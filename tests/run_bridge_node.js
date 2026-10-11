#!/usr/bin/env node
/*
 * run_bridge_node.js — 橋の入口（src/intake.js の makeBridgeIntake・bridgeMessage）の試験（node。本物の窓は使わない）
 *
 *   node tests/run_bridge_node.js
 *
 * 偽の窓（addEventListener／removeEventListener／postMessage を持つだけのもの）に message を流して確かめる:
 *   読み:   橋の言葉でないもの・版違い・形違いは null。文字列は打つ入口と同じ読み方（話者の切り出し・1 列目の時刻を落とす・
 *           改行で分ける）。{who, text} はそのまま。それ以外の要素は落として数える
 *   受け:   始める前・止めた後は受けない。受けた発話は打つ入口と同じ形 {who, text, t} で emit.line に届き、t は届いた時刻
 *           （送り手の時刻は使わない）で単調。setFloor で下限を足せる
 *   hello:  {source:'kiku', v:2, kind:'hello', listening, received} を送り手（ev.source。親ページなど自分の窓と違う窓でも）に返す。
 *           ev.source が無い・postMessage を持たないときは自分の窓に返す。始める前は返さない（ページ側が答える）
 *   status: 橋の {kind:'status', state:'listening'|'stopped'|'error', text} を読む（state が 3 つ以外・text が文字列でなければ null）。
 *           聞いている間に届いたものは札の後ろに「。」でつなぐ（listening はその文、stopped は「橋は止めた（文）」、error は
 *           「橋は誤りで止まった（文）」）。error は知らせ「橋が止まった: 文」も 1 回（同じ文が続いても 1 回）。聞いていないときは捨てる。
 *           status() に bridge: {state, text}（無ければ null）が乗る。枠の聞いている状態は変えない（emit.stopped を呼ばない）
 *   状態:   status() の state が stopped → listening → stopped と動き、received・messages・dropped が数える。札（emit.status）に件数が出る
 *   守り:   data が無い・例外を投げる source・addEventListener の無い窓、でも投げない
 */
'use strict';
const path = require('path');
const KIT = path.resolve(__dirname, '..');
const INTAKE = require(path.join(KIT, 'src', 'intake.js'));

const results = [];
function t(group, name, ok, detail) { results.push({ group: group, name: name, ok: !!ok, detail: detail || '' }); }
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// 偽の窓。message の聞き手を持ち、post(data, source) で届ける
function fakeWin() {
  const listeners = [];
  const posted = [];
  const w = {
    addEventListener: function (k, f) { if (k === 'message') listeners.push(f); },
    removeEventListener: function (k, f) { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); },
    postMessage: function (body) { posted.push(body); },
    post: function (data, source) { listeners.slice().forEach(function (f) { f({ data: data, source: source === undefined ? w : source, origin: 'null' }); }); },
    listeners: listeners, posted: posted
  };
  return w;
}
function fakeEmit() {
  const e = { lines: [], statuses: [], notices: [] };
  e.line = function (l) { e.lines.push(l); };
  e.status = function (s) { e.statuses.push(s); };
  e.notice = function (ls) { e.notices.push(ls); };
  e.interim = function () {};
  e.event = function () {};
  e.stoppedCalls = 0;
  e.stopped = function () { e.stoppedCalls++; };
  return e;
}
function msg(lines) { return { source: 'kiku-bridge', v: 2, kind: 'lines', lines: lines }; }

