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
 * 送るもの（どれも {source:'kiku-bridge', v:2, …}。宛先の origin は iframe の src から作る（new URL(src).origin）。作れない iframe には送らない）:
 *   {kind:'hello'}                        始めるときに 1 回と、その後 2 秒ごと（HELLO_PERIOD_MS）。聞いている間、または溜めた発話がある間は
 *                                         続ける（止めた後も、溜めた分が残っていれば続ける）。枠が居れば
 *                                         {source:'kiku', v:2, kind:'hello', listening, received} が返る（'kiku-page' の印も受ける）。
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
 *   {kind:'here', where, capturing, ver}  枠の ping・指図への返事。where はこの PC の中で文字にできるか、capturing は音を取っている途中か、
 *                                         ver はこの拡張の版（manifest の version。枠は自分の持つ版より古ければ「新しい版がある」と出す）
 *
 * 版（v）: 2。版 1 の送り手（拡張 0.1.0）は v:1 の指図にしか応えないので、枠が v:2 で話せば、タブに残った 0.1.0 は黙る
 *   （古い送り手の window の message の受け口は、後から入った送り手からは止められない。Chromium 141 で実測）。
 *
 * タブに古い送り手がいるとき: 拡張を新しい版に置き換えると、タブに入っていた送り手は動いたまま残る（chrome.* は使えなくなるが、
 *   window の受け口は生きている。Chromium 141 で実測）。だから送り手は、立ち上がる前に document へ kiku-bridge-retire の知らせを出し、
 *   それを聞いた古い送り手（0.2.0 以降）は受け口と操作部を外して退く。古い送り手が音を取っている途中なら、取り終えるまで退かず
 *   （操作部の host に data-busy を立てる）、新しい送り手はそれが消えるのを待ってから立ち上がる（会議の途中で聞き取りを切らないため）。
 *   待っている間にさらに新しい送り手が入れば、待っていた方は立ち上がらずに終わる（立ち上がるのはいつも最後に入った 1 つ）。
 *   退く送り手に、枠へまだ送れていない発話（枠が聞いていない間に溜めた分）が残っていれば、<html> の data-kiku-bridge-pending に
 *   JSON で置いて退き、次の送り手が立ち上がるときに読んで消し、自分の溜めの頭に入れる（枠が聞き始めたら、古い順のまま流れる）。
 *   知らせに応えない送り手（0.1.0）の操作部は、新しい送り手が取り除く（0.1.0 の受け口は残るが、上の v:2 で黙る）。
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
  const VERSION = 2;            // 枠と話す決まりの版（拡張の版ではない。拡張の版は manifest の version）
  const FRAME_HOST_SUFFIX = '.claudeusercontent.com';
  const BATCH_MS = 1000;        // 確定した発話をまとめて送る間隔
  const HELLO_PERIOD_MS = 2000; // hello を繰り返す間隔
  const HELLO_WAIT_MS = 1500;   // hello の返事を待つ長さ
  const STOP_WAIT_MS = 3000;    // 止めるとき、認識の終わりの知らせを待つ上限（kiku 本体と同じ）
  const STATES = ['listening', 'stopped', 'error'];
  const COMMANDS = ['ping', 'start', 'stop', 'install', 'probe'];   // 枠から届く指図（intake.js の makeBridgeLink が送る。probe は 0.2.1 から）
  const HOST_ID = 'kiku-bridge-host';          // 操作部の host の id（タブに 1 つだけ）
  const RETIRE_EVENT = 'kiku-bridge-retire';   // 新しく入った送り手が、前からいる送り手に退いてもらう知らせ（document に出す）
  const BUSY_WAIT_MS = 1000;                   // 前の送り手が音を取っている間、退くのを待つ見回りの間隔
  const HANDOFF_ATTR = 'data-kiku-bridge-pending';   // 退く送り手が、枠へまだ送れていない発話を次の送り手へ渡す置き場（<html> の属性。JSON の配列）
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
  // 居ることの知らせ。where はこの PC の中で文字にできるか（speechLocal の語）、capturing は画面共有の音を取っている途中か、
  // ver はこの拡張の版（文字列のときだけ付ける）
  function hereMessage(where, capturing, ver) {
    const m = { source: SOURCE, v: VERSION, kind: 'here', where: String(where == null ? 'none' : where), capturing: capturing === true };
    if (typeof ver === 'string' && ver) m.ver = ver;
    return m;
  }
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
    // 溜めた分を取り出して空にする（送らない。掛けてあった時計も外す）。退く送り手が、溜めた発話を次の送り手へ渡すときに使う
    function take() {
      if (timer != null) { clearT(timer); timer = null; }
      const out = buf; buf = [];
      return out;
    }
    return {
      push: push, flush: flush, open: setOpen, isOpen: function () { return open; }, take: take,
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

  // ---- 音の診断（0.2.1。枠の「音の診断」から。画面全体の音が届くか・文字になるかを 1 回で測る） ----
  // 2026-10-10 の私用 PC の初めての実走で、タブの音を start(track) に渡した端末内の認識が「aborted」を 5 回続けて止まった。
  // 何が成り立たないのかを測るまで、文字にする所を作り直さない。
  // 同じ画面共有の音を 3 つの段で順に、各 PROBE_PHASE_MS 認識させる:
  //   local_raw: この PC の中で、音のトラックをそのまま（いまの橋と同じ形）
  //   local_16k: この PC の中で、Web Audio で 16kHz・1ch に直したトラック（形が原因なら、ここだけ通る）
  //   cloud_raw: 提供元（Google）のサーバーで、音のトラックをそのまま（音が外へ出る。枠のボタンの文にそう書いてある）
  // 音の大きさは、同じ音を Web Audio の AnalyserNode で 200 ミリ秒ごとに測る（RMS、dBFS）
  const PROBE_PHASES = [
    { key: 'local_raw', local: true, via: 'raw', label: 'PC の中で（音をそのまま）' },
    { key: 'local_16k', local: true, via: '16k', label: 'PC の中で（16kHz・1ch に直して）' },
    { key: 'cloud_raw', local: false, via: 'raw', label: 'Google のサーバーで' }
  ];
  const PROBE_PHASE_MS = 12000;
  const PROBE_TRIES = 3;           // 1 つの段で認識を始める上限（すぐ終わったら 0.5 秒おいて始め直す。いまの橋の振る舞いを短く）
  const PROBE_END_WAIT_MS = 1500;  // 誤りの後・止めた後に、終わりの知らせ（onend）を待つ上限。来なければ abort して進む
  const PROBE_LOUD_DB = -50;       // これより大きい所を「音があった」と数える
  const PROBE_GAP_MS = 1000;       // 段と段の間を空ける長さ
  const PROBE_ENV_WAIT_MS = 3000;  // 端末の様子（版・端末内で日本語が使えるか）を待つ上限
  // 画面共有の選ぶ画面で「画面全体」を先に出す（displaySurface は勧めるだけで、利用者はタブも選べる。選んだものは結果に出る）
  const PROBE_ASK = {
    video: { displaySurface: 'monitor' },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    systemAudio: 'include', selfBrowserSurface: 'exclude'
  };
  const PROBE_STATES = ['running', 'done'];
  const SURFACE_TEXT = { monitor: '画面全体', window: 'ウィンドウ', browser: 'タブ' };
  const ASR_CODE_TEXT = {
    aborted: '止められた', network: '通信が切れた', 'no-speech': '声が聞こえない', 'audio-capture': '音を取れない',
    'not-allowed': '許されていない', 'service-not-allowed': '使えない', 'language-not-supported': '日本語が無い'
  };
  // 枠へ送る診断の知らせ。state は running（途中の文）か done（summary: 文の配列、report: 測った値）
  function probeMessage(state, text, extra) {
    const body = { source: SOURCE, v: VERSION, kind: 'probe', state: PROBE_STATES.indexOf(state) >= 0 ? state : 'done', text: String(text == null ? '' : text) };
    if (extra && typeof extra === 'object') Object.keys(extra).forEach(function (k) { body[k] = extra[k]; });
    return body;
  }
  // 測った値の入れ物（音の大きさ）。db は dBFS（数でなければ -120 として数える）
  function newLevel() { return { max: null, loud: 0, n: 0 }; }
  function addLevel(lv, db) {
    const x = typeof db === 'number' && isFinite(db) ? db : -120;
    lv.n++;
    if (lv.max === null || x > lv.max) lv.max = x;
    if (x > PROBE_LOUD_DB) lv.loud++;
  }
  // 音の大きさの文。測れていなければ空
  function levelText(lv) {
    if (!lv || !lv.n) return '';
    const pct = Math.round(lv.loud * 100 / lv.n);
    if (!lv.loud) return '音: 届いていない（ずっと無音。いちばん大きい所 ' + Math.round(lv.max) + ' dB）';
    return '音: 届いた（いちばん大きい所 ' + Math.round(lv.max) + ' dB・音があったのは測った時間の ' + pct + '%）';
  }
  // 1 つの段の誤りを数えた文（「止められた（aborted）×3」）。誤りが無ければ空
  function errorsText(ph) {
    const n = Object.create(null), order = [];
    (ph.attempts || []).forEach(function (a) {
      (a.ev || []).forEach(function (s) {
        const m = /^error:([^@(]+)/.exec(s);
        if (!m) return;
        if (!n[m[1]]) { n[m[1]] = 0; order.push(m[1]); }
        n[m[1]]++;
      });
    });
    return order.map(function (c) { return (hasOwn(ASR_CODE_TEXT, c) ? ASR_CODE_TEXT[c] + '（' + c + '）' : c) + (n[c] > 1 ? '×' + n[c] : ''); }).join('・');
  }
  function phaseLabel(key) {
    for (let i = 0; i < PROBE_PHASES.length; i++) if (PROBE_PHASES[i].key === key) return PROBE_PHASES[i].label;
    return String(key);
  }
  // 診断の結果を、人が読む文の配列にする（枠と操作部に出す。測った値そのものは report に残る）
  function probeSummary(rep) {
    if (!rep || typeof rep !== 'object') return ['結果が無い'];
    const out = [];
    if (rep.error) out.push('画面共有を始められなかった（' + rep.error + '）');
    if (rep.hasAudio !== undefined) {
      const s = hasOwn(SURFACE_TEXT, rep.surface) ? SURFACE_TEXT[rep.surface] : (rep.surface ? String(rep.surface) : '不明');
      out.push('選んだ画面: ' + s + (rep.hasAudio ? '' : '。音が共有されていない（「システム音声も共有」がオフだった）'));
    }
    if (rep.hasAudio) {
      const lt = levelText(rep.level);
      const ctxOff = rep.ctx && rep.ctx.state0 && rep.ctx.state0 !== 'running' && !(rep.level && rep.level.loud);
      out.push(ctxOff ? '音: 測れなかった（音を測る所が「' + rep.ctx.state0 + '」のままだった）' : (lt || '音: 測れなかった'));
    }
    (rep.phases || []).forEach(function (ph) {
      let w;
      if (ph.skipped) w = '測らなかった（' + ph.skipped + '）';
      else if (ph.finals + ph.interims > 0) w = '文字になった（確定 ' + ph.finals + ' 件・途中 ' + ph.interims + ' 回' + (ph.texts && ph.texts.length ? '。例「' + ph.texts[0] + '」' : '') + '）';
      else {
        const et = errorsText(ph);
        w = '文字にならなかった（' + (et ? '誤り: ' + et : '誤りは出ず、何も返ってこなかった') + '）';
      }
      out.push(phaseLabel(ph.key) + ': ' + w);
    });
    if (rep.stopped) out.push('途中で止めた' + (rep.trackEnded != null ? '（画面共有が止められた）' : ''));
    return out;
  }
  const CONSENT_TEXT = '承知して始める（音を提供元（Google）のサーバーへ送る）';
  const ASK_CLOUD_TEXT = 'この PC の中では文字にできない。音を提供元（Google）のサーバーへ送ってよければ、下のボタンで始める';
  const START_TEXT = '橋: 画面共有の音を枠へ';
  const FROM_FRAME_FAILED_TEXT = '枠のボタンからは画面共有を始められなかった（このブラウザでは、枠の中のクリックがこのページに伝わらない）。この欄の「' + START_TEXT + '」を押して始める';
  const LOCAL_NOT_READY_TEXT = 'この PC の中では、まだ文字にできない（日本語の部品が入っていない）。始めなかった';
  const PROBE_BUSY_TEXT = '音の診断の途中なので、聞き取りを始めなかった。診断が終わってから押す';

  const api = {
    frameOrigin: frameOrigin, pickFrames: pickFrames, postToFrames: postToFrames, helloMessage: helloMessage, linesMessage: linesMessage, statusMessage: statusMessage,
    hereMessage: hereMessage, frameCommand: frameCommand, COMMANDS: COMMANDS,
    isHelloReply: isHelloReply, lineOf: lineOf, makeBatcher: makeBatcher, makeHelloLoop: makeHelloLoop,
    helloText: helloText, pendingText: pendingText, shareText: shareText, whereText: whereText,
    SOURCE: SOURCE, VERSION: VERSION, FRAME_HOST_SUFFIX: FRAME_HOST_SUFFIX, BATCH_MS: BATCH_MS, HELLO_PERIOD_MS: HELLO_PERIOD_MS, HELLO_WAIT_MS: HELLO_WAIT_MS,
    CONSENT_TEXT: CONSENT_TEXT, START_TEXT: START_TEXT, FROM_FRAME_FAILED_TEXT: FROM_FRAME_FAILED_TEXT, LOCAL_NOT_READY_TEXT: LOCAL_NOT_READY_TEXT,
    HOST_ID: HOST_ID, RETIRE_EVENT: RETIRE_EVENT, BUSY_WAIT_MS: BUSY_WAIT_MS, HANDOFF_ATTR: HANDOFF_ATTR,
    probeMessage: probeMessage, probeSummary: probeSummary, newLevel: newLevel, addLevel: addLevel, PROBE_PHASES: PROBE_PHASES, PROBE_ASK: PROBE_ASK,
    PROBE_PHASE_MS: PROBE_PHASE_MS, PROBE_TRIES: PROBE_TRIES, PROBE_LOUD_DB: PROBE_LOUD_DB
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.KIKU_BRIDGE = api;

  // ---- ここから画面の側（document のある所だけ。親ページだけで動く——manifest の all_frames: false） ----
  if (typeof document === 'undefined' || typeof window === 'undefined' || !document.body) return;
  // 前からタブにいる送り手に退いてもらう（頭の「タブに古い送り手がいるとき」）。自分の出した知らせは自分では聞かない（聞く口は後で付ける）
  try { document.dispatchEvent(new Event(RETIRE_EVENT)); } catch (e) { /* 知らせを出せなくても立ち上がる */ }
  // 立ち上がるのを待っている間に、さらに新しい送り手が入ってきたら（その送り手の退く知らせを聞いたら）、待つのをやめて何もしない
  // （待っている送り手が 2 つとも立ち上がって、ping に 2 つ答えないため）
  let superseded = false;
  function onSuperseded() { superseded = true; document.removeEventListener(RETIRE_EVENT, onSuperseded); }
  document.addEventListener(RETIRE_EVENT, onSuperseded);
  waitThenBoot();

  // この拡張の版（manifest の version）。立ち上がるときに 1 回だけ読む（拡張を置き換えた後の古い送り手では chrome.* が投げるため）
  function manifestVersion() {
    try {
      const m = globalThis.chrome && chrome.runtime && typeof chrome.runtime.getManifest === 'function' ? chrome.runtime.getManifest() : null;
      return m && typeof m.version === 'string' ? m.version : null;
    } catch (e) { return null; }
  }
  // 送り手から送り手へ渡す発話の置き場（<html> の属性）。置くときは、まだ読まれていない分の後ろに足す
  function readHandoff() {
    let raw = null;
    try { raw = document.documentElement.getAttribute(HANDOFF_ATTR); } catch (e) { return []; }
    if (!raw) return [];
    try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function putHandoff(lines) {
    try { document.documentElement.setAttribute(HANDOFF_ATTR, JSON.stringify(readHandoff().concat(lines))); } catch (e) { /* 置けなければ失う */ }
  }
  function takeHandoff() {
    const out = readHandoff();
    try { document.documentElement.removeAttribute(HANDOFF_ATTR); } catch (e) { /* 消せなくても、読んだ分は使う */ }
    return out;
  }
  // 前の送り手の操作部が残っていれば: 音を取っている途中（data-busy）なら消えるまで待ち、そうでなければ（知らせに応えない 0.1.0）取り除いて立ち上がる
  function waitThenBoot() {
    if (superseded) return;
    const old = document.getElementById(HOST_ID);
    if (old && old.getAttribute('data-busy') === '1') { setTimeout(waitThenBoot, BUSY_WAIT_MS); return; }
    document.removeEventListener(RETIRE_EVENT, onSuperseded);
    if (old) { try { old.remove(); } catch (e) { /* 取り除けなくても立ち上がる */ } }
    boot();
  }

  function boot() {
    const INTAKE = globalThis.TSV_INTAKE || null;
    // where: 'checking'・'available'・'downloadable'・'downloading'・'unavailable'・'none'（intake.js の speechLocal）
    // speech: 動いている認識の入口。stream: 画面共有（持ち主はこの拡張なので、止めるときにトラックを止める）。share: 共有中の画面の名前（null は共有していない）
    // starting: 画面共有を選んでいる途中（押してから取れるまで）。found: hello の返事（null は待っている・true・false）。
    // helloSeq／replySeq: 何回目の hello か・何回目までに返事が来たか（周期の hello で文を消さないため）。askCloud: 外へ送る承知を求めている
    // lastStatus: 枠へ最後に送った status の本文（枠が聞き始めた返事を受けた時に 1 回送り直す。null は未送。始めるたびに null に戻す——
    //   前の回の「止めた」を、新しい回の画面共有を選んでいる間に送り直さないため）。送り直しが重なって同じ status が 2 度届くことはあるが、
    //   枠は同じ状態を置き直すだけで、誤りの知らせも同じ文では 1 回しか出さない
    // kiku: 最後に指図をくれた枠 {win, origin}（null はまだ無い）。panelOpen: 操作部を開いておく（誤り・枠のボタンから始められなかったとき）
    // retired: 新しい送り手に退いた（受け口も操作部も外した。以後は何もしない）。retireWanted: 退くよう言われたが、音を取っている途中なので取り終えてから退く
    let retired = false, retireWanted = false;
    const MY_VER = manifestVersion();
    const S = { where: 'checking', speech: null, stream: null, share: null, starting: false, began: 0, found: null, foundListening: false, helloSeq: 0, replySeq: 0, askCloud: false, status: '', interim: '', lastStatus: null,
      kiku: null, panelOpen: false, probing: null };

    // 操作部（shadow DOM の中に置き、claude.ai の見た目に触らない・触られない）
    const host = document.createElement('div');
    host.id = HOST_ID;
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
      if (retired) return;
      const busy = !!(S.speech || S.starting || S.probing);
      // 音を取っている途中は data-busy を立てる（新しい送り手は、これが消えるまで立ち上がらずに待つ）
      host.setAttribute('data-busy', busy ? '1' : '0');
      // 取り終えたので退く。退いた後の sendHere は黙るので、その前に「もう取っていない」（capturing:false）を枠へ知らせておく
      if (retireWanted && !busy) { sendHere(); retire(); return; }
      const visible = !!(S.speech || S.starting || S.probing || S.panelOpen || S.askCloud || batcher.pending() > 0);
      host.style.display = visible ? '' : 'none';
      show(closeBtn, !busy);
      el.where.textContent = whereText(S.where);
      show(el.install, S.where === 'downloadable' || S.where === 'downloading');
      el.hello.textContent = S.found === null ? '' : helloText(S.found, S.foundListening);
      el.status.textContent = S.status;
      el.interim.textContent = S.interim ? '（途中）' + S.interim.slice(-40) : '';
      el.share.textContent = S.share === null ? '' : shareText(S.share);
      el.pending.textContent = batcher.isOpen() ? '' : pendingText(batcher.pending());
      show(el.start, !S.speech && !S.askCloud && !S.probing);
      el.start.disabled = S.where === 'checking';
      show(el.consent, !S.speech && S.askCloud && !S.probing);
      el.stop.disabled = !S.speech && !S.probing;
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
      if (retired) return;
      // capturing は音を取っている間だけ真（画面を選んでいる途中は偽。枠は真になってから記録を開くので、選ぶ画面で取り消せば何も書かない）
      const body = hereMessage(S.where, !!S.speech, MY_VER);
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
    // 前の送り手が退くときに置いていった発話を受け取る（頭の「タブに古い送り手がいるとき」）。門は閉じたまま溜めの頭に入れ、
    // 枠が聞き始めた返事で流す。本文は lineOf で形を確かめ直す（置き場はページの DOM なので、形の崩れたものは捨てる）
    takeHandoff().forEach(function (l) { batcher.push(l); });
    // hello。返事は window の message で受ける（枠の origin は見ない）。返事の listening で門を開け閉めし、開いたときに溜めた分が流れる
    function onWindowMessage(ev) {
      if (retired) return;
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
    }
    window.addEventListener('message', onWindowMessage);
    function sendHello() {
      if (retired) return;
      const seq = ++S.helloSeq;
      if (seq === 1 || S.found === false) { S.found = null; S.foundListening = false; }
      const n = postToFrames(document, helloMessage(), kikuFrames());
      if (!n) { S.found = false; S.foundListening = false; batcher.open(false); render(); return; }
      setTimeout(function () { if (S.replySeq < seq) { S.found = false; S.foundListening = false; batcher.open(false); render(); } }, HELLO_WAIT_MS);
      render();
    }
    // 2 秒ごとの hello。画面共有を選んでいる間・聞いている間・溜めた発話がある間は続ける
    const hello = makeHelloLoop(sendHello, function () { return S.starting || !!S.speech || batcher.pending() > 0; }, { periodMs: HELLO_PERIOD_MS });
    // 受け取った発話があれば、枠を探し始める（聞いていなくても、溜めた分がある間は hello を続ける）
    if (batcher.pending() > 0) hello.start();

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
      if (S.speech || S.starting || S.probing) return;
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
      if (retired) return;
      if (c.win) S.kiku = { win: c.win, origin: c.origin };
      if (c.kind === 'ping') { sendHere(c); return; }
      if (c.kind === 'install') { installPack(); return; }
      if (c.kind === 'stop') { stopListening(); return; }
      if (c.kind === 'probe') { runProbe(c); return; }
      // 音の診断の途中: 始めない（画面共有を 2 つ開かない）。枠には誤りとして返す
      if (S.probing) { sendStatus('error', PROBE_BUSY_TEXT); sendHere(c); return; }
      // start: すでに始めている・選んでいる途中なら、いまの状態を返すだけ（二重に画面共有を開かない）
      if (S.speech || S.starting) { sendHere(c); if (S.lastStatus) postToFrames(document, S.lastStatus, kikuFrames()); return; }
      // この PC の中で、と言われたのに、調べた結果ができないと言っている: 始めない（黙ってサーバーへ送る形にしない）
      if (c.local && S.where !== 'available' && S.where !== 'checking') {
        sendStatus('error', LOCAL_NOT_READY_TEXT); sendHere(c); return;
      }
      begin(c.local);
    }
    el.start.addEventListener('click', function () {
      if (S.speech || S.starting || S.probing) return;
      if (S.where === 'checking') return;
      if (S.where !== 'available') { S.askCloud = true; setStatus(ASK_CLOUD_TEXT); return; }
      begin(true);
    });
    el.consent.addEventListener('click', function () { begin(false); });
    // 止める（操作部のボタンと、枠からの stop の指図）。認識の終わりの知らせを待ってから終える
    function stopListening() {
      // 音の診断の途中なら、診断を止める（いまの段を終えて、残りの段は測らない。結果は枠に送る）
      if (S.probing) { S.probing.stop = true; if (typeof S.probing.kick === 'function') S.probing.kick(); return; }
      const sp = S.speech;
      if (!sp) { sendHere(); return; }
      setStatus('止めている（認識の終わりを待つ。最長 ' + (STOP_WAIT_MS / 1000) + ' 秒）');
      const done = function () { endListening('stopped', '止めた'); };
      if (typeof sp.stopWait === 'function') sp.stopWait(done, STOP_WAIT_MS); else { try { sp.stop(); } catch (e) { /* 止め損ねても終える */ } done(); }
    }
    el.stop.addEventListener('click', stopListening);

    // ---- 音の診断（頭の「音の診断」の段を順に測り、結果を指図をくれた枠へ送る） ----
    // P: {to（指図をくれた枠）, rep（測った値）, stop（止めるよう言われた）, kick（いまの段を終える手）, cur（いまの段の結果）, stream, meter}
    function errText(e) { return String(e && e.message ? e.message : e).slice(0, 160); }
    function sendProbe(to, state, text, extra) {
      const body = probeMessage(state, text, extra);
      if (to && to.win && typeof to.win.postMessage === 'function') { try { to.win.postMessage(body, to.origin); return; } catch (e) { /* 送れなければ見つかる枠へ */ } }
      postToFrames(document, body, kikuFrames());
    }
    // 端末の様子（Chrome の版・OS の版・この PC の中で日本語を文字にできるか）。どれも取れなければ欠けたまま
    function probeEnv(SR) {
      const env = {};
      const nav = globalThis.navigator || {};
      const uad = nav.userAgentData;
      const p1 = uad && typeof uad.getHighEntropyValues === 'function'
        ? Promise.resolve(uad.getHighEntropyValues(['fullVersionList', 'platformVersion'])).then(function (v) {
          env.chrome = (v.fullVersionList || []).map(function (b) { return b.brand + ' ' + b.version; }).join(', ');
          env.platform = String(v.platform || '') + ' ' + String(v.platformVersion || '');
        }, function () { /* 取れなくても測る */ })
        : Promise.resolve();
      const p2 = SR && typeof SR.available === 'function'
        ? Promise.resolve().then(function () { return SR.available({ langs: ['ja-JP'], processLocally: true }); }).then(function (s) { env.local = String(s); }, function (e) { env.local = 'error: ' + errText(e); })
        : Promise.resolve().then(function () { env.local = SR ? 'no available()' : 'no SpeechRecognition'; });
      return Promise.all([p1, p2]).then(function () { return env; });
    }
    function runProbe(c) {
      if (S.speech || S.starting || S.probing) {
        const why = '聞き取りか診断の途中なので、診断を始めなかった';
        sendProbe(c, 'done', why, { summary: [why], report: null });
        return;
      }
      const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null;
      const rep = { v: 1, ext: MY_VER, at: new Date().toISOString(), ua: String((globalThis.navigator && navigator.userAgent) || ''), level: newLevel(), phases: [] };
      const P = { to: c, rep: rep, stop: false, kick: null, cur: null, stream: null, meter: null, t0: Date.now() };
      S.probing = P;
      // 画面共有と AudioContext は、押した操作の中で同期に作る（操作の直後でないと、画面共有は断られ、AudioContext は止まったまま始まる）
      let ctx = null;
      try { ctx = new AudioContext({ sampleRate: 16000 }); rep.ctx = { rate: ctx.sampleRate, state0: ctx.state }; } catch (e) { rep.ctx = { error: errText(e) }; }
      let gp;
      try {
        const md = globalThis.navigator && navigator.mediaDevices;
        gp = md && typeof md.getDisplayMedia === 'function' ? Promise.resolve(md.getDisplayMedia(PROBE_ASK)) : Promise.reject(new Error('getDisplayMedia が無い'));
      } catch (e) { gp = Promise.reject(e); }
      const ask = '画面共有の画面で「画面全体」を選び、「システム音声も共有」をオンにして「共有」を押す';
      setStatus('音の診断: ' + ask);
      sendProbe(c, 'running', ask);
      // 端末の様子は、取れた分だけ待つ（取れないまま返ってこなくても、結果を送るのを止めない。上限 PROBE_ENV_WAIT_MS）
      const envP = Promise.race([
        probeEnv(SR).then(function (env) { Object.keys(env).forEach(function (k) { rep[k] = env[k]; }); }, function () { /* 欠けたまま */ }),
        new Promise(function (r) { setTimeout(r, PROBE_ENV_WAIT_MS); })
      ]);
      gp.then(function (stream) { return probeWith(P, SR, ctx, stream); }, function (e) { rep.error = (e && e.name ? e.name + ': ' : '') + errText(e); })
        .then(null, function (e) { rep.error = rep.error || errText(e); })
        .then(function () { return envP; })
        .then(function () { endProbe(P, ctx); });
    }
    function probeWith(P, SR, ctx, stream) {
      const rep = P.rep;
      P.stream = stream;
      const vt = stream && typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks()[0] || null : null;
      const at = stream && typeof stream.getAudioTracks === 'function' ? stream.getAudioTracks()[0] || null : null;
      try { rep.surface = vt && typeof vt.getSettings === 'function' ? vt.getSettings().displaySurface || null : null; } catch (e) { rep.surface = null; }
      rep.hasAudio = !!at;
      if (!at) return Promise.resolve();
      try { const st = at.getSettings(); rep.audio = { sampleRate: st.sampleRate == null ? null : st.sampleRate, channelCount: st.channelCount == null ? null : st.channelCount }; } catch (e) { rep.audio = null; }
      // Chrome の「共有を停止」で止められたら、いまの段を終えて残りは測らない
      at.addEventListener('ended', function () {
        if (rep.trackEnded == null) rep.trackEnded = Date.now() - P.t0;
        P.stop = true;
        if (typeof P.kick === 'function') P.kick();
      });
      let t16 = null;
      if (ctx) {
        try {
          const src = ctx.createMediaStreamSource(stream);
          const an = ctx.createAnalyser();
          an.fftSize = 2048;
          src.connect(an);
          const dest = ctx.createMediaStreamDestination();
          dest.channelCount = 1;
          src.connect(dest);
          t16 = dest.stream.getAudioTracks()[0] || null;
          const buf = new Float32Array(an.fftSize);
          P.meter = setInterval(function () {
            an.getFloatTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            const db = 10 * Math.log10(sum / buf.length + 1e-12);
            addLevel(rep.level, db);
            if (P.cur) addLevel(P.cur.level, db);
          }, 200);
          if (ctx.state !== 'running' && typeof ctx.resume === 'function') Promise.resolve(ctx.resume()).then(null, function () { /* 止まったまま。結果に出る */ });
        } catch (e) { rep.ctx.error = errText(e); }
      }
      return PROBE_PHASES.reduce(function (p, ph, i) {
        return p.then(function () {
          if (P.stop) { rep.phases.push({ key: ph.key, skipped: '止めた' }); return; }
          if (!SR) { rep.phases.push({ key: ph.key, skipped: '音声認識が無い' }); return; }
          const track = ph.via === '16k' ? t16 : at;
          if (!track) { rep.phases.push({ key: ph.key, skipped: '16kHz に直す所を作れなかった' }); return; }
          const text = '測っている（' + (i + 1) + '/' + PROBE_PHASES.length + ': ' + ph.label + '。この段は ' + Math.round(PROBE_PHASE_MS / 1000) + ' 秒）';
          setStatus('音の診断: ' + text);
          sendProbe(P.to, 'running', text);
          return probePhase(P, SR, ph, track, ctx).then(function (res) { rep.phases.push(res); });
        });
      }, Promise.resolve());
    }
    // 1 つの段。認識を始め、すぐ終わったら 0.5 秒おいて始め直す（PROBE_TRIES 回まで）。PROBE_PHASE_MS で止め、終わりを待って次へ
    function probePhase(P, SR, ph, track, ctx) {
      return new Promise(function (resolve) {
        const res = { key: ph.key, finals: 0, interims: 0, texts: [], attempts: [], level: newLevel(),
          track: { state: track.readyState, muted: !!track.muted }, ctx: ctx ? ctx.state : null };
        P.cur = res;
        const t0 = Date.now();
        let over = false, settled = false, live = null, timer = null;
        function ms() { return Date.now() - t0; }
        function done() {
          if (settled) return;
          settled = true;
          if (timer != null) clearTimeout(timer);
          P.cur = null; P.kick = null;
          setTimeout(function () { resolve(res); }, PROBE_GAP_MS);   // 前の段の認識の後始末と、次の段の認識が重ならないように空ける
        }
        function next() { if (over || P.stop) { done(); return; } if (res.attempts.length < PROBE_TRIES) tryOnce(); }
        function tryOnce() {
          const a = { at: ms(), ev: [] };
          res.attempts.push(a);
          const me = { r: null, ended: false };
          function ev(s) { if (a.ev.length < 40) a.ev.push(s + '@' + ms()); }
          me.ev = ev;
          function finish(synthetic) {
            if (me.ended) return;
            me.ended = true;
            if (synthetic) { ev('no-end'); try { me.r.abort(); } catch (e) { /* 止め損ねても進む */ } }
            if (live === me) live = null;
            if (over || P.stop) { done(); return; }
            setTimeout(next, 500);
          }
          let r;
          try { r = new SR(); } catch (e) { ev('new:' + errText(e)); me.ended = true; return; }
          me.r = r;
          live = me;
          r.lang = 'ja-JP';
          r.continuous = true;
          r.interimResults = true;
          if (ph.local) { try { r.processLocally = true; } catch (e) { ev('processLocally:' + errText(e)); } }
          ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'nomatch'].forEach(function (n) { r['on' + n] = function () { ev(n); }; });
          r.onresult = function (e) {
            for (let k = e.resultIndex; k < e.results.length; k++) {
              const x = e.results[k];
              const tx = String(x && x[0] && x[0].transcript || '').trim();
              if (!tx) continue;
              if (a.first == null) a.first = ms();
              if (x.isFinal) { res.finals++; if (res.texts.length < 2) res.texts.push(tx.slice(0, 30)); } else res.interims++;
            }
          };
          r.onerror = function (e) {
            ev('error:' + String(e && e.error || '?') + (e && e.message ? '(' + String(e.message).slice(0, 80) + ')' : ''));
            // 誤りの後に終わりの知らせが来ない認識がある（intake.js の FATAL_END_WAIT_MS と同じ）。来なければ終わったものとする
            setTimeout(function () { if (!me.ended) finish(true); }, PROBE_END_WAIT_MS);
          };
          r.onend = function () { ev('end'); finish(false); };
          try { r.start(track); } catch (e) { ev('start-throw:' + errText(e)); finish(false); }
        }
        // 段を終える（時間が来た・止めるよう言われた）。動いている認識は止め、終わりの知らせを待つ（来なければ abort して進む）
        function end() {
          if (over) return;
          over = true;
          const me = live;
          if (!me || me.ended) { done(); return; }
          try { me.r.stop(); } catch (e) { /* 止め損ねたら、待ちの後で abort */ }
          setTimeout(function () {
            if (me.ended) return;
            me.ended = true;
            me.ev('no-end');
            try { me.r.abort(); } catch (e) { /* 止め損ねても進む */ }
            done();
          }, PROBE_END_WAIT_MS);
        }
        P.kick = end;
        timer = setTimeout(end, PROBE_PHASE_MS);
        tryOnce();
      });
    }
    function endProbe(P, ctx) {
      const rep = P.rep;
      if (P.meter != null) clearInterval(P.meter);
      if (ctx) {
        if (rep.ctx) rep.ctx.state = ctx.state;
        try { Promise.resolve(ctx.close()).then(null, function () { /* 閉じ損ねても害はない */ }); } catch (e) { /* 同上 */ }
      }
      if (P.stream && typeof P.stream.getTracks === 'function') P.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* もう使わない */ } });
      if (P.stop) rep.stopped = true;
      // 数を丸める（db に入れる値に -Infinity・NaN を残さない）
      [rep.level].concat(rep.phases.map(function (x) { return x.level; })).forEach(function (lv) { if (lv && typeof lv.max === 'number') lv.max = Math.round(lv.max * 10) / 10; });
      const summary = probeSummary(rep);
      S.probing = null;
      S.panelOpen = true;   // 枠に届かなくても、ここで読めるように
      setStatus('音の診断の結果: ' + summary.join(' ／ '));
      sendProbe(P.to, 'done', '終わった', { summary: summary, report: rep });
      sendHere();
    }

    // 新しく入った送り手から退くよう言われた（頭の「タブに古い送り手がいるとき」）。音を取っている途中なら、取り終えてから退く（render が見る）
    function onRetire() {
      if (retired) return;
      retireWanted = true;
      if (!S.speech && !S.starting) retire(); else render();
    }
    // 退く: 受け口・周期の hello・まとめ送りの時計を外し、操作部を取り除く。枠へまだ送れていない発話が残っていれば
    // （枠が聞いていない間に拡張を置き換えたとき）、操作部を取り除く前に置き場へ渡す（次の送り手は、操作部が消えてから立ち上がる）
    function retire() {
      if (retired) return;
      retired = true;
      window.removeEventListener('message', onWindowMessage);
      document.removeEventListener(RETIRE_EVENT, onRetire);
      hello.stop();
      batcher.open(false);
      if (batcher.pending() > 0) putHandoff(batcher.take());
      try { host.remove(); } catch (e) { /* 取り除けなくても、受け口は外してある */ }
    }
    document.addEventListener(RETIRE_EVENT, onRetire);

    checkWhere();
    render();
  }
})();
