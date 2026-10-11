#!/usr/bin/env node
/*
 * run_bridge_ext_node.js — 橋の送り手（bridge/chrome/bridge.js の純粋な部分）の試験（node。本物の document・画面共有・音声認識は使わない）
 *
 *   node tests/run_bridge_ext_node.js
 *
 * 確かめること:
 *   読み込み: document の無い所でも読め、純粋な部分だけを出す（画面の側は動かさない）
 *   枠の選び方: src の hostname が ".claudeusercontent.com" で終わる iframe だけを選ぶ。無ければ空（about:blank・別のホスト・空の src・
 *             字面に claudeusercontent.com を含むだけの URL は選ばない）。document が無ければ空。宛先の origin は src から作る
 *   送り方: 選んだ枠の contentWindow に、targetOrigin を src の origin にして送り、送れた数を返す。contentWindow の無い枠・投げる枠は飛ばす。
 *           枠が無ければ 0 件で何も送らない
 *   まとめ: 1 秒（偽の時計）で 1 回にまとめて送り、同じ発話を 2 回送らない。空の本文は溜めない
 *   門:     閉じている間は 1 件も送らず溜める（時計も掛けない）。開いた時に溜めた分が 1 回の lines にまとまって出る。以後は 1 秒ごとに戻る。
 *           送る時に枠が 1 つも無ければ（send が 0）、その分を溜めの頭に戻して門を閉じ、送った数に数えない。status は門を通らず、その場で送る
 *   hello:  返事の判定（kiku と kiku-page を受け、版・種類の違いは断る）と、操作部の文。2 秒ごとに繰り返し、keep が false なら止まる
 *   文:     溜めている件数の文（PENDING）・共有中の文（SHARE）
 *   形:     hello・lines・status の送る形
 *   音の診断: probe の指図の受け方・送る形・画面共有の頼み方・段の順・音の大きさの数え方・結果の文（端末で測った値を人が読む文にする）
 *   写し:   bridge/chrome/intake.js は、頭の生成物のコメントの後ろが src/intake.js と 1 文字も違わない（build_bridge.py --check と同じ判定を node で）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const KIT = path.resolve(__dirname, '..');
const B = require(path.join(KIT, 'bridge', 'chrome', 'bridge.js'));

const results = [];
function t(group, name, ok, detail) { results.push({ group: group, name: name, ok: !!ok, detail: detail || '' }); }
function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// 偽の iframe と document。postMessage は本文と targetOrigin を記録する
function frame(src, win) {
  return { src: src, contentWindow: win === undefined ? { posted: [], origins: [], postMessage: function (b, o) { this.posted.push(b); this.origins.push(o); } } : win };
}
function doc(frames) { return { querySelectorAll: function (sel) { return sel === 'iframe' ? frames.slice() : []; } }; }
// 偽の時計。setTimeout を差し替えて、掛かった時計を手で鳴らす
function fakeClock() {
  const timers = [];
  return {
    timers: timers,
    setTimeout: function (f, ms) { timers.push({ f: f, ms: ms }); return timers.length; },
    clearTimeout: function (id) { if (timers[id - 1]) timers[id - 1].f = null; },
    fire: function () { const live = timers.splice(0).filter(function (x) { return x.f; }); live.forEach(function (x) { x.f(); }); return live.length; },
    live: function () { return timers.filter(function (x) { return x.f; }); }
  };
}

(function () {
  const G = '読み込み';
  t(G, 'document の無い所で読めて、純粋な部分が出ている', typeof B.pickFrames === 'function' && typeof B.makeBatcher === 'function' && typeof B.isHelloReply === 'function' && typeof B.frameOrigin === 'function' && typeof B.makeHelloLoop === 'function');
  t(G, '画面の側は動いていない（document を作っていない）', typeof globalThis.document === 'undefined');
  t(G, '印と版は枠の側と同じ', B.SOURCE === 'kiku-bridge' && B.VERSION === 2);
})();

(function () {
  const G = '枠の選び方';
  const a = frame('https://x.claudeusercontent.com/a'), b = frame('https://example.test/b'), c = frame('https://y.frame.claudeusercontent.com/c?q=1#h');
  t(G, 'hostname が .claudeusercontent.com で終わる iframe だけを選ぶ', deepEq(B.pickFrames(doc([a, b, c])), [a, c]));
  t(G, '1 つも無ければ空（「無ければ全部」ではない）', B.pickFrames(doc([b, frame(''), frame('about:blank')])).length === 0);
  t(G, 'document が無い・querySelectorAll が無いときは空', deepEq(B.pickFrames(null), []) && deepEq(B.pickFrames({}), []));
  t(G, 'src が文字列でない枠・about:blank・空の src は選ばない', B.pickFrames(doc([frame(null), frame(undefined), frame('about:blank'), frame('')])).length === 0);
  t(G, '字面に claudeusercontent.com を含むだけの URL は選ばない（別ホストの path・query・前に文字が付く host・裸の host）',
    B.pickFrames(doc([frame('https://evil.test/claudeusercontent.com'), frame('https://evil.test/?u=x.claudeusercontent.com'), frame('https://xclaudeusercontent.com/a'), frame('https://claudeusercontent.com/a'), frame('https://x.claudeusercontent.com.evil.test/a')])).length === 0);
  t(G, '宛先の origin は src の origin（path・query・fragment を落とし、大文字は小さく、既定でない port は残す）',
    B.frameOrigin('https://y.frame.claudeusercontent.com/c?q=1#h') === 'https://y.frame.claudeusercontent.com' &&
    B.frameOrigin('HTTPS://X.ClaudeUserContent.com/a') === 'https://x.claudeusercontent.com' &&
    B.frameOrigin('https://x.claudeusercontent.com:8443/a') === 'https://x.claudeusercontent.com:8443',
    [B.frameOrigin('https://y.frame.claudeusercontent.com/c?q=1#h'), B.frameOrigin('HTTPS://X.ClaudeUserContent.com/a')].join(' '));
  t(G, '作れない origin は null（文字列でない・URL でない・別ホスト・about:blank）', B.frameOrigin(null) === null && B.frameOrigin('') === null && B.frameOrigin('not a url') === null && B.frameOrigin('https://example.test/') === null && B.frameOrigin('about:blank') === null);
})();

(function () {
  const G = '送り方';
  const a = frame('https://x.claudeusercontent.com/a'), dead = frame('https://z.claudeusercontent.com/z', null);
  const bad = frame('https://w.claudeusercontent.com/w', { postMessage: function () { throw new Error('送れない'); } });
  const other = frame('https://example.test/b'), blank = frame('about:blank');
  let threw = false, n = -1;
  try { n = B.postToFrames(doc([a, dead, bad, other, blank]), { k: 1 }); } catch (e) { threw = true; }
  t(G, '選んだ枠に送り、送れた数を返す。contentWindow の無い枠・投げる枠は飛ばし、投げない', !threw && n === 1 && deepEq(a.contentWindow.posted, [{ k: 1 }]), 'n=' + n);
  t(G, 'targetOrigin は src の origin（"*" ではない）', deepEq(a.contentWindow.origins, ['https://x.claudeusercontent.com']), JSON.stringify(a.contentWindow.origins));
  t(G, '別ホストの iframe と about:blank の iframe には送らない', other.contentWindow.posted.length === 0 && blank.contentWindow.posted.length === 0);
  t(G, '送り先が無ければ 0 件で、何も送らない（別ホストだけのときも）', B.postToFrames(doc([]), { k: 1 }) === 0 && B.postToFrames(null, { k: 1 }) === 0 && B.postToFrames(doc([other, blank]), { k: 2 }) === 0 && other.contentWindow.posted.length === 0);
})();

(function () {
  const G = 'まとめ';
  const ck = fakeClock();
  const fake = { intervalMs: 1000, setTimeout: ck.setTimeout, clearTimeout: ck.clearTimeout };
  const timers = ck.timers, fire = ck.fire;
  const sent = [];
  const bt = B.makeBatcher(function (lines) { sent.push(lines); }, fake);
  t(G, '既定で門は開いている', bt.isOpen() === true);
  t(G, 'push は溜めるだけで、まだ送らない。時計を 1 つだけ掛ける', bt.push({ text: '一つ目', t: 1.9 }) && bt.push({ text: ' 二つ目 ', t: 2 }) && sent.length === 0 && timers.length === 1 && timers[0].ms === 1000 && bt.pending() === 2);
  t(G, '時計が鳴ると 1 回でまとめて送る。本文は前後の空白を除き、t は整数の秒', fire() === 1 && sent.length === 1 && deepEq(sent[0], [{ text: '一つ目', t: 1 }, { text: '二つ目', t: 2 }]), JSON.stringify(sent));
  t(G, '送った後に flush しても、同じ発話を 2 回送らない', bt.flush() === 0 && sent.length === 1 && bt.pending() === 0);
  bt.push({ text: '三つ目', t: 3 });
  t(G, 'flush はすぐ送り、掛けた時計を外す', bt.flush() === 1 && sent.length === 2 && deepEq(sent[1], [{ text: '三つ目', t: 3 }]) && fire() === 0);
  t(G, '空の本文・本文の無いものは溜めない', bt.push({ text: '   ' }) === false && bt.push({}) === false && bt.push(null) === false && bt.pending() === 0);
  bt.push({ text: 't が無い' }); bt.flush();
  t(G, 't が数でなければ欄を付けない', deepEq(sent[2], [{ text: 't が無い' }]), JSON.stringify(sent[2]));
  t(G, '数えたものは送った発話と回数に合う', deepEq(bt.count(), { sent: 4, batches: 3 }), JSON.stringify(bt.count()));
  const all = [].concat.apply([], sent).map(function (x) { return x.text; });
  t(G, 'どの発話も 1 度ずつ', all.length === new Set(all).size && all.length === 4, all.join(','));
  const dflt = B.makeBatcher(function () {});
  t(G, '時計を渡さなければ 1 秒の既定で動く（投げない）', dflt.push({ text: 'x' }) && dflt.flush() === 1 && B.BATCH_MS === 1000);
})();

(function () {
  const G = '門';
  const ck = fakeClock();
  const sent = [];
  const bt = B.makeBatcher(function (lines) { sent.push(lines); }, { intervalMs: 1000, setTimeout: ck.setTimeout, clearTimeout: ck.clearTimeout, open: false });
  t(G, 'open:false で閉じて始まる', bt.isOpen() === false);
  bt.push({ text: '冒頭 1', t: 0 }); bt.push({ text: '冒頭 2', t: 3 }); bt.push({ text: '冒頭 3', t: 7 });
  t(G, '閉じている間は溜めるだけで、時計も掛けず、1 件も送らない', sent.length === 0 && ck.live().length === 0 && bt.pending() === 3);
  t(G, '閉じている間の flush も送らず、溜めた分を失わない（止めた後も残る）', bt.flush() === 0 && sent.length === 0 && bt.pending() === 3);
  t(G, 'listening でない返事（open(false) を重ねる）でも何も起きない', bt.open(false) === 0 && sent.length === 0 && bt.pending() === 3);
  t(G, '上限を置かない（1000 件溜めても落とさない）', (function () { for (let i = 0; i < 1000; i++) bt.push({ text: '溜め ' + i, t: 10 + i }); return bt.pending() === 1003; })(), 'pending=' + bt.pending());
  const n = bt.open(true);
  t(G, 'listening:true で開くと、溜めた分が 1 回の lines にまとまって出る（順はそのまま）', n === 1003 && sent.length === 1 && sent[0].length === 1003 && sent[0][0].text === '冒頭 1' && sent[0][2].text === '冒頭 3' && sent[0][1002].text === '溜め 999' && bt.pending() === 0 && bt.isOpen() === true, 'n=' + n + ' sent=' + sent.length);
  bt.push({ text: '続き', t: 2000 });
  t(G, '開いた後は 1 秒ごとのまとめ送りに戻る（時計が掛かり、鳴ると送る）', sent.length === 1 && ck.live().length === 1 && ck.live()[0].ms === 1000 && ck.fire() === 1 && sent.length === 2 && deepEq(sent[1], [{ text: '続き', t: 2000 }]));
  bt.push({ text: '枠が止めた後', t: 2001 });
  t(G, '閉じ直すと、掛けてあった時計は外れ、鳴っても送らない', bt.open(false) === 0 && ck.fire() === 0 && sent.length === 2 && bt.pending() === 1);
  t(G, '閉じている間に時計を掛け直すこともない', (bt.push({ text: 'もう 1 つ', t: 2002 }), ck.live().length === 0 && sent.length === 2));
  t(G, 'もう一度開くと、その分だけがまとまって出る（前に送ったものは入らない）', bt.open(true) === 2 && sent.length === 3 && deepEq(sent[2].map(function (x) { return x.text; }), ['枠が止めた後', 'もう 1 つ']));
  t(G, '数えたものは、門を通して送った発話と回数に合う', deepEq(bt.count(), { sent: 1006, batches: 3 }), JSON.stringify(bt.count()));
  // 開いているときの open(true) の重ね押し（周期の hello の返事）は流さない。まとめ送りは 1 秒の時計に任せる
  const ck2 = fakeClock();
  const sent2 = [];
  const bt2 = B.makeBatcher(function (lines) { sent2.push(lines); }, { intervalMs: 1000, setTimeout: ck2.setTimeout, clearTimeout: ck2.clearTimeout });
  bt2.push({ text: '聞いている間の発話', t: 5 });
  t(G, 'すでに開いているときの open(true) は何もしない（0 を返し、時計はそのまま、送らない）', bt2.open(true) === 0 && sent2.length === 0 && ck2.live().length === 1 && bt2.pending() === 1 && bt2.isOpen() === true);
  t(G, 'その時計が鳴ったときに 1 回で送る（重ね押しで 2 回にならない）', ck2.fire() === 1 && sent2.length === 1 && deepEq(sent2[0], [{ text: '聞いている間の発話', t: 5 }]) && bt2.pending() === 0);
  // 開いている間に枠が消えた: send が 0 を返したら、その発話を溜めの頭に戻して門を閉じ、送った数に数えない
  const ck3 = fakeClock();
  const got3 = [];
  let reach = 1;
  const bt3 = B.makeBatcher(function (lines) { if (reach) got3.push(lines); return reach; }, { intervalMs: 1000, setTimeout: ck3.setTimeout, clearTimeout: ck3.clearTimeout });
  bt3.push({ text: '届く', t: 1 }); ck3.fire();
  reach = 0;
  bt3.push({ text: '枠が消えた後 1', t: 2 }); bt3.push({ text: '枠が消えた後 2', t: 3 });
  t(G, '送る時に枠が無い（send が 0）と、その 2 件は溜めに戻り、門が閉じ、送った数に入らない', ck3.fire() === 1 && got3.length === 1 && bt3.pending() === 2 && bt3.isOpen() === false && deepEq(bt3.count(), { sent: 1, batches: 1 }), JSON.stringify({ pending: bt3.pending(), open: bt3.isOpen(), count: bt3.count() }));
  bt3.push({ text: '閉じた後', t: 4 });
  t(G, '閉じた後に来た発話は時計を掛けずに後ろへ溜まる', ck3.live().length === 0 && bt3.pending() === 3);
  t(G, '閉じている間の flush（止めたとき）も送らず、溜めを失わない', bt3.flush() === 0 && bt3.pending() === 3 && got3.length === 1);
  reach = 1;
  t(G, '枠が戻って開くと、戻した 2 件が先、後の 1 件が後ろの順で 1 回に流れる', bt3.open(true) === 3 && got3.length === 2 && deepEq(got3[1].map(function (x) { return x.text; }), ['枠が消えた後 1', '枠が消えた後 2', '閉じた後']) && deepEq(bt3.count(), { sent: 4, batches: 2 }), JSON.stringify(got3[1]));
  reach = 0;
  bt3.push({ text: '開いた直後にまた消えた', t: 5 });
  t(G, '開いた途端の flush が届かなくても同じ（戻して閉じる。0 を返す）', bt3.isOpen() === true && bt3.flush() === 0 && bt3.isOpen() === false && bt3.pending() === 1);
  const bt4 = B.makeBatcher(function () { return undefined; }, { intervalMs: 1000, setTimeout: ck3.setTimeout, clearTimeout: ck3.clearTimeout });
  t(G, 'send が数を返さない（undefined）ときは届いたものとして数える（前と同じ）', bt4.push({ text: 'u' }) && bt4.flush() === 1 && bt4.pending() === 0 && bt4.isOpen() === true);
  // take: 退く送り手が溜めた分を次の送り手へ渡すときに使う。送らずに取り出して空にし、掛けてあった時計も外す
  const ck5 = fakeClock();
  const sent5 = [];
  const bt5 = B.makeBatcher(function (lines) { sent5.push(lines); }, { intervalMs: 1000, setTimeout: ck5.setTimeout, clearTimeout: ck5.clearTimeout });
  bt5.push({ text: '渡す 1', t: 1 }); bt5.push({ text: '渡す 2', t: 2 });
  const taken = bt5.take();
  t(G, 'take は溜めた分を古い順に取り出して空にし、送らず、時計も外す（鳴っても何も出ない）', deepEq(taken, [{ text: '渡す 1', t: 1 }, { text: '渡す 2', t: 2 }]) && bt5.pending() === 0 && ck5.live().length === 0 && ck5.fire() === 0 && sent5.length === 0, JSON.stringify(taken));
  t(G, '取り出した分は送った数に入らない', deepEq(bt5.count(), { sent: 0, batches: 0 }));
  // status は門を通らない: postToFrames でその場で送る（枠が居なければ 0）
  const a = frame('https://x.claudeusercontent.com/a');
  const m = B.postToFrames(doc([a]), B.statusMessage('listening', '橋が聞き始めた（画面全体。この PC の中で文字にする）'));
  t(G, 'status は溜めず、その場で枠に届く', m === 1 && a.contentWindow.posted.length === 1 && a.contentWindow.posted[0].kind === 'status' && a.contentWindow.posted[0].state === 'listening');
  t(G, 'status は枠が居なければ送らない（0 件。投げない）', B.postToFrames(doc([frame('about:blank')]), B.statusMessage('error', 'x')) === 0);
})();

(function () {
  const G = 'hello';
  t(G, 'kiku と kiku-page の返事を受ける', B.isHelloReply({ source: 'kiku', v: 2, kind: 'hello', listening: true }) && B.isHelloReply({ source: 'kiku-page', v: 2, kind: 'hello' }));
  t(G, '印・版・種類が違えば断る。data が無くても投げない', !B.isHelloReply({ source: 'kiku-bridge', v: 2, kind: 'hello' }) && !B.isHelloReply({ source: 'kiku', v: 1, kind: 'hello' }) && !B.isHelloReply({ source: 'kiku', v: 2, kind: 'lines' }) && !B.isHelloReply(null) && !B.isHelloReply('x'));
  t(G, '見つからないときの文は「開いてから押す」', B.helloText(false) === '枠が見つからない（kiku のアーティファクトを開いてから押す）');
  t(G, '見つかったときは、枠が聞いているかで文が変わる', /橋から受けている/.test(B.helloText(true, true)) && /「聞き取りを開始」/.test(B.helloText(true, false)));
  t(G, '文字にする場所の文は 6 つの状態にあり、知らない語は none の文', ['checking', 'available', 'downloadable', 'downloading', 'unavailable', 'none'].every(function (w) { return B.whereText(w).length > 0; }) && B.whereText('?') === B.whereText('none') && /外へ出ない/.test(B.whereText('available')));
  // 2 秒ごとの hello
  const ck = fakeClock();
  let keepOn = true, sends = 0;
  const h = B.makeHelloLoop(function () { sends++; }, function () { return keepOn; }, { setTimeout: ck.setTimeout, clearTimeout: ck.clearTimeout });
  t(G, 'HELLO_PERIOD_MS は 2000', B.HELLO_PERIOD_MS === 2000);
  t(G, 'start ですぐ 1 回送り、2 秒の時計を 1 つ掛ける', (h.start(), sends === 1 && ck.live().length === 1 && ck.live()[0].ms === 2000 && h.running()), 'sends=' + sends);
  t(G, '鳴るたびに 1 回送り、次の 2 秒を掛ける（3 回鳴らすと合わせて 4 回）', ck.fire() === 1 && ck.fire() === 1 && ck.fire() === 1 && sends === 4 && ck.live().length === 1 && ck.live()[0].ms === 2000 && h.count() === 4, 'sends=' + sends);
  keepOn = false;
  t(G, 'keep が false になると、次に鳴ったとき送らずに止まる（時計も掛けない）', ck.fire() === 1 && sends === 4 && ck.live().length === 0 && !h.running());
  keepOn = true;
  t(G, 'start し直すと、またすぐ 1 回送って続く。重ねて start しても時計は 1 つ', (h.start(), h.start(), sends === 6 && ck.live().length === 1));
  t(G, 'stop で止まる（鳴るものが無い）', (h.stop(), !h.running() && ck.fire() === 0 && sends === 6));
  const d = B.makeHelloLoop(function () {}, null);
  t(G, '時計を渡さなければ 2 秒の既定で動く（投げない）。keep が無ければ続ける', (d.start(), d.running() && (d.stop(), !d.running())));
})();

(function () {
  const G = '文';
  t(G, 'PENDING の文の形（N 件）', B.pendingText(3) === '枠がまだ聞いていない。発話を溜めている（3 件。枠で「聞き取りを開始」を押すと流れる）' && B.pendingText(1003) === '枠がまだ聞いていない。発話を溜めている（1003 件。枠で「聞き取りを開始」を押すと流れる）', B.pendingText(3));
  t(G, 'PENDING は 0 件・数でないときは空', B.pendingText(0) === '' && B.pendingText(-1) === '' && B.pendingText(NaN) === '' && B.pendingText(undefined) === '');
  t(G, 'SHARE の文は「共有中: <名前>」。名前が空なら「共有中」だけ', B.shareText('画面全体') === '共有中: 画面全体' && B.shareText('screen:0:0') === '共有中: screen:0:0' && B.shareText('') === '共有中' && B.shareText(null) === '共有中' && B.shareText('  ') === '共有中');
  t(G, 'ボタンの文は変えていない', B.START_TEXT === '橋: 画面共有の音を枠へ' && B.CONSENT_TEXT === '承知して始める（音を提供元（Google）のサーバーへ送る）');
})();

(function () {
  const G = '形';
  t(G, 'hello', deepEq(B.helloMessage(), { source: 'kiku-bridge', v: 2, kind: 'hello' }));
  t(G, 'lines', deepEq(B.linesMessage([{ text: 'a', t: 1 }]), { source: 'kiku-bridge', v: 2, kind: 'lines', lines: [{ text: 'a', t: 1 }] }));
  t(G, 'status は 3 つの状態だけ。知らない語は error。text は文字列', deepEq(B.statusMessage('listening', '聞いている'), { source: 'kiku-bridge', v: 2, kind: 'status', state: 'listening', text: '聞いている' }) && B.statusMessage('bogus').state === 'error' && B.statusMessage('stopped', null).text === '');
  t(G, 'here は ver（拡張の版）を文字のときだけ載せる', deepEq(B.hereMessage('available', true, '0.2.0'), { source: 'kiku-bridge', v: 2, kind: 'here', where: 'available', capturing: true, ver: '0.2.0' }) && !('ver' in B.hereMessage('none', false, null)) && !('ver' in B.hereMessage('none', false, '')) && !('ver' in B.hereMessage('none', false, 2)));
  t(G, 'lines の形は枠の側（intake.js の bridgeMessage）が読める', (function () {
    const I = require(path.join(KIT, 'src', 'intake.js'));
    const m = I.bridgeMessage(B.linesMessage([{ text: '甲: a', t: 1 }, { text: 'b', t: 2 }]));
    return m && m.kind === 'lines' && m.lines.length === 2 && m.dropped === 0 && m.lines[0].text === '甲: a' && m.lines[0].who === null;
  })());
})();

(function () {
  const G = '写し';
  // build_bridge.py の HEAD と同じ 1 行。変えるなら両方
  const HEAD = '/* kit/bridge/chrome/intake.js: 生成物。build_bridge.py が kit/src/intake.js から写す。手で直さず、kit/src/intake.js を直してから build_bridge.py を走らせる */\n';
  let src = null, copy = null, err = '';
  try { src = fs.readFileSync(path.join(KIT, 'src', 'intake.js'), 'utf8'); copy = fs.readFileSync(path.join(KIT, 'bridge', 'chrome', 'intake.js'), 'utf8'); } catch (e) { err = String(e && e.message); }
  const headOk = copy !== null && copy.slice(0, HEAD.length) === HEAD;
  const bodyOk = headOk && src !== null && copy.slice(HEAD.length) === src;
  let where = '';
  if (headOk && !bodyOk && src !== null) {
    const body = copy.slice(HEAD.length);
    let i = 0; while (i < body.length && i < src.length && body[i] === src[i]) i++;
    where = ' 最初の違いは ' + i + ' 文字目（写し ' + body.length + ' 文字、元 ' + src.length + ' 文字）';
  }
  t(G, 'bridge/chrome/intake.js は、頭の生成物のコメントの後ろが src/intake.js と 1 文字も違わない（build_bridge.py で作り直す）', bodyOk, err || (!headOk ? '頭の 1 行が build_bridge.py の HEAD と違う: ' + JSON.stringify(copy === null ? null : copy.slice(0, 80)) : where));
})();