// ---- 読み ----
(function () {
  const G = '読み';
  const B = INTAKE.bridgeMessage;
  t(G, '橋の言葉でないもの（source が違う）は null', B({ source: 'other', v: 2, kind: 'lines', lines: ['a'] }) === null);
  t(G, '版が違えば null', B({ source: 'kiku-bridge', v: 1, kind: 'lines', lines: ['a'] }) === null);
  t(G, 'data が無い・文字列・配列は null', B(null) === null && B(undefined) === null && B('x') === null && B([]) === null);
  t(G, 'kind が知らないものは null', B({ source: 'kiku-bridge', v: 2, kind: 'bye' }) === null);
  t(G, 'lines が配列でなければ null', B({ source: 'kiku-bridge', v: 2, kind: 'lines', lines: 'a' }) === null);
  t(G, 'hello は {kind:hello}', deepEq(B({ source: 'kiku-bridge', v: 2, kind: 'hello' }), { kind: 'hello' }));
  const r = B(msg(['司会: 始めます', '0:05\t乙\tはい', { who: ' 丙 ', text: ' 了解 ' }, 5, null, { text: '' }, { who: '丁' }]));
  t(G, '文字列は打つ入口と同じ読み方（名前: 本文）', r.lines[0].who === '司会' && r.lines[0].text === '始めます', JSON.stringify(r.lines[0]));
  t(G, '1 列目の時刻は落とし、「話者<TAB>本文」に読む（timecol が立つ）', r.lines[1].who === '乙' && r.lines[1].text === 'はい' && r.timecol === true, JSON.stringify(r.lines[1]));
  t(G, '{who, text} は前後の空白を除いてそのまま', r.lines[2].who === '丙' && r.lines[2].text === '了解', JSON.stringify(r.lines[2]));
  t(G, '数・null・text の空・text の無い物は落として数える（4 件）', r.lines.length === 3 && r.dropped === 4, 'lines=' + r.lines.length + ' dropped=' + r.dropped);
  const r2 = B(msg(['甲: 一つ目\n\n乙: 二つ目\n   ']));
  t(G, '改行を含む文字列は行に分け、空の行は落とす（落とした数には入れない）', r2.lines.length === 2 && r2.lines[1].who === '乙' && r2.dropped === 0, JSON.stringify(r2));
  const r3 = B(msg(['15:00までに出す', 'https://example.test/x']));
  t(G, '時刻・URL で始まる行は話者にしない（打つ入口と同じ）', r3.lines[0].who === null && r3.lines[0].text === '15:00までに出す' && r3.lines[1].who === null, JSON.stringify(r3.lines));
  const r4 = B(msg([{ who: 'A', text: 'x', t: 999 }]));
  t(G, '送り手の時刻の欄（t）は読まない', r4.lines[0].t === undefined && Object.keys(r4.lines[0]).join(',') === 'who,text', JSON.stringify(r4.lines[0]));
  t(G, 'timecol は 1 列目が時刻らしい行が無ければ false', r2.timecol === false && r3.timecol === false);
  t(G, '空の lines は受理して 0 件', deepEq(B(msg([])), { kind: 'lines', lines: [], dropped: 0, timecol: false }));
  t(G, '印が出ている', INTAKE.BRIDGE_SOURCE === 'kiku-bridge' && INTAKE.BRIDGE_REPLY_SOURCE === 'kiku' && INTAKE.BRIDGE_VERSION === 2);
  function S(state, text) { return { source: 'kiku-bridge', v: 2, kind: 'status', state: state, text: text }; }
  t(G, 'status（listening）は {kind:status, state, text}', deepEq(B(S('listening', '橋が聞き始めた（画面全体。この PC の中で文字にする）')), { kind: 'status', state: 'listening', text: '橋が聞き始めた（画面全体。この PC の中で文字にする）' }));
  t(G, 'status（stopped・error）も読む', deepEq(B(S('stopped', '止めた')), { kind: 'status', state: 'stopped', text: '止めた' }) && deepEq(B(S('error', '共有が止められた')), { kind: 'status', state: 'error', text: '共有が止められた' }));
  t(G, 'status の text は空の文字列でもよい', deepEq(B(S('listening', '')), { kind: 'status', state: 'listening', text: '' }));
  t(G, 'status の state が 3 つ以外なら null', B(S('paused', 'x')) === null && B(S('', 'x')) === null && B(S(undefined, 'x')) === null && B(S(1, 'x')) === null && B(S('toString', 'x')) === null);
  t(G, 'status の text が文字列でなければ null', B(S('listening', 5)) === null && B(S('listening', null)) === null && B(S('error')) === null && B(S('error', ['x'])) === null);
  t(G, 'status に余計な欄があっても state と text だけを返す', deepEq(B({ source: 'kiku-bridge', v: 2, kind: 'status', state: 'stopped', text: 't', extra: 1 }), { kind: 'status', state: 'stopped', text: 't' }));
})();

