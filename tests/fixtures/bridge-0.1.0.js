/*
 * 試験用の写し: 拡張「橋」0.1.0 の bridge.js（退く知らせに応えない、いちばん古い版）。頭のこの注（4 行）を除けば、0.1.0 の bridge.js と 1 バイトも違わない。
 * run_bridge_ui_node.js の「退く」が、タブに残った 0.1.0 の操作部を新しい版が取り除くかを確かめるために読む。直さないこと。
 */
/*
 * bridge.js — kiku 橋の送り手（Chrome 拡張の content script）。claude.ai の親ページ（top frame）で動く。
 *
 * 何をするか:
 *   枠（claude.ai のアーティファクトの iframe）の中の kiku は、枠の中では画面共有の音もマイクも取れない。
 *   この拡張は親ページで画面共有の音（Windows は「画面全体」＋「システム音声も共有」＝PC で鳴っている Teams・Zoom の音。
 *   会議がブラウザのタブなら、そのタブ＋「タブの音声も共有」。macOS／Linux は「画面全体」では音が取れない——MDN の互換データ）を取り
 *   （intake.js の captureDisplayAudio）、ブラウザの音声認識（intake.js の makeSpeechIntake。lang は intake.js の既定 ja-JP）で
 *   文字にして、枠の iframe へ window.postMessage で流す。枠の側の受け口は intake.js の makeBridgeIntake。
 *
 * 送るもの（どれも {source:'kiku-bridge', v:1, …}。宛先の origin は iframe の src から作る（new URL(src).origin）。作れない iframe には送らない）:
 *   {kind:'hello'}                        始めるときに 1 回と、その後 2 秒ごと（HELLO_PERIOD_MS）。聞いている間、または溜めた発話がある間は
 *                                         続ける（止めた後も、溜めた分が残っていれば続ける）。枠が居れば
 *                                         {source:'kiku', v:1, kind:'hello', listening, received} が返る（'kiku-page' の印も受ける）。
 *                                         返事は window の message で受け、listening が true のときだけ発話を流す（下の lines）
 *   {kind:'lines', lines:[{text, t}]}     確定した発話。t は聞き始めからの経過秒（整数）。1 発話を 2 回送らない（枠の側は t を使わず、届いた時刻を押す）。
 *                                         枠が聞いている（最後の hello の返事の listening が true）あいだは 1 秒ごとにまとめて送る。
 *                                         聞いていないあいだは送らずに溜める（上限は置かない。操作部に件数を出す）。枠が聞き始めた返事を
 *                                         受けた時に、溜めた分を 1 回の lines で流し、以後は 1 秒ごとのまとめ送りに戻る。
 *                                         送る時に枠が 1 つも無ければ（開いている間に枠が消えた）、その分は溜めに戻して同じように待つ
 *   {kind:'status', state, text}          始めた（listening）・止めた（stopped）・誤りで止まった（error）。溜めずにその場で送る（枠が居なければ送らない）。
 *                                         枠が聞いていない間に送った status は枠が捨てるので、枠が聞き始めた返事（listening が false→true）を受けた時に、
 *                                         最後の status を 1 回だけ送り直す（溜めた lines の前に）
 *
 * 送る先: ページの iframe のうち、src の hostname が ".claudeusercontent.com" で終わるものだけ。1 つも無ければ送らない（送るたびに探し直す）
 *
 * 外へ出るもの: この拡張は通信しない。この PC の中で文字にできない（intake.js の speechLocal が 'available' でない）ときだけ、
 *   音声認識が音を提供元（Google）のサーバーへ送る。そのときは操作部にそう出し、承知のボタンを押したときだけ始める
 *   （kiku 本体と同じ方針。端末内で始めた後に失敗しても、サーバーへは切り替えない——intake.js）。
 *   端末内かどうかは、押したボタンで決まる（begin(local)）: 「橋」のボタンは端末内で（where が 'available' のときだけ押せる。
 *   調べている途中は押せない）、承知のボタンはサーバーへ送る形で始める。画面共有の後に調べた結果を読み直さない
 *   （調べ直しは Promise で、画面共有は操作の直後にしか始められないため）。立てて始めた後に失敗しても外へは送らない
 *
 * 確かめたこと: 操作部・hello・発話の到達・止めるは Chromium 141 に拡張を読み込んで確かめた（tests/e2e/e2e_bridge_ext.js）。
 *   content script からの getDisplayMedia は permissions policy には止められない（断られた理由は取り込み口が無いことだった）。
 *   本物の画面共有に音のトラックが乗るか、本物の認識が start(track) を受けるかは未実測
 *
 * 純粋な部分（枠の選び方・宛先の origin・発話のまとめと溜め・hello の周期と判定・送る形・札の文）は globalThis.KIKU_BRIDGE（node では module.exports）に出し、
 * tests/run_bridge_ext_node.js が偽の document・iframe・postMessage・時計で試験する。document の無い所では画面の側を動かさない
 */
