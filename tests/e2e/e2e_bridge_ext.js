#!/usr/bin/env node
/*
 * e2e_bridge_ext.js — 橋の送り手（bridge/chrome の Chrome 拡張）を本物の Chromium に読み込み、claude.ai を模した親ページから
 *                     枠（アーティファクトの iframe）へ文字が届くかを通しで確かめる（Chromium headed、xvfb の下。https の偽の claude.ai）
 *
 *   xvfb-run -a node tests/e2e/e2e_bridge_ext.js [道具の根のパス] [出力フォルダ]
 *   （playwright と Chromium と openssl が要る。Chromium の場所は環境変数 CHROMIUM_PATH で渡す。無ければ playwright の既定。
 *     KIKU_E2E_HEADLESS=1 を置くと xvfb 無しの headless（新しい形）で開く。拡張は headed の方が確かなので既定は headed）
 *
 * 作り:
 *   - 自己署名の証明書（openssl で出力フォルダに作る）の https サーバーを立て、Chromium に --host-resolver-rules で claude.ai と
 *     *.claudeusercontent.com を 127.0.0.1 に向けさせる（--ignore-certificate-errors）。拡張の content script は URL の字面
 *     （https://claude.ai/*）で入るので、本物の claude.ai に触れずに「本物の URL」で試せる
 *   - 親ページ https://claude.ai/artifact/<id> は、本物の claude.ai の応答ヘッダ（2026-10-09 に取ったもの）と同じ形の
 *     content-security-policy（style-src は nonce だけ。frame-src は枠の origin）と permissions-policy（display-capture=(self 枠)）を
 *     付けて返す。中身は nonce 付きの style 1 つと枠の iframe 1 つだけ。iframe に allow 属性は付けない——本物の枠の中で
 *     getDisplayMedia が permissions policy で断られた実測に合わせたもので、本物の iframe に allow が無いかは未確認（推測）
 *   - 枠 https://<uuid>.frame.claudeusercontent.com/artifact_wrapped.html は、e2e_artifact.js と同じく kiku-artifact.html を骨で包み、
 *     頭に偽の window.claude（use はすべて null。分析役は内蔵の模擬を選ぶ）と、届いた message を記録する口を置く。
 *     枠の側の応答ヘッダは本物を取っていないので付けない（不明）
 *   - content script の世界（isolated world）には CDP で入る: Runtime.enable → executionContextCreated のうち isolated で
 *     globalThis.KIKU_BRIDGE を持つものを選び、Runtime.evaluate(contextId) で読む・差し替える。画面の操作部（shadow DOM）は
 *     playwright の selector（open な shadow root は貫く）で押す。親ページの文の待ちは evaluate の polling（下の waitUI。
 *     本物と同じ CSP の下では playwright の waitForFunction が eval を断られて使えない）
 *
 * 確かめること:
 *   (読み込み) 拡張が読み込まれ、親ページに操作部（#kiku-bridge-host の shadow root に「橋（画面共有の音を枠へ）」）が出る。
 *              isolated world で chrome.runtime.id が文字列、KIKU_BRIDGE・TSV_INTAKE がある
 *   (範囲)     枠の document には注入されない（all_frames: false）。枠の URL を最上位で開いても注入されない（matches）。
 *              どちらも load の後に 1500 ミリ秒以上置いてから見る（注入は load の前後に入るので、固定の短い待ちでは「無い」の証拠が弱い）。
 *              iframe の無い claude.ai のページには注入され、そこで橋を押すと hello は「枠が見つからない」
 *   (送り先)   kiku の枠が無く about:blank の iframe と別ホストの iframe だけがある claude.ai のページ（/withother）で橋を始める。
 *              hello は「枠が見つからない（kiku のアーティファクトを開いてから押す）」、偽の認識の確定 3 件は送られずに
 *              PENDING「枠がまだ聞いていない。発話を溜めている（3 件。…）」になり、about:blank の iframe・別ホストの iframe・
 *              親の窓のどれにも hello・lines・status が 1 件も届かない。止めても溜めた分は残る
 *   (CSP)      本物と同じ style-src nonce の下で操作部の見た目が効いているか（.box の背景色・host の position・font-size）。
 *              コンソールの CSP 違反（Refused to apply inline style）の件数
 *   (環境)     音声認識の口・available・processLocally・speechLocal()・操作部の「この PC の中で…」の文・getDisplayMedia の有無・
 *              featurePolicy の display-capture を親と枠で。合否にせず結果に書く（results の group「環境」は ok を常に true にし、
 *              detail に実測の値を入れる）
 *   (枠の既定)   枠の中では、音の入り方の既定が拡張「橋」（設定は「設定と記録」の引き出しを開いてから選ぶ）
 *   (素の画面共有) 何も差し替えずに操作部で始め、status の文を記録する（合否にしない）。hello は「枠で「聞き取りを開始」を押すと届く」。
 *              音を取れなかったので、枠は聞き取りを始めず記録も開かない
 *   (枠から始める) 何も差し替えずに枠の「聞き取りを開始」を押す。拡張が画面共有を試み（xvfb では画面を読めずに断られる）、
 *              断られた理由が「操作の直後でない」（InvalidStateError）ではないこと＝枠の中のクリックが親のページに伝わったことを見る。
 *              枠は「始められませんでした：…」を出し、記録を開かない
 *   (差し替えて通す) isolated world の getDisplayMedia を本物の MediaStream（AudioContext の createMediaStreamDestination）を返す
 *              関数に、SpeechRecognition を偽の認識（start(track) を記録し、途中結果 1 件と確定 3 件を出す）に差し替え、枠で 1 回押す。
 *              拡張が getDisplayMedia を 1 回呼び、取り始めてから枠が聞き取りを始める。枠の札が「届いた発話 3 件」、素材ログに 3 発話、
 *              5 秒の窓が閉じて S1、start に渡った track が live、操作部の status が認識の始まりの文、SHARE「共有中: <名前>」。
 *              listening の status は枠の札の後ろに「。」で続く
 *   (枠で停止)   枠の「停止」1 回で、拡張も止まる（操作部の status「止めた」・音のトラックが ended・認識の stop 1 回）。枠は聞き終え、
 *              「停止しました。…」を出す
 *   (操作部で止める) 枠から始めた聞き取りを、操作部の「止める」（Chrome の「共有を停止」と同じ道）で止めると、枠も終え、
 *              表の状態の行に「画面の共有が止まったので、聞き取りを終えました」。止める前に確定した発話は全部入る
 *   (操作部から始める) 枠のボタンを使わず操作部で始めても、枠が自分で記録を開いて聞き取りを始め、3 発話が入る。枠の「停止」で両方止まる
 *   (残る溜め)   枠の入口が「打つ／貼る」のときに操作部で始めると、枠は聞かず、橋は溜める（PENDING 3 件）。止めても溜めは残り、
 *              hello は続く。枠の入口を「橋」に戻して押すと、溜めた 3 件が先に、新しく取った 3 件が後に入る。溜めが無くなり橋も
 *              止まると hello が止まる
 *   (誤り)     親・枠・isolated world の pageerror と console error が、CSP の件を除いて 0 件
 *   (証拠)     節ごとに screenshot を出力フォルダに落とす。結果の JSON も同じ所に書く
 *
 * 結果は JSON で標準出力に出す。1 件でも落ちれば終了コード 1。全体は 240 秒で打ち切る（打ち切りも不合格）
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const KIT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'kiku-e2e-bridge-ext'));
fs.mkdirSync(OUT, { recursive: true });
const EXT = path.join(KIT, 'bridge', 'chrome');
const HEADLESS = process.env.KIKU_E2E_HEADLESS === '1';
const TOTAL_MS = 300000;

// 枠の origin（uuid は作り物）と、親ページの CSP の nonce（作り物）
const UUID = '0f0f0f0f-0000-4000-8000-000000000001';
const FRAME_HOST = UUID + '.frame.claudeusercontent.com';
const OTHER_HOST = 'other.test';   // kiku の枠ではない別ホストの iframe（送り先の確かめに使う）
const NONCE = 'kikuTestNonce0123456789ab';
const ART_ID = 'kikuE2eBridgeExt00';
// 注入が「無い」ことを見る前に load の後に置く長さ。content script は load の前後に入るので、短い固定の待ちでは証拠が弱い
const ABSENCE_WAIT_MS = 1500;
// 橋の時計（周期と返事の待ち）は bridge.js から取る（node では純粋な部分だけが出る。document は作らない）
const BRIDGE = require(path.join(KIT, 'bridge', 'chrome', 'bridge.js'));
const MANIFEST = JSON.parse(fs.readFileSync(path.join(KIT, 'bridge', 'chrome', 'manifest.json'), 'utf8'));
// 操作部・札の文は、揃えた文言の写し（bridge.js・intake.js を読んで取らず、ここに独立に持つ）
const HELLO_NONE = '枠が見つからない（kiku のアーティファクトを開いてから押す）';
function pendingText(n) { return '枠がまだ聞いていない。発話を溜めている（' + n + ' 件。枠で「聞き取りを開始」を押すと流れる）'; }

const results = [];
const env = [];   // 環境の事実（合否にしないもの）
function check(group, name, ok, detail) {
  results.push({ group: group, name: name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.error((ok ? '合格 ' : '不合格 ') + '[' + group + '] ' + name + (detail != null ? '  — ' + String(detail).slice(0, 300) : ''));
}
function fact(name, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  env.push({ name: name, value: v });
  results.push({ group: '環境', name: name, ok: true, detail: v });
  console.error('環境 ' + name + ' = ' + String(v).slice(0, 300));
}
function finish(code) {
  const ng = results.filter(function (r) { return !r.ok; });
  const out = { results: results, env: env, ng: ng.length, total: results.length, headless: HEADLESS };
  fs.writeFileSync(path.join(OUT, 'e2e_bridge_ext_result.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ total: results.length, ng: ng.length }, null, 1));
  process.exit(code != null ? code : (ng.length ? 1 : 0));
}

// ---- 偽の window.claude（枠の頭で走る。能力は全部 null。橋から届いた message と、こちらが返した hello を記録する） ----
const FAKE = `
(function () {
  const F = globalThis.__fake = { uses: [], inbound: [], inIframe: (function () { try { return window.top !== window; } catch (e) { return true; } })(), dbOn: false, dbSets: [] };
  // 保存庫（db）は F.dbOn の間だけ偽物を返す（音の診断の結果を残すところを見るため。ふだんは null）
  const fakeDb = { doc: function (p) { return { set: function (v) { F.dbSets.push({ path: p, value: JSON.parse(JSON.stringify(v)) }); return Promise.resolve(); } }; } };
  globalThis.claude = { use: function (name) { F.uses.push(name); return Promise.resolve(name === 'db' && F.dbOn ? fakeDb : null); } };
  window.addEventListener('message', function (ev) {
    const d = ev && ev.data;
    if (d && d.source === 'kiku-bridge') F.inbound.push({ kind: d.kind, state: d.state, text: d.text, n: Array.isArray(d.lines) ? d.lines.length : null, origin: ev.origin });
  });
  // 自分が親へ返した hello は、親の操作部の文（「枠が見つかった…」）で確かめる（別オリジンの親の postMessage は包めない）
})();
`;

// ---- 本物の claude.ai の応答ヘッダと同じ形（2026-10-09 に取った実物。uuid と nonce だけ自分の枠に合わせた） ----
// extraFrameSrc: /withother の親ページだけ、frame-src に別ホストの iframe の origin を足す（本物の CSP は枠の origin しか許さないので、
// 別ホストの iframe を置くための試験の都合。送り先の判定は bridge.js の側の話で、CSP が止めるかは見ていない）
function parentHeaders(extraFrameSrc) {
  const FO = 'https://' + FRAME_HOST;                              // 枠の origin（permissions-policy・connect-src はこれだけ）
  const F = FO + (extraFrameSrc ? ' ' + extraFrameSrc : '');       // frame-src
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'content-security-policy': "frame-ancestors 'self' chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn chrome-extension://dngcpimnedloihjnnfngkgjoidhnaolf; " +
      'frame-src ' + F + "; script-src 'nonce-" + NONCE + "' 'self' 'wasm-unsafe-eval' a-cdn.claude.ai assets.claude.ai assets-proxy.anthropic.com a-cdn.anthropic.com s-cdn.anthropic.com; " +
      "style-src 'nonce-" + NONCE + "'; connect-src 'self' https://" + FRAME_HOST + "; base-uri 'none'; object-src 'none'; form-action 'none'",
    'cross-origin-opener-policy': 'same-origin-allow-popups',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'accelerometer=(self "' + FO + '"), attribution-reporting=*, autoplay=(self "https://www.youtube-nocookie.com"), bluetooth=self, browsing-topics=*, ' +
      'camera=(self "' + FO + '"), clipboard-read=self, compute-pressure=self, display-capture=(self "' + FO + '"), encrypted-media=self, geolocation=(self "' + FO + '"), ' +
      'gyroscope=(self "' + FO + '"), hid=self, identity-credentials-get=self, idle-detection=self, local-fonts=self, magnetometer=(self "' + FO + '"), ' +
      'microphone=(self "' + FO + '"), midi=(self "' + FO + '"), otp-credentials=self, picture-in-picture=*, publickey-credentials-create=self, publickey-credentials-get=self, ' +
      'serial=self, storage-access=*, unload=(), usb=self, web-share=self, window-management=self',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'x-content-type-options': 'nosniff'
  };
}
// 親ページの中身。本物に似せて最小限: nonce 付きの style 1 つと枠の iframe 1 つ（allow 属性は付けない＝推測。上の頭）
// mode: 'frame'（kiku の枠 1 つ）・'plain'（iframe 無し）・'withother'（kiku の枠は無く、about:blank の iframe と別ホストの iframe だけ）
function parentHtml(mode) {
  // iframe の大きさも nonce 付きの style に書く（style 属性は style-src nonce の下では断られ、枠が 300×150 の既定の大きさになる）
  let body;
  if (mode === 'frame') body = '<iframe id="f" src="https://' + FRAME_HOST + '/artifact_wrapped.html"></iframe>';
  else if (mode === 'withother') body = '<p>kiku の枠は無い</p><iframe id="blank" src="about:blank"></iframe><iframe id="other" src="https://' + OTHER_HOST + '/other.html"></iframe>';
  else body = '<p>枠の無いページ</p>';
  return '<!doctype html><html><head><meta charset="utf-8"><title>artifact</title><style nonce="' + NONCE + '">body{margin:0;background:#f4f4f4}#f{display:block;width:1280px;height:900px;border:0}</style></head><body>' +
    body + '</body></html>';
}
// 別ホストの iframe の中身。届いた message を全部 __got に記録する（CSP は付けないので inline script が動く）
const OTHER_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>other</title><script>globalThis.__got = []; window.addEventListener("message", function (ev) { const d = ev && ev.data; globalThis.__got.push({ kind: d && d.kind, source: d && d.source, origin: ev.origin }); });</script></head><body><p>別ホストの iframe</p></body></html>';

// ---- https サーバー（自己署名。443 が取れれば 443、取れなければ空いている口を使い、MAP に口を書く） ----
function makeCert() {
  const key = path.join(OUT, 'key.pem'), cert = path.join(OUT, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', key, '-out', cert, '-subj', '/CN=claude.ai',
    '-addext', 'subjectAltName=DNS:claude.ai,DNS:*.frame.claudeusercontent.com,DNS:' + OTHER_HOST], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}
function serve(wrapped) {
  const srv = https.createServer(makeCert(), function (req, res) {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    const url = String(req.url || '');
    if (host === 'claude.ai' && url.indexOf('/artifact/') === 0) { res.writeHead(200, parentHeaders()); res.end(parentHtml('frame')); return; }
    if (host === 'claude.ai' && url.indexOf('/plain') === 0) { res.writeHead(200, parentHeaders()); res.end(parentHtml('plain')); return; }
    if (host === 'claude.ai' && url.indexOf('/withother') === 0) { res.writeHead(200, parentHeaders('https://' + OTHER_HOST)); res.end(parentHtml('withother')); return; }
    if (host === FRAME_HOST && url.indexOf('/artifact_wrapped.html') === 0) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(wrapped); return; }
    if (host === OTHER_HOST && url.indexOf('/other.html') === 0) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(OTHER_HTML); return; }
    if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }   // ブラウザが勝手に取りに来る。404 の console error を出さないため
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('無い: ' + host + url);
  });
  return new Promise(function (resolve) {
    srv.once('error', function () { srv.removeAllListeners('error'); srv.listen(0, '127.0.0.1', function () { resolve({ srv: srv, port: srv.address().port }); }); });
    srv.listen(443, '127.0.0.1', function () { srv.removeAllListeners('error'); resolve({ srv: srv, port: 443 }); });
  });
}

// ---- 操作部（shadow DOM）の読み方。ページの主の世界から読む（shadow root は open） ----
const UI_SRC = 'function(){ const h = document.getElementById("kiku-bridge-host"); if (!h || !h.shadowRoot) return null; const r = h.shadowRoot;' +
  ' const ds = Array.from(r.querySelectorAll(".box > div")).map(function (d) { return d.textContent; });' +
  ' return { title: (r.querySelector(".box > b") || {}).textContent || "", where: ds[0] || "", hello: ds[1] || "", status: ds[2] || "", interim: ds[3] || "", share: ds[4] || "", pending: ds[5] || "",' +
  '   buttons: Array.from(r.querySelectorAll("button")).map(function (b) { return { text: b.textContent, shown: b.style.display !== "none", disabled: b.disabled }; }) }; }';
function readUI(page) { return page.evaluate('(' + UI_SRC + ')()'); }
// 親ページの操作部の文を条件が満たされるまで待つ。cond は u（readUI の返り値）を見る式の文字列で、node の側で評価する。
// playwright の waitForFunction は使えない——本物と同じ script-src（'unsafe-eval' 無し）の親ページでは、waitForFunction が
// ページの中で predicate を eval するので EvalError で落ちる（文字列でも関数でも。実測）。evaluate（CDP）は CSP に掛からないので、
// 100 ミリ秒ごとに evaluate で読んで node の側で判定する。満たされなければ最後に読んだ値を添えて投げる
async function waitUI(page, cond, timeout) {
  const f = new Function('u', 'return (' + cond + ');');
  const until = Date.now() + (timeout || 10000);
  let u = null;
  while (Date.now() < until) {
    u = await readUI(page);
    if (u && f(u)) return u;
    await page.waitForTimeout(100);
  }
  throw new Error('待ちきれなかった（' + cond + '）。最後に読んだ: ' + JSON.stringify(u));
}
// 操作部の文の変わり目を時刻つきで残す（主の世界の MutationObserver。落ちたとき何がいつ出たかを detail に出すため）
const TRACE_SRC = 'function(){ const h = document.getElementById("kiku-bridge-host"); if (!h || !h.shadowRoot || globalThis.__kikuUiLog) return false;' +
  ' const L = globalThis.__kikuUiLog = []; const t0 = Date.now(); const read = (' + UI_SRC + ');' +
  ' let last = ""; const mo = new MutationObserver(function () { const u = read(); const k = u ? u.status + " | " + u.hello : ""; if (k !== last) { last = k; L.push([Date.now() - t0, k]); } });' +
  ' mo.observe(h.shadowRoot, { subtree: true, childList: true, characterData: true }); return true; }';
function readTrace(page) { return page.evaluate('(globalThis.__kikuUiLog || []).map(function (x) { return x[0] + "ms " + x[1]; }).join(" / ")').catch(function () { return ''; }); }
// 操作部はふだん隠れている（出るのは、聞いている間・画面共有を選んでいる間・溜めがある間・誤りや枠のボタンから始められなかった後・
// 承知を求めている間だけ）。試験では、押す前に隠れていれば出しておく（本物で操作部を押すのは、それが出ているときだけ）
const SHOW_HOST = '(function(){ const h = document.getElementById("kiku-bridge-host"); if (h && h.style.display === "none") { h.style.display = ""; return true; } return false; })()';
async function clickButton(page, text) {
  await page.evaluate(SHOW_HOST);
  await page.locator('#kiku-bridge-host button', { hasText: text }).first().click({ timeout: 5000 });
}
// 「橋: 画面共有の音を枠へ」を押し、承知のボタンが出ればそれも押す（この PC の中で文字にできないとき）。押した道筋を返す
async function pressStart(page) {
  await clickButton(page, '橋: 画面共有の音を枠へ');
  const u = await readUI(page);
  const consent = u.buttons.find(function (b) { return /承知して始める/.test(b.text); });
  let how;
  if (consent && consent.shown) { await clickButton(page, '承知して始める'); how = '承知のボタンを押して始めた（' + u.status + '）'; }
  else how = '承知なしで始めた（' + u.where + '）';
  // begin() は押した操作の中で同期に「画面共有を選んでいる…」を出す。それが見えるまで待ってから返す（押した直後に読むと前の文が残っていることがある）
  await waitUI(page, '/画面共有を選んでいる/.test(u.status) || /枠が見つからない|画面共有|音声認識|聞いている/.test(u.status + u.hello)', 3000).catch(function () {});
  return how;
}

// ---- content script の世界（isolated world）に CDP で入る ----
async function attachWorlds(ctx, page) {
  const sess = await ctx.newCDPSession(page);
  const worlds = new Map();
  sess.on('Runtime.executionContextCreated', function (e) { worlds.set(e.context.id, e.context); });
  sess.on('Runtime.executionContextDestroyed', function (e) { worlds.delete(e.executionContextId); });
  sess.on('Runtime.executionContextsCleared', function () { worlds.clear(); });
  await sess.send('Runtime.enable');
  async function evalIn(id, expression) {
    const r = await sess.send('Runtime.evaluate', { contextId: id, expression: expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('世界の中で投げた: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  }
  // KIKU_BRIDGE を持つ isolated world を探す（playwright 自身の utility world や枠の世界は持たない）。無ければ null
  async function findBridge() {
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      for (const c of Array.from(worlds.values())) {
        const a = c.auxData || {};
        if (a.isDefault || a.type !== 'isolated') continue;
        try { if ((await evalIn(c.id, 'typeof globalThis.KIKU_BRIDGE === "object" && globalThis.KIKU_BRIDGE !== null')) === true) return c; } catch (e) { /* 消えた世界 */ }
      }
      await page.waitForTimeout(100);
    }
    return null;
  }
  async function mainFrameId() { const t = await sess.send('Page.getFrameTree'); return t.frameTree.frame.id; }
  return { sess: sess, worlds: worlds, evalIn: evalIn, findBridge: findBridge, mainFrameId: mainFrameId,
    list: function () { return Array.from(worlds.values()).map(function (c) { const a = c.auxData || {}; return { id: c.id, name: c.name, type: a.type, isDefault: a.isDefault, frameId: a.frameId }; }); } };
}