// ---- status（橋の状態の知らせ） ----
(function () {
  const G = 'status';
  function S(state, text) { return { source: 'kiku-bridge', v: 2, kind: 'status', state: state, text: text }; }
  function last(e) { return e.statuses[e.statuses.length - 1]; }
  const w = fakeWin(); const e = fakeEmit();
  const it = INTAKE.makeBridgeIntake(e, function () { return 0; }, { win: w });
  w.post(S('error', '始める前の誤り'));
  t(G, '聞いていない（始める前）に届いた status は捨てる（札も知らせも出ず、status().bridge は null）', e.statuses.length === 0 && e.notices.length === 0 && it.status().bridge === null);
  it.start();
  const base = last(e);
  t(G, 'start 直後の札は今までどおり「橋から受けている（届いた発話 0 件）」', base === '橋から受けている（届いた発話 0 件）', base);
  const LISTEN = '橋が聞き始めた（画面全体。この PC の中で文字にする）';
  w.post(S('listening', LISTEN));
  t(G, 'listening の status で、札の後ろにその文が「。」で続く（共有した画面の名前が見える）', last(e) === '橋から受けている（届いた発話 0 件）。' + LISTEN, last(e));
  t(G, 'status() に bridge: {state, text} が乗る', deepEq(it.status().bridge, { state: 'listening', text: LISTEN }), JSON.stringify(it.status().bridge));
  t(G, 'status は受けた発話・message の数に入らない', it.status().received === 0 && it.status().messages === 0 && it.status().dropped === 0);
  t(G, 'listening では知らせを出さない', e.notices.length === 0);
  w.post(msg(['甲: 一つ目', 5]));
  t(G, '発話が届いた後の札にも、橋の状態の文が残る', last(e) === '橋から受けている（届いた発話 1 件。形の違いで落としたもの 1 件）。' + LISTEN, last(e));
  w.post(S('error', '画面共有が止められた'));
  t(G, 'error の status で、札の後ろが「橋は誤りで止まった（文）」になる', last(e) === '橋から受けている（届いた発話 1 件。形の違いで落としたもの 1 件）。橋は誤りで止まった（画面共有が止められた）', last(e));
  t(G, 'error で知らせ「橋が止まった: 文」が 1 回出る', e.notices.length === 1 && deepEq(e.notices[0], ['橋が止まった: 画面共有が止められた']), JSON.stringify(e.notices));
  t(G, 'error でも枠の聞いている状態は変わらない（state は listening のまま。emit.stopped は呼ばない）', it.status().state === 'listening' && e.stoppedCalls === 0, JSON.stringify(it.status()));
  w.post(S('error', '画面共有が止められた'));
  t(G, '同じ text の error が続いても知らせは 1 回（札は出し直す）', e.notices.length === 1 && last(e) === '橋から受けている（届いた発話 1 件。形の違いで落としたもの 1 件）。橋は誤りで止まった（画面共有が止められた）', JSON.stringify(e.notices));
  w.post(S('error', '音声認識が使えない'));
  t(G, '違う text の error は、また知らせる', e.notices.length === 2 && deepEq(e.notices[1], ['橋が止まった: 音声認識が使えない']), JSON.stringify(e.notices));
  w.post(S('listening', '橋が聞き始めた（画面全体。音声は提供元のサーバーへ送られる）'));
  w.post(S('error', '音声認識が使えない'));
  t(G, '間に listening が届けば、同じ text の error をまた知らせる（続きの誤り）', e.notices.length === 3, JSON.stringify(e.notices));
  w.post(S('stopped', '利用者が止めた'));
  t(G, 'stopped の status で、札の後ろが「橋は止めた（文）」になり、知らせは出ない', last(e) === '橋から受けている（届いた発話 1 件。形の違いで落としたもの 1 件）。橋は止めた（利用者が止めた）' && e.notices.length === 3, last(e));
  t(G, 'status().bridge は最後に届いたもの', deepEq(it.status().bridge, { state: 'stopped', text: '利用者が止めた' }));
  w.post(S('listening', ''));
  t(G, 'text が空の listening は「橋が聞き始めた」とだけ出す（「。」で終わらない）', last(e) === '橋から受けている（届いた発話 1 件。形の違いで落としたもの 1 件）。橋が聞き始めた', last(e));
  w.post(S('stopped', ' '));
  t(G, 'text が空白だけの stopped は「橋は止めた」とだけ出す（空のかっこを付けない）', /。橋は止めた$/.test(last(e)), last(e));
  w.post(S('error', ''));
  t(G, 'text が空の error は「橋は誤りで止まった」とだけ出し、知らせは「橋が止まった: 」', /。橋は誤りで止まった$/.test(last(e)) && e.notices.length === 4 && e.notices[3][0] === '橋が止まった: ', last(e) + ' / ' + JSON.stringify(e.notices[3]));
  t(G, 'status の後の札も、こちらが足す部分は日本語だけ（英字の項目名が無い。橋の text はそのまま載せる）', e.statuses.every(function (x) { return !/[A-Za-z]/.test(x.split('（画面全体。この PC の中で文字にする）').join('')); }), e.statuses.join(' | '));
  t(G, 'status() の bridge は写し（書き換えても中は変わらない）', (function () { const b = it.status().bridge; b.text = 'x'; return it.status().bridge.text === ''; })());
  w.post({ source: 'kiku-bridge', v: 2, kind: 'status', state: 'paused', text: 'x' });
  t(G, '形の違う status（state が 3 つ以外）は捨てる（bridge は変わらず、dropped にも数えない）', it.status().bridge.state === 'error' && it.status().dropped === 1);
  it.stop();
  t(G, 'stop の札は今までどおり「止めた（橋）」', last(e) === '止めた（橋）');
  w.post(S('listening', '止めた後'));
  t(G, '止めた後に届いた status は捨てる', e.statuses[e.statuses.length - 1] === '止めた（橋）' && it.status().bridge.text === '');
  it.start();
  t(G, 'start し直すと橋の状態は忘れる（bridge は null、札は件数だけ）', it.status().bridge === null && last(e) === '橋から受けている（届いた発話 1 件。形の違いで落としたもの 1 件）', last(e));
  w.post(S('error', '音声認識が使えない'));
  t(G, 'start し直した後の error はまた知らせる', e.notices.length === 5);
  it.stop();
  // hello の扱いは前のまま: status を受けた後も、hello の返事の形は変わらない
  const w2 = fakeWin(); const e2 = fakeEmit();
  const it2 = INTAKE.makeBridgeIntake(e2, function () { return 0; }, { win: w2 });
  it2.start();
  w2.post(S('listening', 'x'));
  const src = { posted: [], postMessage: function (b) { this.posted.push(b); } };
  w2.post({ source: 'kiku-bridge', v: 2, kind: 'hello' }, src);
  t(G, 'status を受けた後も hello の返事は {source:kiku, v:2, kind:hello, listening, received} のまま（bridge は乗らない）', src.posted.length === 1 && deepEq(src.posted[0], { source: 'kiku', v: 2, kind: 'hello', listening: true, received: 0 }), JSON.stringify(src.posted));
  it2.stop();
  // emit.notice の無い受け取り側: error の知らせは札に出る
  const w3 = fakeWin(); const e3 = fakeEmit(); delete e3.notice;
  const it3 = INTAKE.makeBridgeIntake(e3, function () { return 0; }, { win: w3 });
  it3.start();
  w3.post(S('error', '壊れた'));
  t(G, 'emit.notice が無ければ、error の知らせは札に出る', e3.statuses.some(function (s) { return s === '橋が止まった: 壊れた'; }), e3.statuses.join(' | '));
  it3.stop();
})();

