#!/usr/bin/env node
/*
 * e2e_artifact.js — claude.ai のアーティファクトに貼る形 kiku-artifact.html を、モックの window.claude の中で通しで確かめる
 *                  （Chromium headless、file://）
 *
 *   node tests/e2e/e2e_artifact.js [ツールのルートフォルダのパス] [出力フォルダ]
 *   （playwright と Chromium が要る。Chromium の場所は環境変数 CHROMIUM_PATH で渡す。無ければ playwright の既定）
 *
 * kiku-artifact.html（doctype・html・head・body の無い中身）を、アーティファクトの仕組みが付けるのと同じ骨で包んだ一時ファイルを出力フォルダに作り、
 * その頭にモックの window.claude を置く script を入れ、本物のアーティファクトと同じく iframe の中で開く（window.top !== window）。偽物の中身:
 *   use('sample')    → 問いの末尾の JSON（状態の最小表現）を読み、内蔵の台本（tests/fixtures/meeting10.jsonl。analyst.js の mock）と
 *                      同じ返事を文字列で返す関数。2 回目だけ ``` で囲んで返す（囲みを 1 回だけ外して読むこと）。
 *                      __fake.mode を 'not_granted' にすると {code:'not_granted'} を投げる。'rate_limited_once' にすると
 *                      次の 1 回だけ {code:'rate_limited'} を投げて 'ok' に戻る。'generic' にすると、どの窓にも最初の発言から
 *                      カードを 1 枚作る返事を返す（台本の無い素材のため）。URL に ?nosample があれば null（問う機能が無い）
 *   use('db')        → メモリの中のモックのデータベース（doc/collection/where/orderBy/limit/get/set/update/delete/acquire）
 *   use('downloads') → 呼ばれた filename を記録する偽物。__fake.noDownloads が true か、URL に ?nodl があれば null
 *   それ以外         → null
 * 混んでいるときに置く間（app.js の RATE_LIMIT_WAIT_MS）は、偽物の頭で KIKU_RATE_LIMIT_WAIT_MS=1000 にして 1 秒に縮める
 * 確かめること:
 *   (a) 起動で分析役の既定が「この画面の Claude」、音声の入口が選べない、コピー（控え）のチェックボックスが見える
 *   (b) 貼り付けで素材を入れ、「次の窓を流す」で窓が進んでカードが出て、判断ログが検査を通る（S1〜S3 を書いた）。
 *       sample には modelTier と cache:false と signal が渡る
 *   (c) ブリッジ: window.postMessage({source:'kiku-bridge', v:2, kind:'lines', lines:[…]}, '*') で届いた発話が素材ログに入り、
 *       hello に返事がある（聞いている間は listening:true、聞いていないときは false）
 *   (d) コピー（控え）のチェックボックスをオンにした記録はモックのデータベースに文書が増え、オフの記録では増えない
 *   (e) 「書き出す」でモックの downloads が 2 回呼ばれる（.jsonl には .txt が付く）
 *   (f) sample が {code:'not_granted'} を投げると、同じ窓を出し直さずに止まって知らせる（sample は 1 回しか呼ばれない）。
 *       分析役を変えて「聞き取りを開始」を押すと、同じ記録の続きを聞ける
 *   (g) sample が 1 回だけ {code:'rate_limited'} を投げると、「1 秒おいてから、同じ窓で出し直す」と出て、同じ窓で S1 を書く（空振りにしない）
 *   (h) use('downloads') が null のとき、iframe の中では「このアーティファクトでは保存できない」と言い、落としたと言わない
 *   (i) アーティファクトの中では API の 2 つの経路が選べず、無理に選んでも「接続を試す」も「聞き取りを開始」も断る（fetch は出ない）
 *   (k) 表の一筋（2026-10-10）: 親のページにモックの拡張機能を置く（kiku の ping に here を返し、start で取り込み中のフラグを立て、stop で
 *       「止めた」と here を返す）。名前を打たずに「聞き取りを開始」→ 拡張機能に start（この PC の中で）が届き、取り込みが始まって
 *       から記録を開く（名前は押した日時）。発話が窓になり S1 を書き、「停止」で拡張機能に stop が届いて終える。選ぶ画面で取り消すと
 *       「始められませんでした」と出て、記録を作らない
 *   (l) 書き起こしを貼る: 時刻の無い文を貼って「構造にする」を押すだけで、区切りごとに流れて最後まで進み、終えて止まる
 *       （名前は日時＋（貼り付け）、入力方法は元に戻る）
 *   (m) 拡張機能を入れる手順（2026-10-10）: 親のページのモックの拡張機能が答えない（?absent）と、表に 3 つの手順が出る。「拡張機能を保存する」で
 *       モックの downloads に kiku-bridge-<バージョン>.zip が渡り、中身は build_bridge.py の make_zip と 1 バイトも違わない。アドレスの
 *       コピーは写せたか、写せなければ選んで Ctrl+C を頼む。保存の確かめで取り消すと、赤にせずもう一度押せると言う。
 *       拡張機能が無いまま「聞き取りを開始」を押すと赤で断り、モックの拡張機能が答え始めると、読み込み直さずに手順もその断りも消えて「拡張機能と
 *       つながっています」になる。here の ver が古いと「新しいバージョンがあります」の行（保存のボタンつき）が出て、同じバージョンなら消える。
 *       アーティファクトの保存機能が無い（?nodl）と「保存しませんでした（この画面では保存できない）」と言う。Claude のアプリ（UA に Electron）の
 *       中では、手順を出さず「パソコンの Chrome でこのアーティファクトを開きます」と言う
 *   (j) 仕組みが自分のページとして出す版（window.claude はあるが use() は全部 null、iframe でない。?nosample&nodl で真似る）:
 *       問う機能が無いと起動後に分析役の欄に出て「聞き取りを開始」を断る。拡張機能はアーティファクトにしか届かないので「ブリッジ」は選べず、
 *       入力方法は「打つ／貼る」。内蔵の模擬で聞いた記録の「書き出す」は、
 *       アーティファクトの保存機能が無いのでふつうの書き出し（a[download]）に切り替わり、2 つのファイルがダウンロードのフォルダに保存される
 *
 * 結果は JSON で標準出力に出す。1 件でも落ちれば終了コード 1
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const KIT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'kiku-e2e-artifact'));
fs.mkdirSync(OUT, { recursive: true });
const LAUNCH = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, headless: true } : { headless: true };

const results = [];
function check(group, name, ok, detail) {
  results.push({ group: group, name: name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.error((ok ? '合格 ' : '不合格 ') + '[' + group + '] ' + name + (detail != null ? '  — ' + String(detail).slice(0, 300) : ''));
}
// 分析役の欄（an-msgs）は見えている文だけ（畳んだ欄は除く）。うまくいった区切りでは欄が閉じている（隠れていても中身は読む）
const txt = function (target, id) {
  return target.evaluate(function (id) {
    if (id === 'an-msgs') return Array.from(document.querySelectorAll('#an-msgs > div')).map(function (d) { return d.textContent; }).join('\n');
    const e = document.getElementById(id); return e ? e.innerText : '';
  }, id);
};

// ---- モックの window.claude（ページの先頭で動く） ----
const SCRIPT = fs.readFileSync(path.join(KIT, 'tests', 'fixtures', 'meeting10.jsonl'), 'utf8').split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); });
const FAKE = `
(function () {
  const flags = String(location.search || '');
  const F = globalThis.__fake = { mode: 'ok', sampleCalls: 0, sampleOpts: [], fenced: 0, downloads: [], store: new Map(), uses: [], leases: new Map(),
    noSample: /[?&]nosample\\b/.test(flags), noDownloads: /[?&]nodl\\b/.test(flags), inIframe: (function () { try { return window.top !== window; } catch (e) { return true; } })() };
  globalThis.KIKU_RATE_LIMIT_WAIT_MS = 1000;   // 混んでいるときに置く間をテストでは 1 秒に
  F.script = ${JSON.stringify(SCRIPT).replace(/<\//g, '<\\/')};
  function sample(prompt, opts) {
    F.sampleCalls++;
    F.sampleOpts.push({ modelTier: opts && opts.modelTier, cache: opts && opts.cache, signal: !!(opts && opts.signal), effort: opts && opts.effort });
    if (F.mode === 'not_granted') return Promise.reject({ code: 'not_granted', message: 'viewer declined' });
    if (F.mode === 'rate_limited_once') { F.mode = 'ok'; return Promise.reject({ code: 'rate_limited', message: 'Too many calls' }); }
    const i = prompt.lastIndexOf('\\n{');
    const pack = JSON.parse(prompt.slice(i + 1));
    if (F.mode === 'generic') {
      const L = pack.new.lines;
      const ev = [];
      if (L.length) ev.push({ e: 'card', id: pack.next_ids.card, t: L[0].t, d: 0, role: 'claim', who: L[0].who, src: L.slice(0, 3).map(function (l) { return l.i; }), li: null, ti: String(L[0].text).slice(0, 30), b: 'この区切りの最初の発言から作った' });
      return Promise.resolve({ text: JSON.stringify({ step: { t: pack.new.t }, events: ev, note: { x: 'テスト用の一般の返事' } }), truncated: false });
    }
    const A = globalThis.TSV_ANALYST;
    const an = A.makeAnalyst({ kind: 'mock', script: F.script });
    return an.analyze(pack, '').then(function (r) {
      let text = JSON.stringify({ step: r.step, events: r.events, note: r.note });
      if (F.sampleCalls === 2) { F.fenced++; text = '\`\`\`json\\n' + text + '\\n\`\`\`'; }
      return { text: text, truncated: false, modelTierApplied: (opts && opts.modelTier) || 'default' };
    });
  }
  // モックのデータベース（db.d.ts の形のうち、record.js が使うものだけ）
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function segs(p) { return String(p).split('/').filter(Boolean); }
  function snap(p) { const has = F.store.has(p); const body = has ? clone(F.store.get(p)) : undefined; return { id: p.split('/').pop(), exists: has, data: function () { return body; } }; }
  function docRef(p) {
    return {
      id: segs(p).pop(), path: p,
      get: function () { return Promise.resolve(snap(p)); },
      set: function (data) { F.store.set(p, clone(data)); return Promise.resolve(); },
      update: function (data) { F.store.set(p, Object.assign({}, F.store.get(p) || {}, clone(data))); return Promise.resolve(); },
      delete: function () { F.store.delete(p); return Promise.resolve(); },
      collection: function (sub) { return colRef(p + '/' + sub); },
      // ロック（db.d.ts の acquire）: 持ち主が無い・切れた・同じ持ち主なら与える。ほかの持ち主が持っていれば busy
      acquire: function (o) {
        const cur = F.leases.get(p); const t = Date.now();
        if (cur && cur.until > t && cur.holder !== (o && o.holder)) return Promise.resolve({ acquired: false, expiresAt: new Date(cur.until).toISOString() });
        const until = t + Math.min(600000, Math.max(1000, (o && o.ttlMs) || 30000));
        F.leases.set(p, { holder: o && o.holder, until: until });
        return Promise.resolve({ acquired: true, version: 1, expiresAt: new Date(until).toISOString(), holder: o && o.holder });
      }
    };
  }
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function query(p, filters, order, lim) {
    const parts = segs(p);
    return {
      where: function (f, op, v) { return query(p, filters.concat([[f, op, v]]), order, lim); },
      orderBy: function (f, dir) { return query(p, filters, [f, dir || 'asc'], lim); },
      limit: function (n) { return query(p, filters, order, n); },
      get: function () {
        let rows = [];
        F.store.forEach(function (body, dp) {
          const dparts = segs(dp);
          if (dparts.length !== parts.length + 1 || dp.slice(0, p.length + 1) !== p + '/') return;
          rows.push({ id: dparts[dparts.length - 1], body: body });
        });
        filters.forEach(function (fl) {
          const f = fl[0], op = fl[1], v = fl[2];
          rows = rows.filter(function (r) { const x = r.body[f]; return op === '>' ? x > v : op === '>=' ? x >= v : op === '<' ? x < v : op === '<=' ? x <= v : op === '==' ? x === v : true; });
        });
        if (order) { const f = order[0], sign = order[1] === 'desc' ? -1 : 1; rows.sort(function (a, b) { return sign * cmp(a.body[f], b.body[f]) || cmp(a.id, b.id); }); }
        else rows.sort(function (a, b) { return cmp(a.id, b.id); });
        if (lim) rows = rows.slice(0, lim);
        const docs = rows.map(function (r) { return snap(p + '/' + r.id); });
        return Promise.resolve({ docs: docs, size: docs.length, empty: !docs.length });
      }
    };
  }
  function colRef(p) { const q = query(p, [], null, 0); q.doc = function (id) { return docRef(p + '/' + id); }; return q; }
  const db = { doc: docRef, collection: colRef };
  const downloads = { save: function (req) {
    const bin = req.data && typeof req.data === 'object' && typeof req.data.byteLength === 'number';
    let b64 = null;
    if (bin) { const u = new Uint8Array(req.data.buffer || req.data, req.data.byteOffset || 0, req.data.byteLength); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); b64 = btoa(s); }
    if (F.declineNext) { F.declineNext = false; return Promise.reject({ code: 'declined', message: 'the viewer said no' }); }
    F.downloads.push({ filename: req.filename, bytes: bin ? req.data.byteLength : req.data.length, b64: b64 });
    return Promise.resolve({ status: 'saved' });
  } };
  globalThis.claude = {
    use: function (name) {
      F.uses.push(name);
      if (name === 'sample') return Promise.resolve(F.noSample ? null : sample);
      if (name === 'db') return Promise.resolve(db);
      if (name === 'downloads') return Promise.resolve(F.noDownloads ? null : downloads);
      return Promise.resolve(null);
    }
  };
  // ブリッジの返事を受ける
  F.replies = [];
  window.addEventListener('message', function (ev) { if (ev.data && ev.data.source === 'kiku') F.replies.push(ev.data); });
})();
`;

(async function main() {
  const art = fs.readFileSync(path.join(KIT, 'kiku-artifact.html'), 'utf8');
  check('形', 'kiku-artifact.html に doctype・html・head・body の開きが無い', !/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(art));
  const wrapped = '<!doctype html><html><head><meta charset="utf-8"><script>' + FAKE + '</script></head><body>' + art + '</body></html>';
  const wrappedPath = path.join(OUT, 'artifact_wrapped.html');
  fs.writeFileSync(wrappedPath, wrapped);
  // 本物のアーティファクトと同じく iframe の中で開く（アーティファクトの中の書き出しは window.top !== window を見る）
  const hostPath = path.join(OUT, 'artifact_host.html');
  // 親のページにモックの拡張機能「ブリッジ」を置く（kiku の ping・start・stop・install に here・status で答える。本物は bridge/chrome/bridge.js）
  // モックの拡張機能が here に載せるバージョン。アーティファクトに埋め込まれる ZIP と同じバージョン（manifest.json の version）
  const EXT_VER = JSON.parse(fs.readFileSync(path.join(KIT, 'bridge', 'chrome', 'manifest.json'), 'utf8')).version;
  const HOST_BRIDGE = `
(function () {
  // absent: 拡張機能がまだ入っていない（何にも答えない。URL に ?absent があれば最初から）。ver: here に載せる拡張機能のバージョン（既定はアーティファクトの持つ ZIP と同じバージョン）
  const B = window.__bridge = { capturing: false, where: 'available', cmds: [], startOk: true, absent: /[?&]absent(&|$)/.test(location.search), ver: ${JSON.stringify(EXT_VER)} };
  function to(d) { const f = document.getElementById('f'); if (f && f.contentWindow) f.contentWindow.postMessage(Object.assign({ source: 'kiku-bridge', v: 2 }, d), '*'); }
  window.addEventListener('message', function (ev) {
    const d = ev.data; if (!d || d.source !== 'kiku' || d.v !== 2 || B.absent) return;
    B.cmds.push(d.kind + (d.kind === 'start' ? (d.local ? ':local' : ':cloud') : ''));
    if (d.kind === 'start') {
      if (B.startOk) { B.capturing = true; to({ kind: 'status', state: 'listening', text: 'ブリッジが聞き始めた' }); }
      else to({ kind: 'status', state: 'error', text: '画面共有を取り消した' });
    }
    if (d.kind === 'stop' && B.capturing) { B.capturing = false; to({ kind: 'status', state: 'stopped', text: '止めた' }); }
    to({ kind: 'here', where: B.where, capturing: B.capturing, ver: B.ver });
  });
})();
`;
  fs.writeFileSync(hostPath, '<!doctype html><html><head><meta charset="utf-8"><title>host</title><script>' + HOST_BRIDGE + '</script></head><body style="margin:0"><iframe id="f" src="artifact_wrapped.html" style="width:1280px;height:900px;border:0"></iframe></body></html>');
  const fixture = fs.readFileSync(path.join(KIT, 'tests', 'fixtures', 'meeting10.txt'), 'utf8');

  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  // 設定は「設定と記録」の引き出しの中（2026-10-10 の作り直し）。テストは欄を直に操作するので、引き出しを開いておく
  await ctx.addInitScript(function () { document.addEventListener('DOMContentLoaded', function () { const d = document.getElementById('settings'); if (d) d.open = true; }); });
  const page = await ctx.newPage();
  const errs = []; const ext = []; const consoleErr = [];
  page.on('pageerror', function (e) { errs.push(String(e && e.stack || e && e.message || e)); });
  page.on('console', function (m) { if (m.type() === 'error') consoleErr.push(m.text()); });
  page.on('request', function (r) { if (!/^(file|blob|data):/.test(r.url())) ext.push(r.url()); });
  await page.goto('file://' + hostPath);
  const P = await (await page.waitForSelector('#f')).contentFrame();   // 以後、画面の操作は iframe の中（P）に対して行う
  await P.waitForSelector('#route', { timeout: 10000 });
  await page.waitForTimeout(500);
  const fake = function (expr) { return P.evaluate('(function(){ const F = globalThis.__fake; return ' + expr + '; })()'); };
  const bridge = function (expr) { return page.evaluate('(function(){ const B = window.__bridge; return ' + expr + '; })()'); };
  const readLog = function (target, name) { return target.evaluate(function (name) { const r = globalThis.TSV_RECORD.makeRecord(name); return r.load().then(function () { return r.log; }); }, name); };
  const pasteMaterial = async function () {
    await P.selectOption('#intake', 'file');
    await P.evaluate(function (t) { const e = document.getElementById('file-paste'); e.value = t; e.dispatchEvent(new Event('change', { bubbles: true })); }, fixture);
    await P.waitForFunction(function () { return /貼った文字をファイルとして使う/.test(document.getElementById('intakemsg').textContent); }, null, { timeout: 5000 });
  };
  const nextWindow = async function (n) {
    await P.click('#file-next');
    await P.waitForFunction(function (n) {
      const m = /（区切り S(\d+)）/.exec(document.getElementById('edge').textContent);
      return m && Number(m[1]) === n && !document.getElementById('file-next').disabled;
    }, n, { timeout: 15000 });
  };

  // ---------- (a) 起動 ----------
  {
    const st = await P.evaluate(function () {
      const sp = document.querySelector('#intake option[value="speech"]');
      return { route: document.getElementById('route').value, speechDisabled: !!(sp && sp.disabled), speechText: sp ? sp.textContent : '', intake: document.getElementById('intake').value,
        dbRow: !document.getElementById('db-row').hidden, mirror: document.getElementById('db-mirror').checked, note: !document.getElementById('claudenote').hidden,
        bind: document.getElementById('bindlog').hidden && document.getElementById('bindsrc').hidden, stRoute: document.getElementById('st-route').textContent, setupmsg: document.getElementById('setupmsg').textContent };
    });
    check('起動', '分析役の既定が「この画面の Claude」', st.route === 'claude' && /この画面の Claude/.test(st.stRoute), st.route + ' / ' + st.stRoute);
    check('起動', '音声の入口が選べない（このアーティファクトでは使えない）。入力方法の既定は拡張機能「ブリッジ」', st.speechDisabled && /このアーティファクトでは使えない/.test(st.speechText) && st.intake === 'bridge', st.speechText + ' / ' + st.intake);
    await P.waitForFunction(function () { return /拡張機能とつながっています/.test(document.getElementById('ask-text').textContent); }, null, { timeout: 5000 });
    const ask = await P.evaluate(function () { return { hidden: document.getElementById('ask').hidden, text: document.getElementById('ask-text').textContent, start: document.getElementById('start').textContent, sample: !document.getElementById('sample').hidden }; });
    check('表', '拡張機能とつながると、表に「拡張機能とつながっています。「聞き取りを開始」を押すと、画面共有の選択画面が出ます」と出る', !ask.hidden && /「聞き取りを開始」を押すと、画面共有の選択画面が出ます/.test(ask.text), ask.text);
    check('表', '表のボタンは「聞き取りを開始」、記録が無いあいだは見本が見える', ask.start === '聞き取りを開始' && ask.sample, JSON.stringify(ask));
    check('表', '拡張機能に ping が届いている', (await bridge('B.cmds.slice()')).indexOf('ping') >= 0);
    check('起動', 'コピー（控え）のチェックボックスが見えて、既定はオフ', st.dbRow && !st.mirror);
    check('起動', '「この画面の Claude」の説明が見え、未配線の知らせが無い', st.note && !/未配線|組み込まれていない|呼び出す機能が無い|呼び出す機能がありません|権限が与えられていない|権限が与えられていません/.test(st.setupmsg), st.setupmsg);
    check('起動', 'ファイルに結び付けるボタンは出ない（保存の画面が要る）', st.bind);
    const speedLabels = await P.evaluate(function () { return Array.from(document.querySelectorAll('#speeds button')).map(function (b) { return b.textContent; }); });
    check('R9', '速度ボタンに「等倍」', speedLabels.indexOf('等倍') >= 0, speedLabels.join('/'));
  }

  // ---------- (b) 貼り付け → 窓 → カード（コピーのチェックボックスはオン） ----------
  const NAME1 = 'アーティファクトの一筋';
  {
    await P.fill('#name', NAME1);
    await P.check('#db-mirror');
    await pasteMaterial();
    await P.click('#start');
    await P.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    const stListen = await txt(P, 'st-listen');
    check('一筋', '聞き始めた', /聞いている/.test(stListen), stListen);
    for (let k = 1; k <= 3; k++) await nextWindow(k);
    const an = await txt(P, 'an-msgs');
    const rows = await P.evaluate(function () { return Array.from(document.getElementById('rows').children).map(function (c) { return { t: c._t, id: (c.querySelector('.cid') || c.querySelector('.dno') || {}).textContent || '' }; }); });
    const calls = await fake('{ n: F.sampleCalls, fenced: F.fenced, opts: F.sampleOpts, uses: F.uses.slice() }');
    check('一筋', '3 窓で S3 を書いた（判断ログが検査を通った）', /S3 の区切りを書いた/.test(an), an.replace(/\n/g, ' ').slice(0, 160));
    check('一筋', '中央にカードが出た（台本の S1〜S3 の分）', rows.length >= 3 && rows.every(function (r) { return r.t <= 90; }), JSON.stringify(rows));
    check('一筋', 'sample は窓ごとに 1 回（3 回）呼ばれ、2 回目は ``` で囲んだ返事も読めた', calls.n === 3 && calls.fenced === 1, JSON.stringify(calls));
    check('一筋', 'sample に modelTier・cache:false・signal が渡る', calls.opts.every(function (o) { return o.modelTier === 'default' && o.cache === false && o.signal === true; }), JSON.stringify(calls.opts));
    check('一筋', 'use は sample と db を求めた（API キーの欄は使わない）', calls.uses.indexOf('sample') >= 0 && calls.uses.indexOf('db') >= 0, calls.uses.join(','));
    const feed = await P.evaluate(function () { return Array.from(document.querySelectorAll('#feed .fl')).filter(function (n) { return !n.classList.contains('interim'); }).length; });
    check('一筋', '右の逐語は窓として渡した発話だけ（1〜3 窓分）', feed > 0 && feed <= 40, feed);
    const anText = await txt(P, 'an-msgs');
    check('画面の言葉', '分析役の欄の見えている文に英字の項目名が無い', !/[A-Za-z]{2,}/.test(anText), anText.replace(/\n/g, ' ').slice(0, 200));
  }

  // ---------- (d) コピー: オンの記録はモックのデータベースに文書が増える ----------
  const seg1 = await P.evaluate(function (n) { return globalThis.TSV_RECORD.dbSegment(n); }, NAME1);
  {
    await P.waitForFunction(function () { return /データベースに保存している/.test(document.getElementById('db-state').textContent); }, null, { timeout: 5000 });
    // 素材ログは 1.5 秒の猶予でまとめて書くので、少し待つ
    await page.waitForTimeout(2000);
    const docs = await fake('Array.from(F.store.keys()).filter(function (k) { return k.indexOf("kiku/' + seg1 + '") === 0; })');
    const head = await fake('F.store.get("kiku/' + seg1 + '")');
    const logDocs = docs.filter(function (k) { return k.indexOf('/log/') > 0; });
    const srcDocs = docs.filter(function (k) { return k.indexOf('/src/') > 0; });
    check('コピー', '見出し kiku/<名前> があり、元の名前を持つ', !!head && head.name === NAME1, JSON.stringify(head));
    check('コピー', '判断ログの文書が増えた（open と S1〜S3 の追記ごと）', logDocs.length >= 2, logDocs.join(','));
    check('コピー', '素材ログの文書が増えた', srcDocs.length >= 1, srcDocs.join(','));
    const state = await txt(P, 'db-state');
    check('コピー', 'チェックボックスの隣に「データベースに保存している（判断ログ N 行・素材ログ M 行）」', /データベースに保存している（判断ログ \d+ 行・素材ログ \d+ 行/.test(state), state);
  }

  // ---------- (e) 書き出す: モックの downloads が 2 回呼ばれる ----------
  {
    await P.click('#end');
    await P.waitForFunction(function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 15000 });
    await P.click('#export');
    await P.waitForFunction(function () { return /保存した|保存しなかった|保存できない/.test(document.getElementById('recmsg').textContent); }, null, { timeout: 5000 });
    const dl = await fake('F.downloads.slice()');
    const recmsg = await txt(P, 'recmsg');
    check('書き出し', 'モックの downloads が 2 回呼ばれ、.jsonl に .txt が付く', dl.length === 2 && dl[0].filename === NAME1 + '.jsonl.txt' && dl[1].filename === NAME1 + '.src.jsonl.txt' && dl.every(function (d) { return d.bytes > 0; }), JSON.stringify(dl));
    check('書き出し', '一言が両方の名前で「保存した」と言う', new RegExp(NAME1 + '\\.jsonl\\.txt を保存した').test(recmsg) && new RegExp(NAME1 + '\\.src\\.jsonl\\.txt を保存した').test(recmsg), recmsg);
  }

  // ---------- (c) ブリッジ（コピーのチェックボックスはオフ、分析役は内蔵の模擬） ----------
  const NAME2 = 'ブリッジの一筋';
  {
    const before = await fake('F.store.size');
    await P.fill('#name', NAME2);
    await P.uncheck('#db-mirror');
    await P.selectOption('#route', 'mock');
    await P.selectOption('#intake', 'bridge');
    await P.fill('#win', '5');
    // 聞いていないときの hello: ページが listening:false で答える
    await P.evaluate(function () { globalThis.__fake.replies = []; window.postMessage({ source: 'kiku-bridge', v: 2, kind: 'hello' }, '*'); });
    await page.waitForTimeout(200);
    const r0 = await fake('F.replies.slice()');
    check('ブリッジ', '聞いていないときの hello に {source:kiku, kind:hello, listening:false} が返る', r0.length === 1 && r0[0].kind === 'hello' && r0[0].listening === false && r0[0].v === 2, JSON.stringify(r0));
    await page.evaluate(function () { window.__bridge.cmds = []; });
    await P.click('#start');
    await P.waitForFunction(function () { return /聞いている/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 10000 });
    const cmds0 = await bridge('B.cmds.slice()');
    check('ブリッジ', '「聞き取りを開始」で拡張機能に start（この PC の中で）が 1 回届く', cmds0.filter(function (c) { return /^start/.test(c); }).join(',') === 'start:local', cmds0.join(','));
    const badge0 = await txt(P, 'intakemsg');
    check('ブリッジ', '聞き始めると入口のラベルが「ブリッジから受け取っている（届いた発言 0 件）」', /ブリッジから受け取っている（届いた発言 0 件/.test(badge0), badge0);
    await P.evaluate(function () { globalThis.__fake.replies = []; window.postMessage({ source: 'kiku-bridge', v: 2, kind: 'hello' }, '*'); });
    await page.waitForTimeout(200);
    const r1 = await fake('F.replies.slice()');
    check('ブリッジ', '聞いている間の hello に listening:true が 1 回だけ返る', r1.length === 1 && r1[0].listening === true && r1[0].received === 0, JSON.stringify(r1));
    await P.evaluate(function () { window.postMessage({ source: 'kiku-bridge', v: 2, kind: 'lines', lines: ['司会: 始めます', { who: '乙', text: 'はい、お願いします' }, 7] }, '*'); });
    await page.waitForTimeout(300);
    const badge1 = await txt(P, 'intakemsg');
    check('ブリッジ', 'ラベルに「届いた発言 2 件」と「捨てたもの 1 件」', /届いた発言 2 件/.test(badge1) && /捨てたもの 1 件/.test(badge1), badge1);
    const src = await P.evaluate(function (name) { const r = globalThis.TSV_RECORD.makeRecord(name); return r.load().then(function () { return r.src; }); }, NAME2);
    const utt = src.filter(function (l) { return l.i != null; });
    check('ブリッジ', '届いた発話が素材ログに打つ入口と同じ形で入る（i・t・who・text・at。src の名前は増えない）', utt.length === 2 && utt[0].i === 1 && utt[0].who === '司会' && utt[0].text === '始めます' && utt[1].who === '乙' && typeof utt[0].t === 'number' && typeof utt[0].at === 'string' && Object.keys(utt[0]).sort().join(',') === 'at,i,t,text,who', JSON.stringify(utt));
    // 5 秒の窓が閉じると、内蔵の模擬が S1 を書く
    await P.waitForFunction(function () { return /S1 の区切りを書いた/.test(document.getElementById('an-msgs').textContent); }, null, { timeout: 15000 });
    const edge = await txt(P, 'edge');
    check('ブリッジ', '窓が閉じて S1 を書いた（ブリッジの発話が窓に入った）', /いま 1〜2 番目の発言まで整理した（区切り S1）/.test(edge), edge);
    await P.evaluate(function () { globalThis.__fake.replies = []; window.postMessage({ source: 'kiku-bridge', v: 2, kind: 'hello' }, '*'); });
    await page.waitForTimeout(200);
    const r2 = await fake('F.replies.slice()');
    check('ブリッジ', 'hello の返事に受けた数（2）が乗る', r2.length === 1 && r2[0].received === 2, JSON.stringify(r2));
    await P.click('#end');
    await P.waitForFunction(function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 15000 });
    const cmds1 = await bridge('B.cmds.slice()');
    const now1 = await txt(P, 'now-text');
    check('ブリッジ', '「停止」で拡張機能に stop が届き、拡張機能が止まってから終える（表の状態は「停止しました」）', cmds1.indexOf('stop') >= 0 && !(await bridge('B.capturing')) && /停止しました/.test(now1), cmds1.join(',') + ' / ' + now1);
    await P.evaluate(function () { window.postMessage({ source: 'kiku-bridge', v: 2, kind: 'lines', lines: ['終えた後'] }, '*'); });
    await page.waitForTimeout(300);
    const src2 = await P.evaluate(function (name) { const r = globalThis.TSV_RECORD.makeRecord(name); return r.load().then(function () { return r.src; }); }, NAME2);
    check('ブリッジ', '聞き終えた後に届いたものは受けない', src2.filter(function (l) { return l.i != null; }).length === 2 && !src2.some(function (l) { return /終えた後/.test(l.text || ''); }), src2.length);
    await page.waitForTimeout(2000);
    const after = await fake('F.store.size');
    const seg2 = await P.evaluate(function (n) { return globalThis.TSV_RECORD.dbSegment(n); }, NAME2);
    const docs2 = await fake('Array.from(F.store.keys()).filter(function (k) { return k.indexOf("kiku/' + seg2 + '") === 0; })');
    check('コピー', 'チェックボックスがオフの記録はモックのデータベースに 1 つも書かない', docs2.length === 0 && after === before, docs2.join(',') + ' / ' + before + ' → ' + after);
  }

  // ---------- (f) not_granted: 出し直さずに止まる ----------
  const NAME3 = '断られる';
  {
    await P.evaluate(function () { globalThis.__fake.mode = 'not_granted'; });
    const calls0 = await fake('F.sampleCalls');
    await P.fill('#name', NAME3);
    await P.selectOption('#route', 'claude');
    await P.fill('#win', '30');
    await pasteMaterial();
    await P.click('#start');
    await P.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await P.click('#file-next');
    await P.waitForFunction(function () { return !document.getElementById('halt').hidden; }, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const calls1 = await fake('F.sampleCalls');
    const st = await P.evaluate(function () {
      const g = function (id) { return document.getElementById(id).innerText; };
      return { halt: g('halt'), listen: g('st-listen'), setup: g('setupmsg'), an: g('an-msgs'), start: document.getElementById('start').disabled, intake: g('intakemsg'),
        raw: Array.from(document.querySelectorAll('#an-msgs details')).map(function (d) { return d.textContent; }).join(' | ') };
    });
    check('断り', 'sample は 1 回しか呼ばれない（同じ窓を出し直さない）', calls1 - calls0 === 1, (calls1 - calls0) + ' 回');
    check('断り', '大きく「止まりました」と出て、聞いていない', /止まりました/.test(st.halt) && /止まっている/.test(st.listen), st.halt + ' / ' + st.listen);
    check('断り', '分析役の欄に、出し直さない理由と続け方（整理する AI を変えて「聞き取りを開始」）', /同じ区切りは送り直さない/.test(st.an) && /「聞き取りを開始」/.test(st.an), st.an.replace(/\n/g, ' ').slice(0, 200));
    check('断り', '見えている文は日本語で（「AI」は語として使う）、機械向けの文（not_granted）は畳んだ欄の中', !/[A-Za-z]{2,}/.test(st.an.replace(/AI/g, '')) && /not_granted/.test(st.raw), st.an.replace(/\n/g, ' ').slice(0, 160) + ' / ' + st.raw.slice(0, 120));
    check('断り', '「聞き取りを開始」が押せる（読み込み直さなくてよい）', st.start === false);
    const logA = await P.evaluate(function (name) { const r = globalThis.TSV_RECORD.makeRecord(name); return r.load().then(function () { return r.log.length; }); }, NAME3);
    check('断り', '記録は閉じていない（end を書かない。open だけ）', logA === 1, logA);
    // 分析役を変えて続きから
    await P.evaluate(function () { globalThis.__fake.mode = 'ok'; });
    await P.selectOption('#route', 'mock');
    await P.click('#start');
    await P.waitForFunction(function () { return !document.getElementById('file-next').disabled && /続きから/.test(document.getElementById('setupmsg').textContent); }, null, { timeout: 10000 });
    const haltHidden = await P.evaluate(function () { return document.getElementById('halt').hidden; });
    await nextWindow(1);
    const edge3 = await txt(P, 'edge');
    check('断り', '分析役を変えて「聞き取りを開始」→ 同じ記録の続き（止めた窓の発話を含む）で S1 を書き、止まったという知らせが消える', haltHidden && /（区切り S1）/.test(edge3), edge3);
  }

  // ---------- (g) rate_limited: 1 回目だけ混んでいる → 1 秒おいて同じ窓で出し直し、S1 を書く ----------
  const NAME4 = '混んでいる';
  {
    // (f) の末尾は内蔵の模擬で NAME3 を聞いている。聞き終えてから、この画面の Claude で新しい記録を始める
    await P.click('#end');
    await P.waitForFunction(function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 15000 });
    await P.evaluate(function () { globalThis.__fake.mode = 'rate_limited_once'; });
    const calls0 = await fake('F.sampleCalls');
    await P.fill('#name', NAME4);
    await P.selectOption('#route', 'claude');
    await pasteMaterial();
    await P.click('#start');
    await P.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await P.click('#file-next');
    let sawWait = '';
    try {
      await P.waitForFunction(function () { return /秒おいてから、同じ区切りで送り直す/.test(document.getElementById('an-msgs').textContent); }, null, { timeout: 5000, polling: 50 });
      sawWait = await txt(P, 'an-msgs');
    } catch (e) { sawWait = ''; }
    await P.waitForFunction(function () { return /S1 の区切りを書いた/.test(document.getElementById('an-msgs').textContent); }, null, { timeout: 15000 });
    const calls1 = await fake('F.sampleCalls');
    const edge4 = await txt(P, 'edge');
    const log4 = await readLog(P, NAME4);
    const steps4 = log4.filter(function (e) { return e.e === 'step'; });
    const gaps4 = log4.filter(function (e) { return e.e === 'hold' && e.kind === 'gap'; });
    check('混雑', '混んでいる（rate_limited）と「1 秒おいてから、同じ区切りで送り直す」と出る（見えている文は日本語だけ）', /（1 回目）/.test(sawWait) && /1 秒おいてから、同じ区切りで送り直す/.test(sawWait) && !/[A-Za-z]{2,}/.test(sawWait.split('整理する AI に返したメッセージ')[0]), sawWait.replace(/\n/g, ' ').slice(0, 200));
    check('混雑', 'sample は 2 回（1 回目が混んでいて、2 回目で返事）', calls1 - calls0 === 2, (calls1 - calls0) + ' 回');
    check('混雑', '待った後に同じ区切りで S1 を書き、未確定の区切り（gap）にしない', /（区切り S1）/.test(edge4) && steps4.length === 1 && gaps4.length === 0 && steps4[0].n === 1, edge4 + ' / steps ' + steps4.length + ' gaps ' + gaps4.length);
    const an4 = await txt(P, 'an-msgs');
    check('混雑', '出し直して書けた後の分析役の欄に英字の項目名が無い', /S1 の区切りを書いた/.test(an4) && !/[A-Za-z]{2,}/.test(an4), an4.replace(/\n/g, ' ').slice(0, 160));
  }

  // ---------- (h) アーティファクトの保存機能が無い（use('downloads') が null）: iframe の中では「保存できない」と言う ----------
  {
    await P.click('#end');
    await P.waitForFunction(function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 15000 });
    await P.evaluate(function () { globalThis.__fake.noDownloads = true; document.getElementById('recmsg').textContent = ''; });
    const dl0 = (await fake('F.downloads.slice()')).length;
    await P.click('#export');
    await P.waitForFunction(function () { return /保存できない|保存した|保存しなかった|落とした/.test(document.getElementById('recmsg').textContent); }, null, { timeout: 5000 });
    const m = await txt(P, 'recmsg');
    const dl1 = (await fake('F.downloads.slice()')).length;
    check('書き出し', 'iframe の中で動いている（window.top !== window）', (await fake('F.inIframe')) === true);
    check('書き出し', '保存の権限が無ければ「このアーティファクトでは保存できない（保存の権限が無い）」と言い、保存したとは言わない（モックの downloads は呼ばれない）', /このアーティファクトでは保存できない（保存の権限が無い）/.test(m) && !/落とした|保存した/.test(m) && dl1 === dl0, m);
    await P.evaluate(function () { globalThis.__fake.noDownloads = false; });
  }

  // ---------- (i) API の経路はアーティファクトの中では選べず、無理に選んでも断る ----------
  {
    const st = await P.evaluate(function () {
      const o = function (v) { return document.querySelector('#route option[value="' + v + '"]'); };
      return { a: o('anthropic').disabled, at: o('anthropic').textContent, o: o('openai').disabled, ot: o('openai').textContent };
    });
    check('API', 'アーティファクトの中では API の 2 つの選択肢が選べず、「このアーティファクトでは使えない」と書いてある', st.a && st.o && /このアーティファクトでは使えない/.test(st.at) && /このアーティファクトでは使えない/.test(st.ot), JSON.stringify(st));
    await P.evaluate(function () {
      const o = document.querySelector('#route option[value="anthropic"]'); o.disabled = false;
      const r = document.getElementById('route'); r.value = 'anthropic'; r.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const setup = await txt(P, 'setupmsg');
    check('API', '無理に選ぶと分析役の欄に「このアーティファクトからは外の API に送れません」', /このアーティファクトからは外の API に送れません/.test(setup), setup);
    await P.click('#api-test');
    await page.waitForTimeout(200);
    const am = await txt(P, 'api-msg');
    check('API', '「接続を試す」も断る', /このアーティファクトからは外の API に送れません/.test(am), am);
    const NAME5 = 'API を選ぶ';
    await P.fill('#name', NAME5);
    await P.click('#start');
    await page.waitForTimeout(300);
    const sm = await txt(P, 'setupmsg');
    const log5 = await readLog(P, NAME5);
    check('API', '「聞き取りを開始」も断り、記録を作らない', /このアーティファクトからは外の API に送れません/.test(sm) && log5.length === 0 && (await txt(P, 'st-listen')).indexOf('聞いている') < 0, sm + ' / log ' + log5.length);
    await P.selectOption('#route', 'claude');
  }

  // ---------- (k) 表の一筋: 名前を打たずに「聞き取りを開始」→ 拡張機能 → 構造 → 「停止」 ----------
  const AUTO_NAME = /^\d{4}-\d\d-\d\d \d\d時\d\d分\d\d秒$/;
  {
    await P.fill('#name', '');
    await P.selectOption('#route', 'claude');
    await P.selectOption('#intake', 'bridge');
    await P.fill('#win', '5');
    await P.evaluate(function () { globalThis.__fake.mode = 'generic'; });
    const names0 = await P.evaluate(function () { return globalThis.TSV_RECORD.listNames(); });
    // 選ぶ画面で取り消した: 記録を作らず、「始められませんでした」と出る
    await page.evaluate(function () { window.__bridge.startOk = false; window.__bridge.cmds = []; });
    await P.click('#start');
    await P.waitForFunction(function () { return /始められませんでした/.test(document.getElementById('setupmsg').textContent); }, null, { timeout: 5000 });
    const cancel = await P.evaluate(function () { return { setup: document.getElementById('setupmsg').textContent, start: document.getElementById('start').textContent, dis: document.getElementById('start').disabled, now: document.getElementById('now-text').textContent }; });
    const names1 = await P.evaluate(function () { return globalThis.TSV_RECORD.listNames(); });
    check('表の一筋', '選ぶ画面で取り消すと「始められませんでした：…」と出て、記録を作らず、ボタンはまた押せる', /始められませんでした：画面共有を取り消した/.test(cancel.setup) && names1.length === names0.length && cancel.start === '聞き取りを開始' && !cancel.dis, JSON.stringify(cancel) + ' / ' + names0.length + '→' + names1.length);
    // 本番: 名前を打たずに押す
    await page.evaluate(function () { window.__bridge.startOk = true; window.__bridge.cmds = []; });
    await P.click('#start');
    await P.waitForFunction(function () { return /聞き取り中/.test(document.getElementById('now-text').textContent); }, null, { timeout: 10000 });
    const live = await P.evaluate(function () { return { name: document.getElementById('recname').textContent, startHidden: document.getElementById('start').hidden, endHidden: document.getElementById('end').hidden, where: document.getElementById('now-where').textContent, sample: document.getElementById('sample').hidden, ask: document.getElementById('ask').hidden }; });
    check('表の一筋', '名前は押した日時で付き、表は「停止」だけになり、見本と始める前の欄は消える', AUTO_NAME.test(live.name) && live.startHidden && !live.endHidden && live.sample && live.ask, JSON.stringify(live));
    check('表の一筋', '表に「この PC の中で文字にしています」と出る', /この PC の中で文字にしています/.test(live.where), live.where);
    check('表の一筋', '拡張機能に start（この PC の中で）が届いた', (await bridge('B.cmds.slice()')).indexOf('start:local') >= 0);
    await P.evaluate(function () { window.postMessage({ source: 'kiku-bridge', v: 2, kind: 'lines', lines: ['甲: 今日は三点あります', '乙: 一点目からお願いします', '甲: まず予算の話です'] }, '*'); });
    await P.waitForFunction(function () { return /（区切り S1）/.test(document.getElementById('edge').textContent); }, null, { timeout: 15000 });
    const card = await P.evaluate(function () { return Array.from(document.querySelectorAll('#rows .card .ti')).map(function (e) { return e.textContent; }); });
    check('表の一筋', '届いた発話が区切りになり、この画面の Claude がカードを書いた', card.length >= 1 && /今日は三点あります/.test(card[0]), JSON.stringify(card));
    const anHidden = await P.evaluate(function () { return document.getElementById('analystbox').hidden; });
    check('表の一筋', 'うまくいった区切りでは、分析役の欄を表に出さない', anHidden === true);
    await P.click('#end');
    await P.waitForFunction(function () { return /停止しました/.test(document.getElementById('now-text').textContent); }, null, { timeout: 15000 });
    const name = live.name;
    const logK = await readLog(P, name);
    check('表の一筋', '「停止」で拡張機能に stop が届き、記録を閉じる（end）', (await bridge('B.cmds.slice()')).indexOf('stop') >= 0 && logK.length && logK[logK.length - 1].e === 'end', JSON.stringify(logK.map(function (e) { return e.e; })));
    await P.waitForFunction(function (n) { const o = document.querySelector('#past option'); return o && o.value === n; }, name, { timeout: 5000 }).catch(function () {});
    const past = await P.evaluate(function () { return Array.from(document.querySelectorAll('#past option')).map(function (o) { return o.value; }); });
    check('表の一筋', '前の記録の一覧に、いま閉じた記録が先頭で出る', past[0] === name, past.slice(0, 3).join(' / '));
    // 前の記録を開いて振り返る
    await P.selectOption('#past', name);
    await P.click('#past-open');
    await P.waitForFunction(function () { return /前の記録を見ています/.test(document.getElementById('now-text').textContent); }, null, { timeout: 5000 });
    const view = await P.evaluate(function () { return { replay: !document.getElementById('replayctl').hidden, rows: document.getElementById('rows').children.length }; });
    check('表の一筋', '前の記録を開くと振り返りになり、カードが出る', view.replay && view.rows >= 1, JSON.stringify(view));
  }

  // ---------- (l) 書き起こしを貼る: 時刻の無い文 → 「構造にする」だけで最後まで ----------
  {
    const sentences = [];
    for (let k = 1; k <= 24; k++) sentences.push('これは試しの書き起こしの ' + k + ' 番目の文で、時刻は付いていません。');
    await P.click('#paste-open');
    await P.fill('#paste-text', sentences.join(''));
    await P.click('#paste-go');
    await P.waitForFunction(function () { return /停止しました/.test(document.getElementById('now-text').textContent); }, null, { timeout: 60000 });
    const st = await P.evaluate(function () { return { name: document.getElementById('recname').textContent, intake: document.getElementById('intake').value, paste: document.getElementById('paste-text').value, hidden: document.getElementById('paste').hidden }; });
    // 記録はブラウザの中へ順に書くので、end が書き込まれるまで待ってから読む
    let logL = [];
    for (let k = 0; k < 50; k++) { logL = await readLog(P, st.name); if (logL.length && logL[logL.length - 1].e === 'end') break; await page.waitForTimeout(100); }
    const steps = logL.filter(function (e) { return e.e === 'step'; });
    const cards = logL.filter(function (e) { return e.e === 'card'; });
    check('貼り付け', '名前は日時＋（貼り付け）、区切りは 120 秒', /^\d{4}-\d\d-\d\d \d\d時\d\d分\d\d秒（貼り付け）$/.test(st.name) && logL[0].window === 120 && logL[0].mode === 'file', st.name + ' / ' + JSON.stringify(logL[0]));
    check('貼り付け', '押すだけで区切りごとに流れ、最後まで進んで閉じた（2 区切り以上・カードあり・end）', steps.length >= 2 && cards.length >= 2 && logL[logL.length - 1].e === 'end', 'steps ' + steps.length + ' cards ' + cards.length + ' last ' + logL[logL.length - 1].e);
    check('貼り付け', '貼った欄は空になり、入力方法は元（ブリッジ）に戻る', st.paste === '' && st.hidden && st.intake === 'bridge', JSON.stringify(st));
    await P.evaluate(function () { globalThis.__fake.mode = 'ok'; });
  }

  check('アーティファクト', 'ページ内エラー無し', errs.length === 0, errs.join(' | '));
  check('アーティファクト', 'console.error 無し', consoleErr.length === 0, consoleErr.join(' | '));
  check('アーティファクト', '外部リクエスト無し', ext.length === 0, ext.join(' | '));
  await page.screenshot({ path: path.join(OUT, 'artifact_after.png'), fullPage: true });

  // ---------- (j) 仕組みが自分のページとして出す版: window.claude（use）はあるが機能は全部 null、iframe でない ----------
  {
    const page2 = await ctx.newPage();
    const errs2 = []; const ext2 = []; const downloads2 = [];
    page2.on('pageerror', function (e) { errs2.push(String(e && e.stack || e && e.message || e)); });
    page2.on('request', function (r) { if (!/^(file|blob|data):/.test(r.url())) ext2.push(r.url()); });
    page2.on('download', function (d) { downloads2.push(d); });
    // 保存の画面（showSaveFilePicker）は headless では人の操作が無いと開けないので外し、a[download] の道を見る（e2e_kiku と同じ）
    await page2.addInitScript(function () { try { delete globalThis.showSaveFilePicker; globalThis.showSaveFilePicker = undefined; } catch (e) { /* 消せない */ } });
    await page2.goto('file://' + wrappedPath + '?nosample&nodl');
    await page2.waitForTimeout(500);
    const st = await page2.evaluate(function () {
      const sp = document.querySelector('#intake option[value="speech"]');
      const br = document.querySelector('#intake option[value="bridge"]');
      return { route: document.getElementById('route').value, inIframe: globalThis.__fake.inIframe, setup: document.getElementById('setupmsg').textContent, speechDisabled: !!(sp && sp.disabled), uses: globalThis.__fake.uses.slice(),
        intake: document.getElementById('intake').value, bridgeDisabled: !!(br && br.disabled), bridgeLabel: br ? br.textContent : '', ask: document.getElementById('ask').hidden };
    });
    check('自分のページ', 'iframe でなく、起動の既定はアーティファクトと同じ（分析役は「この画面の Claude」）', st.inIframe === false && st.route === 'claude' && st.speechDisabled, JSON.stringify(st));
    check('自分のページ', '拡張機能は claude.ai の中のアーティファクトにしか届かないので、「ブリッジ」は選べず（claude.ai の中で開いたときだけ）、入力方法は「打つ／貼る」、拡張機能を入れる手順も出さない', st.intake === 'text' && st.bridgeDisabled && /claude\.ai の中で開いたときだけ/.test(st.bridgeLabel) && st.ask === true, JSON.stringify({ intake: st.intake, bridgeDisabled: st.bridgeDisabled, label: st.bridgeLabel, ask: st.ask }));
    check('自分のページ', '問う機能が null と分かると、分析役の欄に「Claude を使う権限が与えられていません」と出る', /Claude を使う権限が与えられていません/.test(st.setup) && st.uses.indexOf('sample') >= 0, st.setup);
    const NAME6 = '自分のページ';
    await page2.fill('#name', NAME6);
    await page2.selectOption('#intake', 'file');
    await page2.evaluate(function (t) { const e = document.getElementById('file-paste'); e.value = t; e.dispatchEvent(new Event('change', { bubbles: true })); }, fixture);
    await page2.waitForFunction(function () { return /貼った文字をファイルとして使う/.test(document.getElementById('intakemsg').textContent); }, null, { timeout: 5000 });
    await page2.click('#start');
    await page2.waitForTimeout(300);
    const sm = await txt(page2, 'setupmsg');
    check('自分のページ', '「この画面の Claude」のまま「聞き取りを開始」を押すと、記録を作らずに断る', /Claude を使う権限が与えられていません/.test(sm) && (await readLog(page2, NAME6)).length === 0, sm);
    await page2.selectOption('#route', 'mock');
    await page2.click('#start');
    await page2.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page2.click('#file-next');
    await page2.waitForFunction(function () { return /S1 の区切りを書いた/.test(document.getElementById('an-msgs').textContent); }, null, { timeout: 15000 });
    await page2.click('#end');
    await page2.waitForFunction(function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 15000 });
    await page2.click('#export');
    await page2.waitForFunction(function () { return /保存できない|保存した|保存しなかった|落とした|保存先を選ばなかった/.test(document.getElementById('recmsg').textContent); }, null, { timeout: 10000 });
    const rm = await txt(page2, 'recmsg');
    const t0 = Date.now();
    while (downloads2.length < 2 && Date.now() - t0 < 10000) await page2.waitForTimeout(100);
    check('自分のページ', 'アーティファクトの保存機能が無く iframe でもなければ、ふつうの書き出し（a[download]）に切り替えて「2 つのファイルを保存した」と言い、「保存できない」とは言わない', !/保存できない/.test(rm) && /2 つのファイルを保存した/.test(rm), rm);
    check('自分のページ', '2 つのファイルが落ちる', downloads2.length === 2, downloads2.length + ' 件 ' + downloads2.map(function (d) { return d.suggestedFilename(); }).join(','));
    check('自分のページ', 'ページ内エラー無し・外部リクエスト無し', errs2.length === 0 && ext2.length === 0, errs2.concat(ext2).join(' | '));
    await page2.close();
  }

  // ---------- (m) 拡張機能を入れる手順: 拡張機能が居ないと 3 つの手順、保存で ZIP、入ると読み込み直さずにつながる ----------
  {
    const ZIP_B64 = require('child_process').execFileSync('python3', ['-c', 'import base64,importlib.util,sys;s=importlib.util.spec_from_file_location("b",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(base64.b64encode(m.make_zip()).decode());print(m.zip_name())', path.join(KIT, 'bridge', 'chrome', 'build_bridge.py')], { encoding: 'utf8' }).trim().split('\n');
    const ZIP_NAME = ZIP_B64[1];
    const page3 = await ctx.newPage();
    const errs3 = [];
    page3.on('pageerror', function (e) { errs3.push(String(e && e.stack || e && e.message || e)); });
    page3.on('console', function (m) { if (m.type() === 'error') errs3.push(m.text()); });
    await page3.goto('file://' + hostPath + '?absent');
    const Q = await (await page3.waitForSelector('#f')).contentFrame();
    await Q.waitForSelector('#route', { timeout: 10000 });
    await Q.waitForFunction(function () { return !document.getElementById('ask-setup').hidden; }, null, { timeout: 8000 });
    const s0 = await Q.evaluate(function () {
      return { text: document.getElementById('ask-text').textContent, steps: document.querySelectorAll('#ask-setup .setup-steps > li').length,
        save: document.getElementById('bridge-save-msg').textContent, zip: document.getElementById('bridge-zip-name').textContent, cls: document.getElementById('ask').className };
    });
    check('入れる手順', '拡張機能が答えないと、表に「3 つの手順」と手順が 3 つ出て、保存する ZIP の名前と大きさが見える', /3 つの手順/.test(s0.text) && s0.steps === 3 && s0.save.indexOf(ZIP_NAME) === 0 && /約 \d+ KB/.test(s0.save) && s0.zip === ZIP_NAME && /setup/.test(s0.cls), JSON.stringify(s0));
    // 「聞き取りを開始」を押すと、拡張機能が無いと赤で断る（入ったら消える。下で確かめる）
    await Q.click('#start');
    const rf = await Q.evaluate(function () { const e = document.getElementById('setupmsg'); return { text: e.textContent, warn: e.className === 'warn' }; });
    check('入れる手順', '拡張機能が無いまま「聞き取りを開始」を押すと、赤で「拡張機能「ブリッジ」が見つかりません」と断る', /拡張機能「ブリッジ」が見つかりません/.test(rf.text) && rf.warn, JSON.stringify(rf));
    // 保存の確かめで取り消す: 赤にせず、もう一度押せると言う
    await Q.evaluate(function () { globalThis.__fake.declineNext = true; });
    await Q.click('#bridge-save');
    await Q.waitForFunction(function () { return /保存しました|保存しませんでした|取り消しました/.test(document.getElementById('bridge-save-result').textContent); }, null, { timeout: 5000 });
    const dc = await Q.evaluate(function () { const e = document.getElementById('bridge-save-result'); return { msg: e.textContent, warn: e.classList.contains('warn'), done: document.getElementById('step-save').classList.contains('done'), btn: document.getElementById('bridge-save').disabled, size: document.getElementById('bridge-save-msg').textContent, role: e.getAttribute('role') }; });
    check('入れる手順', '保存の確認で取り消すと「保存を取り消しました。もう一度押すと保存の確認が出ます」と出て、赤にせず、✓ も付けず、もう一度押せる（名前と大きさのラベルはそのまま）', dc.msg === '保存を取り消しました。もう一度押すと保存の確認が出ます' && !dc.warn && !dc.done && !dc.btn && dc.size.indexOf(ZIP_NAME) === 0 && dc.role === 'status', JSON.stringify(dc));
    const dl0 = (await Q.evaluate(function () { return globalThis.__fake.downloads.length; }));
    await Q.click('#bridge-save');
    await Q.waitForFunction(function () { return /保存しました|保存しませんでした/.test(document.getElementById('bridge-save-result').textContent); }, null, { timeout: 5000 });
    const got = await Q.evaluate(function () { return globalThis.__fake.downloads.slice(); });
    const d = got[got.length - 1] || {};
    const s1 = await Q.evaluate(function () { return { msg: document.getElementById('bridge-save-result').textContent, done: document.getElementById('step-save').classList.contains('done') }; });
    check('入れる手順', '「拡張機能を保存する」でアーティファクトの保存機能に ' + ZIP_NAME + ' が 1 回渡り、中身は make_zip と 1 バイトも違わない', got.length === dl0 + 1 && d.filename === ZIP_NAME && d.b64 === ZIP_B64[0], JSON.stringify({ n: got.length - dl0, filename: d.filename, bytes: d.bytes, same: d.b64 === ZIP_B64[0] }));
    check('入れる手順', '保存すると「〜を保存しました」と出て、1 つ目の手順に ✓ が付く', /を保存しました/.test(s1.msg) && s1.done, JSON.stringify(s1));
    await Q.click('#ext-copy');
    await Q.waitForFunction(function () { return document.getElementById('ext-copy-msg').textContent !== ''; }, null, { timeout: 5000 });
    const cm = await Q.evaluate(function () { return { msg: document.getElementById('ext-copy-msg').textContent, sel: String(getSelection()), done: document.getElementById('step-open').classList.contains('done') }; });
    check('入れる手順', 'アドレスのコピーは、コピーできたら「コピーしました」と ✓、できなければアドレスを選んで Ctrl+C を頼む', (cm.msg === 'コピーしました' && cm.done) || (/Ctrl\+C/.test(cm.msg) && cm.sel === 'chrome://extensions'), JSON.stringify(cm));
    // 拡張機能が入った（モックの拡張機能が答え始めた）: 読み込み直さずに気づく
    await page3.evaluate(function () { window.__bridge.absent = false; });
    await Q.waitForFunction(function () { return /拡張機能とつながっています/.test(document.getElementById('ask-text').textContent); }, null, { timeout: 8000 });
    const s2 = await Q.evaluate(function () { return { setup: document.getElementById('ask-setup').hidden, update: document.getElementById('ask-update-row').hidden, setupmsg: document.getElementById('setupmsg').textContent }; });
    check('入れる手順', '拡張機能が答え始めると、読み込み直さずに手順が消えて「拡張機能とつながっています」になる（同じバージョンなら新しいバージョンの知らせは出ない）', s2.setup && s2.update, JSON.stringify(s2));
    check('入れる手順', '拡張機能が入ると、さっきの赤の断り（見つかりません）は消える', s2.setupmsg === '', JSON.stringify(s2.setupmsg));
    // 古いバージョンの拡張機能: 「新しいバージョンがあります」の行（保存のボタンつき）が出る
    await page3.evaluate(function () { window.__bridge.ver = '0.1.9'; });
    await Q.waitForFunction(function () { return !document.getElementById('ask-update-row').hidden; }, null, { timeout: 8000 });
    const ut = await Q.evaluate(function () { return document.getElementById('ask-update-text').textContent; });
    const ver = /kiku-bridge-(.+)\.zip$/.exec(ZIP_NAME)[1];
    check('入れる手順', 'つながった拡張機能のバージョンが古いと「拡張機能の新しいバージョン（' + ver + '）があります（いまは 0.1.9。このままでも使えます）」と出る', ut.indexOf('拡張機能の新しいバージョン（' + ver + '）があります（いまは 0.1.9') === 0, ut);
    check('音の診断', '診断のできない古いバージョン（0.1.9）とつながっている間は「音の診断」を出さない', await Q.evaluate(function () { return document.getElementById('ask-probe-row').hidden; }));
    const dl1 = (await Q.evaluate(function () { return globalThis.__fake.downloads.length; }));
    await Q.click('#bridge-update');
    await Q.waitForFunction(function () { return /保存しました|保存しませんでした/.test(document.getElementById('bridge-update-msg').textContent); }, null, { timeout: 5000 });
    const got2 = await Q.evaluate(function () { return globalThis.__fake.downloads.slice(); });
    check('入れる手順', '「新しいバージョンを保存する」で同じ ZIP が渡る', got2.length === dl1 + 1 && got2[got2.length - 1].b64 === ZIP_B64[0]);
    await page3.evaluate(function (v) { window.__bridge.ver = v; }, ver);
    await Q.waitForFunction(function () { return document.getElementById('ask-update-row').hidden; }, null, { timeout: 8000 });
    check('入れる手順', '拡張機能を置き換えてバージョンが揃うと、新しいバージョンの知らせは消える', true);
    // 音の診断: バージョンが揃えば出る。このモックの拡張機能は probe に答えないので、押すと少し待って「返事がありません」と言い、また押せるに戻る
    const pr = await Q.evaluate(function () { return !document.getElementById('ask-probe-row').hidden && !document.getElementById('probe-go').disabled; });
    check('音の診断', '診断のできるバージョン（' + ver + '）とつながると「音の診断」が出て押せる', pr);
    await Q.click('#probe-go');
    // postMessage は後から届くので、親が受け取るのを待ってから数える
    await page3.waitForFunction(function () { return window.__bridge.cmds.indexOf('probe') >= 0; }, null, { timeout: 3000 }).catch(function () {});
    const sent = await page3.evaluate(function () { return window.__bridge.cmds.indexOf('probe') >= 0 ? 'probe' : window.__bridge.cmds.join(','); });
    const busy = await Q.evaluate(function () { return document.getElementById('start').disabled; });
    await Q.waitForFunction(function () { return /返事がありません/.test(document.getElementById('probe-msg').textContent); }, null, { timeout: 8000 }).catch(function () {});
    const pm = await Q.evaluate(function () { return { msg: document.getElementById('probe-msg').textContent, go: document.getElementById('probe-go').disabled, start: document.getElementById('start').disabled }; });
    check('音の診断', '押すと拡張機能に probe が届き、その間「聞き取りを開始」は押せない。返事が無ければ「拡張機能から返事がありません…」と言い、どちらもまた押せる', sent === 'probe' && busy && /^拡張機能から返事がありません/.test(pm.msg) && !pm.go && !pm.start, JSON.stringify({ sent: sent, busy: busy, pm: pm }));
    check('入れる手順', 'ページ内エラー無し', errs3.length === 0, errs3.join(' | '));
    await page3.close();
    // アーティファクトの保存機能が無い
    const page4 = await ctx.newPage();
    const wrappedNodl = path.join(OUT, 'artifact_host_nodl.html');
    fs.writeFileSync(wrappedNodl, fs.readFileSync(hostPath, 'utf8').replace('src="artifact_wrapped.html"', 'src="artifact_wrapped.html?nodl"'));
    await page4.goto('file://' + wrappedNodl + '?absent');
    const R = await (await page4.waitForSelector('#f')).contentFrame();
    await R.waitForFunction(function () { return !document.getElementById('ask-setup').hidden; }, null, { timeout: 8000 });
    await R.click('#bridge-save');
    await R.waitForFunction(function () { return /保存しました|保存しませんでした/.test(document.getElementById('bridge-save-result').textContent); }, null, { timeout: 5000 });
    const nm = await R.evaluate(function () { const e = document.getElementById('bridge-save-result'); return { msg: e.textContent, warn: e.classList.contains('warn'), done: document.getElementById('step-save').classList.contains('done'), btn: document.getElementById('bridge-save').disabled }; });
    check('入れる手順', 'アーティファクトの保存機能が無いと「保存しませんでした（この画面では保存できない）」と赤で言い、✓ は付けず、もう一度押せる', nm.msg === '保存しませんでした（この画面では保存できない）' && nm.warn && !nm.done && !nm.btn, JSON.stringify(nm));
    await page4.close();
    // Claude のアプリ（Electron）の中で開いた: 拡張機能を入れる手順は出さず、パソコンの Chrome で開くよう言う
    const ctxApp = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.0.0 Chrome/138.0.0.0 Electron/37.0.0 Safari/537.36' });
    const page5 = await ctxApp.newPage();
    const errs5 = [];
    page5.on('pageerror', function (e) { errs5.push(String(e && e.stack || e && e.message || e)); });
    await page5.goto('file://' + hostPath + '?absent');
    const A5 = await (await page5.waitForSelector('#f')).contentFrame();
    await A5.waitForFunction(function () { return /PC の Chrome/.test(document.getElementById('ask-text').textContent); }, null, { timeout: 8000 });
    const ap = await A5.evaluate(function () { return { text: document.getElementById('ask-text').textContent, setup: document.getElementById('ask-setup').hidden, cls: document.getElementById('ask').className }; });
    check('入れる手順', 'Claude のアプリ（Electron）の中では、3 つの手順を出さず「PC の Chrome でこのアーティファクトを開いてください」と言う', ap.setup && /warn/.test(ap.cls) && ap.text.indexOf('会議の音を聞くには、PC の Chrome でこのアーティファクトを開いてください') === 0, JSON.stringify(ap));
    await A5.click('#start');
    const am = await A5.evaluate(function () { return document.getElementById('setupmsg').textContent; });
    check('入れる手順', 'そこで「聞き取りを開始」を押しても、インストール方法ではなく「PC の Chrome で開く」と断る', /PC の Chrome で/.test(am) && !/インストール方法は下/.test(am), am);
    check('入れる手順', 'アプリの中で開いてもページ内エラー無し', errs5.length === 0, errs5.join(' | '));
    await ctxApp.close();
  }

  await browser.close();
  const ng = results.filter(function (r) { return !r.ok; });
  const out = { results: results, ng: ng.length, total: results.length };
  fs.writeFileSync(path.join(OUT, 'e2e_artifact_result.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ total: results.length, ng: ng.length }, null, 1));
  process.exit(ng.length ? 1 : 0);
})().catch(function (e) { console.error('テストそのものが例外で止まりました: ' + (e && e.stack || e)); process.exit(2); });