// ---- 音の診断（0.2.1）: 指図の受け方・送る形・結果の文 ----
(function () {
  const G = '音の診断';
  const ev = function (d, origin) { return { data: d, origin: origin === undefined ? 'https://abc.claudeusercontent.com' : origin, source: null }; };
  t(G, '枠からの probe の指図を受ける（印・版・origin は他の指図と同じに見る）', (B.frameCommand(ev({ source: 'kiku', v: 2, kind: 'probe' })) || {}).kind === 'probe');
  t(G, '版の違う probe・別の origin からの probe は断る', B.frameCommand(ev({ source: 'kiku', v: 1, kind: 'probe' })) === null && B.frameCommand(ev({ source: 'kiku', v: 2, kind: 'probe' }, 'https://evil.example')) === null);
  const m = B.probeMessage('running', '文', { summary: ['a'] });
  t(G, '送る形: {source:kiku-bridge, v:2, kind:probe, state, text, …}', m.source === 'kiku-bridge' && m.v === 2 && m.kind === 'probe' && m.state === 'running' && m.text === '文' && deepEq(m.summary, ['a']));
  t(G, '知らない state は done にする', B.probeMessage('x', '').state === 'done');
  t(G, '画面全体を勧め、システム音声を求め、自分のタブは出さない', B.PROBE_ASK.video.displaySurface === 'monitor' && B.PROBE_ASK.systemAudio === 'include' && B.PROBE_ASK.selfBrowserSurface === 'exclude' && B.PROBE_ASK.audio.echoCancellation === false);
  t(G, '段は 3 つ（端末内そのまま・端末内 16kHz・サーバー）の順', B.PROBE_PHASES.map(function (p) { return p.key + ':' + p.local + ':' + p.via; }).join(' ') === 'local_raw:true:raw local_16k:true:16k cloud_raw:false:raw');
  const lv = B.newLevel();
  B.addLevel(lv, -20); B.addLevel(lv, -60); B.addLevel(lv, -Infinity); B.addLevel(lv, NaN);
  t(G, '音の大きさ: 数でないものは -120 として数え、敷居（-50）より大きい所だけを「音があった」に数える', lv.n === 4 && lv.max === -20 && lv.loud === 1, JSON.stringify(lv));
  // 結果の文
  const ok = { hasAudio: true, surface: 'monitor', ctx: { state0: 'running' }, level: { max: -12.3, loud: 150, n: 200 }, phases: [
    { key: 'local_raw', finals: 0, interims: 0, texts: [], attempts: [{ ev: ['start@3', 'error:aborted@40', 'end@41'] }, { ev: ['error:aborted(x)@5'] }, { ev: ['error:network@9', 'no-end@1509'] }] },
    { key: 'local_16k', finals: 4, interims: 9, texts: ['こんにちは'], attempts: [{ ev: [] }] },
    { key: 'cloud_raw', finals: 0, interims: 0, texts: [], attempts: [{ ev: ['start@1', 'end@12000'] }] }
  ] };
  const sm = B.probeSummary(ok);
  t(G, '結果の文: 選んだ画面・音・3 つの段の 5 行', deepEq(sm, [
    '選んだ画面: 画面全体',
    '音: 届いた（いちばん大きい所 -12 dB・音があったのは測った時間の 75%）',
    'PC の中で（音をそのまま）: 文字にならなかった（誤り: 止められた（aborted）×2・通信が切れた（network））',
    'PC の中で（16kHz・1ch に直して）: 文字になった（確定 4 件・途中 9 回。例「こんにちは」）',
    'Google のサーバーで: 文字にならなかった（誤りは出ず、何も返ってこなかった）'
  ]), JSON.stringify(sm));
  t(G, '音のトラックが無い: 「システム音声も共有」がオフだったと言い、音の行は出さない', deepEq(B.probeSummary({ hasAudio: false, surface: 'browser', phases: [] }), ['選んだ画面: タブ。音が共有されていない（「システム音声も共有」がオフだった）']));
  t(G, '画面共有を断られた: その理由だけ', deepEq(B.probeSummary({ error: 'NotAllowedError: Permission denied', phases: [] }), ['画面共有を始められなかった（NotAllowedError: Permission denied）']));
  t(G, 'ずっと無音: 「届いていない」', /^音: 届いていない（ずっと無音/.test(B.probeSummary({ hasAudio: true, surface: 'monitor', ctx: { state0: 'running' }, level: { max: -120, loud: 0, n: 50 }, phases: [] })[1]));
  t(G, '音を測る所が動いていなかった（suspended）で無音: 「測れなかった」と言い、無音とは言わない', /^音: 測れなかった（音を測る所が「suspended」/.test(B.probeSummary({ hasAudio: true, surface: 'monitor', ctx: { state0: 'suspended' }, level: { max: -120, loud: 0, n: 50 }, phases: [] })[1]));
  t(G, '止めた: 測らなかった段と「途中で止めた（画面共有が止められた）」', deepEq(B.probeSummary({ hasAudio: true, surface: 'window', ctx: { state0: 'running' }, level: { max: -9, loud: 5, n: 5 }, stopped: true, trackEnded: 4000, phases: [{ key: 'cloud_raw', skipped: '止めた' }] }).slice(2), ['Google のサーバーで: 測らなかった（止めた）', '途中で止めた（画面共有が止められた）']));
  t(G, '結果が無い・形が違う: 「結果が無い」', deepEq(B.probeSummary(null), ['結果が無い']));
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