// ---- 受け ----
(function () {
  const G = '受け';
  const w = fakeWin(); const e = fakeEmit();
  let now = 10;
  const it = INTAKE.makeBridgeIntake(e, function () { return now; }, { win: w });
  t(G, 'kind は bridge', it.kind === 'bridge');
  w.post(msg(['甲: 始める前']));
  t(G, '始める前に届いたものは受けない（溜めない）', e.lines.length === 0 && it.status().received === 0);
  t(G, 'start は true を返し、聞き手を 1 つ付ける', it.start() === true && w.listeners.length === 1);
  w.post(msg(['甲: 一つ目', { who: '乙', text: '二つ目' }]));
  t(G, '受けた発話が打つ入口と同じ形 {who, text, t} で届く', e.lines.length === 2 && deepEq(e.lines[0], { who: '甲', text: '一つ目', t: 10 }) && deepEq(e.lines[1], { who: '乙', text: '二つ目', t: 10 }), JSON.stringify(e.lines));
  now = 12.9;
  w.post(msg(['三つ目']));
  t(G, 't は届いた時計の整数の秒（切り捨て）', e.lines[2].t === 12 && e.lines[2].who === null, JSON.stringify(e.lines[2]));
  now = 11;
  w.post(msg(['四つ目']));
  t(G, '時計が戻っても t は戻らない（単調）', e.lines[3].t === 12, JSON.stringify(e.lines[3]));
  it.setFloor(50); now = 20;
  w.post(msg(['五つ目']));
  t(G, 'setFloor の下限より前の時刻は下限に揃う', e.lines[4].t === 50, JSON.stringify(e.lines[4]));
  t(G, '二度 start しても聞き手は 1 つのまま', it.start() === true && w.listeners.length === 1);
  it.stop();
  t(G, 'stop で聞き手が外れる', w.listeners.length === 0);
  w.post(msg(['止めた後']));
  t(G, '止めた後に届いたものは受けない', e.lines.length === 5);
  t(G, 'もう一度 start すると、また受ける', it.start() && (w.post(msg(['再開後'])), e.lines.length === 6) && e.lines[5].text === '再開後');
  it.stop();
})();