// ---- isolated world に置く差し替え（getDisplayMedia → 本物の MediaStream、SpeechRecognition → 偽の認識） ----
const REPLACE_SRC = `
(function () {
  const F = globalThis.__kikuExtFake = { starts: [], stops: 0, aborts: 0, created: 0, gdmCalls: [], availableAsked: null, fired: [], t0: Date.now() };
  function row(text, final) { const r = [{ transcript: text, confidence: 1 }]; r.isFinal = !!final; return r; }
  function FakeSR() {
    this.lang = ''; this.continuous = false; this.interimResults = false; this.processLocally = false;
    this.onstart = null; this.onresult = null; this.onerror = null; this.onend = null;
    this._timers = []; this._alive = false; this._results = [];
    F.created++;
  }
  FakeSR.available = function (o) { F.availableAsked = o; return Promise.resolve('unavailable'); };
  FakeSR.prototype.start = function (track) {
    const self = this;
    F.starts.push({ argIsTrack: !!(track && typeof track.readyState === 'string'), kind: track ? track.kind : null, readyState: track ? track.readyState : null, live: !!(track && track.readyState === 'live'),
      lang: this.lang, continuous: this.continuous, interimResults: this.interimResults, processLocally: this.processLocally });
    this._alive = true;
    function at(ms, f) { self._timers.push(setTimeout(function () { if (self._alive) f(); }, ms)); }
    // 音の診断の試験（F.probeMode）: この PC の中で、画面共有の音のトラックそのものを渡されたときだけ、私用 PC の実走と同じく
    // 「aborted」で止まる（16kHz に直したトラックと、サーバーへ送る形は、ふだんどおり 3 発話を返す）
    if (F.probeMode && this.processLocally && track === F.track) {
      at(50, function () { F.fired.push([Date.now() - F.t0, 'error aborted']); if (self.onerror) self.onerror({ error: 'aborted', message: '' }); });
      at(60, function () { self._end(); });
      return;
    }
    function emitRes(idx) { F.fired.push([Date.now() - F.t0, 'result' + idx]); if (self.onresult) self.onresult({ resultIndex: idx, results: self._results.slice() }); }
    at(60, function () { F.fired.push([Date.now() - F.t0, 'onstart']); if (self.onstart) self.onstart({}); });
    at(200, function () { self._results[0] = row('一つ目の途中', false); emitRes(0); });
    at(400, function () { self._results[0] = row('一つ目の発話', true); emitRes(0); });
    at(600, function () { self._results[1] = row('二つ目の発話', true); emitRes(1); });
    at(800, function () { self._results[2] = row('三つ目の発話', true); emitRes(2); });
  };
  FakeSR.prototype._end = function () {
    this._timers.forEach(clearTimeout); this._timers = [];
    if (!this._alive) return;
    this._alive = false;
    const self = this;
    setTimeout(function () { F.fired.push([Date.now() - F.t0, 'onend']); if (self.onend) self.onend({}); }, 30);
  };
  FakeSR.prototype.stop = function () { F.stops++; F.fired.push([Date.now() - F.t0, 'stop()']); this._end(); };
  FakeSR.prototype.abort = function () { F.aborts++; this._end(); };
  globalThis.SpeechRecognition = FakeSR;
  globalThis.webkitSpeechRecognition = FakeSR;
  const ac = new AudioContext();
  // 呼ばれるたびに新しい stream を作る（止めるとトラックが ended になり、同じ stream では 2 回目が「画面共有が止まっている」で断られる）。
  // F.stream・F.track は最後に渡したもの
  function freshStream() {
    const dest = ac.createMediaStreamDestination();
    const osc = ac.createOscillator(); osc.connect(dest); osc.start();
    F.stream = dest.stream; F.track = dest.stream.getAudioTracks()[0];
    return F.stream;
  }
  freshStream();
  navigator.mediaDevices.getDisplayMedia = function (c) { F.gdmCalls.push(c); return Promise.resolve(F.gdmCalls.length === 1 ? F.stream : freshStream()); };
  return { trackKind: F.track.kind, trackState: F.track.readyState, label: F.track.label, isMediaStream: F.stream instanceof MediaStream };
})()
`;

