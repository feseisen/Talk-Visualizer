#!/usr/bin/env node
/*
 * run_record_node.js — src/record.js の「枠の共有データベース（db）への写し」と「枠の保存（downloads）での書き出し」の試験
 *
 *   node tests/run_record_node.js
 *
 * 本物の db・downloads は呼ばない。ここにある偽の db（メモリの中で doc().set/get/update/delete と
 * collection().where/orderBy/limit/get を、契約（db.d.ts）の形に合わせて実装したもの）で確かめる。
 *
 * 群:
 *   1. 名前       記録の名前 → パスの段（dbSegment）。使えない字は _、日本語の名前どうしが同じ段にならない、長さの上限
 *   2. 追記       3 回の追記 → 文書 3 つ、id が 6 桁の 0 埋め、見出しの lastLog／lastSrc、空の追記は書かない、イベントの中身
 *   3. 直列化     重なった追記でも同じ文書へ同時に 2 つ書かない、重なった分は 1 つの文書にまとまる、順序が保たれる
 *   4. 失敗       1 回の失敗はやり直して通る／2 回で黙る（以後は db を呼ばない）／やり直しても通らない誤りはすぐ黙る
 *   5. loadAll    1000 件を超える頁の繰り、n の順、空、名前の衝突、db が無い、読み込み中は書かない
 *   6. 続き       同じ名前の新しい sink が見出しの続きから番号を振る。見出しが遅れていれば末尾の文書の先から
 *   7. 消す       文書と見出しが消える
 *   8. 保存       downloads の save が通れば true、断られたら false、.jsonl には .txt を足す、空は呼ばない、無ければ false
 *   9. 能力       useCapability は claude.use が無い・null・例外のどれでも null で、決して reject しない
 *  10. 結び付け   makeRecord に attachMirror すると、appendLog／appendSrc が写しにも届く
 *  11. 単一の書き手 書く前に見出しの貸し出し（acquire）を取る。別の端末が持っていれば書かずに止める（other_writer）、
 *                 持っている間は延ばす、切れた後に取り直したら見出しを読み直して末尾の先から、貸し出しの口が無ければ前のとおり書く
 */
'use strict';
const path = require('path');

const KIT = path.resolve(__dirname, '..');
const REC = require(path.join(KIT, 'src', 'record.js'));