// ---- hello ----
(function () {
  const G = 'hello';
  const w = fakeWin(); const e = fakeEmit();
  const it = INTAKE.makeBridgeIntake(e, function () { return 0; }, { win: w });
  // 始める前は聞き手が無いので返事は無い（ページ側が別に答える）
  w.post({ source: 'kiku-bridge', v: 2, kind: 'hello' });
  t(G, '始める前（聞き手が無い）は何も返さない', w.posted.length === 0);
  it.start();
  const src = { posted: [], postMessage: function (b) { this.posted.push(b); } };
  w.post({ source: 'kiku-bridge', v: 2, kind: 'hello' }, src);
  t(G, 'hello に、送り手（ev.source）へ {source:kiku, v:2, kind:hello, listening:true, received:0} を返す', src.posted.length === 1 && deepEq(src.posted[0], { source: 'kiku', v: 2, kind: 'hello', listening: true, received: 0 }), JSON.stringify(src.posted));
  w.post(msg(['甲: a', '乙: b']));
  w.post({ source: 'kiku-bridge', v: 2, kind: 'hello' }, src);
  t(G, '受けた数が hello の返事に乗る', src.posted[1].received === 2, JSON.stringify(src.posted[1]));
  // 送り手が親ページ（自分の窓と違う窓）のとき。返事は ev.source にだけ届き、自分の窓には届かない（自分の窓に送ると親には届かない）
  const parent = fakeWin();
  w.post({ source: 'kiku-bridge', v: 2, kind: 'hello' }, parent);
  t(G, 'ev.source が自分の窓と違う窓なら、返事はそちらにだけ届く', parent.posted.length === 1 && deepEq(parent.posted[0], { source: 'kiku', v: 2, kind: 'hello', listening: true, received: 2 }) && w.posted.length === 0, JSON.stringify(parent.posted) + ' / 自分の窓 ' + w.posted.length);
  w.post({ source: 'kiku-bridge', v: 2, kind: 'hello' }, null);
  t(G, 'source が無ければ窓に返す', w.posted.length === 1 && w.posted[0].kind === 'hello', JSON.stringify(w.posted));
  w.post({ source: 'kiku-bridge', v: 2, kind: 'hello' }, { nothing: true });
  t(G, 'ev.source に postMessage が無ければ自分の窓に返す', w.posted.length === 2 && w.posted[1].kind === 'hello' && parent.posted.length === 1, JSON.stringify(w.posted));
  const bad = { postMessage: function () { throw new Error('返せない'); } };
  let threw = false;
  try { w.post({ source: 'kiku-bridge', v: 2, kind: 'hello' }, bad); } catch (x) { threw = true; }
  t(G, '返事で投げられても投げ返さない', !threw);
  t(G, 'hello は受けた数に入らない', it.status().received === 2 && it.status().messages === 1);
  it.stop();
})();

// ---- 状態 ----
(function () {
  const G = '状態';
  const w = fakeWin(); const e = fakeEmit();
  const it = INTAKE.makeBridgeIntake(e, function () { return 0; }, { win: w });
  t(G, '作った直後は stopped・0 件', deepEq(it.status(), { state: 'stopped', received: 0, messages: 0, dropped: 0, error: null, bridge: null }), JSON.stringify(it.status()));
  it.start();
  t(G, 'start で listening、札に「届いた発話 0 件」', it.status().state === 'listening' && /届いた発話 0 件/.test(e.statuses[e.statuses.length - 1]), e.statuses.join(' | '));
  w.post(msg(['甲: a', 5, { who: 'b', text: 'c' }]));
  const s = it.status();
  t(G, 'received・messages・dropped が数える', s.received === 2 && s.messages === 1 && s.dropped === 1, JSON.stringify(s));
  t(G, '札に件数と落とした数が出る', /届いた発話 2 件/.test(e.statuses[e.statuses.length - 1]) && /落としたもの 1 件/.test(e.statuses[e.statuses.length - 1]), e.statuses[e.statuses.length - 1]);
  t(G, '札は日本語だけ（英字の項目名が無い）', e.statuses.every(function (x) { return !/[A-Za-z]/.test(x); }), e.statuses.join(' | '));
  w.post(msg(['0:01\t甲\t時刻つき']));
  t(G, '1 列目の時刻を落とした行が初めて来たら、知らせを 1 回だけ出す（noticed().timecol）', e.notices.length === 1 && e.notices[0][0] === INTAKE.TIMECOL_TEXT && it.noticed().timecol === true, JSON.stringify(e.notices));
  w.post(msg(['0:02\t甲\tもう一度']));
  t(G, '二度目は知らせない', e.notices.length === 1);
  it.stop();
  t(G, 'stop で stopped、札は「止めた（橋）」', it.status().state === 'stopped' && e.statuses[e.statuses.length - 1] === '止めた（橋）');
  t(G, 'status() は写し（書き換えても中は変わらない）', (function () { const x = it.status(); const was = x.received; x.received = 99; return it.status().received === was && was === 4; })());
})();

// ---- 守り ----
(function () {
  const G = '守り';
  const w = fakeWin(); const e = fakeEmit();
  const it = INTAKE.makeBridgeIntake(e, function () { return 0; }, { win: w });
  it.start();
  let threw = false;
  try {
    w.listeners[0]({});
    w.listeners[0]({ data: null });
    w.listeners[0]({ data: { source: 'kiku-bridge', v: 2, kind: 'lines', lines: [{ get text() { throw new Error('壊れた'); } }] } });
  } catch (x) { threw = true; }
  t(G, 'data が無い・null・読むと投げる要素、でも投げない', !threw && e.lines.length === 0 && it.status().received === 0);
  const w2 = { postMessage: function () {} };
  const e2 = fakeEmit();
  const it2 = INTAKE.makeBridgeIntake(e2, function () { return 0; }, { win: w2 });
  t(G, 'addEventListener の無い窓では start が false で state は error', it2.start() === false && it2.status().state === 'error' && typeof it2.status().error === 'string', JSON.stringify(it2.status()));
  t(G, 'その札も日本語', /橋を開けない/.test(e2.statuses[0]) && !/[A-Za-z]/.test(e2.statuses[0]), e2.statuses[0]);
  let threw2 = false;
  try { it2.stop(); } catch (x) { threw2 = true; }
  t(G, 'removeEventListener の無い窓でも stop は投げない', !threw2 && it2.status().state === 'stopped');
  t(G, 'flush は何もしない', (it.flush(), true));
  // emit.notice の無い受け取り側: 知らせは札に出る
  const w3 = fakeWin(); const e3 = fakeEmit(); delete e3.notice;
  const it3 = INTAKE.makeBridgeIntake(e3, function () { return 0; }, { win: w3 });
  it3.start();
  w3.post(msg(['0:01\t甲\tx']));
  t(G, 'emit.notice が無ければ、1 列目の時刻の知らせは札に出る', e3.statuses.some(function (s) { return s === INTAKE.TIMECOL_TEXT; }), e3.statuses.join(' | '));
  it.stop(); it3.stop();
})();