(async function main() {
  const killer = setTimeout(function () { check('時間', TOTAL_MS / 1000 + ' 秒以内に終わった', false, '打ち切った'); finish(1); }, TOTAL_MS);
  const art = fs.readFileSync(path.join(KIT, 'kiku-artifact.html'), 'utf8');
  const wrapped = '<!doctype html><html><head><meta charset="utf-8"><script>' + FAKE + '</script></head><body>' + art + '</body></html>';
  fs.writeFileSync(path.join(OUT, 'artifact_wrapped.html'), wrapped);
  check('形', '拡張のフォルダに manifest.json・bridge.js・intake.js がある', ['manifest.json', 'bridge.js', 'intake.js'].every(function (f) { return fs.existsSync(path.join(EXT, f)); }), EXT);

  const { srv, port } = await serve(wrapped);
  const mapTo = '127.0.0.1' + (port === 443 ? '' : ':' + port);
  fact('https サーバーの口', port === 443 ? '443（MAP に口は書かない）' : String(port) + '（443 が取れず、MAP に口を書いた）');
  const userDataDir = fs.mkdtempSync(path.join(OUT, 'profile-'));
  const launch = {
    headless: HEADLESS, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 },
    args: [
      '--disable-extensions-except=' + EXT, '--load-extension=' + EXT,
      '--host-resolver-rules=MAP claude.ai ' + mapTo + ', MAP *.claudeusercontent.com ' + mapTo + ', MAP ' + OTHER_HOST + ' ' + mapTo,
      '--ignore-certificate-errors', '--no-proxy-server',
      '--auto-select-desktop-capture-source=Entire screen', '--use-fake-ui-for-media-stream'
    ]
  };
  if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
  const ctx = await chromium.launchPersistentContext(userDataDir, launch);
  fact('Chromium', (await ctx.browser() ? ctx.browser().version() : '') + (HEADLESS ? '（headless）' : '（headed）'));

  // 誤りの集め（ページごと。console の error と pageerror。CSP の件は分けて数える）
  const errs = { page: [], csp: [] };
  function watch(p, label) {
    p.on('pageerror', function (e) { errs.page.push(label + ': ' + String(e && e.message || e)); });
    p.on('console', function (m) {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/Refused to apply inline style|Content Security Policy/.test(t)) errs.csp.push(label + ': ' + t); else errs.page.push(label + ': ' + t);
    });
  }
  const page = ctx.pages()[0] || await ctx.newPage();
  watch(page, '親');
  const W = await attachWorlds(ctx, page);

  // ---------- (読み込み) ----------
  await page.goto('https://claude.ai/artifact/' + ART_ID, { waitUntil: 'load' });
  const tLoad = Date.now();
  const P = await (await page.waitForSelector('#f', { timeout: 10000 })).contentFrame();
  await P.waitForSelector('#route', { timeout: 15000, state: 'attached' });
  let hostSeen = true;
  try { await page.waitForSelector('#kiku-bridge-host', { timeout: 10000, state: 'attached' }); } catch (e) { hostSeen = false; }
  const ui0 = hostSeen ? await readUI(page) : null;
  const hostShown0 = hostSeen ? await page.evaluate('document.getElementById("kiku-bridge-host").style.display') : null;
  check('読み込み', '操作部はふだん隠れている（claude.ai のどのページにも入るので。読み込んだだけでは display:none）', hostShown0 === 'none', JSON.stringify(hostShown0));
  if (hostSeen) await page.evaluate('(' + TRACE_SRC + ')()');
  check('読み込み', '親ページに #kiku-bridge-host があり、shadow root に「橋（画面共有の音を枠へ）」', !!ui0 && /橋（画面共有の音を枠へ）/.test(ui0.title), ui0 ? ui0.title : '操作部が無い（拡張が読み込まれていないか、注入されていない）');
  const world = await W.findBridge();
  const mainId = await W.mainFrameId();
  check('読み込み', 'isolated world に KIKU_BRIDGE があり、親フレームの世界である', !!world && world.auxData && world.auxData.frameId === mainId, world ? JSON.stringify({ name: world.name, frameId: world.auxData.frameId, main: mainId }) : JSON.stringify(W.list()));
  if (!world) { await page.screenshot({ path: path.join(OUT, '1_load.png') }); srv.close(); await ctx.close(); fs.rmSync(userDataDir, { recursive: true, force: true }); clearTimeout(killer); finish(1); return; }
  const inW = function (expr) { return W.evalIn(world.id, expr); };
  const rt = await inW('(function(){ const c = globalThis.chrome; return { id: c && c.runtime ? c.runtime.id : null, type: typeof (c && c.runtime && c.runtime.id), intake: typeof globalThis.TSV_INTAKE, bridge: typeof globalThis.KIKU_BRIDGE }; })()');
  check('読み込み', 'isolated world で chrome.runtime.id が文字列、TSV_INTAKE がある', rt.type === 'string' && rt.intake === 'object', JSON.stringify(rt));
  fact('isolated world の名前と拡張の id', JSON.stringify({ worldName: world.name, runtimeId: rt.id }));
  // 調べている途中（where が checking の文）なら「橋: 画面共有の音を枠へ」は押せない。終わっていれば押せる（最初に読んだ瞬間の関係を見る。どちらの瞬間でも判定が立つ）
  {
    const sb = ui0.buttons.find(function (b) { return b.text === '橋: 画面共有の音を枠へ'; });
    const checking = /調べている/.test(ui0.where);
    check('読み込み', '「橋: 画面共有の音を枠へ」は、調べている途中（「…調べている…」）なら disabled、終わっていれば押せる', !!sb && sb.disabled === checking, JSON.stringify({ where: ui0.where, disabled: sb ? sb.disabled : null }));
    const uAfter = await waitUI(page, '!/調べている/.test(u.where)', 10000).catch(function () { return null; });
    const sb2 = uAfter ? uAfter.buttons.find(function (b) { return b.text === '橋: 画面共有の音を枠へ'; }) : null;
    check('読み込み', '調べ終わると「橋: 画面共有の音を枠へ」が押せる（disabled が外れる）', !!uAfter && !!sb2 && sb2.disabled === false, uAfter ? JSON.stringify({ where: uAfter.where, disabled: sb2 ? sb2.disabled : null }) : '調べ終わらなかった');
  }
  await page.screenshot({ path: path.join(OUT, '1_load.png') });

  // ---------- (範囲) ----------
  // 「無い」を見るのは load の後に ABSENCE_WAIT_MS 以上置いてから（親の load からここまでの時間を差し引いて待つ）
  await page.waitForTimeout(Math.max(0, ABSENCE_WAIT_MS - (Date.now() - tLoad)));
  const sinceLoad = Date.now() - tLoad;
  const frameHasHost = await P.evaluate(function () { return !!document.getElementById('kiku-bridge-host'); });
  check('範囲', '枠の document には #kiku-bridge-host が無い（all_frames: false。親の load の ' + ABSENCE_WAIT_MS + ' ミリ秒以上後に見た）', frameHasHost === false && sinceLoad >= ABSENCE_WAIT_MS, 'ある=' + frameHasHost + '（load から ' + sinceLoad + ' ミリ秒）');
  {
    const p2 = await ctx.newPage(); watch(p2, '枠を最上位で');
    await p2.goto('https://' + FRAME_HOST + '/artifact_wrapped.html', { waitUntil: 'load' });
    const t2 = Date.now();
    await p2.waitForSelector('#route', { timeout: 15000, state: 'attached' });
    await p2.waitForTimeout(Math.max(0, ABSENCE_WAIT_MS - (Date.now() - t2)));
    const since2 = Date.now() - t2;
    const has = await p2.evaluate(function () { return !!document.getElementById('kiku-bridge-host'); });
    check('範囲', '枠の URL を最上位で開いても注入されない（matches は claude.ai だけ。load の ' + ABSENCE_WAIT_MS + ' ミリ秒以上後に見た）', has === false && since2 >= ABSENCE_WAIT_MS, 'ある=' + has + '（load から ' + since2 + ' ミリ秒）');
    await p2.screenshot({ path: path.join(OUT, '2_frame_top.png') });
    await p2.close();
  }
  {
    const p3 = await ctx.newPage(); watch(p3, 'iframe の無い claude.ai');
    await p3.goto('https://claude.ai/plain', { waitUntil: 'load' });
    let ok3 = true;
    try { await p3.waitForSelector('#kiku-bridge-host', { timeout: 10000, state: 'attached' }); } catch (e) { ok3 = false; }
    check('範囲', 'iframe の無い claude.ai のページにも注入される', ok3);
    if (ok3) {
      await waitUI(p3, '!/調べている/.test(u.where)', 10000).catch(function () {});
      const how = await pressStart(p3);
      await waitUI(p3, 'u.hello !== ""', 5000).catch(function () {});
      const u3 = await readUI(p3);
      check('範囲', 'iframe の無いページで橋を押すと hello は「枠が見つからない」', /枠が見つからない/.test(u3.hello), u3.hello + ' / ' + how);
      const t3 = Date.now();
      await waitUI(p3, '!/画面共有を選んでいる/.test(u.status)', 20000).catch(function () {});
      fact('iframe の無いページで素の getDisplayMedia を呼んだ後の status（待った秒）', (await readUI(p3)).status + '（' + ((Date.now() - t3) / 1000).toFixed(1) + ' 秒）');
    }
    await p3.screenshot({ path: path.join(OUT, '2_plain.png') });
    await p3.close();
  }

  // ---------- (送り先) kiku の枠が無く、about:blank の iframe と別ホストの iframe だけがある claude.ai のページ ----------
  {
    const p4 = await ctx.newPage(); watch(p4, '枠の無い iframe だけ');
    const W4 = await attachWorlds(ctx, p4);
    await p4.goto('https://claude.ai/withother', { waitUntil: 'load' });
    let ok4 = true;
    try { await p4.waitForSelector('#kiku-bridge-host', { timeout: 10000, state: 'attached' }); } catch (e) { ok4 = false; }
    check('送り先', 'kiku の枠が無い claude.ai のページにも注入される', ok4);
    const other = p4.frames().find(function (f) { return f.url().indexOf('https://' + OTHER_HOST + '/') === 0; });
    // about:blank の iframe は親と同じ origin。親の窓にも受け口を置き、橋が親や about:blank に送っていないかを見る（evaluate は CSP に掛からない）
    let hooked = null;
    try {
      hooked = await p4.evaluate(function () {
        const w = document.getElementById('blank').contentWindow;
        w.__got = []; w.addEventListener('message', function (ev) { const d = ev && ev.data; w.__got.push({ kind: d && d.kind, source: d && d.source, origin: ev.origin }); });
        globalThis.__topGot = []; window.addEventListener('message', function (ev) { const d = ev && ev.data; if (d && d.source === 'kiku-bridge') globalThis.__topGot.push({ kind: d.kind, origin: ev.origin }); });
        return { blankHref: w.location.href, iframes: document.querySelectorAll('iframe').length };
      });
    } catch (e) { hooked = { error: String(e && e.message || e) }; }
    check('送り先', 'about:blank の iframe（親と同じ origin）と親の窓に message の受け口を置けた。別ホストの iframe も読み込めた', !!hooked && hooked.blankHref === 'about:blank' && hooked.iframes === 2 && !!other, JSON.stringify(hooked) + ' other=' + (other ? other.url() : 'なし'));
    if (ok4 && hooked && !hooked.error && other) {
      const world4 = await W4.findBridge();
      check('送り先', 'isolated world に KIKU_BRIDGE がある', !!world4, world4 ? world4.name : JSON.stringify(W4.list()));
      if (world4) {
        await waitUI(p4, '!/調べている/.test(u.where)', 10000).catch(function () {});
        const rep4 = await W4.evalIn(world4.id, REPLACE_SRC);
        check('送り先', 'isolated world に live な音のトラックと偽の認識を置けた', rep4.isMediaStream && rep4.trackState === 'live', JSON.stringify(rep4));
        const how = await pressStart(p4);
        let u4 = null, waitErr = '';
        try { u4 = await waitUI(p4, 'u.pending === ' + JSON.stringify(pendingText(3)), 8000); } catch (e) { waitErr = String(e && e.message || e).split('\n')[0]; u4 = await readUI(p4); }
        check('送り先', 'hello は「枠が見つからない（kiku のアーティファクトを開いてから押す）」（about:blank・別ホストの iframe は枠に数えない）', u4.hello === HELLO_NONE, u4.hello + ' / ' + how);
        check('送り先', '偽の認識の確定 3 件は送られず、操作部に PENDING「…（3 件。…）」', u4.pending === pendingText(3), u4.pending + (waitErr ? ' ／ 待ちの誤り: ' + waitErr : ''));
        check('送り先', '操作部の status は認識の始まりの文「聞いている（画面共有の音。…）」、SHARE は「共有中…」', /聞いている（画面共有の音/.test(u4.status) && /^共有中/.test(u4.share), u4.status + ' / ' + u4.share);
        // 送る先が無いので、2 秒ごとの hello が何度か鳴った後に見る（1 周期以上）
        await p4.waitForTimeout(BRIDGE.HELLO_PERIOD_MS + 500);
        const got = await p4.evaluate(function () { return { blank: document.getElementById('blank').contentWindow.__got, top: globalThis.__topGot }; });
        const otherGot = await other.evaluate(function () { return globalThis.__got; });
        check('送り先', 'about:blank の iframe・別ホストの iframe・親の窓のどれにも hello・lines・status が 1 件も届かない（targetOrigin は枠の origin だけ）', got.blank.length === 0 && otherGot.length === 0 && got.top.length === 0, JSON.stringify({ blank: got.blank, other: otherGot, top: got.top }));
        const helloN = await W4.evalIn(world4.id, 'globalThis.__kikuExtFake.gdmCalls.length');
        fact('枠の無いページで getDisplayMedia が呼ばれた回数', helloN);
        // 止めても溜めた分は残る（枠が居ないので流せない）
        await clickButton(p4, '止める');
        let stopErr4 = '';
        try { await waitUI(p4, 'u.status === "止めた"', 8000); } catch (e) { stopErr4 = String(e && e.message || e).split('\n')[0]; }
        const u4b = await readUI(p4);
        check('送り先', '止めた後も溜めた 3 件は残り（PENDING のまま）、SHARE は消える', !stopErr4 && u4b.status === '止めた' && u4b.pending === pendingText(3) && u4b.share === '', JSON.stringify({ status: u4b.status, pending: u4b.pending, share: u4b.share }) + (stopErr4 ? ' ／ ' + stopErr4 : ''));
        const got2 = await p4.evaluate(function () { return document.getElementById('blank').contentWindow.__got.length + globalThis.__topGot.length; });
        const otherGot2 = await other.evaluate(function () { return globalThis.__got.length; });
        check('送り先', '止めたときの status も、about:blank・別ホスト・親の窓には届かない', got2 === 0 && otherGot2 === 0, 'blank+top=' + got2 + ' other=' + otherGot2);
      }
    }
    await p4.screenshot({ path: path.join(OUT, '2_withother.png') });
    await p4.close();
  }
  await page.bringToFront();
  fact('親ページの visibilityState（他のページを閉じた後）', await page.evaluate('document.visibilityState'));

  // ---------- (CSP) ----------
  {
    const st = await page.evaluate(function () {
      const h = document.getElementById('kiku-bridge-host'); const box = h.shadowRoot.querySelector('.box');
      const cs = getComputedStyle(box);
      return { bg: cs.backgroundColor, font: cs.fontSize, border: cs.borderTopStyle, hostPos: getComputedStyle(h).position, styleSheets: h.shadowRoot.styleSheets.length,
        cssRules: (function () { try { return h.shadowRoot.styleSheets[0].cssRules.length; } catch (e) { return 'read failed'; } })() };
    });
    const styled = st.bg === 'rgb(255, 255, 255)' && st.font === '12px' && st.hostPos === 'fixed';
    check('CSP', "style-src 'nonce-…' の親ページで操作部の見た目が効く（.box の background-color が白・font-size 12px・host が fixed）", styled, JSON.stringify(st));
    check('CSP', 'コンソールに CSP 違反（Refused to apply inline style）が無い', errs.csp.length === 0, errs.csp.length + ' 件: ' + errs.csp.join(' | ').slice(0, 400));
    fact('CSP 違反のコンソールの件数', errs.csp.length);
    await page.screenshot({ path: path.join(OUT, '3_csp.png') });
  }

  // ---------- (環境) ----------
  {
    const e1 = await inW('(function(){ const SR = globalThis.SpeechRecognition, WK = globalThis.webkitSpeechRecognition; const C = SR || WK;' +
      ' return { SpeechRecognition: typeof SR, webkitSpeechRecognition: typeof WK, available: !!(C && typeof C.available === "function"), install: !!(C && typeof C.install === "function"),' +
      ' processLocally: !!(C && C.prototype && ("processLocally" in C.prototype)), startLength: C && C.prototype && typeof C.prototype.start === "function" ? C.prototype.start.length : null,' +
      ' getDisplayMedia: !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function"),' +
      ' fpDisplay: document.featurePolicy ? document.featurePolicy.allowsFeature("display-capture") : "featurePolicy 無し", fpMic: document.featurePolicy ? document.featurePolicy.allowsFeature("microphone") : null,' +
      ' isSecure: globalThis.isSecureContext, ua: navigator.userAgent }; })()');
    fact('親の isolated world: typeof SpeechRecognition / webkitSpeechRecognition', e1.SpeechRecognition + ' / ' + e1.webkitSpeechRecognition);
    fact('親の isolated world: available の有無 / install の有無 / "processLocally" in prototype / start.length', e1.available + ' / ' + e1.install + ' / ' + e1.processLocally + ' / ' + e1.startLength);
    fact('親の isolated world: getDisplayMedia の有無 / featurePolicy display-capture / microphone / isSecureContext', e1.getDisplayMedia + ' / ' + e1.fpDisplay + ' / ' + e1.fpMic + ' / ' + e1.isSecure);
    fact('UA', e1.ua);
    const local = await inW('globalThis.TSV_INTAKE.speechLocal()');
    fact('親の isolated world: INTAKE.speechLocal() の返り値', local);
    fact('操作部の「この PC の中で…」の文', (await readUI(page)).where);
    const e2 = await P.evaluate(function () {
      return { fpDisplay: document.featurePolicy ? document.featurePolicy.allowsFeature('display-capture') : 'featurePolicy 無し', fpMic: document.featurePolicy ? document.featurePolicy.allowsFeature('microphone') : null,
        getDisplayMedia: !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function'), origin: location.origin, inIframe: globalThis.__fake.inIframe,
        speech: document.querySelector('#intake option[value="speech"]') ? document.querySelector('#intake option[value="speech"]').disabled : null };
    });
    fact('枠: featurePolicy display-capture / microphone / getDisplayMedia の有無 / origin / iframe の中', e2.fpDisplay + ' / ' + e2.fpMic + ' / ' + e2.getDisplayMedia + ' / ' + e2.origin + ' / ' + e2.inIframe);
    const e3 = await page.evaluate(function () { return { fpDisplay: document.featurePolicy ? document.featurePolicy.allowsFeature('display-capture') : 'featurePolicy 無し', origin: location.origin }; });
    fact('親（主の世界）: featurePolicy display-capture / origin', e3.fpDisplay + ' / ' + e3.origin);
  }

  // ---------- 枠の側の下ごしらえ（設定は「設定と記録」の引き出しの中。開いてから選ぶ） ----------
  await P.evaluate(function () { document.getElementById('settings').open = true; });
  check('枠の既定', '枠の中では、音の入り方の既定が拡張「橋」', (await P.inputValue('#intake')) === 'bridge', await P.inputValue('#intake'));
  await P.selectOption('#route', 'mock');
  await P.fill('#win', '5');
  // 枠の札・状態の文
  async function frameText(id) { return P.evaluate(function (x) { const e = document.getElementById(x); return e ? e.textContent : ''; }, id); }
  async function frameNames() { return P.evaluate(function () { return globalThis.TSV_RECORD.listNames(); }); }
  async function frameSrc(name) { return P.evaluate(function (n) { const r = globalThis.TSV_RECORD.makeRecord(n); return r.load().then(function () { return r.src.filter(function (l) { return l.i != null; }); }); }, name); }
  // 素材ログへの書き込みは画面の札より遅れて入る（ブラウザ内の保存）。n 件になるまで読み直す（ms まで。届かなければ最後に読んだもの）
  async function waitSrc(name, n, ms) {
    const until = Date.now() + (ms || 8000);
    let s = await frameSrc(name);
    while (s.length < n && Date.now() < until) { await P.waitForTimeout(200); s = await frameSrc(name); }
    return s;
  }
  // 枠で「聞き取りを開始」を押す。この PC の中で文字にできないと拡張が言っている間は、表の承知の印を付けてから押す
  async function frameStart() {
    if (await P.isVisible('#bridge-cloud')) await P.check('#bridge-cloud');
    await P.click('#start');
  }
  async function waitFrame(id, re, ms) {
    try { await P.waitForFunction(function (a) { return new RegExp(a[1]).test(document.getElementById(a[0]).textContent); }, [id, re.source], { timeout: ms }); return true; } catch (e) { return false; }
  }

  // ---------- (素の画面共有) 操作部で、何も差し替えずに始める。枠はまだ聞いていない ----------
  {
    await P.fill('#name', '橋の拡張0');
    const how = await pressStart(page);
    await waitUI(page, 'u.hello !== ""', 5000).catch(function () {});
    const u = await readUI(page);
    check('素の画面共有', '枠が聞いていないときの hello は「枠が見つかった（枠で「聞き取りを開始」を押すと届く）」', u.hello === BRIDGE.helloText(true, false), u.hello + ' / ' + how);
    const t4 = Date.now();
    await waitUI(page, '!/画面共有を選んでいる/.test(u.status)', 20000).catch(function () {});
    const u2 = await readUI(page);
    fact('素の getDisplayMedia（差し替え無し）の後の操作部の status（待った秒）', u2.status + '（' + ((Date.now() - t4) / 1000).toFixed(1) + ' 秒）');
    const replies = await P.evaluate(function () { return globalThis.__fake.inbound.filter(function (m) { return m.kind === 'status'; }); });
    fact('素の試みで枠に届いた kind:status', replies);
    // 万一、素の画面共有で認識が始まってしまったら（音のトラックがあった）止めておく
    if (/聞いている（画面共有の音/.test(u2.status)) { await clickButton(page, '止める'); await waitUI(page, '/止めた/.test(u.status)', 8000).catch(function () {}); }
    else check('素の画面共有', '拡張が音を取れなかったので、枠は聞き取りを始めず、記録も開かない', !/聞いている/.test(await frameText('st-listen')) && (await frameNames()).indexOf('橋の拡張0') < 0, await frameText('st-listen'));
    await page.screenshot({ path: path.join(OUT, '4_raw_share.png') });
  }

  // ---------- (枠から始める) 枠の「聞き取りを開始」で、拡張に画面共有を始めさせる（何も差し替えない） ----------
  // xvfb の下では画面を読めずに断られる。断られ方で、枠の中のクリックが親のページの「操作の直後」に数えられたかが分かる
  // （数えられなければ getDisplayMedia は InvalidStateError で断られ、拡張は「枠のボタンからは画面共有を始められなかった…」と言う）
  {
    await P.evaluate(function () { globalThis.__fake.inbound = []; });
    await frameStart();
    const failed = await waitFrame('setupmsg', /始められませんでした/, 15000);
    const sm = await frameText('setupmsg');
    const u = await readUI(page);
    fact('枠の「聞き取りを開始」で拡張が素の画面共有を試みた後の、枠の文と操作部の status', sm + ' ／ ' + u.status);
    check('枠から始める', '枠のボタン 1 回で拡張が画面共有を試みる（操作部の status が変わる）。断られた理由は「操作の直後でない」ではない（枠のクリックが親に伝わった）', failed && !/枠のボタンからは画面共有を始められなかった/.test(sm + u.status) && u.status !== '' && !/画面共有を選んでいる/.test(u.status), sm + ' ／ ' + u.status);
    check('枠から始める', '画面共有が断られたので、枠は「始められませんでした：…」を出し、記録を開かない', failed && !/聞いている/.test(await frameText('st-listen')) && (await frameNames()).indexOf('橋の拡張0') < 0, await frameText('st-listen'));
    await page.screenshot({ path: path.join(OUT, '4b_frame_start_raw.png') });
  }

  // ---------- (差し替えて通す) 枠の「聞き取りを開始」1 回で、拡張が画面共有を始め、枠が聞き取りを始める ----------
  {
    const rep = await inW(REPLACE_SRC);
    check('差し替え', 'isolated world に本物の MediaStream（live な音のトラック）と偽の認識を置けた', rep.isMediaStream && rep.trackKind === 'audio' && rep.trackState === 'live', JSON.stringify(rep));
    await P.fill('#name', '橋の拡張');
    await P.evaluate(function () { globalThis.__fake.inbound = []; });
    const t0 = Date.now();
    await frameStart();
    const listening = await waitFrame('st-listen', /聞いている/, 10000);
    fact('枠で押してから枠が聞き取りを始めるまで（ミリ秒）', Date.now() - t0);
    const gdm = await inW('globalThis.__kikuExtFake.gdmCalls');
    check('差し替え', '枠で 1 回押すと、拡張が getDisplayMedia を 1 回（systemAudio:include・video:true）呼び、取り始めてから枠が聞き取りを始める', listening && gdm.length === 1 && gdm[0].systemAudio === 'include' && gdm[0].video === true, JSON.stringify({ listening: await frameText('st-listen'), gdm: gdm }));
    let got3 = await waitFrame('intakemsg', /届いた発話 3 件/, 10000);
    await waitUI(page, '/枠は橋から受けている/.test(u.hello)', 5000).catch(function () {});
    const u = await readUI(page);
    check('差し替え', '枠が聞いているときの hello は「枠が見つかった（枠は橋から受けている）」', u.hello === BRIDGE.helloText(true, true), u.hello);
    // bridge.js は「橋が聞き始めた（…）」を枠へ送るだけで、操作部には認識の onstart の文（intake.js の listeningText）が出る。現物に合わせる
    check('差し替え', '操作部の status が認識の始まりの文「聞いている（画面共有の音。…）」', /聞いている（画面共有の音/.test(u.status), u.status + ' ／ 変わり目: ' + await readTrace(page));
    const shareLabel = await inW('String(globalThis.__kikuExtFake.track.label || "")');
    check('差し替え', '操作部に SHARE「共有中: <共有した画面の名前>」（名前は差し替えた音のトラックの label。空なら「共有中」だけ）', u.share === (shareLabel ? '共有中: ' + shareLabel : '共有中'), u.share + ' ／ label=' + JSON.stringify(shareLabel));
    check('差し替え', '枠が聞いているので PENDING は出ない', u.pending === '', u.pending);
    const badge = await frameText('intakemsg');
    check('差し替え', '枠の札が「橋から受けている（届いた発話 3 件…）」（途中結果は数えない）', got3 && /橋から受けている（届いた発話 3 件/.test(badge), badge);
    // 枠が記録を開き終える前に届いた listening の status は捨てられ、聞き始めた返事の後に橋が送り直す。札の後ろに「。」で続く
    let gotListen = await waitFrame('intakemsg', /届いた発話 3 件）。橋が聞き始めた（/, 5000);
    const badgeL = await frameText('intakemsg');
    check('差し替え', '枠の札の後ろに listening の status の文「。橋が聞き始めた（…）」が続く', gotListen && (!shareLabel || badgeL.indexOf(shareLabel) >= 0), badgeL);
    const starts = await inW('globalThis.__kikuExtFake.starts');
    check('差し替え', '偽の認識の start に渡った引数が live な音のトラック（ja-JP・continuous・interimResults）', starts.length === 1 && starts[0].argIsTrack && starts[0].live && starts[0].kind === 'audio' && starts[0].lang === 'ja-JP' && starts[0].continuous && starts[0].interimResults, JSON.stringify(starts));
    const utt = await waitSrc('橋の拡張', 3);
    check('差し替え', '枠の素材ログに 3 発話（一つ目・二つ目・三つ目。who は無し・t は数）', utt.length === 3 && utt.map(function (l) { return l.text; }).join('/') === '一つ目の発話/二つ目の発話/三つ目の発話' && utt.every(function (l) { return l.who === null && typeof l.t === 'number'; }), JSON.stringify(utt));
    const inbound = await P.evaluate(function () { return globalThis.__fake.inbound; });
    const lm = linesOf(inbound);
    check('差し替え', '枠に届いた lines は合わせて 3 件で、どれも origin は claude.ai', lm.reduce(function (a, m) { return a + m.n; }, 0) === 3 && lm.every(function (m) { return m.origin === 'https://claude.ai'; }), JSON.stringify(lm));
    const lst = inbound.filter(function (m) { return m.kind === 'status' && m.state === 'listening'; });
    check('差し替え', '枠に kind:status の listening が届いた（枠が聞いていると橋が知る前に送った分は、返事の後に同じ文でもう 1 度届く）', (lst.length === 1 || lst.length === 2) && lst.every(function (m) { return /橋が聞き始めた/.test(m.text) && m.text === lst[0].text; }), JSON.stringify(lst));
    const s1 = await waitFrame('an-msgs', /S1 を書いた/, 15000);
    const edge = await frameText('edge');
    check('差し替え', '5 秒の窓が閉じて #an-msgs に「S1 を書いた」（橋の 3 発話が窓に入った）', s1 && /（S1）/.test(edge), edge);
    await page.screenshot({ path: path.join(OUT, '5_replaced_listening.png') });
  }

  // ---------- (枠で停止) 枠の「停止」1 回で、拡張も音を取るのをやめ、枠は最後の区切りを閉じて終える ----------
  {
    await P.click('#end');
    let stopErr = '';
    try { await waitUI(page, 'u.status === "止めた"', 8000); } catch (e) { stopErr = String(e && e.message || e).split('\n')[0]; }
    const ended = await waitFrame('st-listen', /聞き終えた/, 15000);
    const u5 = await readUI(page);
    check('枠で停止', '枠の「停止」で、操作部の status が「止めた」（操作部は押していない）', !stopErr && u5.status === '止めた', u5.status + (stopErr ? ' ／ 待ちの誤り: ' + stopErr : '') + ' ／ 変わり目: ' + await readTrace(page));
    check('枠で停止', '止めると SHARE が消え、PENDING も無い', u5.share === '' && u5.pending === '', JSON.stringify({ share: u5.share, pending: u5.pending }));
    const trackAfter = await inW('(function(){ const F = globalThis.__kikuExtFake; return { readyState: F.track.readyState, stops: F.stops, aborts: F.aborts, created: F.created, fired: F.fired.map(function (x) { return x[0] + "ms " + x[1]; }).join(" / ") }; })()');
    check('枠で停止', '差し替えた stream の音のトラックが ended（stopShare）で、偽の認識は stop が 1 回', trackAfter.readyState === 'ended' && trackAfter.stops === 1, JSON.stringify(trackAfter));
    const sm = await frameText('setupmsg');
    check('枠で停止', '枠は聞き終え（「聞き終えた」）、「停止しました。記録はこのブラウザに残っています…」を出す', ended && /^停止しました/.test(sm), JSON.stringify({ listen: await frameText('st-listen'), setupmsg: sm }));
    const utt = await frameSrc('橋の拡張');
    check('枠で停止', '止めた後も素材ログは 3 発話のまま（失わず、重ねない）', utt.length === 3, utt.length + ' 件');
    const u6 = await readUI(page);
    const startBtn = u6.buttons.find(function (b) { return /橋: 画面共有の音を枠へ/.test(b.text); });
    const stopBtn = u6.buttons.find(function (b) { return b.text === '止める'; });
    check('枠で停止', '止めた後は操作部に「橋: 画面共有の音を枠へ」が出て「止める」は押せない', !!startBtn && startBtn.shown && !!stopBtn && stopBtn.disabled, JSON.stringify(u6.buttons));
    await page.screenshot({ path: path.join(OUT, '6_stopped.png') });
  }

  // 枠に届いた kind:hello の数（橋が 2 秒ごとに繰り返しているか・止まったかを見る）
  async function helloCount() { return P.evaluate(function () { return globalThis.__fake.inbound.filter(function (m) { return m.kind === 'hello'; }).length; }); }
  function linesOf(inbound) { return inbound.filter(function (m) { return m.kind === 'lines'; }); }

  // ---------- (操作部で止める) 枠から始めた聞き取りを、操作部の「止める」（Chrome の「共有を停止」と同じ道）で止める → 枠も終える ----------
  {
    await P.fill('#name', '橋の拡張1');
    await frameStart();
    await waitFrame('st-listen', /聞いている/, 10000);
    const got3 = await waitFrame('intakemsg', /届いた発話 3 件/, 10000);
    await clickButton(page, '止める');
    let stopErr = '';
    try { await waitUI(page, 'u.status === "止めた"', 8000); } catch (e) { stopErr = String(e && e.message || e).split('\n')[0]; }
    const ended = await waitFrame('st-listen', /聞き終えた/, 15000);
    const where = await frameText('now-where');
    check('操作部で止める', '拡張の側で止めると、枠も聞き取りを終え、表の状態の行に「画面の共有が止まったので、聞き取りを終えました」', got3 && !stopErr && ended && where === '画面の共有が止まったので、聞き取りを終えました', JSON.stringify({ got3: got3, listen: await frameText('st-listen'), where: where }) + (stopErr ? ' ／ ' + stopErr : ''));
    const utt = await waitSrc('橋の拡張1', 3);
    check('操作部で止める', '止める前に確定した 3 発話は、枠の素材ログに全部入る', utt.length === 3 && utt.map(function (l) { return l.text; }).join('/') === '一つ目の発話/二つ目の発話/三つ目の発話', JSON.stringify(utt));
    await page.screenshot({ path: path.join(OUT, '6b_stopped_by_panel.png') });
  }

  // ---------- (操作部から始める) 枠のボタンを使わず、操作部の「橋: 画面共有の音を枠へ」で始める → 枠は自分で聞き取りを始める ----------
  {
    await P.fill('#name', '橋の拡張2');
    await P.evaluate(function () { globalThis.__fake.inbound = []; });
    const t0 = Date.now();
    const how = await pressStart(page);
    const listening = await waitFrame('st-listen', /聞いている/, 10000);
    const got3 = await waitFrame('intakemsg', /届いた発話 3 件/, 10000);
    const ms = Date.now() - t0;
    fact('操作部で押してから、枠の札に 3 件が出るまでの時間（ミリ秒）', ms);
    const utt = await waitSrc('橋の拡張2', 3);
    check('操作部から始める', '操作部で始めても、枠が「橋の拡張2」の記録を開いて聞き取りを始め、3 発話が送った順で入る', listening && got3 && utt.length === 3 && utt.map(function (l) { return l.text; }).join('/') === '一つ目の発話/二つ目の発話/三つ目の発話', JSON.stringify({ listen: await frameText('st-listen'), utt: utt }) + ' / ' + how);
    await waitUI(page, '/枠は橋から受けている/.test(u.hello) && u.pending === ""', 5000).catch(function () {});
    const u2 = await readUI(page);
    check('操作部から始める', '流れた後は PENDING が無く、hello が「枠が見つかった（枠は橋から受けている）」', u2.pending === '' && u2.hello === BRIDGE.helloText(true, true), JSON.stringify({ pending: u2.pending, hello: u2.hello }));
    await page.screenshot({ path: path.join(OUT, '8_started_from_panel.png') });
    // 枠の「停止」で両方止まる
    await P.click('#end');
    await waitUI(page, 'u.status === "止めた"', 8000).catch(function () {});
    const ended = await waitFrame('st-listen', /聞き終えた/, 15000);
    const u3 = await readUI(page);
    check('操作部から始める', '枠の「停止」で、拡張も止まり（「止めた」）、溜めも無い', ended && u3.status === '止めた' && u3.pending === '', JSON.stringify({ status: u3.status, pending: u3.pending, listen: await frameText('st-listen') }));
  }

  // ---------- (残る溜め) 枠の入口が「打つ／貼る」のときに操作部で始める → 枠は聞かず、橋は溜める。止めても溜めは残り、
  // 枠の入口を「橋」に戻して「聞き取りを開始」を押すと、溜めた分から先に流れる ----------
  {
    await P.selectOption('#intake', 'text');
    await P.fill('#name', '橋の拡張3');
    await P.evaluate(function () { globalThis.__fake.inbound = []; });
    const how = await pressStart(page);
    let u = null, waitErr = '';
    try { u = await waitUI(page, 'u.pending === ' + JSON.stringify(pendingText(3)), 8000); } catch (e) { waitErr = String(e && e.message || e).split('\n')[0]; u = await readUI(page); }
    check('残る溜め', '枠が聞いていないあいだに 3 件溜まり、hello は「枠で「聞き取りを開始」を押すと届く」', u.pending === pendingText(3) && u.hello === BRIDGE.helloText(true, false), JSON.stringify({ pending: u.pending, hello: u.hello }) + (waitErr ? ' ／ 待ちの誤り: ' + waitErr : '') + ' / ' + how);
    check('残る溜め', '枠の入口が「打つ／貼る」なので、枠は聞き取りを始めない', !/聞いている/.test(await frameText('st-listen')) && (await frameNames()).indexOf('橋の拡張3') < 0, await frameText('st-listen'));
    await clickButton(page, '止める');
    let stopErr = '';
    try { await waitUI(page, 'u.status === "止めた"', 8000); } catch (e) { stopErr = String(e && e.message || e).split('\n')[0]; }
    const u2 = await readUI(page);
    check('残る溜め', '橋を止めても溜めた 3 件は残り（PENDING のまま）、SHARE は消え、「止める」は押せない', !stopErr && u2.status === '止めた' && u2.pending === pendingText(3) && u2.share === '' && u2.buttons.some(function (b) { return b.text === '止める' && b.disabled; }), JSON.stringify({ status: u2.status, pending: u2.pending, share: u2.share }) + (stopErr ? ' ／ ' + stopErr : ''));
    const inb1 = await P.evaluate(function () { return globalThis.__fake.inbound; });
    check('残る溜め', '止めるまでに枠へ lines は届いていない', linesOf(inb1).length === 0, JSON.stringify(inb1));
    // 溜めがある間は、止めた後も hello が 2 秒ごとに続く
    const h1 = await helloCount();
    await page.waitForTimeout(BRIDGE.HELLO_PERIOD_MS + 500);
    const h2 = await helloCount();
    check('残る溜め', '止めた後も、溜めがある間は hello が続く（' + (BRIDGE.HELLO_PERIOD_MS + 500) + ' ミリ秒で増える）', h2 > h1, h1 + ' → ' + h2);
    // 枠の入口を「橋」に戻して始める → 拡張が新しく画面共有を始め、溜めた 3 件が先に、新しい 3 件が後に流れる
    await P.selectOption('#intake', 'bridge');
    await frameStart();
    await waitFrame('st-listen', /聞いている/, 10000);
    const got6 = await waitFrame('intakemsg', /届いた発話 6 件/, 10000);
    const utt = await waitSrc('橋の拡張3', 6);
    const u3 = await readUI(page);
    check('残る溜め', '溜めた 3 件が先に、新しく取った 3 件が後に、枠の素材ログに入る。PENDING は消える', got6 && utt.length === 6 && utt.map(function (l) { return l.text; }).join('/') === '一つ目の発話/二つ目の発話/三つ目の発話/一つ目の発話/二つ目の発話/三つ目の発話' && u3.pending === '', JSON.stringify({ utt: utt.map(function (l) { return l.text; }), pending: u3.pending, badge: await frameText('intakemsg') }));
    await page.screenshot({ path: path.join(OUT, '9_pending_after_stop.png') });
    await P.click('#end');
    await waitUI(page, 'u.status === "止めた"', 8000).catch(function () {});
    await waitFrame('st-listen', /聞き終えた/, 15000);
    // 溜めが無くなり橋も止まっているので、hello は止まる（枠に届く hello の数が増えない）
    await page.waitForTimeout(BRIDGE.HELLO_PERIOD_MS + 500);
    const h3 = await helloCount();
    await page.waitForTimeout(BRIDGE.HELLO_PERIOD_MS + 500);
    const h4 = await helloCount();
    check('残る溜め', '溜めが流れて橋も止まっていれば、hello は止まる（' + (BRIDGE.HELLO_PERIOD_MS + 500) + ' ミリ秒で増えない）', h4 === h3, h3 + ' → ' + h4);
  }

  // ---------- (音の診断) 枠の「音の診断」1 回で、拡張が画面全体を勧めて画面共有を開き、3 つの段を測って結果を枠へ返す。
  // 偽の認識は、この PC の中で音のトラックそのものを渡されたときだけ aborted で止まる（私用 PC の実走と同じ止まり方） ----------
  {
    await inW('globalThis.__kikuExtFake.probeMode = true; globalThis.__kikuExtFake.starts = []; true');
    await P.evaluate(function () { globalThis.__fake.dbOn = true; globalThis.__fake.dbSets = []; });
    const shown = await P.isVisible('#probe-go');
    check('音の診断', '拡張 ' + MANIFEST.version + ' とつながっている枠に「音の診断」のボタンが出る', shown, String(shown));
    const gdm0 = (await inW('globalThis.__kikuExtFake.gdmCalls')).length;
    const t0 = Date.now();
    await P.evaluate(function () { globalThis.__fake.inbound = []; });
    await P.click('#probe-go');
    const busyStart = await P.isDisabled('#start');
    // 差し替えた画面共有はすぐ返るので、最初の文はすぐ「測っている…」に替わる。届いた知らせの記録で確かめる
    const running = await waitFrame('probe-msg', /測っている（1\/3/, 5000);
    const firstNote = await P.evaluate(function () { const m = globalThis.__fake.inbound.filter(function (x) { return x.kind === 'probe'; })[0]; return m ? m.state + ':' + m.text : ''; });
    check('音の診断', '押すとすぐ、拡張から「画面全体を選び…」の知らせが枠に届き、段が進むと「測っている（1/3…）」が出る。その間「聞き取りを開始」は押せない', running && busyStart && /^running:.*「画面全体」を選び/.test(firstNote), firstNote + ' ／ ' + await frameText('probe-msg') + ' ／ start disabled=' + busyStart);
    const doneOk = await waitFrame('probe-msg', /^終わりました/, (BRIDGE.PROBE_PHASE_MS * 3) + 20000);
    fact('音の診断に掛かった時間（ミリ秒）', Date.now() - t0);
    const lines = await P.evaluate(function () { return Array.prototype.map.call(document.querySelectorAll('#probe-out p'), function (p) { return p.textContent; }); });
    fact('音の診断の結果（枠の文）', lines.join(' ／ '));
    const gdm = await inW('globalThis.__kikuExtFake.gdmCalls');
    const ask = gdm[gdm.length - 1] || {};
    check('音の診断', '拡張が getDisplayMedia を 1 回、画面全体を勧めて（video.displaySurface: monitor・systemAudio: include）呼ぶ', gdm.length === gdm0 + 1 && ask.video && ask.video.displaySurface === 'monitor' && ask.systemAudio === 'include', JSON.stringify(ask));
    check('音の診断', '終わると枠に結果が 5 行（選んだ画面・音・3 つの段）', doneOk && lines.length === 5, JSON.stringify(lines));
    check('音の診断', '音は「届いた」（差し替えた音は鳴り続ける発振音）', /^音: 届いた/.test(lines[1] || ''), lines[1]);
    check('音の診断', 'PC の中で音そのまま: aborted が 3 回で「文字にならなかった」', lines[2] === 'PC の中で（音をそのまま）: 文字にならなかった（誤り: 止められた（aborted）×3）', lines[2]);
    check('音の診断', 'PC の中で 16kHz に直して: 「文字になった（確定 3 件…）」', /^PC の中で（16kHz・1ch に直して）: 文字になった（確定 3 件・途中 1 回。例「一つ目の発話」）$/.test(lines[3] || ''), lines[3]);
    check('音の診断', 'Google のサーバーで: 「文字になった（確定 3 件…）」', /^Google のサーバーで: 文字になった（確定 3 件/.test(lines[4] || ''), lines[4]);
    const starts = await inW('globalThis.__kikuExtFake.starts');
    check('音の診断', '認識を始めた回数と形: 音そのまま（端末内）3 回・16kHz（端末内）1 回・サーバー 1 回。どれも ja-JP・continuous・interimResults で、渡したのは live なトラック', starts.length === 5 && starts.map(function (x) { return x.processLocally ? 'L' : 'C'; }).join('') === 'LLLLC' && starts.every(function (x) { return x.argIsTrack && x.live && x.lang === 'ja-JP' && x.continuous && x.interimResults; }), JSON.stringify(starts));
    const sets = await P.evaluate(function () { return globalThis.__fake.dbSets; });
    const rep = sets.length === 1 ? sets[0].value.report : null;
    check('音の診断', '結果を保存庫の probe に 1 つ残す（文と測った値。3 つの段・音の大きさ・誤りの順の記録つき）', sets.length === 1 && /^probe\/p\d+$/.test(sets[0].path) && Array.isArray(sets[0].value.summary) && sets[0].value.summary.length === 5 && rep && rep.phases.length === 3 && rep.level.n > 0 && rep.phases[0].attempts.length === 3 && /^error:aborted@/.test(rep.phases[0].attempts[0].ev.find(function (e) { return /^error/.test(e); }) || ''), JSON.stringify(sets).slice(0, 600));
    fact('音の診断の測った値（保存庫に残したもの）', rep ? JSON.stringify(rep).slice(0, 1200) : 'なし');
    check('音の診断', '終わると枠の文が「保存庫にも残しました」になり、「聞き取りを開始」がまた押せる', /保存庫にも残しました/.test(await frameText('probe-msg')) && !(await P.isDisabled('#start')), await frameText('probe-msg'));
    const tr = await inW('globalThis.__kikuExtFake.track.readyState');
    check('音の診断', '診断で開いた画面共有の音のトラックは止めてある（ended）', tr === 'ended', tr);
    const u = await readUI(page);
    check('音の診断', '拡張の操作部にも同じ結果（「音の診断の結果: …」）が出たまま残る', u.status === '音の診断の結果: ' + lines.join(' ／ '), u.status);
    await page.screenshot({ path: path.join(OUT, '10_probe.png') });
    await inW('globalThis.__kikuExtFake.probeMode = false; true');
    await P.evaluate(function () { globalThis.__fake.dbOn = false; });
  }

  // ---------- (誤り) ----------
  check('誤り', '親・枠・isolated world の pageerror と console error が無い（CSP の件を除く）', errs.page.length === 0, errs.page.length + ' 件: ' + errs.page.join(' | ').slice(0, 600));
  await page.screenshot({ path: path.join(OUT, '7_end.png'), fullPage: true });

  srv.close();
  await ctx.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });   // 一時のプロファイルは残さない（証拠は screenshot と結果の JSON）
  clearTimeout(killer);
  finish();
})().catch(function (e) { console.error('試験そのものが落ちた: ' + (e && e.stack || e)); check('試験', '最後まで走った', false, String(e && e.message || e)); finish(2); });
