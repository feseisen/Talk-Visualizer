/*
 * record.js — 記録。判断ログ（<会議名>.jsonl）と素材ログ（<会議名>.src.jsonl）の 2 本。どちらも追記専用
 *
 *   - メモリの配列に積み、同時に IndexedDB（データベース kiku）へ 1 行ずつ追記する
 *   - 「書き出す」で jsonl ／ src.jsonl を a[download] で落とす
 *   - File System Access が使えれば、本物のファイルにも追記する（使えなければ黙って IndexedDB だけ）
 *   - 「記録を消す」で、この会議名の行を IndexedDB から消す
 *   - claude.ai のアーティファクトの枠の中では、枠の共有データベース（db）に写しを置ける（makeDbSink。下の節。
 *     同じ名前を 2 つの端末が同時に写さないよう、見出しの貸し出しを持つ端末だけが書く）。
 *     枠の中では保存の画面も a[download] も使えないので、書き出しは枠の保存（downloads）で（makeDownloadsExport）
 *
 * 一度書いた行には手を入れない。直すときは fix イベントを足して表す（format/FORMAT.md）。
 * ここには検査が無い。追記の前に verify.js を通すのは呼ぶ側（app.js）の責任
 */
(function () {
  'use strict';

  const DB_NAME = 'kiku';
  const DB_VER = 1;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!globalThis.indexedDB) { reject(new Error('ブラウザ内の保存が無い')); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        const db = req.result;
        ['log', 'src'].forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            const os = db.createObjectStore(name, { autoIncrement: true });
            os.createIndex('name', 'name', { unique: false });
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('ブラウザ内の保存を開けない')); };
    });
  }

  function makeRecord(name) {
    const rec = { name: name, log: [], src: [] };
    let dbp = null;
    let chain = Promise.resolve();     // IndexedDB への書き込みを順番どおりにする
    const handles = { log: null, src: null };
    const fsChain = { log: Promise.resolve(), src: Promise.resolve() };
    const status = { idb: '未確認', fs: { log: '無し', src: '無し' }, lastError: null };
    let mirror = null;                 // 枠の共有データベースへの写し（makeDbSink）。無ければ null。失敗しても記録は止めない

    function db() {
      if (!dbp) dbp = openDb().then(function (d) { status.idb = '使える'; return d; }, function (e) { status.idb = '使えない（' + (e && e.message || e) + '）'; throw e; });
      return dbp;
    }

    // 既存の記録を読む（同じ会議名の行を鍵の順に）。無ければ空
    function load() {
      return db().then(function (d) {
        return Promise.all(['log', 'src'].map(function (store) {
          return new Promise(function (resolve) {
            const out = [];
            let tx;
            try { tx = d.transaction(store, 'readonly'); } catch (e) { resolve(out); return; }
            const idx = tx.objectStore(store).index('name');
            const cur = idx.openCursor(IDBKeyRange.only(name));
            cur.onsuccess = function () {
              const c = cur.result;
              if (c) { out.push(c.value.ev); c.continue(); } else resolve(out);
            };
            cur.onerror = function () { resolve(out); };
          });
        }));
      }).then(function (r) {
        rec.log = r[0]; rec.src = r[1];
        return { log: rec.log.length, src: rec.src.length };
      }, function () { return { log: 0, src: 0, idb: false }; });
    }

    function persist(store, evs) {
      chain = chain.then(function () {
        return db().then(function (d) {
          return new Promise(function (resolve) {
            let tx;
            try { tx = d.transaction(store, 'readwrite'); } catch (e) { status.lastError = e; resolve(); return; }
            const os = tx.objectStore(store);
            evs.forEach(function (ev) { os.add({ name: name, ev: ev }); });
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { status.lastError = tx.error; resolve(); };
            tx.onabort = function () { status.lastError = tx.error; resolve(); };
          });
        }, function () { /* IndexedDB が無いときはメモリだけ */ });
      });
      return chain;
    }

    // File System Access への追記（使えるときだけ。失敗しても記録そのものは止めない）
    function fsAppend(kind, text) {
      const h = handles[kind];
      if (!h) return Promise.resolve();
      fsChain[kind] = fsChain[kind].then(function () {
        return h.getFile().then(function (f) {
          return h.createWritable({ keepExistingData: true }).then(function (w) {
            return w.seek(f.size).then(function () { return w.write(text); }).then(function () { return w.close(); });
          });
        });
      }).catch(function (e) { status.fs[kind] = '書けなかった（' + (e && e.message || e) + '）'; });
      return fsChain[kind];
    }

    function lines(evs) { return evs.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n'; }

    function appendLog(batch) {
      const evs = batch.map(function (e) { return JSON.parse(JSON.stringify(e)); });
      evs.forEach(function (e) { rec.log.push(e); });
      persist('log', evs);
      fsAppend('log', lines(evs));
      if (mirror) mirror.appendLog(evs);
      return evs;
    }
    function appendSrc(line) {
      const ev = JSON.parse(JSON.stringify(line));
      rec.src.push(ev);
      persist('src', [ev]);
      fsAppend('src', lines([ev]));
      if (mirror) mirror.appendSrc([ev]);
      return ev;
    }
    // 枠の共有データベースへの写し（makeDbSink の返り値）を結び付ける。以後の追記と「消す」が写しにも届く。
    // null で外す。結び付ける前の分は写さない（続きから聞くときは、先に sink.loadAll() で写しの側を読む）
    function attachMirror(sink) { mirror = sink || null; return mirror; }

    function download(fname, text) {
      const blob = new Blob([text], { type: 'application/x-ndjson;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname; a.style.display = 'none';   // 枠では使わない（app.js は枠の中では枠の保存を使い、ここへ来ない）
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    }
    // 書き出す。保存の画面（showSaveFilePicker）が使えればそれで名前を付けて保存し、無ければ a[download] で落とす
    // （file:// から a[download] で落とすと、名前が「download」になる環境がある。Chromium の headless で観測。実機は未確認）。
    // 返す値: 'picker'（選んだ保存先に保存した）／'cancelled'（保存先を選ばなかった）／'download'（保存の画面が無いので
    // a[download] で落とした）／'fallback'（保存の画面を開けなかった・保存できなかったので a[download] で落とした。
    // Chromium は押してから約 5 秒を過ぎると 2 つ目の保存の画面を開かせない（SecurityError）。1 つ目の画面で迷うと 2 つ目がこれになる）
    function exportVia(fname, text) {
      if (typeof globalThis.showSaveFilePicker === 'function') {
        return globalThis.showSaveFilePicker({ suggestedName: fname }).then(function (h) {
          return h.createWritable().then(function (w) { return w.write(text).then(function () { return w.close(); }); }).then(function () { return 'picker'; });
        }).catch(function (e) {
          if (e && e.name === 'AbortError') return 'cancelled';
          download(fname, text); return 'fallback';
        });
      }
      download(fname, text);
      return Promise.resolve('download');
    }
    function exportLog() { return exportVia(name + '.jsonl', lines(rec.log)); }
    function exportSrc() { return exportVia(name + '.src.jsonl', lines(rec.src)); }

    // 本物のファイルに追記する（File System Access）。いまある分を先に書き、以後は追記
    function bindFile(kind) {
      if (typeof globalThis.showSaveFilePicker !== 'function') { status.fs[kind] = 'この環境では使えない'; return Promise.resolve(false); }
      const suggested = kind === 'log' ? name + '.jsonl' : name + '.src.jsonl';
      return globalThis.showSaveFilePicker({ suggestedName: suggested }).then(function (h) {
        handles[kind] = h;
        return h.createWritable().then(function (w) {
          return w.write(lines(kind === 'log' ? rec.log : rec.src)).then(function () { return w.close(); });
        }).then(function () { status.fs[kind] = '書いている（' + (h.name || suggested) + '）'; return true; });
      }).catch(function (e) { status.fs[kind] = '結び付けなかった（' + (e && e.message || e) + '）'; return false; });
    }

    // この会議名の行を IndexedDB から消し、メモリも空にする（写しが結び付いていれば、写しの側も消す）
    function clear() {
      rec.log = []; rec.src = [];
      const m = mirror;
      chain = chain.then(function () {
        return db().then(function (d) {
          return Promise.all(['log', 'src'].map(function (store) {
            return new Promise(function (resolve) {
              let tx;
              try { tx = d.transaction(store, 'readwrite'); } catch (e) { resolve(); return; }
              const idx = tx.objectStore(store).index('name');
              const cur = idx.openCursor(IDBKeyRange.only(name));
              cur.onsuccess = function () { const c = cur.result; if (c) { c.delete(); c.continue(); } };
              tx.oncomplete = function () { resolve(); };
              tx.onerror = function () { resolve(); };
            });
          }));
        }, function () {});
      }).then(function () { return m ? m.clear() : undefined; });
      return chain;
    }

    return {
      name: name,
      get log() { return rec.log; },
      get src() { return rec.src; },
      load: load,
      appendLog: appendLog,
      appendSrc: appendSrc,
      exportLog: exportLog,
      exportSrc: exportSrc,
      bindFile: bindFile,
      clear: clear,
      flush: function () { return chain; },
      attachMirror: attachMirror,
      status: status
    };
  }

  // ---- 枠の共有データベース（db）への写し ----
  //
  // claude.ai のアーティファクトの枠の中では、await claude.use('db') で枠の共有データベースが使える（無ければ null）。
  // 記録の本体は上の IndexedDB で、ここはその写し。別のタブや別の端末から「続きから聞く」ための材料になる。
  // 写しが書けなくても本体は止めない（失敗は status に残し、1 回だけやり直し、それでも駄目なら以後は黙って落とす）
  //
  //   見出し    kiku/<名前>             {name, started, lastLog, lastSrc, v:1}
  //   判断ログ  kiku/<名前>/log/<6 桁>  {n, events, at}   n は 1 から。id は n を 6 桁に 0 埋めした文字列（並べ替えのため）
  //   素材ログ  kiku/<名前>/src/<6 桁>  同じ
  //
  // <名前> は記録の名前をパスに使える字（英数字と _ - . ~ : @ +）に直したもの（dbSegment）。
  // 書き込みは 1 本の列に直列化する（前の書き込みが終わるまで次を待つ。同じ文書へ同時に 2 つ書かない）。
  // 読み込み中は書かない。空の追記は書かない。追記が重なった分は 1 つの文書にまとめる（文書の数を増やさないため）

  const SEG_OK = /^[A-Za-z0-9_\-.~:@+]$/;
  const SEG_MAX = 150;   // パスの段は 200 バイトまで。直した後は ASCII だけなので文字数 = バイト数。符号を足す分を残す

  // 文字列の短い符号（FNV-1a 32 ビット、16 進 8 桁）。名前の衝突を避けるためだけで、秘密ではない
  function hash8(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  // 記録の名前 → パスの段。使えない字は _ に置き換える。置き換えや切り詰めがあったら、元の名前の符号を - で足す
  // （日本語の名前はすべて _ になるので、符号が無いと「会議A」と「会議B」が同じ置き場になる）
  function dbSegment(name) {
    const s = String(name == null ? '' : name);
    let out = '';
    let changed = false;
    Array.from(s).forEach(function (ch) {
      if (SEG_OK.test(ch)) out += ch; else { out += '_'; changed = true; }
    });
    if (out.length > SEG_MAX) { out = out.slice(0, SEG_MAX); changed = true; }
    if (out === '' || out === '.' || out === '..') changed = true;
    return changed ? out + '-' + hash8(s) : out;
  }

  // やり直しても通らない誤り（契約の決まり: 呼び方の誤り・容量・取り消し・枠の都合）。name_conflict と other_writer はこちらで付ける
  const NO_RETRY = { invalid_argument: 1, quota_exceeded: 1, revoked: 1, not_granted: 1, capability_disabled: 1, capability_removed: 1, transform_error: 1, name_conflict: 1, other_writer: 1 };
  const LEASE_MS = 30000;   // 見出しの貸し出し（acquire）の長さ。書くたびに延ばす。これより長く書かなければ、別の端末が書き手になれる
  // 貸し出しの持ち主の名前。同じタブでは読み込み直しても同じ名前になるよう sessionStorage に覚える（使えなければその場の乱数）。
  // 読み込み直した直後も自分の前の貸し出しを延ばせるので、切れるまで待たずに書ける。別のタブ・別の端末は別の名前になる
  let holderCache = null;
  function tabHolder() {
    if (holderCache) return holderCache;
    const KEY = 'kiku.holder';
    let h = null;
    try { h = globalThis.sessionStorage ? sessionStorage.getItem(KEY) : null; } catch (e) { h = null; }
    if (!h) {
      h = 'kiku-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      try { if (globalThis.sessionStorage) sessionStorage.setItem(KEY, h); } catch (e) { /* 覚えられなければその場限りの名前 */ }
    }
    holderCache = h;
    return h;
  }
  function errText(e) {
    if (!e) return '不明';
    const code = typeof e.code === 'string' ? e.code : '';
    const msg = (e.message !== undefined && e.message !== null) ? String(e.message) : (typeof e === 'string' ? e : '');
    return code ? code + (msg ? '（' + msg + '）' : '') : (msg || String(e));
  }

  // db: await claude.use('db') の返り値（null なら何もしない写し）。name: 記録の名前。
  // opts は試験のため（now: 時刻の文字列を返す、wait: やり直しの前に待つ、srcHoldMs: 素材ログをまとめて書くまでの猶予、
  // leaseMs: 貸し出しの長さ、holder: 貸し出しの持ち主の名前）
  //
  // 単一の書き手: 書く前に見出しの文書へ短い貸し出し（acquire）を掛け、持てたときだけ書く。契約（db.d.ts）は「書き込みは後勝ちで
  // 取引は無い。読んで足して書く番号を作るな」と言う——同じ名前の記録を 2 つの端末（タブ）が同時に写すと、両方が見出しの
  // lastLog=N を読んで同じ文書 000(N+1) に set し、後の set が前のイベントを黙って消す。貸し出しは持ち主の名前で延ばせるので、
  // 書くたびに延ばす（持ち主の名前は tabHolder: 同じタブなら読み込み直しても同じ）。別の端末が持っていれば、切れる時刻まで
  // 1 回だけ待ってもう一度取り、それでも持てなければ書かずに写しを止めて status.error にそう出す（other_writer。本体は残る）。
  // 貸し出しを取り直したとき（持っていない間があった）は、別の端末が書いたかもしれないので見出しと末尾を読み直してから続ける。
  // 貸し出しの口が無い古い仕組み（acquire が無い・capability_removed）では、調停できないまま前のとおり書く
  function makeDbSink(db, name, opts) {
    opts = opts || {};
    const now = opts.now || function () { return new Date().toISOString(); };
    const wait = opts.wait || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    const srcHold = typeof opts.srcHoldMs === 'number' ? opts.srcHoldMs : 1500;
    const leaseMs = typeof opts.leaseMs === 'number' && opts.leaseMs > 0 ? opts.leaseMs : LEASE_MS;
    const holder = typeof opts.holder === 'string' && opts.holder ? opts.holder : tabHolder();
    let leaseUntil = 0;             // 自分が貸し出しを持っていると分かっている時刻（こちらの時計、ms）。0 は持っていない
    const seg = dbSegment(name);
    const status = {
      db: db ? '未確認' : '無し',   // '無し'（枠の外）／'未確認'／'使える'／'使えない'
      name: name, segment: seg,
      written: { log: 0, src: 0 },  // 写したイベントの数
      docs: { log: 0, src: 0 },     // この sink が書いた文書の数
      retried: 0, dropped: 0,       // やり直した回数・黙って落としたイベントの数
      error: null,                  // 写しを止めた理由（止めたら以後は書かない）
      lastError: null,              // 最後の失敗（やり直して通った分も残る）
      loading: false,
      head: null                    // 見出しの写し（読んだ・書いた最新）
    };
    let chain = Promise.resolve();
    let inspected = null;           // 見出しと末尾を読んだ Promise（通らなければ null に戻し、次に読み直す）
    const counters = { log: 0, src: 0 };
    const pending = { log: { evs: [], waiters: [] }, src: { evs: [], waiters: [] } };
    let timer = null;
    let dead = !db;

    function headRef() { return db.doc('kiku/' + seg); }
    function colRef(kind) { return db.collection('kiku/' + seg + '/' + kind); }
    function docId(n) { return ('000000' + n).slice(-6); }
    function lastKey(kind) { return kind === 'log' ? 'lastLog' : 'lastSrc'; }
    function label(kind) { return kind === 'log' ? '判断ログ' : '素材ログ'; }

    function giveUp(e, kind) {
      dead = true;
      status.db = '使えない';
      if (e && e.code === 'other_writer') status.error = '別の端末（タブ）が同じ記録を写している（' + errText(e) + '）。この端末からは写さない（記録の本体は残る）';
      else status.error = label(kind) + 'の写しを書けなかった（' + errText(e) + '）。以後、写しは書かない（記録の本体は残る）';
    }

    // 見出しの貸し出しを取る（持っていれば延ばす）。→ true: 取り直した（持っていない間があった）、false: 持っていたのを延ばした。
    // 別の端末が持っていれば、その端末が閉じられて延ばされなくなった場合に備えて、切れる時刻まで 1 回だけ待ってもう一度取る。
    // それでも持てなければ other_writer を投げる（やり直さない）。貸し出しの口が無ければ false（調停できないまま書く）
    function lease() {
      const ref = headRef();
      if (typeof ref.acquire !== 'function') return Promise.resolve(false);
      const wasHeld = leaseUntil > 0 && Date.now() < leaseUntil;
      let asked = 0;
      function tryOnce() { asked = Date.now(); return Promise.resolve().then(function () { return ref.acquire({ holder: holder, ttlMs: leaseMs }); }); }
      return tryOnce().then(function (r) {
        if (r && r.acquired) return r;
        const left = r && r.expiresAt ? Date.parse(r.expiresAt) - Date.now() : NaN;
        const ms = (isFinite(left) ? Math.min(Math.max(left, 0), leaseMs) : leaseMs) + 200;
        return wait(ms).then(tryOnce);
      }).then(function (r) {
        if (!(r && r.acquired)) {
          leaseUntil = 0;
          throw { code: 'other_writer', message: '別の端末が貸し出しを持っている' + (r && r.expiresAt ? '（' + r.expiresAt + ' まで）' : '') };
        }
        leaseUntil = asked + leaseMs;
        return !wasHeld;
      }, function (e) {
        if (e && e.code === 'capability_removed') return false;   // 貸し出しの口が無い古い仕組み
        throw e;
      });
    }

    // 見出しと、各集合の末尾の n を読む（書かない）。番号の続きを決める
    function inspect() {
      if (inspected) return inspected;
      inspected = Promise.resolve().then(function () {
        return headRef().get();
      }).then(function (snap) {
        if (snap && snap.exists) {
          const h = Object.assign({}, snap.data() || {});   // 届いた文書は凍っているので写しを持つ
          if (h.name !== undefined && h.name !== name) throw { code: 'name_conflict', message: '同じ置き場に別の記録「' + h.name + '」がある' };
          counters.log = Number(h.lastLog) || 0; counters.src = Number(h.lastSrc) || 0;
          status.head = h;
        } else {
          counters.log = 0; counters.src = 0;
          status.head = null;
        }
        // 見出しより先の文書が残っていれば（前に見出しの更新だけ通らなかった）、その先から続ける
        return Promise.all(['log', 'src'].map(function (kind) {
          return colRef(kind).orderBy('n', 'desc').limit(1).get().then(function (qs) {
            const top = qs && qs.docs && qs.docs.length ? Number((qs.docs[0].data() || {}).n) || 0 : 0;
            if (top > counters[kind]) counters[kind] = top;
          });
        }));
      }).then(function () { status.db = '使える'; }, function (e) { inspected = null; throw e; });
      return inspected;
    }
    // 見出しが無ければ作る
    function ensureHead() {
      return inspect().then(function () {
        if (status.head) return status.head;
        const h = { name: name, started: now(), lastLog: counters.log, lastSrc: counters.src, v: 1 };
        return headRef().set(h).then(function () { status.head = h; return h; });
      });
    }

    // 貸し出しを取る → 1 つの文書に書く（set）→ 見出しの lastLog／lastSrc を進める（update）。通らなければ 1 回だけやり直す
    function writeBatch(kind, evs) {
      function once() {
        return lease().then(function (fresh) {
          if (fresh) inspected = null;   // 持っていない間に別の端末が書いたかもしれない。見出しと末尾を読み直して続きの番号を決める
          return ensureHead();
        }).then(function () {
          const n = counters[kind] + 1;
          const body = { n: n, events: evs, at: now() };
          return colRef(kind).doc(docId(n)).set(body).then(function () {
            const patch = {}; patch[lastKey(kind)] = n;
            return headRef().update(patch);
          }).then(function () {
            counters[kind] = n;
            if (status.head) status.head[lastKey(kind)] = n;
            status.written[kind] += evs.length; status.docs[kind] += 1;
            return true;
          });
        });
      }
      return once().catch(function (e) {
        status.lastError = errText(e);
        if (!(e && typeof e.code === 'string' && NO_RETRY[e.code])) {
          status.retried += 1;
          return wait(300 + Math.floor(Math.random() * 500)).then(once).catch(function (e2) {
            status.lastError = errText(e2);
            giveUp(e2, kind);
            return false;
          });
        }
        giveUp(e, kind);
        return false;
      });
    }

    // 溜まっている分を書く。判断ログを先に、次に素材ログ。取り出した時点の分だけ（書いている間に来た分は次の回）
    function writePending() {
      return ['log', 'src'].reduce(function (p, kind) {
        return p.then(function () {
          const q = pending[kind];
          if (!q.evs.length) return;
          const evs = q.evs; const waiters = q.waiters;
          q.evs = []; q.waiters = [];
          if (dead) { status.dropped += evs.length; waiters.forEach(function (w) { w(false); }); return; }
          return writeBatch(kind, evs).then(function (ok) {
            if (!ok) status.dropped += evs.length;
            waiters.forEach(function (w) { w(ok); });
          });
        });
      }, Promise.resolve());
    }
    function kick() {
      if (timer) { clearTimeout(timer); timer = null; }
      chain = chain.then(writePending);
      return chain;
    }
    function append(kind, events) {
      const evs = Array.isArray(events) ? events.map(clone) : [];
      if (!evs.length) return Promise.resolve(false);           // 何も変わっていないのに書かない
      if (dead) { status.dropped += evs.length; return Promise.resolve(false); }
      const q = pending[kind];
      const p = new Promise(function (resolve) { q.waiters.push(resolve); });
      evs.forEach(function (e) { q.evs.push(e); });
      // 判断ログはすぐ書く。素材ログは 1 行ずつ届くので、少し待ってまとめて 1 つの文書に書く
      if (kind === 'log' || srcHold <= 0) kick();
      else if (!timer) timer = setTimeout(function () { timer = null; kick(); }, srcHold);
      return p;
    }
    function appendLog(events) { return append('log', events); }
    function appendSrc(events) { return append('src', events); }

    // 見出しを読む（無ければ null。失敗も null で、理由は status.lastError）
    function head() {
      if (!db) return Promise.resolve(null);
      return Promise.resolve().then(function () { return headRef().get(); })
        .then(function (snap) { return snap && snap.exists ? Object.assign({}, snap.data() || {}) : null; },
          function (e) { status.lastError = errText(e); return null; });
    }

    // 1 つの集合を n の順に全部読む（1000 件ずつ頁を繰る）
    function readAll(kind) {
      const LIMIT = 1000;
      const events = []; let docs = 0; let last = 0;
      function page() {
        return colRef(kind).where('n', '>', last).orderBy('n').limit(LIMIT).get().then(function (qs) {
          const before = last;
          const got = qs && qs.docs ? qs.docs : [];
          got.forEach(function (d) {
            const b = d.data() || {};
            const n = Number(b.n);
            if (n > last) last = n;
            docs += 1;
            if (Array.isArray(b.events)) b.events.forEach(function (ev) { events.push(clone(ev)); });
          });
          if (got.length < LIMIT || last === before) return;   // 頁が満たなければ終わり。n が進まなければ（壊れた文書）も止める
          return page();
        });
      }
      return page().then(function () { return { events: events, docs: docs }; });
    }
    // log と src を全部読んで、イベントの配列を 2 本返す（続きから聞くための材料）。読んでいる間は書かない
    function loadAll() {
      if (!db) return Promise.resolve({ ok: false, log: [], src: [], head: null, docs: { log: 0, src: 0 }, error: '枠の共有データベースが無い' });
      chain = chain.then(function () {
        status.loading = true;
        return inspect().then(function () {
          return Promise.all(['log', 'src'].map(readAll));
        }).then(function (r) {
          return { ok: true, log: r[0].events, src: r[1].events, head: status.head ? Object.assign({}, status.head) : null, docs: { log: r[0].docs, src: r[1].docs }, error: null };
        }, function (e) {
          status.lastError = errText(e);
          if (e && typeof e.code === 'string' && NO_RETRY[e.code]) giveUp(e, 'log');
          return { ok: false, log: [], src: [], head: null, docs: { log: 0, src: 0 }, error: errText(e) };
        }).then(function (r) { status.loading = false; return r; });
      });
      return chain;
    }

    // この名前の写しを消す（文書を 1 件ずつ、最後に見出し）。消せなければ false
    function deleteAll(kind, rounds) {
      if (rounds > 200) return Promise.resolve();   // 消しても減らない（見えない文書など）なら止める
      return colRef(kind).orderBy('n').limit(1000).get().then(function (qs) {
        const got = qs && qs.docs ? qs.docs : [];
        if (!got.length) return;
        return got.reduce(function (p, d) { return p.then(function () { return colRef(kind).doc(d.id).delete(); }); }, Promise.resolve())
          .then(function () { return deleteAll(kind, rounds + 1); });
      });
    }
    function clear() {
      if (!db) return Promise.resolve(false);
      chain = chain.then(function () {
        pending.log.evs = []; pending.src.evs = [];
        pending.log.waiters.splice(0).concat(pending.src.waiters.splice(0)).forEach(function (w) { w(false); });
        return deleteAll('log', 0).then(function () { return deleteAll('src', 0); })
          .then(function () { return headRef().delete(); })
          .then(function () {
            counters.log = 0; counters.src = 0; status.head = null; status.docs = { log: 0, src: 0 }; inspected = null;
            return true;
          }, function (e) { status.lastError = errText(e); return false; });
      });
      return chain;
    }

    // 溜まっている分を書き切るまで待つ（画面を離れる前などに）
    function flush() { if (!db) return Promise.resolve(); return kick(); }

    return { appendLog: appendLog, appendSrc: appendSrc, head: head, loadAll: loadAll, clear: clear, flush: flush, status: status, segment: seg };
  }

  // ---- 枠の保存（downloads）での書き出し ----
  //
  // 枠の中では showSaveFilePicker も a[download] も使えない。downloads は await claude.use('downloads') の返り値（無ければ null）。
  // 保存できる拡張子が決まっているので、外れる名前（.jsonl など）には .txt を足して出す（中身はそのまま。閲覧者が付け直せる）

  const DL_EXT = ['gif', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'txt', 'json', 'md', 'docx', 'pptx', 'epub', 'csv', 'ttf', 'html', 'svg', 'pdf', 'xlsx', 'zip'];
  const DL_REASON = {
    declined: '保存しなかった', rejected_extension: 'この形のファイルは枠の中では保存できない', extension_not_enabled: 'この形のファイルはここでは保存できない',
    too_large: '大きすぎて保存できない', rate_limited: '前の確認がまだ開いている。少し待ってもう一度', bad_request: '保存の呼び方が誤っている',
    request_unknown: '保存の求めが無い', unavailable: 'この画面では保存できない', empty: '中身が空なので保存しない'
  };
  function downloadFilename(fname) {
    const s = String(fname == null ? '' : fname);
    const m = /\.([A-Za-z0-9]+)$/.exec(s);
    if (m && DL_EXT.indexOf(m[1].toLowerCase()) >= 0) return s;
    return s + '.txt';
  }
  function makeDownloadsExport(downloads) {
    const usable = !!(downloads && typeof downloads.save === 'function');
    const status = { downloads: usable ? '使える' : '無し', lastSaved: null, lastError: null, reason: null };
    function fail(code, message) {
      status.lastError = { code: code, message: message };
      status.reason = DL_REASON[code] || DL_REASON.unavailable;
      return false;
    }
    // 保存を閲覧者に促す。保存したら true。断られた・できなかったら false（理由は status.reason に日本語、status.lastError に code）。
    // 中身は文字列（UTF-8 で保存される）か、バイト列（Uint8Array など。拡張の ZIP）
    function save(filename, text) {
      if (!usable) return Promise.resolve(fail('unavailable', '枠の保存が無い'));
      const bytes = !!(text && typeof text === 'object' && typeof text.byteLength === 'number');
      if (bytes ? !text.byteLength : (typeof text !== 'string' || !text.length)) return Promise.resolve(fail('empty', '中身が空'));
      const fname = downloadFilename(filename);
      return Promise.resolve().then(function () { return downloads.save({ filename: fname, data: text }); })
        .then(function () { status.lastSaved = fname; status.lastError = null; status.reason = null; return true; },
          function (e) { return fail(e && typeof e.code === 'string' ? e.code : 'unavailable', e && e.message || String(e)); });
    }
    return { save: save, status: status, filename: downloadFilename };
  }

  // 枠の中の能力（'db'・'downloads' など）を取る。無ければ null（claude.use が無い・null を返す・例外を投げる、のどれでも）。
  // 決して reject しない
  function useCapability(cap) {
    return Promise.resolve().then(function () {
      const c = globalThis.claude;
      if (!c || typeof c.use !== 'function') return null;
      return c.use(cap);
    }).then(function (x) { return x || null; }, function () { return null; });
  }

  // 保存されている記録の一覧（画面の「前の記録」で選ぶため）。新しい順（open の t0 の降順。t0 の無いものは後ろに名前の順）。
  // [{name, t0, ended}]。ended は end を書いた記録
  function listRecords() {
    return openDb().then(function (d) {
      return new Promise(function (resolve) {
        const recs = Object.create(null); // 鍵は会議の名前（人が打つ）。素の表にする
        let tx;
        try { tx = d.transaction('log', 'readonly'); } catch (e) { resolve([]); return; }
        const cur = tx.objectStore('log').openCursor();
        cur.onsuccess = function () {
          const c = cur.result;
          if (c) {
            const v = c.value || {};
            const r = recs[v.name] || (recs[v.name] = { name: v.name, t0: null, ended: false });
            const ev = v.ev || {};
            if (ev.e === 'open' && r.t0 == null && typeof ev.t0 === 'string') r.t0 = ev.t0;
            if (ev.e === 'end') r.ended = true;
            c.continue();
            return;
          }
          const list = Object.keys(recs).map(function (k) { return recs[k]; });
          list.sort(function (a, b) {
            if (a.t0 && b.t0) return a.t0 < b.t0 ? 1 : a.t0 > b.t0 ? -1 : (a.name < b.name ? -1 : 1);
            if (a.t0 || b.t0) return a.t0 ? -1 : 1;
            return a.name < b.name ? -1 : 1;
          });
          resolve(list);
        };
        cur.onerror = function () { resolve([]); };
      });
    }, function () { return []; });
  }

  // 保存されている会議名の一覧（画面で選ぶため）
  function listNames() {
    return openDb().then(function (d) {
      return new Promise(function (resolve) {
        const names = Object.create(null); // 鍵は会議の名前（人が打つ）。素の表にする
        let tx;
        try { tx = d.transaction('log', 'readonly'); } catch (e) { resolve([]); return; }
        const cur = tx.objectStore('log').openCursor();
        cur.onsuccess = function () { const c = cur.result; if (c) { names[c.value.name] = true; c.continue(); } else resolve(Object.keys(names).sort()); };
        cur.onerror = function () { resolve([]); };
      });
    }, function () { return []; });
  }

  const api = {
    makeRecord: makeRecord, listNames: listNames, listRecords: listRecords,
    makeDbSink: makeDbSink, dbSegment: dbSegment,
    makeDownloadsExport: makeDownloadsExport, downloadFilename: downloadFilename,
    useCapability: useCapability
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TSV_RECORD = api;
})();