// ---- つなぎ（makeBridgeLink: 枠の側から拡張を探し、指図を送る） ----
(function () {
  const G = 'つなぎ';
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
  // 枠の窓（自分）と親の窓。親は届いたものを記録する。top は親と同じ
  const parent = { got: [], postMessage: function (b, o) { this.got.push({ body: JSON.parse(JSON.stringify(b)), origin: o }); } };
  const self = fakeWin();
  self.parent = parent; self.top = parent;
  const changes = [];
  const L = INTAKE.makeBridgeLink({ win: self, setTimeout: setT, clearTimeout: clearT, now: function () { return now; }, onChange: function (st) { changes.push(st); } });
  t(G, '始める前は「まだ分からない」', deepEq(L.state(), { present: null, where: null, capturing: false, ver: null }), JSON.stringify(L.state()));
  L.start();
  t(G, '始めるとすぐ親に ping を 1 回（宛先は *、中身は印と種類だけ）', parent.got.length === 1 && deepEq(parent.got[0], { body: { source: 'kiku', v: 2, kind: 'ping' }, origin: '*' }), JSON.stringify(parent.got));
  advance(INTAKE.LINK_FIRST_WAIT_MS - 1);
  t(G, '待つ間は「まだ分からない」のまま', L.state().present === null);
  advance(1);
  t(G, '返事が無いまま待ちを過ぎると「居ない」になり、知らせが 1 回', L.state().present === false && changes.length === 1 && changes[0].present === false, JSON.stringify(changes));
  t(G, '居なくても ping は続ける（後から入れた拡張に気づくため）', parent.got.filter(function (m) { return m.body.kind === 'ping'; }).length === 2, String(parent.got.length));
  self.post({ source: 'kiku-bridge', v: 2, kind: 'here', where: 'available', capturing: false }, parent);
  t(G, 'here が届くと「居る」になり、where を覚える', deepEq(L.state(), { present: true, where: 'available', capturing: false, ver: null }) && changes.length === 2, JSON.stringify(L.state()));
  self.post({ source: 'kiku-bridge', v: 2, kind: 'here', where: 'available', capturing: false }, parent);
  t(G, '同じ here では知らせない', changes.length === 2, String(changes.length));
  self.post({ source: 'kiku-bridge', v: 2, kind: 'here', where: 'bogus', capturing: 'yes' }, parent);
  t(G, '知らない where は none、capturing は true のときだけ真', deepEq(L.state(), { present: true, where: 'none', capturing: false, ver: null }), JSON.stringify(L.state()));
  const c0 = changes.length;
  self.post({ source: 'kiku-bridge', v: 2, kind: 'here', where: 'none', capturing: false, ver: '0.2.0' }, parent);
  t(G, 'here の ver（拡張の版）を覚え、版が変わったら知らせる', L.state().ver === '0.2.0' && changes.length === c0 + 1, JSON.stringify(L.state()));
  self.post({ source: 'kiku-bridge', v: 2, kind: 'here', where: 'none', capturing: false, ver: '0.2.0; drop table' }, parent);
  t(G, '版の形でない ver は null（画面に出す前に弾く）', L.state().ver === null, JSON.stringify(L.state()));
  self.post({ source: 'kiku-bridge', v: 2, kind: 'here', where: 'none', capturing: false, ver: 2 }, parent);
  t(G, '文字でない ver も null', L.state().ver === null);
  self.post({ source: 'other', v: 2, kind: 'here', where: 'available' }, parent);
  self.post({ source: 'kiku-bridge', v: 1, kind: 'here', where: 'available' }, parent);
  self.post({ source: 'kiku-bridge', v: 2, kind: 'lines', lines: ['x'] }, parent);
  t(G, '印・版・種類が違う知らせでは変わらない', L.state().where === 'none', JSON.stringify(L.state()));
  const before = parent.got.length;
  t(G, 'capture(true) は start を local:true で送り、送れた宛先の数（1）を返す', L.capture(true) === 1 && deepEq(parent.got[before].body, { source: 'kiku', v: 2, kind: 'start', local: true }), JSON.stringify(parent.got[before]));
  L.capture(false); L.capture('yes');
  t(G, 'capture(false) と真偽でない値は local:false', parent.got[before + 1].body.local === false && parent.got[before + 2].body.local === false);
  t(G, 'release は stop、install は install', L.release() === 1 && L.install() === 1 && parent.got[before + 3].body.kind === 'stop' && parent.got[before + 4].body.kind === 'install');
  advance(INTAKE.LINK_LOST_MS + INTAKE.LINK_PING_MS);
  t(G, 'here が途切れると「居なくなった」になり、取り込みの途中の印も下ろす', L.state().present === false && L.state().capturing === false, JSON.stringify(L.state()));
  L.stop();
  const n = parent.got.length;
  advance(10000);
  t(G, '止めた後は ping を送らず、here も受けない', parent.got.length === n && (self.post({ source: 'kiku-bridge', v: 2, kind: 'here', where: 'available' }, parent), L.state().present === false), String(parent.got.length - n));
  // 枠の外で開いたページ（parent も top も自分）: 宛先が無い
  const lone = fakeWin(); lone.parent = lone; lone.top = lone;
  const L2 = INTAKE.makeBridgeLink({ win: lone, setTimeout: setT, clearTimeout: clearT, now: function () { return now; } });
  L2.start();
  t(G, '枠の外で開いたページでは送る先が無く、capture は 0 を返す', L2.capture(true) === 0 && lone.posted.length === 0);
  advance(INTAKE.LINK_FIRST_WAIT_MS);
  t(G, 'そのページでは「居ない」になる', L2.state().present === false);
  L2.stop();
  // parent と top が違う（入れ子の枠）: 両方に送る
  const p2 = { got: [], postMessage: function (b) { this.got.push(b); } }, t2 = { got: [], postMessage: function (b) { this.got.push(b); } };
  const nest = fakeWin(); nest.parent = p2; nest.top = t2;
  const L3 = INTAKE.makeBridgeLink({ win: nest, setTimeout: setT, clearTimeout: clearT, now: function () { return now; } });
  t(G, '入れ子の枠では parent と top の両方に送る', L3.capture(true) === 2 && p2.got.length === 1 && t2.got.length === 1);
  // 例外を投げる受け手でも止まらない
  const w4 = fakeWin(); w4.parent = parent; w4.top = parent;
  const L4 = INTAKE.makeBridgeLink({ win: w4, setTimeout: setT, clearTimeout: clearT, now: function () { return now; }, onChange: function () { throw new Error('x'); } });
  L4.start();
  let threw = false;
  try { w4.post({ source: 'kiku-bridge', v: 2, kind: 'here', where: 'available' }, parent); } catch (e) { threw = true; }
  t(G, '知らせの受け手が投げても、つなぎは投げずに状態を変える', !threw && L4.state().present === true);
  L4.stop();
  // 音の診断（拡張 0.2.1）: probe を送り、probe の知らせを読んで onProbe に渡す
  const w5 = fakeWin(); const p5 = { got: [], postMessage: function (b, o) { this.got.push({ body: JSON.parse(JSON.stringify(b)), origin: o }); } };
  w5.parent = p5; w5.top = p5;
  const notes = [];
  const L5 = INTAKE.makeBridgeLink({ win: w5, setTimeout: setT, clearTimeout: clearT, now: function () { return now; }, onProbe: function (n) { notes.push(n); } });
  L5.start();
  t(G, 'probe() は kind:probe を送り、送れた宛先の数を返す', L5.probe() === 1 && deepEq(p5.got[p5.got.length - 1].body, { source: 'kiku', v: 2, kind: 'probe' }), JSON.stringify(p5.got));
  w5.post({ source: 'kiku-bridge', v: 2, kind: 'probe', state: 'running', text: '測っている' }, p5);
  w5.post({ source: 'kiku-bridge', v: 2, kind: 'probe', state: 'done', text: '終わった', summary: ['a', 3, 'b'], report: { phases: [1, 2] } }, p5);
  t(G, 'probe の知らせを読んで渡す（summary は文字列だけ、report は写し）', notes.length === 2 && deepEq(notes[0], { state: 'running', text: '測っている', summary: [], report: null }) && deepEq(notes[1], { state: 'done', text: '終わった', summary: ['a', 'b'], report: { phases: [1, 2] } }), JSON.stringify(notes));
  w5.post({ source: 'kiku-bridge', v: 2, kind: 'probe', state: 'odd', text: 'x' }, p5);
  w5.post({ source: 'kiku-bridge', v: 2, kind: 'probe', state: 'done', text: 5 }, p5);
  w5.post({ source: 'kiku-bridge', v: 1, kind: 'probe', state: 'done', text: 'x' }, p5);
  t(G, '形の違う probe の知らせ（知らない state・文字でない text・違う版）は渡さない', notes.length === 2, JSON.stringify(notes.slice(2)));
  w5.post({ source: 'kiku-bridge', v: 2, kind: 'probe', state: 'done', text: 'x', report: { big: 'x'.repeat(INTAKE.PROBE_REPORT_MAX) } }, p5);
  t(G, '大きすぎる report は null にして、文は渡す', notes.length === 3 && notes[2].report === null && notes[2].text === 'x');
  t(G, 'probe の知らせでは居る・居ないの状態を変えない（here だけが変える）', L5.state().present === null, JSON.stringify(L5.state()));
  L5.stop();
})();