const results = [];
function t(group, name, ok, detail) { results.push({ group: group, name: name, ok: !!ok, detail: detail || '' }); }
function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(x[k]); }).join(',') + '}';
  return JSON.stringify(x);
}
function deepEq(a, b) { return canon(a) === canon(b); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); Object.keys(x).forEach(function (k) { deepFreeze(x[k]); }); }
  return x;
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ---- 偽の db（契約 db.d.ts の形） ----
const SEG_RE = /^[A-Za-z0-9_\-.~:@+]+$/;
function makeFakeDb(opts) {
  opts = opts || {};
  const store = new Map();                 // 文書のパス → 本文
  const calls = [];                        // {op, path}
  const inflight = new Map();              // 書き込み中の文書 → 件数
  const failQueue = [];                    // 次の書き込みを落とす code の列
  const leases = new Map();                // 貸し出し中の文書 → {holder, until}
  let overlap = 0;                         // 同じ文書へ同時に 2 つ書いた回数
  let readGate = null;                     // 読みを止める Promise（読み込み中に書かないことの確かめ）
  const delay = opts.delay || function () { return Promise.resolve(); };

  function segs(p) {
    const parts = String(p).split('/');
    parts.forEach(function (s) {
      if (!SEG_RE.test(s) || s === '.' || s === '..') throw new TypeError('パスの段に使えない字: ' + JSON.stringify(s));
      if (Buffer.byteLength(s, 'utf8') > 200) throw new TypeError('パスの段が長すぎる');
    });
    return parts;
  }
  function snap(p) {
    const has = store.has(p);
    const body = has ? deepFreeze(clone(store.get(p))) : undefined;
    return { id: p.split('/').pop(), exists: has, data: function () { return body; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function write(op, p, fn) {
    calls.push({ op: op, path: p });
    const f = failQueue.shift();
    if (f) return Promise.reject({ code: f, message: '試験の失敗 ' + f });
    inflight.set(p, (inflight.get(p) || 0) + 1);
    if (inflight.get(p) > 1) overlap++;
    return delay().then(function () {
      try { fn(); } finally { inflight.set(p, inflight.get(p) - 1); }
    });
  }
  function docRef(p) {
    const parts = segs(p);
    if (parts.length % 2 !== 0) throw new TypeError('文書のパスは偶数の段: ' + p + '（' + parts.length + ' 段）');
    const ref = {
      id: parts[parts.length - 1], path: p,
      get: function () {
        calls.push({ op: 'get', path: p });
        return (readGate || Promise.resolve()).then(delay).then(function () { return snap(p); });
      },
      set: function (data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return Promise.reject({ code: 'invalid_argument', message: '本文は object' });
        return write('set', p, function () { store.set(p, clone(data)); });
      },
      update: function (data) {
        return write('update', p, function () {
          if (!store.has(p)) throw { code: 'invalid_argument', message: '無い文書に update' };
          store.set(p, Object.assign({}, store.get(p), clone(data)));
        });
      },
      delete: function () { return write('delete', p, function () { store.delete(p); }); },
      collection: function (sub) { return colRef(p + '/' + sub); },
      // 貸し出し（契約の acquire）: 持ち主が無い・切れている・同じ持ち主なら与える（同じ持ち主は延ばす）。ほかの持ち主が持っていれば busy。
      // 失敗の列（_failNext）は書き込みにだけ効く（acquire は消費しない）。_noAcquire なら口そのものを置かない
      acquire: function (o) {
        calls.push({ op: 'acquire', path: p, holder: o && o.holder });
        if (opts.acquireReject) return Promise.reject({ code: opts.acquireReject, message: '試験の失敗 ' + opts.acquireReject });
        const ttl = Math.min(600000, Math.max(1000, (o && o.ttlMs) || 30000));
        const ttlReal = opts.ttlAsIs ? ((o && o.ttlMs) || 30000) : ttl;   // 試験では短い ttl をそのまま使う
        const cur = leases.get(p);
        const t = Date.now();
        if (cur && cur.until > t && cur.holder !== (o && o.holder)) return Promise.resolve({ acquired: false, expiresAt: new Date(cur.until).toISOString() });
        const until = t + ttlReal;
        leases.set(p, { holder: o && o.holder, until: until });
        return Promise.resolve({ acquired: true, version: 1, expiresAt: new Date(until).toISOString(), holder: o && o.holder });
      },
      onSnapshot: function () { return function () {}; }
    };
    if (opts.noAcquire) delete ref.acquire;
    return ref;
  }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function query(p, filters, order, lim) {
    const parts = segs(p);
    if (parts.length % 2 !== 1) throw new TypeError('集合のパスは奇数の段: ' + p + '（' + parts.length + ' 段）');
    if (filters.length > 10) throw new TypeError('filter は 10 まで');
    const q = {
      path: p,
      where: function (f, op, v) { return query(p, filters.concat([[f, op, v]]), order, lim); },
      orderBy: function (f, dir) { if (order) throw new TypeError('orderBy は 1 つまで'); return query(p, filters, [f, dir || 'asc'], lim); },
      limit: function (n) { if (!(n >= 1 && n <= 1000)) return Promise.reject({ code: 'invalid_argument', message: 'limit は 1〜1000' }); return query(p, filters, order, n); },
      get: function () {
        calls.push({ op: 'query', path: p });
        return (readGate || Promise.resolve()).then(delay).then(function () {
          let rows = [];
          store.forEach(function (body, dp) {
            const dparts = dp.split('/');
            if (dparts.length !== parts.length + 1 || dp.slice(0, p.length + 1) !== p + '/') return;
            rows.push({ id: dparts[dparts.length - 1], body: body });
          });
          filters.forEach(function (fl) {
            const f = fl[0], op = fl[1], v = fl[2];
            rows = rows.filter(function (r) {
              const x = r.body[f];
              if (op === '==') return x === v; if (op === '!=') return x !== v;
              if (op === '>') return x > v; if (op === '>=') return x >= v;
              if (op === '<') return x < v; if (op === '<=') return x <= v;
              if (op === 'in') return v.indexOf(x) >= 0; if (op === 'not-in') return v.indexOf(x) < 0;
              if (op === 'array-contains') return Array.isArray(x) && x.indexOf(v) >= 0;
              throw new TypeError('知らない op: ' + op);
            });
          });
          if (order) {
            const f = order[0], sign = order[1] === 'desc' ? -1 : 1;
            rows.sort(function (a, b) {
              const ax = a.body[f], bx = b.body[f];
              if (ax === undefined && bx === undefined) return cmp(a.id, b.id);
              if (ax === undefined) return 1; if (bx === undefined) return -1;   // 欄の無い文書は最後
              return sign * cmp(ax, bx) || cmp(a.id, b.id);
            });
          } else rows.sort(function (a, b) { return cmp(a.id, b.id); });
          if (lim) rows = rows.slice(0, lim);
          const docs = rows.map(function (r) { return snap(p + '/' + r.id); });
          return { docs: docs, size: docs.length, empty: !docs.length, docChanges: function () { return []; }, metadata: { fromCache: false, hasPendingWrites: false } };
        });
      },
      onSnapshot: function () { return function () {}; }
    };
    return q;
  }
  function colRef(p) {
    const q = query(p, [], null, 0);
    q.doc = function (id) { return docRef(p + '/' + (id || ('auto' + Math.random().toString(36).slice(2, 10)))); };
    q.add = function (data) { const d = q.doc(); return d.set(data).then(function () { return d; }); };
    return q;
  }
  return {
    doc: docRef, collection: colRef,
    _store: store, _calls: calls,
    _overlap: function () { return overlap; },
    _failNext: function (codes) { codes.forEach(function (c) { failQueue.push(c); }); },
    _gateReads: function (p) { readGate = p; },
    _paths: function (prefix) { return Array.from(store.keys()).filter(function (k) { return k.indexOf(prefix) === 0; }).sort(); },
    _leases: leases,
    _lease: function (p, holder, ms) { leases.set(p, { holder: holder, until: Date.now() + ms }); }   // 別の端末が持っている状態を作る
  };
}

// 試験の中では、やり直しの待ちと時刻を固定する
const fixed = { now: function () { return '2026-10-09T00:00:00Z'; }, wait: function () { return Promise.resolve(); }, srcHoldMs: 0 };
function ev(i) { return { e: 'step', n: i, t: [i * 30, i * 30 + 30], lines: [i, i + 1] }; }

(async function () {
  // ---- 1. 名前 ----
  (function () {
    const seg = REC.dbSegment;
    t('名前', '使える字だけの名前はそのまま', seg('meeting-2026.10_09~a') === 'meeting-2026.10_09~a', seg('meeting-2026.10_09~a'));
    t('名前', '使えない字（空白・記号）は _ に置き換え、元の名前の符号を - で足す', /^a_b_c-[0-9a-f]{8}$/.test(seg('a b/c')), seg('a b/c'));
    t('名前', '日本語の名前は字が _ になるが、符号で区別される', seg('会議A') !== seg('会議B') && /^__A-[0-9a-f]{8}$/.test(seg('会議A')) && seg('会議') !== seg('打合せ'), seg('会議A') + ' / ' + seg('会議B'));
    t('名前', '同じ名前には同じ段（決定的）', seg('定例 10/9') === seg('定例 10/9'));
    t('名前', '空の名前・.・.. も段になる', /^-[0-9a-f]{8}$/.test(seg('')) && /^\.-[0-9a-f]{8}$/.test(seg('.')) && /^\.\.-[0-9a-f]{8}$/.test(seg('..')), [seg(''), seg('.'), seg('..')].join(' '));
    const long = new Array(400).join('x') + 'あ';
    const ls = seg(long);
    t('名前', '長い名前は切り詰めて符号を足し、200 バイトに収まる', Buffer.byteLength(ls, 'utf8') <= 200 && /-[0-9a-f]{8}$/.test(ls), ls.length + ' 字');
    const names = ['会議A', '会議B', '打合せ', 'a b', 'a_b', 'a/b', '', '.', '..', long, 'x'.repeat(160), 'x'.repeat(161)];
    t('名前', 'どの段もパスの規則（字・200 バイト・. と .. でない）を通る', names.every(function (n) { const s = seg(n); return SEG_RE.test(s) && s !== '.' && s !== '..' && Buffer.byteLength(s, 'utf8') <= 200; }));
    t('名前', '異なる名前の段は互いに異なる', new Set(names.map(seg)).size === names.length);
    t('名前', 'null・undefined は空の名前として扱う', seg(null) === seg('') && seg(undefined) === seg(''));
  })();

  // ---- 2. 追記 ----
  await (async function () {
    const db = makeFakeDb();
    const sink = REC.makeDbSink(db, '定例 10/9', fixed);
    const seg = sink.segment;
    t('追記', '作っただけでは db を呼ばない', db._calls.length === 0 && sink.status.db === '未確認');
    const r1 = await sink.appendLog([ev(1)]);
    const r2 = await sink.appendLog([ev(2), ev(3)]);
    const r3 = await sink.appendLog([ev(4)]);
    const logPaths = db._paths('kiku/' + seg + '/log/');
    t('追記', '3 回の追記で文書が 3 つ、id は 6 桁の 0 埋め', r1 === true && r2 === true && r3 === true && deepEq(logPaths, ['kiku/' + seg + '/log/000001', 'kiku/' + seg + '/log/000002', 'kiku/' + seg + '/log/000003']), JSON.stringify(logPaths));
    const d2 = db._store.get('kiku/' + seg + '/log/000002');
    t('追記', '文書は {n, events, at} で、イベントはそのまま', d2 && d2.n === 2 && deepEq(d2.events, [ev(2), ev(3)]) && d2.at === '2026-10-09T00:00:00Z', JSON.stringify(d2));
    const head = db._store.get('kiku/' + seg);
    t('追記', '見出しは {name, started, lastLog, lastSrc, v:1} で、lastLog が 3', deepEq(head, { name: '定例 10/9', started: '2026-10-09T00:00:00Z', lastLog: 3, lastSrc: 0, v: 1 }), JSON.stringify(head));
    await sink.appendSrc([{ i: 1, t: 0, who: 'A', text: 'こんにちは' }]);
    const head2 = db._store.get('kiku/' + seg);
    const srcPaths = db._paths('kiku/' + seg + '/src/');
    t('追記', '素材ログは src の集合に入り、見出しの lastSrc が進む（lastLog は動かない）', deepEq(srcPaths, ['kiku/' + seg + '/src/000001']) && head2.lastSrc === 1 && head2.lastLog === 3, JSON.stringify(head2));
    const before = db._calls.length;
    const r0 = await sink.appendLog([]);
    const rn = await sink.appendLog(null);
    t('追記', '空の追記は書かない（db も呼ばない）', r0 === false && rn === false && db._calls.length === before);
    t('追記', '見出しは 1 回しか set しない（2 回目からは update だけ）', db._calls.filter(function (c) { return c.op === 'set' && c.path === 'kiku/' + seg; }).length === 1);
    t('追記', 'status に写した数と見出しが出る', sink.status.db === '使える' && sink.status.written.log === 4 && sink.status.written.src === 1 && sink.status.docs.log === 3 && sink.status.head.lastLog === 3 && sink.status.error === null, JSON.stringify(sink.status));
    const h = await sink.head();
    t('追記', 'head() は見出しの写しを返す', deepEq(h, head2));
    const src = [ev(9)];
    await sink.appendLog(src);
    src[0].n = 99;
    t('追記', '渡した配列を後で変えても、書いた文書は変わらない（写しを取っている）', db._store.get('kiku/' + seg + '/log/000004').events[0].n === 9);
    const nul = REC.makeDbSink(null, 'x', fixed);
    const rNull = await nul.appendLog([ev(1)]);
    const lNull = await nul.loadAll();
    t('追記', 'db が null なら、何もしない写し（status.db は「無し」、追記は false、loadAll は ok:false）', rNull === false && nul.status.db === '無し' && lNull.ok === false && deepEq(lNull.log, []) && nul.status.dropped === 1, JSON.stringify(nul.status));
  })();

  // ---- 3. 直列化 ----
  await (async function () {
    const db = makeFakeDb({ delay: function () { return sleep(3); } });
    const sink = REC.makeDbSink(db, 'burst', fixed);
    const ps = [];
    for (let i = 1; i <= 6; i++) ps.push(sink.appendLog([ev(i)]));
    for (let i = 1; i <= 6; i++) ps.push(sink.appendSrc([{ i: i, t: i, who: 'A', text: String(i) }]));
    const rs = await Promise.all(ps);
    await sink.flush();
    t('直列化', '重なった追記でも同じ文書へ同時に 2 つ書かない', db._overlap() === 0, '重なり ' + db._overlap());
    t('直列化', '重なった追記は全部通る', rs.every(function (r) { return r === true; }), JSON.stringify(rs));
    const nLog = db._paths('kiku/burst/log/').length;
    const nSrc = db._paths('kiku/burst/src/').length;
    t('直列化', '待っている間に重なった分は 1 つの文書にまとまる（12 回の追記で文書は 12 より少ない）', nLog + nSrc < 12 && nLog >= 1 && nSrc >= 1, 'log ' + nLog + ' / src ' + nSrc);
    const all = await sink.loadAll();
    t('直列化', 'まとめても、イベントの順序は追記した順のまま', all.ok && deepEq(all.log.map(function (e) { return e.n; }), [1, 2, 3, 4, 5, 6]) && deepEq(all.src.map(function (e) { return e.i; }), [1, 2, 3, 4, 5, 6]), JSON.stringify(all.log.map(function (e) { return e.n; })));
    t('直列化', '見出しの lastLog／lastSrc は文書の数と合う', db._store.get('kiku/burst').lastLog === nLog && db._store.get('kiku/burst').lastSrc === nSrc);
    // 素材ログの猶予（srcHoldMs）: 猶予の間に届いた行は 1 つの文書に
    const db2 = makeFakeDb();
    const s2 = REC.makeDbSink(db2, 'hold', { now: fixed.now, wait: fixed.wait, srcHoldMs: 20 });
    const p1 = s2.appendSrc([{ i: 1 }]); await sleep(5); const p2 = s2.appendSrc([{ i: 2 }]);
    const got = await Promise.all([p1, p2]);
    t('直列化', '素材ログは猶予の間に届いた行をまとめて 1 つの文書に書く', got[0] === true && got[1] === true && db2._paths('kiku/hold/src/').length === 1 && db2._store.get('kiku/hold/src/000001').events.length === 2, JSON.stringify(db2._paths('kiku/hold/')));
    const p3 = s2.appendSrc([{ i: 3 }]);
    await s2.flush();
    t('直列化', 'flush() は猶予を待たずに書き切る', (await p3) === true && db2._paths('kiku/hold/src/').length === 2);
  })();

  // ---- 4. 失敗 ----
  await (async function () {
    // 1 回の失敗はやり直して通る
    let db = makeFakeDb();
    let sink = REC.makeDbSink(db, 'retry1', fixed);
    await sink.appendLog([ev(1)]);
    db._failNext(['unavailable']);
    const r = await sink.appendLog([ev(2)]);
    t('失敗', '1 回の失敗はやり直して通る（status.retried が 1、error は無し、lastError に残る）', r === true && sink.status.retried === 1 && sink.status.error === null && /unavailable/.test(sink.status.lastError) && db._paths('kiku/retry1/log/').length === 2, JSON.stringify(sink.status));
    t('失敗', 'やり直しは同じ番号（文書 000002 が 1 つだけ。000003 は無い）', db._store.get('kiku/retry1/log/000002').n === 2 && !db._store.has('kiku/retry1/log/000003'));
    // 2 回失敗で黙る
    db = makeFakeDb();
    sink = REC.makeDbSink(db, 'retry2', fixed);
    await sink.appendLog([ev(1)]);
    db._failNext(['unavailable', 'unavailable']);
    const r2 = await sink.appendLog([ev(2)]);
    const callsAfter = db._calls.length;
    const droppedAfter = sink.status.dropped;
    const r3 = await sink.appendLog([ev(3)]);
    const r4 = await sink.appendSrc([{ i: 1 }]);
    t('失敗', '2 回失敗したら status.error に文を置き、その追記は落とす', r2 === false && typeof sink.status.error === 'string' && /判断ログ/.test(sink.status.error) && sink.status.db === '使えない' && droppedAfter === 1, JSON.stringify(sink.status));
    t('失敗', '以後の追記は黙って落とす（db を呼ばない、dropped が増える）', r3 === false && r4 === false && db._calls.length === callsAfter && sink.status.dropped === 3, 'calls ' + db._calls.length + ' / ' + callsAfter);
    t('失敗', '止めた後も、通った分の文書と見出しは残っている', db._paths('kiku/retry2/log/').length === 1 && db._store.get('kiku/retry2').lastLog === 1);
    // 見出しの update だけ失敗 → やり直しで set が同じ文書に（二重にならない）
    db = makeFakeDb();
    sink = REC.makeDbSink(db, 'headfail', fixed);
    await sink.appendLog([ev(1)]);
    db._failNext([]);
    // 次の追記: set は通し、update を落とす（失敗の列は書き込みの順に消費されるので、set 用に null を挟む）
    db._failNext([null, 'unavailable']);
    const r5 = await sink.appendLog([ev(2)]);
    t('失敗', '見出しの更新だけ落ちても、やり直しで同じ文書に書き直して通る', r5 === true && db._paths('kiku/headfail/log/').length === 2 && db._store.get('kiku/headfail').lastLog === 2 && sink.status.retried === 1, JSON.stringify(sink.status));
    // やり直しても通らない誤りはすぐ黙る
    db = makeFakeDb();
    sink = REC.makeDbSink(db, 'quota', fixed);
    await sink.appendLog([ev(1)]);
    const n0 = db._calls.length;
    db._failNext(['quota_exceeded']);
    const r6 = await sink.appendLog([ev(2)]);
    t('失敗', 'quota_exceeded はやり直さずに止める（retried は 0、error に code）', r6 === false && sink.status.retried === 0 && /quota_exceeded/.test(sink.status.error) && db._calls.slice(n0).filter(function (c) { return c.op === 'set' || c.op === 'update'; }).length === 1, JSON.stringify(sink.status) + ' writes ' + db._calls.slice(n0).filter(function (c) { return c.op === 'set' || c.op === 'update'; }).length);
    // 見出しを読む段階（最初の get）で落ちる → やり直して通る
    db = makeFakeDb();
    sink = REC.makeDbSink(db, 'headget', fixed);
    let failGet = 1;
    const realDoc = db.doc;
    db.doc = function (p) { const d = realDoc(p); if (p === 'kiku/headget') { const g = d.get; d.get = function () { if (failGet-- > 0) return Promise.reject({ code: 'unavailable', message: '読めない' }); return g(); }; } return d; };
    const r7 = await sink.appendLog([ev(1)]);
    t('失敗', '見出しを読む段階で落ちても、やり直して通る', r7 === true && sink.status.retried === 1 && db._store.get('kiku/headget').lastLog === 1, JSON.stringify(sink.status));
    // 例外（code の無い Error）も失敗として扱い、やり直す
    db = makeFakeDb();
    sink = REC.makeDbSink(db, 'throw', fixed);
    const realCol = db.collection;
    let boom = 1;
    db.collection = function (p) { if (boom-- > 0) throw new Error('同期の例外'); return realCol(p); };
    const r8 = await sink.appendLog([ev(1)]);
    t('失敗', '同期の例外も失敗として扱い、やり直して通る', r8 === true && sink.status.retried === 1 && /同期の例外/.test(sink.status.lastError), JSON.stringify(sink.status));
  })();

  // ---- 5. loadAll ----
  await (async function () {
    const db = makeFakeDb();
    const sink = REC.makeDbSink(db, 'big', fixed);
    // 1200 の文書を、sink を通さず直に置く（頁の繰りを見る）。順序が id と n で一致しないように置く順を乱す
    const order = []; for (let i = 1; i <= 1200; i++) order.push(i);
    order.sort(function (a, b) { return (a * 7919) % 1201 - (b * 7919) % 1201; });
    order.forEach(function (n) { db._store.set('kiku/big/log/' + ('000000' + n).slice(-6), { n: n, events: [{ k: n }], at: 'x' }); });
    db._store.set('kiku/big/src/000001', { n: 1, events: [{ i: 1 }, { i: 2 }], at: 'x' });
    db._store.set('kiku/big/src/000002', { n: 2, events: [{ i: 3 }], at: 'x' });
    db._store.set('kiku/big', { name: 'big', started: 'x', lastLog: 1200, lastSrc: 2, v: 1 });
    const all = await sink.loadAll();
    t('loadAll', '1000 件を超える集合は頁を繰って全部読む（1200 文書 → 1200 イベント）', all.ok && all.log.length === 1200 && all.docs.log === 1200, JSON.stringify({ ok: all.ok, n: all.log.length, docs: all.docs, error: all.error }));
    t('loadAll', 'n の順に並ぶ', all.log.every(function (e, i) { return e.k === i + 1; }));
    t('loadAll', '素材ログも n の順に、文書の中のイベントを平らに', deepEq(all.src, [{ i: 1 }, { i: 2 }, { i: 3 }]) && all.docs.src === 2);
    t('loadAll', '見出しも返す', all.head && all.head.lastLog === 1200 && all.head.name === 'big');
    const q = db._calls.filter(function (c) { return c.op === 'query'; }).length;
    t('loadAll', '頁は 1000 件ずつ（log は 2 頁、src は 1 頁、末尾の確かめが 2 回）', q === 5, 'query ' + q);
    const r = await sink.appendLog([ev(1)]);
    t('loadAll', '読んだ後の追記は続きの番号（001201）', r === true && db._store.has('kiku/big/log/001201') && db._store.get('kiku/big').lastLog === 1201);
    t('loadAll', '返したイベントは凍っていない写し（書き換えられる）', (function () { try { all.log[0].k = -1; return all.log[0].k === -1; } catch (e) { return false; } })());
    // 空
    const db2 = makeFakeDb();
    const s2 = REC.makeDbSink(db2, 'empty', fixed);
    const e = await s2.loadAll();
    t('loadAll', '何も無ければ ok で空の配列 2 本、見出しは null。読むだけで書かない', e.ok && deepEq(e.log, []) && deepEq(e.src, []) && e.head === null && db2._calls.every(function (c) { return c.op === 'get' || c.op === 'query'; }), JSON.stringify(e));
    // 名前の衝突（同じ段に別の名前の見出し）
    const db3 = makeFakeDb();
    db3._store.set('kiku/same', { name: 'other', started: 'x', lastLog: 2, lastSrc: 0, v: 1 });
    const s3 = REC.makeDbSink(db3, 'same', fixed);
    const c = await s3.loadAll();
    const w = await s3.appendLog([ev(1)]);
    t('loadAll', '同じ置き場に別の名前の見出しがあれば ok:false で、書きもしない', c.ok === false && /other/.test(c.error) && w === false && db3._store.get('kiku/same').lastLog === 2 && !db3._store.has('kiku/same/log/000003'), JSON.stringify(c));
    // 読み込み中は書かない
    const db4 = makeFakeDb();
    let open; const gate = new Promise(function (r2) { open = r2; });
    db4._gateReads(gate);
    const s4 = REC.makeDbSink(db4, 'gate', fixed);
    const lp = s4.loadAll();
    const ap = s4.appendLog([ev(1)]);
    await sleep(10);
    const writesDuring = db4._calls.filter(function (c2) { return c2.op === 'set' || c2.op === 'update'; }).length;
    open();
    const lr = await lp; const ar = await ap;
    const writesAfter = db4._calls.filter(function (c2) { return c2.op === 'set' || c2.op === 'update'; }).length;
    t('loadAll', '読み込み中は書かず、読み終えてから書く', writesDuring === 0 && lr.ok && ar === true && writesAfter >= 2 && s4.status.loading === false, 'during ' + writesDuring + ' after ' + writesAfter);
    t('loadAll', '読み込み中に来た追記は、読んだ結果には入らない（読んだ時点の分だけ）', lr.log.length === 0);
    // 壊れた文書（n が無い）は読まず、止まる（無限に繰らない）
    const db5 = makeFakeDb();
    for (let i = 1; i <= 1000; i++) db5._store.set('kiku/bad/log/' + ('000000' + i).slice(-6), { events: [{ k: i }], at: 'x' });
    db5._store.set('kiku/bad/log/001001', { n: 1, events: [{ k: 'ok' }], at: 'x' });
    const s5 = REC.makeDbSink(db5, 'bad', fixed);
    const b = await s5.loadAll();
    t('loadAll', 'n の無い文書が 1 頁ぶん並んでいても、n のある文書だけ読んで止まる', b.ok && deepEq(b.log, [{ k: 'ok' }]), JSON.stringify({ ok: b.ok, n: b.log.length }));
  })();

  // ---- 6. 続き ----
  await (async function () {
    // 同じタブで読み込み直した形（貸し出しの持ち主の名前が同じ）。別の端末の形は 11. 単一の書き手
    const db = makeFakeDb();
    const same = Object.assign({}, fixed, { holder: 'same-tab' });
    const a = REC.makeDbSink(db, 'cont', same);
    await a.appendLog([ev(1)]); await a.appendLog([ev(2)]); await a.appendSrc([{ i: 1 }]);
    const b = REC.makeDbSink(db, 'cont', same);
    await b.appendLog([ev(3)]);
    t('続き', '同じ名前の新しい sink は、見出しの続きから番号を振る（000003）', db._store.has('kiku/cont/log/000003') && db._store.get('kiku/cont').lastLog === 3 && db._store.get('kiku/cont').started === '2026-10-09T00:00:00Z');
    t('続き', '見出しは作り直さない（set は 1 回のまま）', db._calls.filter(function (c) { return c.op === 'set' && c.path === 'kiku/cont'; }).length === 1);
    // 見出しが遅れている（文書は 5 まであるのに lastLog が 3）→ 末尾の先から
    db._store.set('kiku/cont/log/000004', { n: 4, events: [ev(4)], at: 'x' });
    db._store.set('kiku/cont/log/000005', { n: 5, events: [ev(5)], at: 'x' });
    const c = REC.makeDbSink(db, 'cont', same);
    await c.appendLog([ev(6)]);
    t('続き', '見出しが末尾より遅れていれば、末尾の文書の先（000006）から。既にある文書を上書きしない', db._store.has('kiku/cont/log/000006') && db._store.get('kiku/cont/log/000004').events[0].n === 4 && db._store.get('kiku/cont').lastLog === 6);
    // 見出しだけ消えている（文書は残っている）→ 見出しを作り直し、末尾の先から
    const db2 = makeFakeDb();
    db2._store.set('kiku/orphan/log/000002', { n: 2, events: [ev(2)], at: 'x' });
    const d = REC.makeDbSink(db2, 'orphan', fixed);
    await d.appendLog([ev(3)]);
    t('続き', '見出しが無くて文書だけ残っていれば、見出しを作って末尾の先から', db2._store.has('kiku/orphan/log/000003') && db2._store.get('kiku/orphan').lastLog === 3);
  })();

  // ---- 7. 消す ----
  await (async function () {
    const db = makeFakeDb();
    const s = REC.makeDbSink(db, 'gone', fixed);
    await s.appendLog([ev(1)]); await s.appendLog([ev(2)]); await s.appendSrc([{ i: 1 }]);
    db._store.set('kiku/other/log/000001', { n: 1, events: [], at: 'x' });   // 別の名前の文書は消さない
    const ok = await s.clear();
    t('消す', 'clear() で文書と見出しが消え、別の名前の文書は残る', ok === true && db._paths('kiku/gone').length === 0 && db._store.has('kiku/other/log/000001'), JSON.stringify(db._paths('kiku/')));
    await s.appendLog([ev(9)]);
    t('消す', '消した後の追記は 000001 から、見出しも作り直す', db._store.has('kiku/gone/log/000001') && db._store.get('kiku/gone').lastLog === 1 && s.status.docs.log === 1);
    const nul = REC.makeDbSink(null, 'x', fixed);
    t('消す', 'db が無ければ false', (await nul.clear()) === false);
  })();

  // ---- 8. 保存 ----
  await (async function () {
    t('保存', '.jsonl には .txt を足す。許された拡張子はそのまま', REC.downloadFilename('a.jsonl') === 'a.jsonl.txt' && REC.downloadFilename('a.src.jsonl') === 'a.src.jsonl.txt' && REC.downloadFilename('a.txt') === 'a.txt' && REC.downloadFilename('a.JSON') === 'a.JSON' && REC.downloadFilename('noext') === 'noext.txt');
    const got = [];
    const fake = { save: function (req) { got.push(req); if (req.filename.indexOf('no') === 0) return Promise.reject({ code: 'declined', message: 'no' }); return Promise.resolve({ status: 'saved' }); } };
    const x = REC.makeDownloadsExport(fake);
    const a = await x.save('会議.jsonl', '{"e":"open"}\n');
    t('保存', '通れば true、呼び出しは {filename, data} で、拡張子は .txt を足した名前', a === true && got.length === 1 && got[0].filename === '会議.jsonl.txt' && got[0].data === '{"e":"open"}\n' && x.status.lastSaved === '会議.jsonl.txt' && x.status.reason === null, JSON.stringify(got));
    const b = await x.save('no.txt', 'x');
    t('保存', '断られたら false で、理由が日本語で status に出る', b === false && x.status.lastError.code === 'declined' && x.status.reason === '保存しなかった', JSON.stringify(x.status));
    const c = await x.save('c.txt', '');
    t('保存', '中身が空なら呼ばずに false', c === false && got.length === 2 && x.status.lastError.code === 'empty');
    const thrower = { save: function () { throw new Error('同期の例外'); } };
    const y = REC.makeDownloadsExport(thrower);
    t('保存', 'save が同期の例外を投げても false', (await y.save('a.txt', 'x')) === false && y.status.lastError.code === 'unavailable');
    const z = REC.makeDownloadsExport(null);
    t('保存', 'downloads が無ければ false（status.downloads は「無し」）', (await z.save('a.txt', 'x')) === false && z.status.downloads === '無し' && z.status.lastError.code === 'unavailable');
    const unknown = REC.makeDownloadsExport({ save: function () { return Promise.reject({ code: 'something_new', message: '?' }); } });
    await unknown.save('a.txt', 'x');
    t('保存', '知らない code は unavailable と同じ文', unknown.status.reason === 'この画面では保存できない' && unknown.status.lastError.code === 'something_new');
  })();

  // ---- 9. 能力 ----
  await (async function () {
    const saved = globalThis.claude;
    try {
      delete globalThis.claude;
      t('能力', 'claude が無ければ null', (await REC.useCapability('db')) === null);
      globalThis.claude = { complete: function () { return Promise.resolve('x'); } };
      t('能力', '古い形（complete だけ）なら null', (await REC.useCapability('db')) === null);
      globalThis.claude = { use: function () { return null; } };
      t('能力', 'use が null を返せば null', (await REC.useCapability('db')) === null);
      globalThis.claude = { use: function () { throw new Error('x'); } };
      t('能力', 'use が例外を投げても null（reject しない）', (await REC.useCapability('db')) === null);
      globalThis.claude = { use: function () { return Promise.reject(new Error('x')); } };
      t('能力', 'use が reject しても null', (await REC.useCapability('db')) === null);
      const obj = { doc: function () {} };
      globalThis.claude = { use: function (n) { return n === 'db' ? Promise.resolve(obj) : Promise.resolve(null); } };
      t('能力', 'use が返したものをそのまま返す', (await REC.useCapability('db')) === obj && (await REC.useCapability('downloads')) === null);
    } finally { if (saved === undefined) delete globalThis.claude; else globalThis.claude = saved; }
  })();

  // ---- 10. 結び付け ----
  await (async function () {
    const db = makeFakeDb();
    const rec = REC.makeRecord('mirror');          // node には indexedDB が無いので、メモリだけの記録になる
    const sink = REC.makeDbSink(db, 'mirror', fixed);
    rec.appendLog([ev(1)]);                          // 結び付ける前の分は写さない
    rec.attachMirror(sink);
    rec.appendLog([ev(2)]);
    rec.appendSrc({ i: 1, t: 0, who: 'A', text: 'x' });
    await sink.flush();
    t('結び付け', 'attachMirror の後の appendLog／appendSrc が写しに届き、前の分は届かない', db._paths('kiku/mirror/log/').length === 1 && db._store.get('kiku/mirror/log/000001').events[0].n === 2 && db._paths('kiku/mirror/src/').length === 1, JSON.stringify(db._paths('kiku/mirror')));
    t('結び付け', '記録の本体（メモリ）は従来どおり', rec.log.length === 2 && rec.src.length === 1);
    await rec.clear();
    t('結び付け', '記録の clear() で写しも消える', db._paths('kiku/mirror').length === 0 && rec.log.length === 0);
    rec.attachMirror(null);
    rec.appendLog([ev(3)]);
    await sink.flush();
    t('結び付け', 'null で外すと届かない', db._paths('kiku/mirror').length === 0);
  })();

  // ---- 11. 単一の書き手 ----
  await (async function () {
    const G = '単一の書き手';
    // 2 つの端末（sink）が同じ名前を同時に写す: 先に書いた側が貸し出しを持ち、後の側は書かずに止まる（上書きで黙って消さない）
    let db = makeFakeDb({ ttlAsIs: true });
    const a = REC.makeDbSink(db, 'two', Object.assign({}, fixed, { leaseMs: 60, holder: 'tab-a' }));
    const b = REC.makeDbSink(db, 'two', Object.assign({}, fixed, { leaseMs: 60, holder: 'tab-b' }));
    const ra = await a.appendLog([ev(1)]);
    const rb = await b.appendLog([ev(99)]);
    const ra2 = await a.appendLog([ev(2)]);
    t(G, '先に書いた端末は通り、後の端末は other_writer で書かずに止まる（文書は a の 2 つだけ。000001 の中身は a のまま）',
      ra === true && rb === false && ra2 === true && db._paths('kiku/two/log/').length === 2 && db._store.get('kiku/two/log/000001').events[0].n === 1 && db._store.get('kiku/two').lastLog === 2,
      JSON.stringify({ ra: ra, rb: rb, paths: db._paths('kiku/two/log/') }));
    t(G, '止まった端末の status に「別の端末（タブ）が同じ記録を写している」と出て、落とした数が数えられ、以後は db を呼ばない',
      b.status.db === '使えない' && /別の端末（タブ）が同じ記録を写している/.test(b.status.error) && /other_writer/.test(b.status.error) && b.status.dropped === 1 && b.status.retried === 0,
      JSON.stringify(b.status));
    const nb = db._calls.length;
    await b.appendLog([ev(100)]);
    t(G, '止まった端末の次の追記は黙って落とす', db._calls.length === nb && b.status.dropped === 2);
    const acq = db._calls.filter(function (c) { return c.op === 'acquire'; });
    t(G, 'acquire は見出しの文書に持ち主の名前で呼ばれる（a は書くたびに 1 回ずつ 2 回、b は busy のあと 1 回だけ取り直して 2 回）', acq.length === 4 && acq.every(function (c) { return c.path === 'kiku/two'; }) && acq.filter(function (c) { return c.holder === 'tab-a'; }).length === 2 && acq.filter(function (c) { return c.holder === 'tab-b'; }).length === 2, JSON.stringify(acq));
    // 貸し出しが切れた後は、別の端末が書き手になれる。取り直したときは見出しと末尾を読み直し、末尾の先から（上書きしない）
    await sleep(80);
    const c = REC.makeDbSink(db, 'two', Object.assign({}, fixed, { leaseMs: 60, holder: 'tab-c' }));
    const rc = await c.appendLog([ev(3)]);
    t(G, '貸し出しが切れた後は別の端末が書き手になれ、末尾の先（000003）から続ける', rc === true && db._store.has('kiku/two/log/000003') && db._store.get('kiku/two/log/000002').events[0].n === 2 && db._store.get('kiku/two').lastLog === 3, JSON.stringify(db._paths('kiku/two/log/')));
    // a は持っていた貸し出しが切れている（c が持っている）→ 書かずに止まる
    const ra3 = await a.appendLog([ev(4)]);
    t(G, '持っていた貸し出しを失った端末は、次に書こうとしたとき other_writer で止まる（c の文書を上書きしない）', ra3 === false && /別の端末/.test(a.status.error) && db._store.get('kiku/two/log/000003').events[0].n === 3 && db._paths('kiku/two/log/').length === 3, JSON.stringify(a.status));
    // 同じ端末が間を置いて書くと（貸し出しが切れていても、誰も取っていなければ）取り直して続ける。
    // 取り直したときは見出しを読み直すので、間に別の端末が残した文書（見出しの更新だけ通らなかった形）の先から
    db = makeFakeDb({ ttlAsIs: true });
    const d = REC.makeDbSink(db, 'gap', Object.assign({}, fixed, { leaseMs: 30, holder: 'tab-d' }));
    await d.appendLog([ev(1)]);
    const getsBefore = db._calls.filter(function (x) { return x.op === 'get' || x.op === 'query'; }).length;
    await sleep(50);
    db._store.set('kiku/gap/log/000002', { n: 2, events: [ev(2)], at: 'x' });   // 別の端末が残した文書（見出しは 1 のまま）
    const rd = await d.appendLog([ev(3)]);
    const getsAfter = db._calls.filter(function (x) { return x.op === 'get' || x.op === 'query'; }).length;
    t(G, '切れた貸し出しを取り直したときは見出しと末尾を読み直し、別の端末が残した文書の先（000003）に書く', rd === true && getsAfter > getsBefore && db._store.has('kiku/gap/log/000003') && db._store.get('kiku/gap/log/000002').events[0].n === 2 && db._store.get('kiku/gap').lastLog === 3, JSON.stringify(db._paths('kiku/gap/log/')));
    // 持っている間は読み直さない（延ばすだけ）
    const getsBefore2 = db._calls.filter(function (x) { return x.op === 'get' || x.op === 'query'; }).length;
    await d.appendLog([ev(4)]);
    const getsAfter2 = db._calls.filter(function (x) { return x.op === 'get' || x.op === 'query'; }).length;
    t(G, '貸し出しを持っている間の追記は、見出しを読み直さず延ばすだけ', getsAfter2 === getsBefore2 && db._store.has('kiku/gap/log/000004'));
    // 別の端末が持っていても、その端末が閉じられて延ばされなければ、切れる時刻まで待ってから取れる（待ちは wait を通す）
    const dbW = makeFakeDb({ ttlAsIs: true });
    dbW._lease('kiku/wait', 'closed-tab', 40);
    const waits = [];
    const w = REC.makeDbSink(dbW, 'wait', { now: fixed.now, srcHoldMs: 0, leaseMs: 60, holder: 'tab-w', wait: function (ms) { waits.push(ms); return sleep(ms); } });
    const rw = await w.appendLog([ev(1)]);
    t(G, '別の端末の貸し出しが切れる時刻まで 1 回だけ待ち、延ばされなければ取って書く', rw === true && waits.length === 1 && waits[0] >= 200 && waits[0] <= 60 + 200 && dbW._store.has('kiku/wait/log/000001') && w.status.error === null, JSON.stringify(waits));
    // 同じタブで読み込み直した形（持ち主の名前が同じ）は、相手の貸し出しが残っていても待たずに延ばして書く
    const dbR = makeFakeDb({ ttlAsIs: true });
    dbR._lease('kiku/reload', 'tab-r', 60000);
    const waitsR = [];
    const rr = REC.makeDbSink(dbR, 'reload', { now: fixed.now, srcHoldMs: 0, leaseMs: 60, holder: 'tab-r', wait: function (ms) { waitsR.push(ms); return sleep(ms); } });
    const rrr = await rr.appendLog([ev(1)]);
    t(G, '同じ持ち主の名前なら（同じタブで読み込み直した形）、残っている貸し出しを待たずに延ばして書く', rrr === true && waitsR.length === 0 && dbR._store.has('kiku/reload/log/000001'));
    // 貸し出しの口が無い古い仕組み（acquire が無い・capability_removed）では、調停できないまま前のとおり書く
    const dbOld = makeFakeDb({ noAcquire: true });
    const e1 = REC.makeDbSink(dbOld, 'old', fixed);
    const re1 = await e1.appendLog([ev(1)]);
    t(G, 'acquire の無い db では、調停せずに前のとおり書く', re1 === true && dbOld._store.has('kiku/old/log/000001') && e1.status.error === null);
    const dbRm = makeFakeDb({ acquireReject: 'capability_removed' });
    const e2 = REC.makeDbSink(dbRm, 'rm', fixed);
    const re2 = await e2.appendLog([ev(1)]);
    t(G, 'acquire が capability_removed で断られても、前のとおり書く', re2 === true && dbRm._store.has('kiku/rm/log/000001') && e2.status.error === null && e2.status.retried === 0);
    // acquire が一時の失敗（unavailable）なら、書き込みと同じにやり直して通る
    const dbUn = makeFakeDb({ acquireReject: 'unavailable' });
    const e3 = REC.makeDbSink(dbUn, 'un', fixed);
    const re3 = await e3.appendLog([ev(1)]);
    t(G, 'acquire が unavailable で落ちても、書き込みと同じに 1 回やり直し（2 回とも落ちれば止める）', re3 === false && e3.status.retried === 1 && /unavailable/.test(e3.status.error) && !dbUn._store.has('kiku/un/log/000001'), JSON.stringify(e3.status));
    // loadAll（読むだけ）は貸し出しを取らない
    const dbRo = makeFakeDb({ ttlAsIs: true });
    dbRo._lease('kiku/ro', 'someone-else', 60000);
    const e4 = REC.makeDbSink(dbRo, 'ro', fixed);
    dbRo._store.set('kiku/ro', { name: 'ro', started: 'x', lastLog: 1, lastSrc: 0, v: 1 });
    dbRo._store.set('kiku/ro/log/000001', { n: 1, events: [ev(1)], at: 'x' });
    const all = await e4.loadAll();
    t(G, '読むだけ（loadAll）は貸し出しを取らず、別の端末が持っていても読める', all.ok && all.log.length === 1 && dbRo._calls.filter(function (x) { return x.op === 'acquire'; }).length === 0, JSON.stringify(all));
    const re4 = await e4.appendLog([ev(2)]);
    t(G, '読んだ後に書こうとすると、別の端末が持っているので書かずに止まる（別の端末の文書は残る）', re4 === false && /別の端末/.test(e4.status.error) && dbRo._store.has('kiku/ro/log/000001') && !dbRo._store.has('kiku/ro/log/000002'));
  })();

  report();
})().catch(function (e) { console.error('試験そのものが例外で止まりました: ' + (e && e.stack || e)); process.exit(1); });

function report() {
  const groups = {};
  results.forEach(function (r) {
    groups[r.group] = groups[r.group] || { ok: 0, ng: 0 };
    groups[r.group][r.ok ? 'ok' : 'ng']++;
    if (!r.ok) console.log('不合格 [' + r.group + '] ' + r.name + (r.detail ? '\n        ' + r.detail : ''));
  });
  console.log('');
  Object.keys(groups).forEach(function (g) { console.log(g + ': 合格 ' + groups[g].ok + ' / 不合格 ' + groups[g].ng); });
  const ng = results.filter(function (r) { return !r.ok; }).length;
  console.log('合計 ' + results.length + ' 件、不合格 ' + ng + ' 件');
  process.exit(ng ? 1 : 0);
}