(function () {
  'use strict';
  const SOURCE = 'kiku-bridge';
  const REPLY_SOURCES = ['kiku', 'kiku-page'];
  const VERSION = 1;
  const FRAME_HOST_SUFFIX = '.claudeusercontent.com';
  const BATCH_MS = 1000;        // 確定した発話をまとめて送る間隔
  const HELLO_PERIOD_MS = 2000; // hello を繰り返す間隔
  const HELLO_WAIT_MS = 1500;   // hello の返事を待つ長さ
  const STOP_WAIT_MS = 3000;    // 止めるとき、認識の終わりの知らせを待つ上限（kiku 本体と同じ）
  const STATES = ['listening', 'stopped', 'error'];
  const COMMANDS = ['ping', 'start', 'stop', 'install'];   // 枠から届く指図（intake.js の makeBridgeLink が送る）
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // ---- 純粋な部分 ----
  // iframe の src から宛先の origin を作る。hostname が ".claudeusercontent.com" で終わるときだけ origin の文字列、それ以外は null
  // （src が文字列でない・URL にならない・別のホストは null）
  function frameOrigin(src) {
    if (typeof src !== 'string' || !src) return null;
    let u;
    try { u = new URL(src); } catch (e) { return null; }
    const h = String(u.hostname || '').toLowerCase();
    if (h.length <= FRAME_HOST_SUFFIX.length || h.slice(-FRAME_HOST_SUFFIX.length) !== FRAME_HOST_SUFFIX) return null;
    return u.origin && u.origin !== 'null' ? u.origin : null;
  }
  // ページの iframe のうち、宛先の origin が作れるもの（src の hostname が ".claudeusercontent.com" で終わる）だけ。無ければ空
  function pickFrames(doc) {
    if (!doc || typeof doc.querySelectorAll !== 'function') return [];
    let all;
    try { all = Array.prototype.slice.call(doc.querySelectorAll('iframe')); } catch (e) { return []; }
    return all.filter(function (f) { return !!(f && frameOrigin(f.src)); });
  }
  // 選んだ iframe の contentWindow に body を送る（targetOrigin は src の origin）。送れた枠の数を返す
  // （contentWindow が無い・postMessage が投げるものは飛ばす。枠が 1 つも無ければ 0 で何も送らない）
  // extra: ほかに送る枠 [{win, origin}]（枠の側から指図をくれた窓。iframe が入れ子でページの直下に無いときにも届くように）。
  // origin が枠のもの（frameOrigin で同じ文字列になる）だけを使い、ページの直下の iframe と同じ窓には 2 度送らない
  function postToFrames(doc, body, extra) {
    let n = 0;
    const done = [];
    pickFrames(doc).forEach(function (f) {
      const w = f.contentWindow;
      const origin = frameOrigin(f.src);
      if (!w || typeof w.postMessage !== 'function' || !origin) return;
      try { w.postMessage(body, origin); n++; done.push(w); } catch (e) { /* 送れない枠は飛ばす */ }
    });
    (Array.isArray(extra) ? extra : []).forEach(function (x) {
      const w = x && x.win;
      if (!w || typeof w.postMessage !== 'function' || done.indexOf(w) >= 0) return;
      if (typeof x.origin !== 'string' || frameOrigin(x.origin) !== x.origin) return;
      try { w.postMessage(body, x.origin); n++; done.push(w); } catch (e) { /* 送れない枠は飛ばす */ }
    });
    return n;
  }
  function helloMessage() { return { source: SOURCE, v: VERSION, kind: 'hello' }; }
  // 居ることの知らせ。where はこの PC の中で文字にできるか（speechLocal の語）、capturing は画面共有の音を取っている途中か
  function hereMessage(where, capturing) { return { source: SOURCE, v: VERSION, kind: 'here', where: String(where == null ? 'none' : where), capturing: capturing === true }; }
  // 枠からの指図か。印（kiku）・版・種類（COMMANDS）と、送り手の origin が枠のもの（https の *.claudeusercontent.com）であること。
  // → {kind, local, origin, win} か null。local は start のときだけ意味を持つ（true のときだけ、この PC の中で文字にする）
  function frameCommand(ev) {
    const d = ev && ev.data;
    if (!d || typeof d !== 'object' || REPLY_SOURCES.indexOf(d.source) < 0 || d.v !== VERSION || COMMANDS.indexOf(d.kind) < 0) return null;
    const origin = ev && typeof ev.origin === 'string' ? ev.origin : '';
    if (!origin || frameOrigin(origin) !== origin || origin.indexOf('https:') !== 0) return null;
    return { kind: d.kind, local: d.local === true, origin: origin, win: ev.source || null };
  }
  function linesMessage(lines) { return { source: SOURCE, v: VERSION, kind: 'lines', lines: lines }; }
  // state は listening・stopped・error のどれか。知らない語は error にする
  function statusMessage(state, text) {
    return { source: SOURCE, v: VERSION, kind: 'status', state: STATES.indexOf(state) >= 0 ? state : 'error', text: String(text == null ? '' : text) };
  }
  // 枠からの hello の返事か
  function isHelloReply(data) {
    return !!(data && typeof data === 'object' && REPLY_SOURCES.indexOf(data.source) >= 0 && data.v === VERSION && data.kind === 'hello');
  }
  // 入口から届いた発話 {text, t} を送る形に。本文が空なら null。t は有限の数のときだけ（整数の秒に切り捨て）
  function lineOf(l) {
    if (!l || typeof l.text !== 'string') return null;
    const text = l.text.replace(/^[\s　]+|[\s　]+$/g, '');
    if (!text) return null;
    const out = { text: text };
    if (typeof l.t === 'number' && isFinite(l.t)) out.t = Math.floor(l.t);
    return out;
  }
  // 発話をまとめて送る。push で溜め、intervalMs たったら 1 回の send(lines) で送る。flush はすぐ送る。同じ発話は 1 度しか送らない。
  // 門（gate）: open(false) で閉じると、溜めるだけで送らない（時計も掛けない。溜めた分は失わない。上限は置かない）。
  // open(true) で開くと、溜めた分をその場で 1 回の send で流し、以後は intervalMs ごとのまとめ送りに戻る。既定は開いている（opts.open が false なら閉じて始める）。
  // send が 0 を返したら（どの枠にも届かなかった。開いている間に枠が消えたとき）、その発話を溜めの頭に戻して門を閉じ、送った数に数えない
  // （次に枠が聞いている返事が来て門が開いたときに、古い順のまま流れる）。0 以外（undefined を含む）は届いたものとして数える。
  // opts.setTimeout／opts.clearTimeout は試験で差し替える
  function makeBatcher(send, opts) {
    opts = opts || {};
    const ms = typeof opts.intervalMs === 'number' && isFinite(opts.intervalMs) && opts.intervalMs >= 0 ? opts.intervalMs : BATCH_MS;
    const setT = opts.setTimeout || globalThis.setTimeout;
    const clearT = opts.clearTimeout || globalThis.clearTimeout;
    let buf = [], timer = null, sent = 0, batches = 0, open = opts.open !== false;
    function flush() {
      if (timer != null) { clearT(timer); timer = null; }
      if (!open || !buf.length) return 0;
      const out = buf; buf = [];
      if (send(out) === 0) { buf = out.concat(buf); open = false; return 0; }
      sent += out.length; batches++;
      return out.length;
    }
    function push(l) {
      const x = lineOf(l);
      if (!x) return false;
      buf.push(x);
      if (open && timer == null) timer = setT(flush, ms);
      return true;
    }
    // 門を開く・閉じる。閉じるときは掛けてあった時計を外す（鳴っても送らない）。開いたときに溜めた分があれば流し、流した数を返す。
  // すでに同じ向きなら何もしない（0 を返す）
    function setOpen(v) {
      if (open === !!v) return 0;   // 同じ向きの重ね押し（周期の hello の返事）では何もしない。開いている間のまとめ送りは 1 秒の時計に任せる
      open = !!v;
      if (!open) { if (timer != null) { clearT(timer); timer = null; } return 0; }
      return buf.length ? flush() : 0;
    }
    return {
      push: push, flush: flush, open: setOpen, isOpen: function () { return open; },
      pending: function () { return buf.length; }, count: function () { return { sent: sent, batches: batches }; }
    };
  }
  // hello を周期で送る。start() ですぐ 1 回 send() し、以後 periodMs ごとに繰り返す。繰り返す前に keep() を見て、false なら止まる
  // （次の start() まで）。stop() で止める。opts.setTimeout／opts.clearTimeout は試験で差し替える
  function makeHelloLoop(send, keep, opts) {
    opts = opts || {};
    const ms = typeof opts.periodMs === 'number' && isFinite(opts.periodMs) && opts.periodMs >= 0 ? opts.periodMs : HELLO_PERIOD_MS;
    const setT = opts.setTimeout || globalThis.setTimeout;
    const clearT = opts.clearTimeout || globalThis.clearTimeout;
    let timer = null, sentN = 0;
    function tick() {
      timer = null;
      if (typeof keep === 'function' && !keep()) return;
      send(); sentN++;
      timer = setT(tick, ms);
    }
    function start() {
      if (timer != null) { clearT(timer); timer = null; }
      send(); sentN++;
      timer = setT(tick, ms);
    }
    function stop() { if (timer != null) { clearT(timer); timer = null; } }
    return { start: start, stop: stop, running: function () { return timer != null; }, count: function () { return sentN; } };
  }
  // 操作部の文
  function helloText(found, listening) {
    if (!found) return '枠が見つからない（kiku のアーティファクトを開いてから押す）';
    return listening ? '枠が見つかった（枠は橋から受けている）' : '枠が見つかった（枠で「聞き取りを開始」を押すと届く）';
  }
  // 溜めている発話の件数の文。0 件なら空
  function pendingText(n) {
    n = typeof n === 'number' && isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return n ? '枠がまだ聞いていない。発話を溜めている（' + n + ' 件。枠で「聞き取りを開始」を押すと流れる）' : '';
  }
  // 共有中の文。label は共有した画面の名前（空なら名前を付けない）
  function shareText(label) {
    const s = String(label == null ? '' : label).replace(/^[\s　]+|[\s　]+$/g, '');
    return s ? '共有中: ' + s : '共有中';
  }
  const WHERE_TEXT = {
    checking: 'この PC の中で文字にできるかを調べている…',
    available: 'この PC の中で文字にする（音声は外へ出ない）',
    downloadable: 'いまは、この PC の中では文字にできない。「日本語の部品を入れる」で入れればできる。入れずに使うなら、音声を提供元（Google）のサーバーへ送ることになる',
    downloading: '日本語の部品を入れている途中。終わったかは「日本語の部品を入れる」でもう一度確かめる。待たずに使うなら、音声を提供元（Google）のサーバーへ送ることになる',
    unavailable: 'このブラウザは、この PC の中だけでは文字にできない。使うなら、音声を提供元（Google）のサーバーへ送ることになる',
    none: 'このブラウザは、この PC の中だけでは文字にできない。使うなら、音声を提供元（Google）のサーバーへ送ることになる'
  };
  function whereText(w) { return hasOwn(WHERE_TEXT, w) ? WHERE_TEXT[w] : WHERE_TEXT.none; }
  const CONSENT_TEXT = '承知して始める（音を提供元（Google）のサーバーへ送る）';
  const ASK_CLOUD_TEXT = 'この PC の中では文字にできない。音を提供元（Google）のサーバーへ送ってよければ、下のボタンで始める';
  const START_TEXT = '橋: 画面共有の音を枠へ';
  const FROM_FRAME_FAILED_TEXT = '枠のボタンからは画面共有を始められなかった（このブラウザでは、枠の中のクリックがこのページに伝わらない）。この欄の「' + START_TEXT + '」を押して始める';
  const LOCAL_NOT_READY_TEXT = 'この PC の中では、まだ文字にできない（日本語の部品が入っていない）。始めなかった';

  const api = {
    frameOrigin: frameOrigin, pickFrames: pickFrames, postToFrames: postToFrames, helloMessage: helloMessage, linesMessage: linesMessage, statusMessage: statusMessage,
    hereMessage: hereMessage, frameCommand: frameCommand, COMMANDS: COMMANDS,
    isHelloReply: isHelloReply, lineOf: lineOf, makeBatcher: makeBatcher, makeHelloLoop: makeHelloLoop,
    helloText: helloText, pendingText: pendingText, shareText: shareText, whereText: whereText,
    SOURCE: SOURCE, VERSION: VERSION, FRAME_HOST_SUFFIX: FRAME_HOST_SUFFIX, BATCH_MS: BATCH_MS, HELLO_PERIOD_MS: HELLO_PERIOD_MS, HELLO_WAIT_MS: HELLO_WAIT_MS,
    CONSENT_TEXT: CONSENT_TEXT, START_TEXT: START_TEXT, FROM_FRAME_FAILED_TEXT: FROM_FRAME_FAILED_TEXT, LOCAL_NOT_READY_TEXT: LOCAL_NOT_READY_TEXT
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.KIKU_BRIDGE = api;

  // ---- ここから画面の側（document のある所だけ。親ページだけで動く——manifest の all_frames: false） ----
  if (typeof document === 'undefined' || typeof window === 'undefined' || !document.body) return;
  if (document.getElementById('kiku-bridge-host')) return;   // 2 度読まれても操作部は 1 つ
  const INTAKE = globalThis.TSV_INTAKE || null;
  // where: 'checking'・'available'・'downloadable'・'downloading'・'unavailable'・'none'（intake.js の speechLocal）
  // speech: 動いている認識の入口。stream: 画面共有（持ち主はこの拡張なので、止めるときにトラックを止める）。share: 共有中の画面の名前（null は共有していない）
  // starting: 画面共有を選んでいる途中（押してから取れるまで）。found: hello の返事（null は待っている・true・false）。
  // helloSeq／replySeq: 何回目の hello か・何回目までに返事が来たか（周期の hello で文を消さないため）。askCloud: 外へ送る承知を求めている
  // lastStatus: 枠へ最後に送った status の本文（枠が聞き始めた返事を受けた時に 1 回送り直す。null は未送。始めるたびに null に戻す——
  //   前の回の「止めた」を、新しい回の画面共有を選んでいる間に送り直さないため）。送り直しが重なって同じ status が 2 度届くことはあるが、
  //   枠は同じ状態を置き直すだけで、誤りの知らせも同じ文では 1 回しか出さない
  // kiku: 最後に指図をくれた枠 {win, origin}（null はまだ無い）。panelOpen: 操作部を開いておく（誤り・枠のボタンから始められなかったとき）
  const S = { where: 'checking', speech: null, stream: null, share: null, starting: false, began: 0, found: null, foundListening: false, helloSeq: 0, replySeq: 0, askCloud: false, status: '', interim: '', lastStatus: null,
    kiku: null, panelOpen: false };

  // 操作部（shadow DOM の中に置き、claude.ai の見た目に触らない・触られない）
  const host = document.createElement('div');
  host.id = 'kiku-bridge-host';
  // ふだんは出さない（claude.ai のどのページにも入るので）。出すのは、聞いている間・画面共有を選んでいる間・溜めた発話がある間・
  // 誤りや枠のボタンから始められなかったとき（panelOpen）・外へ送る承知を求めている間だけ
  host.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483646;display:none;';
  const root = typeof host.attachShadow === 'function' ? host.attachShadow({ mode: 'open' }) : host;
  const style = document.createElement('style');
  style.textContent = '.box{max-width:340px;padding:8px 10px;background:#fff;color:#111;border:1px solid #999;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.25);font:12px/1.5 sans-serif}' +
    '.box b{font-size:12px}.box button{font:12px sans-serif;margin:2px 4px 2px 0;padding:2px 8px}.box .l{margin-top:2px;word-break:break-all}.box .i{color:#666}';
  root.appendChild(style);
  const box = document.createElement('div');
  box.className = 'box';
  function mk(tag, cls, text) { const x = document.createElement(tag); if (cls) x.className = cls; if (text) x.textContent = text; box.appendChild(x); return x; }
  mk('b', '', '橋（画面共有の音を枠へ）');
  // div の並び（where・hello・status・interim）は e2e の読み手が順で読むので、新しい行は後ろに足す
  const el = {
    where: mk('div', 'l i'),
    install: mk('button', '', '日本語の部品を入れる'),
    start: mk('button', '', START_TEXT),
    consent: mk('button', '', CONSENT_TEXT),
    stop: mk('button', '', '止める'),
    hello: mk('div', 'l'),
    status: mk('div', 'l'),
    interim: mk('div', 'l i'),
    share: mk('div', 'l'),
    pending: mk('div', 'l')
  };
  const closeBtn = mk('button', '', '閉じる');   // 誤りの知らせを読んだ後に操作部をしまう（並びの後ろに足す）
  root.appendChild(box);
  document.body.appendChild(host);

  function show(x, on) { x.style.display = on ? '' : 'none'; }
  function render() {
    const visible = !!(S.speech || S.starting || S.panelOpen || S.askCloud || batcher.pending() > 0);
    host.style.display = visible ? '' : 'none';
    show(closeBtn, !S.speech && !S.starting);
    el.where.textContent = whereText(S.where);
    show(el.install, S.where === 'downloadable' || S.where === 'downloading');
    el.hello.textContent = S.found === null ? '' : helloText(S.found, S.foundListening);
    el.status.textContent = S.status;
    el.interim.textContent = S.interim ? '（途中）' + S.interim.slice(-40) : '';
    el.share.textContent = S.share === null ? '' : shareText(S.share);
    el.pending.textContent = batcher.isOpen() ? '' : pendingText(batcher.pending());
    show(el.start, !S.speech && !S.askCloud);
    el.start.disabled = S.where === 'checking';
    show(el.consent, !S.speech && S.askCloud);
    el.stop.disabled = !S.speech;
  }
  function setStatus(text) { S.status = String(text == null ? '' : text); render(); }
  function clock() { return (Date.now() - S.began) / 1000; }

  // この PC の中で文字にできるか（起動時と、部品を入れた後）
  function checkWhere() {
    if (!INTAKE || typeof INTAKE.speechLocal !== 'function') { S.where = 'none'; render(); return; }
    S.where = 'checking'; render();
    INTAKE.speechLocal().then(function (w) {
      S.where = w;
      // 外へ送る承知を求めている間に、この PC の中で文字にできるようになった（部品を入れ終えた）: 問いを下ろして「橋」のボタンに戻す
      // （承知のボタンだけが残ると、入れた部品を使えずに音が外へ出る形でしか始められない）
      if (w === 'available' && S.askCloud && !S.speech && !S.starting) { S.askCloud = false; if (S.status === ASK_CLOUD_TEXT) S.status = ''; }
      render(); sendHere();
    }, function () { S.where = 'unavailable'; render(); sendHere(); });
  }
  // 日本語の部品を入れる（操作部のボタンと、枠からの install の指図）。入れ終えたら調べ直して、枠に here で知らせる
  function installPack() {
    if (!INTAKE || typeof INTAKE.speechInstall !== 'function') { sendHere(); return; }
    S.where = 'downloading'; render(); sendHere();
    INTAKE.speechInstall().then(function () { checkWhere(); }, function () { checkWhere(); });
  }
  el.install.addEventListener('click', installPack);
  closeBtn.addEventListener('click', function () { S.panelOpen = false; S.askCloud = false; render(); });

  // 枠に here を送る。to（{win, origin}）があればその窓だけに、無ければ見つかる枠すべてと、指図をくれた枠に
  function sendHere(to) {
    // capturing は音を取っている間だけ真（画面を選んでいる途中は偽。枠は真になってから記録を開くので、選ぶ画面で取り消せば何も書かない）
    const body = hereMessage(S.where, !!S.speech);
    if (to && to.win && typeof to.win.postMessage === 'function') { try { to.win.postMessage(body, to.origin); } catch (e) { /* 送れなくても次の ping で */ } return; }
    postToFrames(document, body, kikuFrames());
  }
  function kikuFrames() { return S.kiku ? [S.kiku] : []; }

  // 発話のまとめ。門は閉じて始め、枠の hello の返事（listening）で開け閉めする
  // 送れた枠の数を返す（0 なら batcher が溜めに戻して門を閉じる。操作部の件数を描き直す）
  const batcher = makeBatcher(function (lines) {
    const n = postToFrames(document, linesMessage(lines), kikuFrames());
    if (!n) setTimeout(render, 0);
    return n;
  }, { intervalMs: BATCH_MS, open: false });
  // hello。返事は window の message で受ける（枠の origin は見ない）。返事の listening で門を開け閉めし、開いたときに溜めた分が流れる
  window.addEventListener('message', function (ev) {
    // 枠からの指図（ping・start・stop・install）。start はこの知らせの中で同期に画面共有を呼ぶ（枠のクリックで親に付いた「操作の直後」の扱いのうちに）
    const c = frameCommand(ev);
    if (c) { onCommand(c); return; }
    const d = ev && ev.data;
    if (!isHelloReply(d)) return;
    const wasListening = S.foundListening;
    S.found = true; S.foundListening = d.listening === true; S.replySeq = S.helloSeq;
    // 枠が聞き始めた（false→true）: 枠が聞いていない間に送って捨てられた status を 1 回だけ送り直し、そのあとで溜めた lines を流す
    if (!wasListening && S.foundListening && S.lastStatus) postToFrames(document, S.lastStatus, kikuFrames());
    batcher.open(S.foundListening);
    render();
  });
  function sendHello() {
    const seq = ++S.helloSeq;
    if (seq === 1 || S.found === false) { S.found = null; S.foundListening = false; }
    const n = postToFrames(document, helloMessage(), kikuFrames());
    if (!n) { S.found = false; S.foundListening = false; batcher.open(false); render(); return; }
    setTimeout(function () { if (S.replySeq < seq) { S.found = false; S.foundListening = false; batcher.open(false); render(); } }, HELLO_WAIT_MS);
    render();
  }
  // 2 秒ごとの hello。画面共有を選んでいる間・聞いている間・溜めた発話がある間は続ける
  const hello = makeHelloLoop(sendHello, function () { return S.starting || !!S.speech || batcher.pending() > 0; }, { periodMs: HELLO_PERIOD_MS });

  // 枠へ status を送り、最後の status として覚える（枠が後から聞き始めたときの送り直しのため）
  function sendStatus(state, text) {
    S.lastStatus = statusMessage(state, text);
    return postToFrames(document, S.lastStatus, kikuFrames());
  }
  function stopShare() {
    const s = S.stream; S.stream = null; S.share = null;
    if (!s || typeof s.getTracks !== 'function') return;
    s.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* 止め損ねても、もう使わない */ } });
  }
  // 聞くのを終える（利用者が止めた・誤りで止まった・共有が止められた）。1 回だけ: 残りを送り（枠が聞いていなければ溜めたまま残す）、共有を止め、枠に status を送る
  function endListening(state, text) {
    if (!S.speech) return;
    S.speech = null; S.interim = '';
    batcher.flush();
    stopShare();
    sendStatus(state, text);
    if (state === 'error') S.panelOpen = true;
    setStatus(text);
    sendHere();
  }
  const emit = {
    line: function (l) { batcher.push(l); render(); },
    event: function () { /* 素材ログは枠の側が持つ。こちらは残さない */ },
    interim: function (tx) { S.interim = tx || ''; render(); },
    status: function (text) { setStatus(text); },
    notice: function (lines) { setStatus((lines || []).join(' ')); },
    // 再開しない誤りで止まった。共有を止められた（DISPLAY_TEXT.ended）のは誤りではなく止めたこと
    stopped: function (why) {
      const ended = !!(INTAKE && INTAKE.DISPLAY_TEXT && why === INTAKE.DISPLAY_TEXT.ended);
      endListening(ended ? 'stopped' : 'error', why);
    }
  };

  // 始める。local は押したボタンで決まる（「橋」のボタンは true、承知のボタンは false）。画面共有の後に S.where を読み直さない。
  // 画面共有はクリックの直後にしか始められないので、ここは押した操作の中で同期に呼ぶ
  function begin(local) {
    if (!INTAKE) { setStatus('intake.js が読めていない（拡張の読み込みを確かめる）'); return; }
    if (S.speech || S.starting) return;
    S.askCloud = false; S.starting = true; S.lastStatus = null;
    hello.start();
    setStatus('画面共有を選んでいる…（Windows は「画面全体」＋「システム音声も共有」。会議がブラウザのタブなら、そのタブ＋「タブの音声も共有」）');
    let p;
    try { p = INTAKE.captureDisplayAudio(); } catch (e) { p = Promise.reject(e); }
    p.then(function (got) {
      S.starting = false;
      S.stream = got.stream; S.share = String(got.label || ''); S.began = Date.now();
      const sp = INTAKE.makeSpeechIntake(emit, clock, { local: local === true, track: got.track });
      S.speech = sp;
      if (!sp.start()) { S.speech = null; stopShare(); sendStatus('error', S.status); S.panelOpen = true; render(); sendHere(); return; }
      sendStatus('listening', '橋が聞き始めた（' + (got.label ? got.label + '。' : '') + (local === true ? 'この PC の中で文字にする' : '音声は提供元のサーバーへ送られる') + '）');
      render(); sendHere();
    }, function (e) {
      S.starting = false;
      let text = e && e.message ? String(e.message) : '画面共有を始められない';
      // 枠のボタンから来た start が「操作の直後」の扱いを持っていなかった（このブラウザでは枠のクリックが親に伝わらない）: 操作部を開き、
      // ここのボタンで始めてもらう（ここで押せば、この親のページのクリックになる）
      if (e && e.cause && e.cause.name === 'InvalidStateError') { text = FROM_FRAME_FAILED_TEXT; S.panelOpen = true; }
      sendStatus('error', text);
      setStatus(text);
      sendHere();
    });
  }
  // 枠からの指図。指図をくれた枠を覚える（入れ子の iframe でも、その窓へ直に返せるように）
  function onCommand(c) {
    if (c.win) S.kiku = { win: c.win, origin: c.origin };
    if (c.kind === 'ping') { sendHere(c); return; }
    if (c.kind === 'install') { installPack(); return; }
    if (c.kind === 'stop') { stopListening(); return; }
    // start: すでに始めている・選んでいる途中なら、いまの状態を返すだけ（二重に画面共有を開かない）
    if (S.speech || S.starting) { sendHere(c); if (S.lastStatus) postToFrames(document, S.lastStatus, kikuFrames()); return; }
    // この PC の中で、と言われたのに、調べた結果ができないと言っている: 始めない（黙ってサーバーへ送る形にしない）
    if (c.local && S.where !== 'available' && S.where !== 'checking') {
      sendStatus('error', LOCAL_NOT_READY_TEXT); sendHere(c); return;
    }
    begin(c.local);
  }
  el.start.addEventListener('click', function () {
    if (S.speech || S.starting) return;
    if (S.where === 'checking') return;
    if (S.where !== 'available') { S.askCloud = true; setStatus(ASK_CLOUD_TEXT); return; }
    begin(true);
  });
  el.consent.addEventListener('click', function () { begin(false); });
  // 止める（操作部のボタンと、枠からの stop の指図）。認識の終わりの知らせを待ってから終える
  function stopListening() {
    const sp = S.speech;
    if (!sp) { sendHere(); return; }
    setStatus('止めている（認識の終わりを待つ。最長 ' + (STOP_WAIT_MS / 1000) + ' 秒）');
    const done = function () { endListening('stopped', '止めた'); };
    if (typeof sp.stopWait === 'function') sp.stopWait(done, STOP_WAIT_MS); else { try { sp.stop(); } catch (e) { /* 止め損ねても終える */ } done(); }
  }
  el.stop.addEventListener('click', stopListening);

  checkWhere();
  render();
})();