// ---- 貼った書き起こし（timedFromPlain: 時刻の無い文章を素材にする） ----
(function () {
  const G = '貼り付け';
  const P = INTAKE.timedFromPlain;
  function read(text) { const r = INTAKE.makeMaterialReader(text); const out = []; let u; while ((u = r.next())) out.push(u); return out; }
  const timed = '0:00\t甲\t始めます\n0:05\t乙\t次です';
  t(G, '時刻の付いた素材はそのまま（見積もらない）', deepEq(P(timed), { text: timed, estimated: false }));
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nこんにちは';
  t(G, '字幕は 1 つの発話でもそのまま', P(vtt).estimated === false);
  const mixed = '今日は会議です。\n甲: 値上げの件です。はい。\n9:00 から始めます';
  const r = P(mixed);
  t(G, '時刻らしい行が 1 つだけ混じった文章は、時刻の無い文章として読む', r.estimated === true, JSON.stringify(r));
  const us = read(r.text);
  t(G, '行ごとに 1 発話。短い切れ端（はい。）は前の文につなぎ、行の頭の「名前: 」は話者', deepEq(us.map(function (u) { return [u.who, u.text]; }), [[null, '今日は会議です。'], ['甲', '値上げの件です。はい。'], [null, '9:00 から始めます']]), JSON.stringify(us));
  t(G, '時刻はその発話より前の文字数から（1 分あたり ' + INTAKE.PLAIN_CHARS_PER_MIN + ' 字）', deepEq(us.map(function (u) { return u.t; }), [0, 1, 3]), JSON.stringify(us.map(function (u) { return u.t; })));
  const long = 'あ'.repeat(300);
  const lr = read(P(long).text);
  t(G, '句点の無い長い行は 120 字で切る', lr.length === 3 && lr.every(function (u) { return Array.from(u.text).length <= 120; }), JSON.stringify(lr.map(function (u) { return u.text.length; })));
  const comma = 'い'.repeat(100) + '、' + 'う'.repeat(100);
  const cr = read(P(comma).text);
  t(G, '切るときは読点のところで切る', cr.length === 2 && /、$/.test(cr[0].text), JSON.stringify(cr.map(function (u) { return u.text.length; })));
  const sentences = '一つ目の文です。二つ目の文です！三つ目の文ですか？';
  t(G, '1 行の中の文は「。！？」で分ける', read(P(sentences).text).length === 3);
  t(G, '空の文字・空白だけは発話なし（見積もらない）', deepEq(P(''), { text: '', estimated: false }) && P('  \n　\n').estimated === false);
  t(G, 'タブを含む行は空白にしてから読む（表の 1 列目を時刻と読まない）', read(P('甲\tこんにちは\nあいさつです').text).length === 2);
  // 先を見ない: ある発話の時刻は、その後ろに何を足しても変わらない
  const a = read(P('最初の文です。\n次の文です。').text), b = read(P('最初の文です。\n次の文です。\nもっと後ろの文がたくさん続きます。').text);
  t(G, 'ある発話の時刻は、後ろに何を足しても変わらない（先の文字は見ない）', deepEq(a.map(function (u) { return u.t; }), b.slice(0, 2).map(function (u) { return u.t; })));
  t(G, 'looksTimed: 表は真、文章は偽', INTAKE.looksTimed(timed) === true && INTAKE.looksTimed(mixed) === false);
})();

// ---- 版（versionLess: 拡張の版が枠の持つ版より古いか） ----
(function () {
  const G = '版';
  const V = INTAKE.versionLess;
  t(G, '0.1.0 は 0.2.0 より古い', V('0.1.0', '0.2.0') === true);
  t(G, '同じ版は古くない', V('0.2.0', '0.2.0') === false);
  t(G, '新しい版は古くない', V('0.3.0', '0.2.0') === false);
  t(G, '文字ではなく数で比べる（0.10.0 は 0.9.9 より新しい）', V('0.10.0', '0.9.9') === false && V('0.9.9', '0.10.0') === true);
  t(G, '桁の数が違っても足りない所は 0（0.2 と 0.2.0 は同じ、0.2 は 0.2.1 より古い）', V('0.2', '0.2.0') === false && V('0.2', '0.2.1') === true);
  t(G, '読めない版は「古い」と言わない', V(null, '0.2.0') === false && V('x', '0.2.0') === false && V('0.2.0', undefined) === false && V('1.2.3.4.5', '9') === false);
})();

report();

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
