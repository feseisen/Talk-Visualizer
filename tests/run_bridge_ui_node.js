#!/usr/bin/env node
/*
 * run_bridge_ui_node.js — ブリッジの送り手（bridge/chrome/bridge.js）の画面の側を、モックのページで通すテスト（node。本物の Chrome・画面共有・音声認識は使わない）
 *
 *   node tests/run_bridge_ui_node.js [bridge.js のパス]
 *
 * bridge.js をそのまま vm で読み、モックの document（shadow root・iframe）・window の message・時計（手で進める）・
 * intake.js の関数（speechLocal・speechInstall・captureDisplayAudio・makeSpeechIntake を差し替え）を渡して、操作パネルのボタンを押す。
 * モックのアーティファクトは hello に 5 ミリ秒で返事をし（listening はテストが決める）、届いたものを全部記録する。
 *
 * 確かめること:
 *   音声認識データ: 外へ送る承知を求めている間に日本語の音声認識データをダウンロードし終えると、承知の問いが下りて「ブリッジ」のボタンに戻り、この PC の中で始まる
 *   アーティファクトが消えた: 聞いている間に iframe が消えると、その間の発話はバッファに戻り、戻ったアーティファクトが聞き始めると古い順に全部届く（1 件も失われない）
 *   前の回: 前の回の「止めた」を、次の回の画面共有を選んでいる間にアーティファクトへ送り直さない
 *   送り手の終了: 同じ document に 2 つ目の送り手が入ると（拡張機能を置き換えた・入れたときに開いていたタブへ差し込んだ）、前の送り手は受信処理と
 *           操作パネルを外して終了し、ping に答えるのは新しい送り手 1 つだけ。前の送り手が音を取っている途中なら、新しい送り手は
 *           取り終えるまで立ち上がらずに待つ（会議を切らない）。取り終えて終了するときは、アーティファクトに capturing:false を知らせてから退く。
 *           アーティファクトがまだ聞いていない発話が残っていれば、新しい送り手へ渡り、アーティファクトが聞き始めると古い順のまま届く（1 件も落ちない）。
 *           終了を求める知らせに応えない 0.1.0（tests/fixtures/bridge-0.1.0.js）は、操作パネルだけ取り除かれ、v:2 の ping には黙る
 *   バージョン:     here に manifest の version（ver）が乗る。読めなければ乗らない
 *
 * 引数に別の bridge.js を渡すと、それを読む（修正を外したコピーで、このテストが不具合を検出できるかを確かめるため）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const KIT = path.resolve(__dirname, '..');
const FILE = path.resolve(process.argv[2] || path.join(KIT, 'bridge', 'chrome', 'bridge.js'));
const CODE = fs.readFileSync(FILE, 'utf8');

const results = [];
function t(group, name, ok, detail) { results.push({ group: group, name: name, ok: !!ok, detail: detail || '' }); }
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function tick() { return new Promise(function (r) { setImmediate(r); }); }
async function settle() { for (let i = 0; i < 5; i++) await tick(); }
function deferred() { let res, rej; const p = new Promise(function (a, b) { res = a; rej = b; }); return { promise: p, resolve: res, reject: rej }; }

// モックのページ（document・window・時計）を 1 つ作る。送り手は loadCopy で何度でも読める（同じ document を分け合う別の世界）
function makeWorld() {
  let now = 0, tid = 0, timers = [];
  function setT(f, ms) { const id = ++tid; timers.push({ id: id, at: now + (ms || 0), f: f }); return id; }
  function clearT(id) { timers = timers.filter(function (x) { return x.id !== id; }); }
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      timers.sort(function (a, b) { return a.at - b.at || a.id - b.id; });
      const x = timers[0];
      if (!x || x.at > end) break;
      timers.shift(); now = x.at; x.f();
    }
    now = end;
  }
  function mkEl(tag) {
    const e = { tag: tag, children: [], style: {}, textContent: '', disabled: false, className: '', id: '', listeners: {}, attrs: {}, parent: null,
      appendChild: function (c) { this.children.push(c); c.parent = this; return c; },
      setAttribute: function (k, v) { this.attrs[k] = String(v); },
      getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      remove: function () { if (this.parent) { const i = this.parent.children.indexOf(this); if (i >= 0) this.parent.children.splice(i, 1); this.parent = null; } },
      addEventListener: function (ty, f) { (this.listeners[ty] = this.listeners[ty] || []).push(f); },
      attachShadow: function () { this.shadow = mkEl('#shadow'); return this.shadow; },
      click: function () { (this.listeners.click || []).forEach(function (f) { f(); }); } };
    return e;
  }
  const body = mkEl('body');
  const html = mkEl('html');
  html.removeAttribute = function (k) { delete this.attrs[k]; };
  let iframes = [];
  const msgListeners = [];
  const docListeners = {};
  const document = { body: body, documentElement: html, createElement: mkEl,
    getElementById: function (id) { return body.children.filter(function (c) { return c.id === id; })[0] || null; },
    querySelectorAll: function (sel) { return sel === 'iframe' ? iframes.slice() : []; },
    addEventListener: function (ty, f) { (docListeners[ty] = docListeners[ty] || []).push(f); },
    removeEventListener: function (ty, f) { const a = docListeners[ty] || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    dispatchEvent: function (ev) { (docListeners[ev.type] || []).slice().forEach(function (f) { f(ev); }); return true; } };
  const window = { addEventListener: function (ty, f) { if (ty === 'message') msgListeners.push(f); },
    removeEventListener: function (ty, f) { const i = msgListeners.indexOf(f); if (ty === 'message' && i >= 0) msgListeners.splice(i, 1); } };
  // モックのアーティファクト: hello に 5 ミリ秒で返事。届いたものは全部 inbound に残す
  function makeFrame(listening) {
    const fr = { listening: !!listening, inbound: [] };
    const win = { postMessage: function (b, origin) {
      fr.inbound.push({ body: JSON.parse(JSON.stringify(b)), origin: origin });
      if (b && b.kind === 'hello') setT(function () {
        msgListeners.forEach(function (f) { f({ data: { source: 'kiku', v: 2, kind: 'hello', listening: fr.listening, received: 0 }, source: win }); });
      }, 5);
    } };
    fr.el = { src: 'https://0f0f0f0f-0000-4000-8000-000000000001.frame.claudeusercontent.com/', contentWindow: win };
    fr.lines = function () { return fr.inbound.filter(function (m) { return m.body.kind === 'lines'; }).reduce(function (a, m) { return a.concat(m.body.lines.map(function (l) { return l.text; })); }, []); };
    fr.statuses = function () { return fr.inbound.filter(function (m) { return m.body.kind === 'status'; }).map(function (m) { return m.body.state + ':' + m.body.text; }); };
    return fr;
  }
  function send(data, origin, source) { msgListeners.slice().forEach(function (f) { f({ data: data, origin: origin, source: source }); }); }
  return { document: document, window: window, body: body, setT: setT, clearT: clearT, advance: advance, makeFrame: makeFrame, send: send,
    msgListeners: msgListeners, now: function () { return now; }, setFrames: function (frs) { iframes = frs.map(function (f) { return f.el; }); } };
}

// 送り手（bridge.js、または code に渡した別のバージョン）を world の document に 1 つ読む。opts.ver は manifest の version（null なら chrome が無い）
function loadCopy(world, opts, code) {
  opts = opts || {};
  const document = world.document, window = world.window, body = world.body, setT = world.setT, clearT = world.clearT;
  const makeFrame = world.makeFrame, advance = world.advance, send = world.send;
  const now = world.now;
  // 差し替えた intake.js の関数
  const where = (opts.where || ['available']).slice();
  const intakeCalls = [];
  let install = null, capture = null, emit = null, captureN = 0;
  const INTAKE = {
    speechLocal: function () { return Promise.resolve(where.length > 1 ? where.shift() : where[0]); },
    speechInstall: function () { install = deferred(); return install.promise; },
    captureDisplayAudio: function () { captureN++; capture = deferred(); if (opts.captureReject) capture.reject(opts.captureReject); else if (opts.captureNow !== false) capture.resolve({ stream: { getTracks: function () { return []; } }, track: {}, label: '画面 1' }); return capture.promise; },
    makeSpeechIntake: function (e, clock, o) { emit = e; intakeCalls.push({ local: o && o.local }); return { start: function () { return true; }, stop: function () {}, stopWait: function (done) { done(); } }; },
    DISPLAY_TEXT: { ended: '画面共有が止められた' }
  };
  const ctx = { document: document, window: window, setTimeout: setT, clearTimeout: clearT, Date: { now: now },
    Promise: Promise, URL: URL, console: console, Math: Math, JSON: JSON, String: String, Array: Array, Object: Object, isFinite: isFinite,
    Event: function (type) { this.type = type; } };
  if (opts.ver !== null) ctx.chrome = { runtime: { getManifest: function () { if (opts.verThrows) throw new Error('Extension context invalidated.'); return { version: opts.ver || '0.2.0' }; } } };
  ctx.globalThis = ctx;
  ctx.TSV_INTAKE = INTAKE;
  vm.createContext(ctx);
  const before = body.children.slice();
  vm.runInContext(code || CODE, ctx, { filename: FILE });
  // この送り手の操作パネルの host（立ち上がるまで待っている送り手は、まだ持たない）
  let host = body.children.filter(function (c) { return before.indexOf(c) < 0; })[0] || null;
  function uiOf(h) {
    const k = h.shadow && h.shadow.children[1] ? h.shadow.children[1].children : [];
    return { where: k[1], install: k[2], start: k[3], consent: k[4], stop: k[5], hello: k[6], status: k[7], interim: k[8], share: k[9], pending: k[10] };
  }
  function shown(x) { return x.style.display !== 'none'; }
  const C = {
    ui: host ? uiOf(host) : null, shown: shown, advance: advance, intakeCalls: intakeCalls, makeFrame: makeFrame, send: send, host: host,
    // 待っていた送り手が立ち上がった後に host と ui を拾い直す（立ち上がっていれば true）。読んだ後に増えた host を拾うので、
    // 待っている送り手が 2 つ以上あるときは使わない（どちらの host か見分けられない）
    adopt: function () { if (C.host) return true; const h = body.children.filter(function (c) { return before.indexOf(c) < 0; })[0]; if (!h) return false; C.host = h; C.ui = uiOf(h); return true; },
    captureCalls: function () { return captureN; },
    setFrames: world.setFrames,
    install: function () { return install; }, capture: function () { return capture; },
    LOCAL_NOT_READY_TEXT: ctx.KIKU_BRIDGE.LOCAL_NOT_READY_TEXT, FROM_FRAME_FAILED_TEXT: ctx.KIKU_BRIDGE.FROM_FRAME_FAILED_TEXT,
    BUSY_WAIT_MS: ctx.KIKU_BRIDGE.BUSY_WAIT_MS, HOST_ID: ctx.KIKU_BRIDGE.HOST_ID, HANDOFF_ATTR: ctx.KIKU_BRIDGE.HANDOFF_ATTR,
    line: function (text) { emit.line({ text: text, t: Math.floor(now() / 1000) }); },
    now: now
  };
  return C;
}
// モックのページを 1 つ作り、bridge.js を 1 つ読む
function makePage(opts) { return loadCopy(makeWorld(), opts); }

(async function () {
  // ---------- 音声認識データ: 承知を求めている間に音声認識データをダウンロードし終えたら、承知の問いを下ろして「ブリッジ」のボタンに戻す ----------
  {
    const G = '音声認識データ';
    const P = makePage({ where: ['downloadable', 'available'] });
    await settle();
    t(G, '起動時は「日本語の音声認識データをダウンロードする」と「ブリッジ」のボタンが出て、承知のボタンは出ない', P.shown(P.ui.install) && P.shown(P.ui.start) && !P.shown(P.ui.consent) && /日本語の音声認識データをダウンロードする/.test(P.ui.where.textContent), P.ui.where.textContent);
    P.ui.start.click();
    t(G, '「ブリッジ」を押すと、外へ送る承知を求める（承知のボタンだけが出る）', !P.shown(P.ui.start) && P.shown(P.ui.consent) && /サーバーへ送ってよければ/.test(P.ui.status.textContent), P.ui.status.textContent);
    P.ui.install.click();
    t(G, '音声認識データをダウンロードしている途中は承知の問いのまま', /ダウンロードしている途中/.test(P.ui.where.textContent) && P.shown(P.ui.consent));
    P.install().resolve(true);
    await settle();
    t(G, '入れ終えると「この PC の中で文字にする」になり、承知のボタンが消えて「ブリッジ」のボタンに戻る', /この PC の中で文字にする/.test(P.ui.where.textContent) && P.shown(P.ui.start) && !P.shown(P.ui.consent) && !P.ui.start.disabled, JSON.stringify({ where: P.ui.where.textContent, start: P.shown(P.ui.start), consent: P.shown(P.ui.consent) }));
    t(G, '承知を求める文も消える', P.ui.status.textContent === '', P.ui.status.textContent);
    const fr = P.makeFrame(true); P.setFrames([fr]);
    P.ui.start.click();
    await settle();
    t(G, '「ブリッジ」を押すと、この PC の中で文字にする形（local: true）で始まる', deepEq(P.intakeCalls, [{ local: true }]), JSON.stringify(P.intakeCalls));
    // 音声認識データが入らなかった（まだ downloadable）ときは承知の問いを下ろさない
    const Q = makePage({ where: ['downloadable', 'downloadable'] });
    await settle();
    Q.ui.start.click(); Q.ui.install.click(); Q.install().resolve(false); await settle();
    t(G, '音声認識データが入らなかったときは、承知の問いを残す（承知のボタンのまま。外へは送らない）', Q.shown(Q.ui.consent) && !Q.shown(Q.ui.start) && Q.intakeCalls.length === 0, JSON.stringify({ consent: Q.shown(Q.ui.consent), start: Q.shown(Q.ui.start) }));
  }

  // ---------- アーティファクトが消えた: 開いている間に iframe が消えても、その間の発話を失わない ----------
  {
    const G = 'アーティファクトが消えた';
    const P = makePage();
    await settle();
    const a = P.makeFrame(true); P.setFrames([a]);
    P.ui.start.click(); await settle();
    P.advance(10);   // hello の返事（listening:true）でゲートが開く
    P.line('一つ目'); P.advance(1000);
    t(G, 'アーティファクトが聞いている間は、1 秒で届く', deepEq(a.lines(), ['一つ目']), JSON.stringify(a.lines()));
    P.advance(1090);   // 2 秒目の hello（アーティファクトはまだ居る）の後へ。次の hello は 4 秒目
    P.line('消える直前'); P.advance(200);
    P.setFrames([]);   // 会話を移った・アーティファクトを閉じた（hello が気づく前）
    P.line('消えた後'); P.advance(800);   // 3.1 秒目にまとめ送りの時計が鳴る（アーティファクトが 1 つも無い。次の hello より前）
    P.advance(1);
    t(G, 'アーティファクトが無いときに鳴ったまとめ送りの 2 件は失われずにバッファに戻り、操作パネルに件数が出る', /2 件/.test(P.ui.pending.textContent) && deepEq(a.lines(), ['一つ目']), P.ui.pending.textContent);
    P.advance(3000);
    t(G, '次の hello で「アーティファクトが見つからない」になる', /アーティファクトが見つからない/.test(P.ui.hello.textContent), P.ui.hello.textContent);
    const b = P.makeFrame(false); P.setFrames([b]);
    P.line('戻る前'); P.advance(2100);
    t(G, 'アーティファクトが戻っても聞いていない間は流れない（溜めた発話は 3 件）', b.lines().length === 0 && /3 件/.test(P.ui.pending.textContent), P.ui.pending.textContent);
    b.listening = true; P.advance(2100);
    t(G, 'アーティファクトが聞き始めると、溜めた 3 件が古い順に 1 回で届き、1 件も失われない', deepEq(b.lines(), ['消える直前', '消えた後', '戻る前']) && P.ui.pending.textContent === '', JSON.stringify(b.lines()));
    P.line('その後'); P.advance(1000);
    t(G, 'その後は 1 秒のまとめ送りに戻る', deepEq(b.lines(), ['消える直前', '消えた後', '戻る前', 'その後']), JSON.stringify(b.lines()));
    // 止める瞬間にアーティファクトが無い: 止めるときの残りの送りもバッファに戻る
    P.line('止める直前'); P.setFrames([]);
    P.ui.stop.click(); P.advance(1);
    t(G, '「停止」の瞬間にアーティファクトが無くても、残りの 1 件はバッファに戻る', /1 件/.test(P.ui.pending.textContent) && P.ui.status.textContent === '止めた', JSON.stringify({ pending: P.ui.pending.textContent, status: P.ui.status.textContent }));
    P.setFrames([b]); P.advance(2100);
    t(G, 'アーティファクトが戻ると（聞いている）、止めた後でもその 1 件が届く', b.lines()[b.lines().length - 1] === '止める直前' && P.ui.pending.textContent === '', JSON.stringify(b.lines()));
  }

  // ---------- 前の回: 前の回の status を、次の回の画面共有を選んでいる間に送り直さない ----------
  {
    const G = '前の回';
    const P = makePage({ captureNow: false });
    await settle();
    const a = P.makeFrame(true); P.setFrames([a]);
    P.ui.start.click(); P.capture().resolve({ stream: { getTracks: function () { return []; } }, track: {}, label: '画面 1' }); await settle(); P.advance(10);
    P.ui.stop.click(); P.advance(5000);
    a.listening = false; a.inbound.length = 0;
    P.ui.start.click();   // 2 回目。画面共有の画面を選んでいる途中（capture は保留のまま）
    await settle(); P.advance(10);
    t(G, '2 回目を押すと hello が出て、アーティファクトは聞いていない返事', a.inbound.some(function (m) { return m.body.kind === 'hello'; }) && /聞き取りを開始/.test(P.ui.hello.textContent), P.ui.hello.textContent);
    a.listening = true; P.advance(2100);   // 選んでいる間にアーティファクトが聞き始める（返事が false→true）
    t(G, '選んでいる間にアーティファクトが聞き始めても、前の回の「止めた」は送り直さない', a.statuses().length === 0, JSON.stringify(a.statuses()));
    P.capture().resolve({ stream: { getTracks: function () { return []; } }, track: {}, label: '画面 2' }); await settle();
    t(G, '画面を選び終えると、この回の「聞き始めた」だけが届く', a.statuses().length === 1 && /^listening:ブリッジが聞き始めた（画面 2。/.test(a.statuses()[0]), JSON.stringify(a.statuses()));
  }

  // ---------- アーティファクトの指図: アーティファクトのボタンから ping・start・stop・install が届く ----------
  {
    const G = 'アーティファクトの指図';
    const ORIGIN = 'https://0f0f0f0f-0000-4000-8000-000000000001.frame.claudeusercontent.com';
    function frameWin() { const w = { got: [], postMessage: function (b, o) { w.got.push({ body: JSON.parse(JSON.stringify(b)), origin: o }); } }; return w; }
    function heres(w) { return w.got.filter(function (m) { return m.body.kind === 'here'; }).map(function (m) { return m.body; }); }
    const P = makePage();
    await settle();
    t(G, '起動しただけでは操作パネルを出さない（claude.ai のどのページにも入るので）', P.host.style.display === 'none', P.host.style.display);
    const w = frameWin();
    P.send({ source: 'kiku', v: 2, kind: 'ping' }, ORIGIN, w);
    t(G, 'ping には、そのアーティファクトに here を返す（宛先の origin は送り手の origin）', w.got.length === 1 && w.got[0].origin === ORIGIN && w.got[0].body.kind === 'here' && w.got[0].body.where === 'available' && w.got[0].body.capturing === false, JSON.stringify(w.got));
    const evil = frameWin();
    P.send({ source: 'kiku', v: 2, kind: 'ping' }, 'https://evil.example', evil);
    P.send({ source: 'kiku', v: 2, kind: 'ping' }, 'http://x.frame.claudeusercontent.com', evil);
    P.send({ source: 'kiku', v: 2, kind: 'start', local: true }, 'https://claudeusercontent.com.evil.example', evil);
    t(G, 'アーティファクトの origin でないところ（別のホスト・http・名前の偽装）からの指図には応えず、画面共有も開かない', evil.got.length === 0 && P.captureCalls() === 0, JSON.stringify(evil.got));
    // start: 知らせの中で同期に画面共有を呼ぶ（アーティファクトのクリックの「操作の直後」の扱いのうちに）
    P.send({ source: 'kiku', v: 2, kind: 'start', local: true }, ORIGIN, w);
    t(G, 'start の知らせを受けたその場で（待たずに）画面共有を呼ぶ', P.captureCalls() === 1);
    await settle();
    t(G, 'local:true なら、この PC の中で文字にする形で始まる', deepEq(P.intakeCalls, [{ local: true }]), JSON.stringify(P.intakeCalls));
    t(G, '聞いている間は操作パネルを出し、アーティファクトに capturing:true の here を送る', P.host.style.display === '' && heres(w).some(function (h) { return h.capturing === true; }), JSON.stringify(heres(w)));
    P.send({ source: 'kiku', v: 2, kind: 'start', local: true }, ORIGIN, w);
    t(G, '聞いている間に start がもう一度来ても、画面共有を二重に開かない', P.captureCalls() === 1);
    P.send({ source: 'kiku', v: 2, kind: 'stop' }, ORIGIN, w);
    P.advance(1); await settle();
    t(G, 'stop で止まり、アーティファクトに「止めた」と capturing:false を送り、操作パネルをしまう', w.got.some(function (m) { return m.body.kind === 'status' && m.body.state === 'stopped'; }) && heres(w).slice(-1)[0].capturing === false && P.host.style.display === 'none', JSON.stringify({ last: heres(w).slice(-1)[0], disp: P.host.style.display }));
    // 入れ子の iframe: アーティファクトがページの直下の iframe に無くても、指図をくれたウィンドウへ発話が届く
    P.setFrames([]);
    const nested = frameWin();
    nested.postMessage = (function (orig) { return function (b, o) { orig(b, o); if (b && b.kind === 'hello') P.advance(0); }; })(nested.postMessage);
    P.send({ source: 'kiku', v: 2, kind: 'start', local: true }, ORIGIN, nested);
    await settle();
    P.send({ source: 'kiku', v: 2, kind: 'hello', listening: true, received: 0 }, ORIGIN, nested);
    P.line('入れ子へ'); P.advance(1000);
    const nestedLines = nested.got.filter(function (m) { return m.body.kind === 'lines'; }).reduce(function (a, m) { return a.concat(m.body.lines.map(function (l) { return l.text; })); }, []);
    t(G, 'アーティファクトがページの直下に無くても（入れ子の iframe）、指図をくれたウィンドウへ発話が届く（宛先はそのアーティファクトの origin）', deepEq(nestedLines, ['入れ子へ']) && nested.got.filter(function (m) { return m.body.kind === 'lines'; }).every(function (m) { return m.origin === ORIGIN; }), JSON.stringify(nested.got.map(function (m) { return m.body.kind; })));
    P.send({ source: 'kiku', v: 2, kind: 'stop' }, ORIGIN, nested); P.advance(1); await settle();
  }
  {
    const G = 'アーティファクトの指図';
    const ORIGIN = 'https://0f0f0f0f-0000-4000-8000-000000000001.frame.claudeusercontent.com';
    const w = { got: [], postMessage: function (b, o) { w.got.push({ body: JSON.parse(JSON.stringify(b)), origin: o }); } };
    // この PC の中では文字にできないのに local:true: 始めない
    const Q = makePage({ where: ['downloadable', 'available'] });
    await settle();
    Q.send({ source: 'kiku', v: 2, kind: 'start', local: true }, ORIGIN, w);
    t(G, 'この PC の中でと言われても、できない状態なら画面共有を開かず、アーティファクトにエラーを送る', Q.captureCalls() === 0 && w.got.some(function (m) { return m.body.kind === 'status' && m.body.state === 'error' && m.body.text === Q.LOCAL_NOT_READY_TEXT; }), JSON.stringify(w.got));
    Q.send({ source: 'kiku', v: 2, kind: 'install' }, ORIGIN, w);
    t(G, 'install で音声認識データのダウンロードを始め、アーティファクトに where:downloading の here を送る', !!Q.install() && w.got.some(function (m) { return m.body.kind === 'here' && m.body.where === 'downloading'; }), JSON.stringify(w.got.map(function (m) { return m.body.kind + ':' + (m.body.where || m.body.state); })));
    Q.install().resolve(true); await settle();
    t(G, '入れ終えると調べ直し、アーティファクトに where:available の here を送る', w.got.filter(function (m) { return m.body.kind === 'here'; }).slice(-1)[0].body.where === 'available', JSON.stringify(w.got.map(function (m) { return m.body.kind + ':' + (m.body.where || m.body.state); })));
    Q.send({ source: 'kiku', v: 2, kind: 'start', local: false }, ORIGIN, w);
    await settle();
    t(G, 'local:false（利用者が外へ送ると選んだ）なら、サーバーへ送る形で始まる', deepEq(Q.intakeCalls, [{ local: false }]), JSON.stringify(Q.intakeCalls));
    // アーティファクトのクリックが親に伝わらないブラウザ: 画面共有が InvalidStateError で断られたら、操作パネルを開いて、そこで押してもらう
    const err = new Error('ボタンを押した直後にしか画面共有を始められない'); err.cause = { name: 'InvalidStateError' };
    const R2 = makePage({ captureReject: err });
    await settle();
    R2.send({ source: 'kiku', v: 2, kind: 'start', local: true }, ORIGIN, w);
    await settle();
    t(G, 'アーティファクトからの start が「操作の直後」の扱いを持たずに断られたら、操作パネルを開いて、そこのボタンで始めるよう出す', R2.host.style.display === '' && R2.ui.status.textContent === R2.FROM_FRAME_FAILED_TEXT && R2.shown(R2.ui.start), R2.ui.status.textContent);
  }

  // ---------- 送り手の終了: 同じタブに送り手が 2 つ入ったら、答えるのは最後に入った 1 つだけ ----------
  {
    const G = '送り手の終了';
    const ORIGIN = 'https://0f0f0f0f-0000-4000-8000-000000000001.frame.claudeusercontent.com';
    function frameWin() { const w = { got: [], postMessage: function (b, o) { w.got.push({ body: JSON.parse(JSON.stringify(b)), origin: o }); } }; return w; }
    function ping(W, v) { const w = frameWin(); W.send({ source: 'kiku', v: v || 2, kind: 'ping' }, ORIGIN, w); return w.got.filter(function (m) { return m.body.kind === 'here'; }).map(function (m) { return m.body; }); }
    function hosts(W) { return W.body.children.filter(function (c) { return c.id === 'kiku-bridge-host'; }); }

    // 1. 休んでいる送り手のタブに新しいバージョンが入る（拡張機能を置き換えた・開いていたタブへ差し込んだ）
    const W = makeWorld();
    const A = loadCopy(W, { ver: '0.2.0' }); await settle();
    t(G, '1 つ目は ping に答える（ver は 0.2.0）', deepEq(ping(W).map(function (h) { return h.ver; }), ['0.2.0']));
    const B = loadCopy(W, { ver: '0.2.1' }); await settle();
    t(G, '2 つ目が入ると、休んでいた 1 つ目は操作パネルを外して終了し、操作パネルは 2 つ目の 1 つだけ', hosts(W).length === 1 && hosts(W)[0] === B.host && A.host.parent === null, String(hosts(W).length));
    t(G, 'ping に答えるのは 2 つ目だけ（here は 1 通、ver は 0.2.1）', deepEq(ping(W).map(function (h) { return h.ver; }), ['0.2.1']), JSON.stringify(ping(W)));
    t(G, '終了した送り手は window の message の受信処理も外す（受信処理は 1 つ）', W.msgListeners.length === 1, String(W.msgListeners.length));
    const n0 = W.msgListeners.length;
    W.advance(10000);
    t(G, '終了した送り手は時計も止める（10 秒進めても、受信処理も送りも増えない）', W.msgListeners.length === n0);

    // 2. 音を取っている途中の送り手のタブに新しいバージョンが入る: 取り終えるまで新しい方は立ち上がらない
    const X = makeWorld();
    const C = loadCopy(X, { ver: '0.2.0' }); await settle();
    const w = frameWin();
    X.send({ source: 'kiku', v: 2, kind: 'start', local: true }, ORIGIN, w); await settle();
    t(G, '音を取っている途中は、操作パネルの host に data-busy=1 が立つ', C.host.getAttribute('data-busy') === '1', C.host.getAttribute('data-busy'));
    const D = loadCopy(X, { ver: '0.2.1' }); await settle();
    t(G, '音を取っている途中に新しいバージョンが入っても、前の送り手は終了せず、新しい方は立ち上がらずに待つ', hosts(X).length === 1 && hosts(X)[0] === C.host && D.adopt() === false);
    t(G, '待っている間、ping に答えるのは前の送り手だけ（会議を切らない）', deepEq(ping(X).map(function (h) { return h.ver + ':' + h.capturing; }), ['0.2.0:true']), JSON.stringify(ping(X)));
    X.advance(D.BUSY_WAIT_MS * 3); await settle();
    t(G, '取っている間は、見回りを何度過ぎても待ち続ける', D.adopt() === false && hosts(X)[0] === C.host);
    X.send({ source: 'kiku', v: 2, kind: 'stop' }, ORIGIN, w); X.advance(1); await settle();
    t(G, '前の送り手は止めた知らせをアーティファクトに送ってから終了する', w.got.some(function (m) { return m.body.kind === 'status' && m.body.state === 'stopped'; }) && C.host.parent === null);
    const lastHere = w.got.filter(function (m) { return m.body.kind === 'here'; }).slice(-1)[0];
    t(G, '終了する前に、アーティファクトへ「もう音を取っていない」（here の capturing:false）を知らせる', !!lastHere && lastHere.body.capturing === false && lastHere.body.ver === '0.2.0', JSON.stringify(lastHere));
    X.advance(D.BUSY_WAIT_MS); await settle();
    t(G, '前の送り手が終了した後の見回りで、新しい方が立ち上がる（操作パネルは 1 つ、ping の答えは 0.2.1 の 1 通）', D.adopt() === true && hosts(X).length === 1 && deepEq(ping(X).map(function (h) { return h.ver; }), ['0.2.1']), JSON.stringify(ping(X)));

    // 3. 待っている間にさらに新しいバージョンが入る: 立ち上がるのは最後の 1 つだけ
    const Y = makeWorld();
    Y.makeFrame(true);
    const E = loadCopy(Y, { ver: '0.2.0' }); await settle();
    const wy = frameWin();
    Y.send({ source: 'kiku', v: 2, kind: 'start', local: true }, ORIGIN, wy); await settle();
    const F = loadCopy(Y, { ver: '0.2.1' }); await settle();
    const H = loadCopy(Y, { ver: '0.2.2' }); await settle();
    Y.send({ source: 'kiku', v: 2, kind: 'stop' }, ORIGIN, wy); Y.advance(1); await settle();
    Y.advance(E.BUSY_WAIT_MS * 2); await settle();
    t(G, '待っていた 2 つのうち、立ち上がるのは後から入った方だけ（操作パネル 1 つ、ping の答えは 0.2.2 の 1 通）', Y.msgListeners.length === 1 && hosts(Y).length === 1 && deepEq(ping(Y).map(function (h) { return h.ver; }), ['0.2.2']), JSON.stringify({ listeners: Y.msgListeners.length, hosts: hosts(Y).length, here: ping(Y) }));

    // 4. 終了を求める知らせに応えない 0.1.0 がタブに残っている
    let OLD = null;
    try { OLD = fs.readFileSync(path.join(KIT, 'tests', 'fixtures', 'bridge-0.1.0.js'), 'utf8'); } catch (e) { OLD = null; }
    if (!OLD) t(G, '0.1.0 の bridge.js のコピー（tests/fixtures/bridge-0.1.0.js）を読めた', false, '読めない');
    else {
      const Z = makeWorld();
      const O = loadCopy(Z, { ver: '0.1.0' }, OLD); await settle();
      t(G, '0.1.0 は v:1 の ping に答える（テストの前提）', ping(Z, 1).length === 1 && ping(Z, 2).length === 0);
      const N = loadCopy(Z, { ver: '0.2.0' }); await settle();
      t(G, '新しいバージョンが入ると、0.1.0 の操作パネルは取り除かれ、操作パネルは新しいバージョンの 1 つだけ', hosts(Z).length === 1 && hosts(Z)[0] === N.host && O.host.parent === null);
      t(G, 'v:2 の ping に答えるのは新しいバージョンだけ（0.1.0 は黙る）', deepEq(ping(Z).map(function (h) { return h.v + ':' + h.ver; }), ['2:0.2.0']), JSON.stringify(ping(Z)));
    }

    // 5. 音を取っている途中にアーティファクトが消え、溜めた発話が残ったまま止めて終了する: 溜めた分は新しい送り手へ渡り、アーティファクトが戻ると古い順に届く
    const V = makeWorld();
    const fa = V.makeFrame(true); V.setFrames([fa]);
    const K = loadCopy(V, { ver: '0.2.0' }); await settle();
    K.ui.start.click(); await settle(); V.advance(10);
    K.line('一'); V.advance(1000);
    V.setFrames([]);   // アーティファクトが消えた（会話を移った・閉じた）
    K.line('二'); K.line('三'); V.advance(1000); V.advance(1);
    const L = loadCopy(V, { ver: '0.2.1' }); await settle();
    t(G, '（前提）アーティファクトが消えた後の 2 件はバッファにあり、新しい送り手は取り終えるのを待っている', /2 件/.test(K.ui.pending.textContent) && L.adopt() === false && deepEq(fa.lines(), ['一']), K.ui.pending.textContent);
    K.ui.stop.click(); V.advance(1); await settle();
    const handed = V.document.documentElement.getAttribute(K.HANDOFF_ATTR);
    t(G, '止めて終了するとき、溜めた 2 件を <html> の置き場へ渡す', K.host.parent === null && !!handed && deepEq(JSON.parse(handed).map(function (l) { return l.text; }), ['二', '三']), String(handed));
    V.advance(K.BUSY_WAIT_MS); await settle();
    t(G, '新しい送り手は立ち上がるときに置き場を読んで消し、2 件をバッファに持つ（操作パネルに件数が出る）', L.adopt() === true && V.document.documentElement.getAttribute(K.HANDOFF_ATTR) === null && /2 件/.test(L.ui.pending.textContent) && L.host.style.display === '', JSON.stringify({ pending: L.ui && L.ui.pending.textContent, attr: V.document.documentElement.getAttribute(K.HANDOFF_ATTR) }));
    const fb = V.makeFrame(false); V.setFrames([fb]);
    L.ui.start.click(); await settle(); V.advance(10);
    L.line('四'); V.advance(1000);
    t(G, 'アーティファクトが戻っても聞いていない間は流れない', fb.lines().length === 0, JSON.stringify(fb.lines()));
    fb.listening = true; V.advance(2100);
    t(G, 'アーティファクトが聞き始めると、前の送り手から渡った 2 件が、新しい送り手の発話より先に古い順で届く（1 件も落ちず、二重にも届かない）', deepEq(fb.lines(), ['二', '三', '四']), JSON.stringify(fb.lines()));

    // 6. 休んでいる送り手に溜めた発話が残っている（止めた後にアーティファクトが消えていた）ときに、新しいバージョンが入る: その場で渡る
    const U = makeWorld();
    const fu = U.makeFrame(true); U.setFrames([fu]);
    const M = loadCopy(U, { ver: '0.2.0' }); await settle();
    M.ui.start.click(); await settle(); U.advance(10);
    M.line('甲'); U.setFrames([]);
    M.ui.stop.click(); U.advance(1); await settle();
    t(G, '（前提）止めた後も 1 件がバッファに残っている', /1 件/.test(M.ui.pending.textContent), M.ui.pending.textContent);
    const N2 = loadCopy(U, { ver: '0.2.1' }); await settle();
    t(G, '休んでいる送り手はその場で終了し、新しい送り手が 1 件を受け取って立ち上がる', M.host.parent === null && N2.host !== null && /1 件/.test(N2.ui.pending.textContent) && U.document.documentElement.getAttribute(M.HANDOFF_ATTR) === null, JSON.stringify({ pending: N2.ui && N2.ui.pending.textContent }));
    const fv = U.makeFrame(true); U.setFrames([fv]); U.advance(2100);
    t(G, '新しい送り手は聞いていなくてもアーティファクトを探し続け、アーティファクトが聞いていれば受け取った 1 件を 1 度だけ届ける', deepEq(fv.lines(), ['甲']) && U.msgListeners.length === 1, JSON.stringify({ lines: fv.lines(), listeners: U.msgListeners.length }));
  }

  // ---------- バージョン: here に manifest の version が乗る ----------
  {
    const G = 'バージョン';
    const ORIGIN = 'https://0f0f0f0f-0000-4000-8000-000000000001.frame.claudeusercontent.com';
    function here(opts) {
      const W = makeWorld(); loadCopy(W, opts);
      const w = { got: [], postMessage: function (b) { w.got.push(JSON.parse(JSON.stringify(b))); } };
      W.send({ source: 'kiku', v: 2, kind: 'ping' }, ORIGIN, w);
      return w.got.filter(function (m) { return m.kind === 'here'; })[0] || null;
    }
    t(G, 'here に manifest の version が乗る', (here({ ver: '0.3.1' }) || {}).ver === '0.3.1');
    const noChrome = here({ ver: null });
    t(G, 'chrome が無い所（node のテスト・普通のページ）では ver を載せない', noChrome && !('ver' in noChrome), JSON.stringify(noChrome));
    const orphan = here({ ver: '0.2.0', verThrows: true });
    t(G, 'manifest を読むと投げる（置き換えられた後の古い送り手）ときも ver を載せず、ping には答える', orphan && !('ver' in orphan) && orphan.where, JSON.stringify(orphan));
  }

  report();
})().catch(function (e) { console.error('テストそのものが例外で止まりました: ' + (e && e.stack || e)); process.exit(2); });

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
  process.exitCode = ng ? 1 : 0;
}
