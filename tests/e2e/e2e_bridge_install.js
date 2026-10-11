#!/usr/bin/env node
/*
 * e2e_bridge_install.js — 拡張「橋」を、利用者と同じ道筋で入れる・置き換える（Chromium headed、xvfb の下）。claude.ai のタブを先に
 *                         開いておき、拡張機能の画面（chrome://extensions）に ZIP を OS のドラッグで落とす。開いていたタブを読み込み
 *                         直さずに、枠（アーティファクトの iframe）が拡張に気づくかを通しで確かめる
 *
 *   xvfb-run -a node tests/e2e/e2e_bridge_install.js [道具の根のパス] [出力フォルダ]
 *   （playwright と Chromium と python3（libX11）が要る。Chromium の場所は環境変数 CHROMIUM_PATH で渡す。無ければ playwright の既定。
 *     OS のドラッグは X11 の XDND なので、X の画面が要る（headless では走らない）。出力フォルダの既定は os.tmpdir() の下）
 *
 * 作り:
 *   - プロファイルは毎回まっさら（出力フォルダの下に作り、終わりに消す）。playwright が既定で付ける --disable-extensions は外す
 *     （利用者のブラウザには無い）。拡張は --load-extension で読み込まない——利用者と同じく、拡張機能の画面に ZIP を落として入れる
 *   - 通信はしない。https://claude.ai と https://<uuid>.frame.claudeusercontent.com の応答は playwright の route で返し（親ページは
 *     e2e_bridge_ext.js と同じ形の CSP と permissions-policy、中身は枠の iframe 1 つ）、ほかの宛先への要求は断って記録する（1 件でも
 *     あれば不合格）。ページの外で Chromium が自分で出す要求（更新の確かめなど）は route に見えないので、--host-resolver-rules で
 *     すべての名前を引けなくしてある（route で返す要求は名前を引かない）
 *   - 枠は e2e_artifact.js と同じく、組み上げた kiku-artifact.html を骨で包み、頭に偽の window.claude（use はすべて null）と、
 *     届いた kiku-bridge の知らせを時刻つきで記録する口を置く。親ページの主の世界には、枠から届いた kiku の知らせ（ping）を
 *     時刻つきで記録する口を、page.evaluate で置く（本物と同じ CSP の下でも evaluate は通る。waitForFunction は通らない）
 *   - ZIP は build_bridge.py の make_zip() で作り、zip_name() の名前で出力フォルダに書く。版を変えた ZIP（新しい版・古い版）は、
 *     拡張のフォルダを出力フォルダに写して manifest の version だけを書き換え、同じ make_zip()（build_bridge.py の HERE を写しに
 *     向けて）で作る。key は元のまま（ID が同じになる）。秘密鍵は作らない・使わない
 *   - ZIP は xdnd_drop.py（同じフォルダ。X11 の XDND を ctypes で話す）で、拡張機能の画面の窓に落とす。DevTools の
 *     Input.dispatchDragEvent では、ページは File を受け取るが Chromium がドラッグ元のパスを持たず、入らない（Chromium 141 で実測）
 *   - デベロッパーモードは、拡張機能の画面のトグル（extensions-toolbar の #devMode）を押してオンにする
 *
 * 確かめること:
 *   (形)       manifest の key から出る ID が aaaamjmfpajoeghckebjabnkgggdmige。枠のページが埋め込む ZIP（KIKU_BRIDGE_ZIP）が
 *              make_zip() と 1 バイトも違わず、名前は zip_name()、版は manifest の version（利用者が落とすのはこの ZIP）
 *   (入れる前)  先に開いた claude.ai のタブの枠に、拡張を入れる 3 つの手順（#ask-setup）が出る。タブに操作部（#kiku-bridge-host）は無い
 *   (入れる)    まっさらなプロファイルで、画面のトグルでデベロッパーモードをオンにし、ZIP を落とすと: 拡張機能の画面が受け取り
 *              （installDroppedFile に誤りが無い）、拡張はちょうど 1 つ、ID は key のもの、版は manifest の version、有効。
 *              確かめの画面は要らない（こちらは何も押さずに、落としてから 10 秒以内に有効になる。拡張機能の画面に開いた dialog も無い）。
 *              読み込み直していない claude.ai のタブに操作部がちょうど 1 つ入り（background.js の差し込み）、枠は有効になってから
 *              10 秒以内に手順を消し、落ち着いた後（枠の ping 1 回分おいて読む。一瞬だけ出た文では合格にしない）に「拡張と
 *              つながっています」と出している。枠に届く here の ver は入れた版。タブも枠も読み込み直していない
 *   (置き換える) 版を 1 つ上げた ZIP（0.2.1）を同じように落とすと: 拡張はちょうど 1 つ、ID は同じ、版は新しい版、有効。
 *              読み込み直していないタブで、操作部はちょうど 1 つ。枠から v:2 の ping を 1 回送ると、1 秒のあいだに here が
 *              ちょうど 1 つ返り、その ver は新しい版（前の版の送り手が退いていなければ 2 つ返る）。枠の持つ ZIP の版（0.2.0）より
 *              古くないので、「新しい版があります」（#ask-update-row）は出ない
 *   (古い版)    別のまっさらなプロファイルで、版を 1 つ下げた ZIP（0.1.9。中身は今の版と同じで version だけ違う）を同じように入れると、
 *              枠は読み込み直さずに手順を消し、「拡張の新しい版（0.2.0）があります（いまは 0.1.9…」を出す
 *   (通信)     route で返したもののほかに、ページからの要求が 1 件も無い
 *   (誤り)     claude.ai のタブ（親と枠）の pageerror と console error が 0 件
 *   (環境)     合否にせず記録する: Chromium の版、終わりのデベロッパーモード（2 つのプロファイルとも。トグルの見た目と設定の両方）、
 *              ZIP を展開した置き場、拡張から届いた here の where、枠の文の移り変わり、入るまで・気づくまでの時間
 *
 * 確かめないこと: Windows・macOS の Chrome、本物の Chrome（Chromium ではない）での入り方。ウェブストアからの入り方。会社の決まり
 *   （ポリシー）で拡張やデベロッパーモードを止められている PC。ファイルマネージャーからのドラッグそのもの（同じ XDND を自分で話す）。
 *   枠の「拡張を保存する」で ZIP が落ちること（e2e_artifact.js の (m) が偽の保存で確かめる）。chrome://extensions を開く・トグルを
 *   見つけるといった人の操作の分かりやすさ。ブラウザを閉じて開き直した後に残るか。0.1.0（決まりの版 1）からの置き換え。
 *   古い版を入れたプロファイルへ新しい版を落とし直すこと（古い版の組は知らせが出るところまで）。画面共有と音声認識（e2e_bridge_ext.js）
 *
 * 結果は JSON で標準出力に出す（各項目は標準エラーに「合格／不合格 [組] 名前」。xvfb-run は中で "$@" 2>&1 とするので、
 * その下では両方が標準出力に混ざる。全部の結果は出力フォルダの e2e_bridge_install_result.json にも書く）。1 件でも落ちれば
 * 終了コード 1、試験そのものが落ちれば 2。全体は 300 秒で打ち切る（打ち切りも不合格）。一回はおよそ 20 秒
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const { chromium } = require('playwright');

const KIT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'kiku-e2e-bridge-install'));
fs.mkdirSync(OUT, { recursive: true });
const EXT = path.join(KIT, 'bridge', 'chrome');
const BUILD_BRIDGE = path.join(EXT, 'build_bridge.py');
const XDND = path.join(__dirname, 'xdnd_drop.py');
const TOTAL_MS = 300000;
// manifest の key で固定した ID（置き換えは落とし直すだけ、という約束の元）。key を変えればここで落ちる
const EXPECTED_ID = 'aaaamjmfpajoeghckebjabnkgggdmige';
const INSTALL_MS = 10000;   // 落としてから有効になるまでの上限
const SEEN_MS = 10000;      // 有効になってから枠が気づくまでの上限
const PING_WINDOW_MS = 1000;
// 枠の origin（uuid は作り物）と、親ページの CSP の nonce（作り物）
const UUID = '0f0f0f0f-0000-4000-8000-000000000002';
const FRAME_HOST = UUID + '.frame.claudeusercontent.com';
const FRAME_ORIGIN = 'https://' + FRAME_HOST;
const NONCE = 'kikuTestNonce0123456789ab';
const ART_ID = 'kikuE2eBridgeInstall';

const results = [];
const env = [];   // 環境の事実（合否にしないもの）
function check(group, name, ok, detail) {
  results.push({ group: group, name: name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.error((ok ? '合格 ' : '不合格 ') + '[' + group + '] ' + name + (detail != null ? '  — ' + String(detail).slice(0, 400) : ''));
}
function fact(name, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  env.push({ name: name, value: v });
  results.push({ group: '環境', name: name, ok: true, detail: v });
  console.error('環境 ' + name + ' = ' + String(v).slice(0, 400));
}

// 一時のもの（プロファイル・版を変えた拡張の写し）は終わりに消す。証拠（結果の JSON・screenshot・ZIP）は出力フォルダに残す
const temps = [];
const contexts = [];
function tempDir(tag) { const d = fs.mkdtempSync(path.join(OUT, tag + '-')); temps.push(d); return d; }
function cleanup() { temps.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 消せなくても結果は出す */ } }); }
let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  cleanup();
  const ng = results.filter(function (r) { return !r.ok; });
  const out = { results: results, env: env, ng: ng.length, total: results.length };
  fs.writeFileSync(path.join(OUT, 'e2e_bridge_install_result.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ total: results.length, ng: ng.length }, null, 1));
  process.exit(code != null ? code : (ng.length ? 1 : 0));
}
async function closeAll() {
  for (const c of contexts) { try { await c.close(); } catch (e) { /* 閉じ損ねても先へ */ } }
  contexts.length = 0;
}

// ---- 偽の window.claude（枠の頭で走る。能力は全部 null）。橋から届いた知らせを時刻つきで記録する ----
const FAKE = `
(function () {
  const F = globalThis.__fake = { uses: [], inbound: [], mark: null, inIframe: (function () { try { return window.top !== window; } catch (e) { return true; } })() };
  globalThis.claude = { use: function (name) { F.uses.push(name); return Promise.resolve(null); } };
  window.addEventListener('message', function (ev) {
    const d = ev && ev.data;
    if (d && d.source === 'kiku-bridge') F.inbound.push({ t: Date.now(), kind: d.kind, v: d.v, ver: d.ver === undefined ? null : d.ver, where: d.where, capturing: d.capturing, origin: ev.origin });
  });
})();
`;

// ---- 本物の claude.ai の応答ヘッダと同じ形（e2e_bridge_ext.js の写し。uuid と nonce だけ自分の枠に合わせた） ----
function parentHeaders() {
  const FO = FRAME_ORIGIN;
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'private, no-store',
    'content-security-policy': "frame-ancestors 'self' chrome-extension://fcoeoabgfenejglbffodgkkbkcdhcgfn chrome-extension://dngcpimnedloihjnnfngkgjoidhnaolf; " +
      'frame-src ' + FO + "; script-src 'nonce-" + NONCE + "' 'self' 'wasm-unsafe-eval' a-cdn.claude.ai assets.claude.ai assets-proxy.anthropic.com a-cdn.anthropic.com s-cdn.anthropic.com; " +
      "style-src 'nonce-" + NONCE + "'; connect-src 'self' " + FO + "; base-uri 'none'; object-src 'none'; form-action 'none'",
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
function parentHtml() {
  return '<!doctype html><html><head><meta charset="utf-8"><title>artifact</title><style nonce="' + NONCE + '">body{margin:0;background:#f4f4f4}#f{display:block;width:1260px;height:880px;border:0}</style></head><body>' +
    '<iframe id="f" src="' + FRAME_ORIGIN + '/artifact_wrapped.html"></iframe></body></html>';
}

// ---- route: claude.ai の親ページと枠だけを返し、ほかは断って記録する ----
async function routeAll(ctx, wrapped, net) {
  await ctx.route('**/*', function (route) {
    const req = route.request();
    const url = req.url();
    let u = null;
    try { u = new URL(url); } catch (e) { /* 下で断る */ }
    const https = !!u && u.protocol === 'https:';
    const host = u ? u.hostname : '', p = u ? u.pathname : '';
    if (https && host === 'claude.ai' && p.indexOf('/artifact/') === 0) { net.served.push(url); return route.fulfill({ status: 200, headers: parentHeaders(), body: parentHtml() }); }
    if (https && host === FRAME_HOST && p === '/artifact_wrapped.html') { net.served.push(url); return route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: wrapped }); }
    if (https && (host === 'claude.ai' || host === FRAME_HOST) && p === '/favicon.ico') { net.served.push(url); return route.fulfill({ status: 204, body: '' }); }
    let frame = null;
    try { frame = req.frame().url(); } catch (e) { /* service worker などの要求には frame が無い */ }
    net.refused.push({ url: url, type: req.resourceType(), frame: frame });
    return route.abort('blockedbyclient');
  });
}

async function launch(profileDir) {
  const opt = {
    headless: false, viewport: null,                       // 窓の大きさのまま（X のドラッグの位置と窓が合うように）
    ignoreDefaultArgs: ['--disable-extensions'],           // 利用者のブラウザには無い
    args: ['--window-position=0,0', '--window-size=1280,1000', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND']
  };
  if (process.env.CHROMIUM_PATH) opt.executablePath = process.env.CHROMIUM_PATH;
  const ctx = await chromium.launchPersistentContext(profileDir, opt);
  contexts.push(ctx);
  return ctx;
}

// ---- 拡張機能の画面（chrome://extensions） ----
// developerPrivate の知らせと、ページの落とし口が呼ぶ installDroppedFile の結果（誤り）を記録する
const INSTRUMENT = function () {
  if (window.__ev) return 'already';
  window.__ev = [];
  window.__calls = [];
  const t0 = Date.now();
  chrome.developerPrivate.onItemStateChanged.addListener(function (e) {
    window.__ev.push({ t: Date.now() - t0, type: e.event_type, id: e.item_id, version: e.extensionInfo && e.extensionInfo.version, state: e.extensionInfo && e.extensionInfo.state });
  });
  const dp = chrome.developerPrivate;
  ['notifyDragInstallInProgress', 'installDroppedFile'].forEach(function (name) {
    const orig = dp[name];
    if (typeof orig !== 'function') return;
    dp[name] = function () {
      const args = Array.from(arguments);
      const rec = { t: Date.now() - t0, name: name };
      window.__calls.push(rec);
      const cbIdx = args.findIndex(function (a) { return typeof a === 'function'; });
      const cb = cbIdx >= 0 ? args[cbIdx] : null;
      const wrapped = function () { rec.cbLastError = chrome.runtime.lastError ? chrome.runtime.lastError.message : null; if (cb) return cb.apply(this, arguments); };
      // notifyDragInstallInProgress は callback を取らない（足すと「No matching signature」で投げる）
      if (cb) args[cbIdx] = wrapped; else if (name === 'installDroppedFile') args.push(wrapped);
      let ret;
      try { ret = orig.apply(dp, args); } catch (e) { rec.threw = String(e); throw e; }
      if (ret && typeof ret.then === 'function') ret.then(function () {}, function (e) { rec.rejected = String(e && e.message || e); });
      return ret;
    };
  });
  return 'instrumented';
};
async function openExtensionsPage(ctx) {
  const p = await ctx.newPage();
  await p.goto('chrome://extensions');
  await p.waitForFunction(function () { return !!document.querySelector('extensions-manager') && !!(window.chrome && chrome.developerPrivate); }, null, { timeout: 15000 });
  await p.evaluate(INSTRUMENT);
  return p;
}
function extInfo(p) {
  return p.evaluate(function () {
    return new Promise(function (r) {
      chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, function (list) {
        r((list || []).filter(function (e) { return e.location !== 'COMPONENT'; }).map(function (e) {
          return { id: e.id, name: e.name, version: e.version, state: e.state, location: e.location, path: e.prettifiedPath,
            disableReasons: Object.keys(e.disableReasons || {}).filter(function (k) { return e.disableReasons[k]; }),
            installWarnings: e.installWarnings, runtimeErrors: (e.runtimeErrors || []).map(function (x) { return x.message; }) };
        }));
      });
    });
  });
}
function profileConfig(p) {
  return p.evaluate(function () { return new Promise(function (r) { chrome.developerPrivate.getProfileConfiguration(function (c) { r({ inDeveloperMode: c && c.inDeveloperMode, canLoadUnpacked: c && c.canLoadUnpacked, isDeveloperModeControlledByPolicy: c && c.isDeveloperModeControlledByPolicy }); }); }); });
}
// 画面のトグル（extensions-toolbar の #devMode）の見た目
function devToggle(p) {
  return p.evaluate(function () {
    const tb = document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar');
    const t = tb && tb.shadowRoot && tb.shadowRoot.querySelector('#devMode');
    return t ? { checked: !!t.checked, disabled: !!t.disabled } : null;
  });
}
// 拡張機能の画面で開いている dialog（shadow root の中まで探す）
function openDialogs(p) {
  return p.evaluate(function () {
    const acc = [];
    (function walk(root) {
      root.querySelectorAll('cr-dialog, dialog').forEach(function (d) { if (d.open) acc.push((d.innerText || d.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 200)); });
      root.querySelectorAll('*').forEach(function (e) { if (e.shadowRoot) walk(e.shadowRoot); });
    })(document);
    return acc;
  });
}
// デベロッパーモードを画面のトグルで入れる（前の状態・押した後の設定とトグルの見た目を返す）
async function turnDevModeOn(p) {
  const before = await profileConfig(p);
  let clickErr = null;
  try { await p.locator('extensions-manager extensions-toolbar #devMode').click({ timeout: 5000 }); } catch (e) { clickErr = String(e && e.message || e).split('\n')[0]; }
  let after = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) { after = await profileConfig(p); if (after.inDeveloperMode) break; await p.waitForTimeout(100); }
  return { before: before, after: after, toggle: await devToggle(p), clickErr: clickErr };
}

// ---- ZIP を OS のドラッグで落とす（xdnd_drop.py）。落とした後、want の版が有効になるのを待つ ----
function xdnd(file) {
  let out;
  try { out = execFileSync('python3', ['-I', XDND, file, '--name-contains', 'Extensions'], { encoding: 'utf8', timeout: 30000 }); }
  catch (e) { return { ok: false, error: 'xdnd_drop.py が落ちた: ' + String(e && e.message || e).split('\n')[0], stdout: String(e.stdout || '').slice(0, 300) }; }
  try { return JSON.parse(out.trim().split('\n').pop()); } catch (e) { return { ok: false, error: 'xdnd_drop.py の出力を読めない', raw: out.slice(0, 300) }; }
}
async function dropZip(p, file, want) {
  await p.bringToFront();
  await p.waitForTimeout(300);
  await p.evaluate(function () { window.__ev.length = 0; window.__calls.length = 0; });
  const t0 = Date.now();
  const xd = xdnd(file);
  let tEnabled = null;
  while (Date.now() - t0 < INSTALL_MS) {
    const info = await extInfo(p);
    if (info.some(function (e) { return e.version === want && e.state === 'ENABLED'; })) { tEnabled = Date.now(); break; }
    const calls = await p.evaluate('window.__calls');
    if (calls.some(function (c) { return c.cbLastError || c.threw || c.rejected; })) break;
    await p.waitForTimeout(100);
  }
  await p.waitForTimeout(500);   // 遅れて届く知らせを待つ
  const shot = path.join(OUT, 'drop-' + want + '-xscreen.png');
  const xs = spawnSync('import', ['-window', 'root', shot], { stdio: 'ignore', timeout: 15000 });   // 窓の外（Chromium の確かめの画面）も写る
  return {
    xd: { ok: xd.ok, dropped: xd.dropped, accepted: (xd.status || []).some(function (s) { return s.accept; }), finished: xd.finished, error: xd.error, why_not: xd.why_not, window: xd.target && xd.target.name },
    t0: t0, tEnabled: tEnabled, msToEnabled: tEnabled ? tEnabled - t0 : null,
    info: await extInfo(p), calls: await p.evaluate('window.__calls'), events: await p.evaluate('window.__ev'), dialogs: await openDialogs(p),
    xshot: xs.status === 0 ? shot : null
  };
}
// 落とした結果の確かめ（入れる・置き換える・古い版で同じ）
function checkDrop(group, r, zip, want) {
  check(group, zip.name + ' を OS のドラッグで拡張機能の画面に落とした（窓が受け入れ、落とし終えた）', r.xd.ok && r.xd.dropped && r.xd.accepted, JSON.stringify(r.xd));
  const inst = r.calls.filter(function (c) { return c.name === 'installDroppedFile'; });
  check(group, '拡張機能の画面が受け取って入れた（installDroppedFile を 1 回呼び、誤りが無い）', inst.length === 1 && !inst[0].cbLastError && !inst[0].threw && !inst[0].rejected, JSON.stringify(r.calls));
  const e = r.info[0] || {};
  check(group, '拡張はちょうど 1 つで、ID は ' + EXPECTED_ID + '、版は ' + want + '、有効', r.info.length === 1 && e.id === EXPECTED_ID && e.version === want && e.state === 'ENABLED',
    JSON.stringify(r.info.map(function (x) { return { id: x.id, version: x.version, state: x.state, location: x.location, disableReasons: x.disableReasons }; })));
  check(group, '確かめの画面は要らない（こちらは何も押さずに、落としてから ' + INSTALL_MS / 1000 + ' 秒以内に有効になった。拡張機能の画面に開いた dialog も無い）',
    r.msToEnabled != null && r.msToEnabled <= INSTALL_MS && r.dialogs.length === 0, JSON.stringify({ msToEnabled: r.msToEnabled, dialogs: r.dialogs, xshot: r.xshot }));
  check(group, '入れたときの警告と、拡張の実行時の誤りが無い', !!e.id && (e.installWarnings || []).length === 0 && (e.runtimeErrors || []).length === 0, JSON.stringify({ installWarnings: e.installWarnings, runtimeErrors: e.runtimeErrors }));
}

// ---- 枠の表（#ask）と、親ページの操作部の数 ----
function frameAsk(F) {
  return F.evaluate(function () {
    const $ = function (id) { return document.getElementById(id); };
    return { box: !$('ask').hidden, setup: !$('ask-setup').hidden, update: !$('ask-update-row').hidden, text: $('ask-text').textContent, updateText: $('ask-update-text').textContent, mark: globalThis.__fake.mark };
  });
}
function hostCount(tab) { return tab.evaluate('document.querySelectorAll("#kiku-bridge-host").length'); }
// cond が満たされるまで（ms まで）枠と親を読み続け、満たされた後も settle ミリ秒は読み続けてから、最後に読んだ形を返す
// （一瞬だけ出た文で合格にしないため。拡張は立ち上がってすぐ where を調べ直し、here を出し直す）。
// 変わり目を時刻つきで残し、firsts の各条件が初めて満たされた時刻も残す（どれも t0 からのミリ秒）
const SETTLE_MS = 2500;   // 枠の ping 1 回分（intake.js の LINK_PING_MS 2000）と少し
async function watchFrame(tab, F, t0, ms, cond, firsts) {
  const trail = [];
  const first = {};
  let last = null, a = null, metAt = null;
  while (true) {
    a = await frameAsk(F);
    a.hosts = await hostCount(tab);
    const now = Date.now() - t0;
    const key = JSON.stringify([a.setup, a.update, a.text, a.hosts]);
    if (key !== last) { trail.push(now + 'ms 手順=' + (a.setup ? '出' : '無') + ' 新版=' + (a.update ? '出' : '無') + ' 操作部=' + a.hosts + ' 「' + a.text + '」'); last = key; }
    Object.keys(firsts || {}).forEach(function (k) { if (first[k] == null && firsts[k](a)) first[k] = now; });
    if (metAt == null && cond(a)) metAt = now;
    if ((metAt != null && now - metAt >= SETTLE_MS) || (metAt == null && now > ms)) return { ok: cond(a), metAt: metAt, a: a, ms: now, first: first, trail: trail };
    await tab.waitForTimeout(100);
  }
}
// 枠に届いた here
function heres(F) { return F.evaluate(function () { return globalThis.__fake.inbound.filter(function (m) { return m.kind === 'here'; }); }); }
// 親ページの主の世界で、枠から届いた kiku の知らせを記録する口（本物と同じ CSP の下でも evaluate は通る）
const PING_REC = '(function(){ if (globalThis.__pings) return false; const P = globalThis.__pings = []; window.addEventListener("message", function (ev) { const d = ev && ev.data;' +
  ' if (d && d.source === "kiku" && ev.origin === ' + JSON.stringify(FRAME_ORIGIN) + ') P.push({ t: Date.now(), kind: d.kind, v: d.v, probe: d.probe || null }); }); return true; })()';

// claude.ai のタブを開き、枠が「入れる 3 つの手順」を出すまで待つ。誤りの集めも付ける
async function openClaudeTab(ctx, label, errs) {
  const tab = ctx.pages()[0] || await ctx.newPage();
  tab.on('pageerror', function (e) { errs.push(label + ': ' + String(e && e.message || e)); });
  tab.on('console', function (m) { if (m.type() === 'error') errs.push(label + ': ' + m.text()); });
  const navs = { n: 0 };
  tab.on('framenavigated', function (f) { if (f === tab.mainFrame()) navs.n++; });
  await tab.goto('https://claude.ai/artifact/' + ART_ID, { waitUntil: 'load' });
  const F = await (await tab.waitForSelector('#f', { timeout: 10000 })).contentFrame();
  await F.waitForSelector('#ask', { state: 'attached', timeout: 15000 });
  await tab.evaluate(PING_REC);
  // 読み込み直していないことの印（主の世界の変数。読み込み直せば消える）
  await tab.evaluate('globalThis.__kikuMark = "' + label + '"');
  await F.evaluate(function (m) { globalThis.__fake.mark = m; }, label);
  let setupErr = null;
  try { await F.waitForFunction(function () { return !document.getElementById('ask-setup').hidden; }, null, { timeout: 10000 }); } catch (e) { setupErr = String(e && e.message || e).split('\n')[0]; }
  return { tab: tab, F: F, navs: navs, navsAtLoad: navs.n, setupErr: setupErr };
}
async function notReloaded(c, label) {
  const tabMark = await c.tab.evaluate('globalThis.__kikuMark');
  const frameMark = await c.F.evaluate(function () { return globalThis.__fake.mark; });
  return { ok: tabMark === label && frameMark === label && c.navs.n === c.navsAtLoad, detail: JSON.stringify({ tabMark: tabMark, frameMark: frameMark, mainFrameNavigations: c.navs.n - c.navsAtLoad }) };
}

// ---- ZIP を作る（build_bridge.py の make_zip。版を変えるものは拡張の写しの manifest の version を書き換えて、HERE を写しに向ける） ----
const MAKE_ZIPS_PY = String.raw`
import importlib.util, json, pathlib, re, shutil, sys
bb, src, work, out = sys.argv[1:5]
spec = importlib.util.spec_from_file_location('build_bridge', bb)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
src = pathlib.Path(src)
key0 = json.loads((src / 'manifest.json').read_text(encoding='utf-8')).get('key')
res = []
for v in sys.argv[5:]:
    if v == '-':
        m.HERE = src
    else:
        d = pathlib.Path(work) / ('ext-' + v)
        shutil.copytree(src, d, ignore=shutil.ignore_patterns('__pycache__'))
        t = (d / 'manifest.json').read_text(encoding='utf-8')
        t2, n = re.subn(r'("version"\s*:\s*")[^"]*(")', lambda x: x.group(1) + v + x.group(2), t, count=1)
        if n != 1:
            raise SystemExit('manifest.json の version を書き換えられない')
        (d / 'manifest.json').write_text(t2, encoding='utf-8')
        m.HERE = d
    data = m.make_zip()
    name = m.zip_name()
    p = pathlib.Path(out) / name
    p.write_bytes(data)
    mf = m.manifest()
    res.append({'want': v, 'version': mf['version'], 'sameKey': mf.get('key') == key0 and bool(key0), 'name': name, 'path': str(p), 'bytes': len(data), 'files': m.zip_files()})
print(json.dumps(res))
`;
// 2 つの ZIP の中身を比べる（片方にしか無い名前と、中身の違う名前）
const ZIP_DIFF_PY = String.raw`
import json, sys, zipfile
za, zb = zipfile.ZipFile(sys.argv[1]), zipfile.ZipFile(sys.argv[2])
na, nb = set(za.namelist()), set(zb.namelist())
print(json.dumps({'onlyEmbedded': sorted(na - nb), 'onlyMakeZip': sorted(nb - na), 'differ': sorted(n for n in na & nb if za.read(n) != zb.read(n))}))
`;
function idFromKey(b64) {
  const h = crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex').slice(0, 32);
  return h.split('').map(function (c) { return String.fromCharCode(97 + parseInt(c, 16)); }).join('');
}
// 版を 1 つ上げる・下げる（0.2.0 → 0.2.1・0.1.9）
function bump(v, up) {
  const n = v.split('.').map(Number);
  while (n.length < 3) n.push(0);
  if (up) { n[2]++; return n.join('.'); }
  if (n[2] > 0) n[2]--; else if (n[1] > 0) { n[1]--; n[2] = 9; } else { n[0]--; n[1] = 9; n[2] = 9; }
  return n.join('.');
}

(async function main() {
  const killer = setTimeout(function () {
    check('時間', TOTAL_MS / 1000 + ' 秒以内に終わった', false, '打ち切った');
    Promise.race([closeAll(), new Promise(function (r) { setTimeout(r, 5000); })]).then(function () { finish(1); });
  }, TOTAL_MS);
  const tStart = Date.now();

  // ---------- (形) ----------
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const BASE = manifest.version, NEWER = bump(BASE, true), OLDER = bump(BASE, false);
  const keyId = manifest.key ? idFromKey(manifest.key) : null;
  check('形', 'manifest に key があり、そこから出る ID が ' + EXPECTED_ID, keyId === EXPECTED_ID, JSON.stringify({ keyId: keyId, version: BASE }));
  const zipDir = path.join(OUT, 'zips');
  fs.rmSync(zipDir, { recursive: true, force: true });
  fs.mkdirSync(zipDir, { recursive: true });
  const work = tempDir('work');
  const zips = JSON.parse(execFileSync('python3', ['-I', '-B', '-c', MAKE_ZIPS_PY, BUILD_BRIDGE, EXT, work, zipDir, '-', NEWER, OLDER], { encoding: 'utf8' }).trim());
  const Z = { base: zips[0], newer: zips[1], older: zips[2] };
  check('形', 'ZIP を 3 つ作った（' + [Z.base, Z.newer, Z.older].map(function (z) { return z.name; }).join('・') + '）。どれも根に manifest.json があり、key は元のまま',
    Z.base.version === BASE && Z.newer.version === NEWER && Z.older.version === OLDER && [Z.base, Z.newer, Z.older].every(function (z) { return z.sameKey && z.files.indexOf('manifest.json') >= 0 && z.files.indexOf('background.js') >= 0; }),
    JSON.stringify(zips.map(function (z) { return { name: z.name, version: z.version, bytes: z.bytes, sameKey: z.sameKey, files: z.files }; })));
  const art = fs.readFileSync(path.join(KIT, 'kiku-artifact.html'), 'utf8');
  const mz = /globalThis\.KIKU_BRIDGE_ZIP = (\{[^\n]*?\});?<\/script>/.exec(art);
  let embedded = null;
  try { embedded = mz ? JSON.parse(mz[1]) : null; } catch (e) { embedded = null; }
  const baseB64 = fs.readFileSync(Z.base.path).toString('base64');
  let zipDiff = null;
  if (embedded && embedded.b64 !== baseB64) {
    // 違うときは、どのファイルが違うかを出す（組み上げた後に拡張のフォルダを直し、build_html.py --artifact を走らせていない、など）
    const embPath = path.join(zipDir, 'embedded-' + String(embedded.file).replace(/[^\w.-]/g, '_'));
    fs.writeFileSync(embPath, Buffer.from(embedded.b64, 'base64'));
    try { zipDiff = JSON.parse(execFileSync('python3', ['-I', '-B', '-c', ZIP_DIFF_PY, embPath, Z.base.path], { encoding: 'utf8' }).trim()); } catch (e) { zipDiff = '比べられない: ' + String(e && e.message || e).split('\n')[0]; }
  }
  check('形', '枠のページ（kiku-artifact.html）が埋め込む ZIP は make_zip() と 1 バイトも違わず、名前は ' + Z.base.name + '、版は ' + BASE + '（利用者が落とすのはこの ZIP）',
    !!embedded && embedded.b64 === baseB64 && embedded.file === Z.base.name && embedded.version === BASE,
    embedded ? JSON.stringify({ file: embedded.file, version: embedded.version, sameBytes: embedded.b64 === baseB64, embeddedBytes: Buffer.from(embedded.b64, 'base64').length, makeZipBytes: Z.base.bytes, zipDiff: zipDiff }) : 'KIKU_BRIDGE_ZIP が見つからない');
  const wrapped = '<!doctype html><html><head><meta charset="utf-8"><script>' + FAKE + '</script></head><body>' + art + '</body></html>';

  const net = { served: [], refused: [] };
  const errs = [];

  // ---------- (入れる前) まっさらなプロファイルで、claude.ai のタブを先に開く ----------
  const ctx = await launch(tempDir('profile-install'));
  fact('Chromium', ctx.browser() ? ctx.browser().version() : '（版を読めない）');
  await routeAll(ctx, wrapped, net);
  const A = await openClaudeTab(ctx, 'claude.ai のタブ', errs);
  {
    const a = await frameAsk(A.F);
    check('入れる前', '先に開いた claude.ai のタブの枠に、拡張を入れる 3 つの手順（#ask-setup）が出る', !A.setupErr && a.setup && /3 つの手順/.test(a.text), A.setupErr || JSON.stringify(a));
    check('入れる前', 'タブに操作部（#kiku-bridge-host）は無い（拡張はまだ入っていない）', (await hostCount(A.tab)) === 0);
  }
  await A.tab.screenshot({ path: path.join(OUT, '1_before_install.png') });

  // ---------- (入れる) 拡張機能の画面でデベロッパーモードをオンにし、ZIP を落とす ----------
  const E = await openExtensionsPage(ctx);
  {
    const before = await extInfo(E);
    check('入れる', 'まっさらなプロファイルには拡張が 1 つも無い', before.length === 0, JSON.stringify(before.map(function (x) { return x.id + ' ' + x.version; })));
    const dm = await turnDevModeOn(E);
    check('入れる', '拡張機能の画面のトグルを押して、デベロッパーモードをオンにした（前はオフ）', dm.before.inDeveloperMode === false && dm.after && dm.after.inDeveloperMode === true && dm.toggle && dm.toggle.checked === true, JSON.stringify(dm));
  }
  const r1 = await dropZip(E, Z.base.path, BASE);
  checkDrop('入れる', r1, Z.base, BASE);
  if (r1.info[0]) fact('ZIP を展開した置き場（入れたとき）', r1.info[0].path);
  fact('落としてから有効になるまで（入れたとき）', r1.msToEnabled == null ? '有効にならなかった' : r1.msToEnabled + ' ミリ秒');
  {
    await A.tab.bringToFront();
    const w = await watchFrame(A.tab, A.F, r1.tEnabled || Date.now(), SEEN_MS,
      function (a) { return !a.setup && a.hosts === 1; },
      { setupGone: function (a) { return !a.setup; }, host: function (a) { return a.hosts >= 1; }, connectedText: function (a) { return /拡張とつながっています/.test(a.text); } });
    const nr = await notReloaded(A, 'claude.ai のタブ');
    check('入れる', '読み込み直していない claude.ai のタブに、操作部（#kiku-bridge-host）がちょうど 1 つ入った（background.js の差し込み）', w.a.hosts === 1 && nr.ok, JSON.stringify({ hosts: w.a.hosts, msAfterEnabled: w.first.host }) + ' ' + nr.detail);
    check('入れる', '枠は読み込み直さずに、有効になってから ' + SEEN_MS / 1000 + ' 秒以内に手順（#ask-setup）を消した（その ' + SETTLE_MS + ' ミリ秒後も消えたまま）', w.first.setupGone != null && w.first.setupGone <= SEEN_MS && !w.a.setup && nr.ok, JSON.stringify({ msAfterEnabled: w.first.setupGone }) + ' ' + nr.detail);
    check('入れる', '手順が消えた後、枠の文（#ask-text）は「拡張とつながっています」（落ち着いてから読む）', /拡張とつながっています/.test(w.a.text), JSON.stringify({ text: w.a.text, seenAtAnyTime: w.first.connectedText != null }));
    check('入れる', '「新しい版があります」（#ask-update-row）は出ない（同じ版）', !w.a.update, w.a.updateText);
    fact('入れた後の枠の文の移り変わり（有効になってからのミリ秒）', w.trail.join(' / '));
    const hs = await heres(A.F);
    check('入れる', '枠に届いた here はどれも v:2 で、ver は ' + BASE, hs.length > 0 && hs.every(function (m) { return m.v === 2 && m.ver === BASE; }), hs.length + ' 件: ' + JSON.stringify(hs.slice(-3)));
    fact('拡張から枠に届いた here（入れたとき。有効になってからのミリ秒と where。はじめの 4 件）', hs.slice(0, 4).map(function (m) { return (m.t - (r1.tEnabled || 0)) + 'ms ' + m.where; }).join(' / '));
  }
  await A.tab.screenshot({ path: path.join(OUT, '2_installed.png') });

  // ---------- (置き換える) 版を 1 つ上げた ZIP を落とす ----------
  const r2 = await dropZip(E, Z.newer.path, NEWER);
  checkDrop('置き換える', r2, Z.newer, NEWER);
  if (r2.info[0]) fact('ZIP を展開した置き場（置き換えたとき）', r2.info[0].path);
  fact('落としてから有効になるまで（置き換えたとき）', r2.msToEnabled == null ? '有効にならなかった' : r2.msToEnabled + ' ミリ秒');
  {
    await A.tab.bringToFront();
    // 新しい版の here が届くまで待つ（届かなければ、その旨を下の確かめが言う）
    const t0 = r2.tEnabled || Date.now();
    let got = false;
    while (Date.now() - t0 < SEEN_MS) {
      if ((await heres(A.F)).some(function (m) { return m.t >= t0 && m.ver === NEWER; })) { got = true; break; }
      await A.tab.waitForTimeout(100);
    }
    const nr = await notReloaded(A, 'claude.ai のタブ');
    const hosts = await hostCount(A.tab);
    check('置き換える', '読み込み直していないタブで、操作部（#kiku-bridge-host）はちょうど 1 つ', hosts === 1 && nr.ok, JSON.stringify({ hosts: hosts }) + ' ' + nr.detail);
    // 枠の中から ping を 1 回送る。周期の ping（2 秒ごと）と重ならないよう、here が届いた直後に送り、送った後に届いた here を
    // 1 秒のあいだ数える（時刻ではなく、送った時点の件数より後ろを数える。同じミリ秒に届いた前の here を数えないため）。
    // 親の側でも、こちらの ping（印の probe で見分ける）から 1 秒のあいだに届いた ping を数える（周期の ping が紛れ込めば、
    // その分 here も増えるのが正しい。同じ枠からの postMessage は順に届くので、印より後ろは送った後の ping）
    const PROBE = 'install-test-' + Date.now();
    const pr = await A.F.evaluate(function (o) {
      return new Promise(function (resolve) {
        const F = globalThis.__fake;
        const hs = function () { return F.inbound.filter(function (m) { return m.kind === 'here'; }); };
        const n0 = hs().length, tw = Date.now();
        const iv = setInterval(function () {
          if (hs().length === n0 && Date.now() - tw < 6000) return;
          clearInterval(iv);
          const waited = hs().length > n0;
          const nAt = hs().length;
          const t0 = Date.now();
          window.parent.postMessage({ source: 'kiku', v: 2, kind: 'ping', probe: o.probe }, '*');
          setTimeout(function () { resolve({ waited: waited, t0: t0, heres: hs().slice(nAt).filter(function (m) { return m.t <= t0 + o.win; }) }); }, o.win);
        }, 5);
      });
    }, { win: PING_WINDOW_MS, probe: PROBE });
    const all = await A.tab.evaluate('globalThis.__pings');
    const pi = all.findIndex(function (m) { return m.probe === PROBE; });
    const pings = pi < 0 ? [] : all.slice(pi).filter(function (m) { return m.kind === 'ping' && m.v === 2 && m.t <= all[pi].t + PING_WINDOW_MS; });
    check('置き換える', '枠から v:2 の ping を 1 回送ると、here がちょうど 1 つ返り、その ver は ' + NEWER + '（送ってから ' + PING_WINDOW_MS + ' ミリ秒のあいだに親に届いた ping と、枠に届いた here の数が等しい）',
      got && pi >= 0 && pr.heres.length === pings.length && pr.heres.every(function (m) { return m.ver === NEWER && m.v === 2; }),
      JSON.stringify({ newVersionHereArrived: got, parentSawProbe: pi >= 0, pingsInWindow: pings.length, heres: pr.heres.map(function (m) { return { ver: m.ver, where: m.where, ms: m.t - pr.t0 }; }), alignedAfterHere: pr.waited }));
    const a = await frameAsk(A.F);
    check('置き換える', '枠は手順を出さず、「新しい版があります」（#ask-update-row）も出ない（' + NEWER + ' は枠の持つ ' + BASE + ' より古くない）', !a.setup && !a.update && a.box, JSON.stringify(a));
    const after = (await heres(A.F)).filter(function (m) { return m.t >= t0; });
    const byVer = {};
    after.forEach(function (m) { byVer[m.ver] = (byVer[m.ver] || 0) + 1; });
    fact('置き換えた後に枠に届いた here の ver（数）', byVer);
  }
  await A.tab.screenshot({ path: path.join(OUT, '3_replaced.png') });
  {
    const pc = await profileConfig(E);
    const tg = await devToggle(E);
    fact('終わりのデベロッパーモード（入れる・置き換えるのプロファイル）', { inDeveloperMode: pc.inDeveloperMode, toggleChecked: tg && tg.checked, controlledByPolicy: pc.isDeveloperModeControlledByPolicy });
  }
  await closeAll();

  // ---------- (古い版) 別のまっさらなプロファイルで、版を 1 つ下げた ZIP を入れる ----------
  const ctx2 = await launch(tempDir('profile-older'));
  await routeAll(ctx2, wrapped, net);
  const C = await openClaudeTab(ctx2, 'claude.ai のタブ（古い版）', errs);
  {
    const a = await frameAsk(C.F);
    check('古い版', '先に開いた claude.ai のタブの枠に、拡張を入れる手順が出る', !C.setupErr && a.setup, C.setupErr || JSON.stringify(a));
  }
  const E2 = await openExtensionsPage(ctx2);
  {
    const dm = await turnDevModeOn(E2);
    check('古い版', '拡張機能の画面のトグルを押して、デベロッパーモードをオンにした', dm.after && dm.after.inDeveloperMode === true, JSON.stringify(dm));
  }
  const r3 = await dropZip(E2, Z.older.path, OLDER);
  checkDrop('古い版', r3, Z.older, OLDER);
  {
    await C.tab.bringToFront();
    const w = await watchFrame(C.tab, C.F, r3.tEnabled || Date.now(), SEEN_MS, function (a) { return !a.setup && a.update; }, { setupGone: function (a) { return !a.setup; }, update: function (a) { return a.update; } });
    const nr = await notReloaded(C, 'claude.ai のタブ（古い版）');
    const want = '拡張の新しい版（' + BASE + '）があります（いまは ' + OLDER;
    check('古い版', '枠は読み込み直さずに手順を消し、' + SEEN_MS / 1000 + ' 秒以内に「' + want + '…」を出す', w.ok && w.a.updateText.indexOf(want) === 0 && nr.ok,
      JSON.stringify({ msAfterEnabled: w.first, updateText: w.a.updateText, text: w.a.text }) + ' ' + nr.detail);
    fact('古い版を入れた後の枠の文の移り変わり（有効になってからのミリ秒）', w.trail.join(' / '));
  }
  await C.tab.screenshot({ path: path.join(OUT, '4_older.png') });
  {
    const pc = await profileConfig(E2);
    const tg = await devToggle(E2);
    fact('終わりのデベロッパーモード（古い版のプロファイル）', { inDeveloperMode: pc.inDeveloperMode, toggleChecked: tg && tg.checked, controlledByPolicy: pc.isDeveloperModeControlledByPolicy });
  }
  await closeAll();

  // ---------- (通信) (誤り) ----------
  check('通信', 'route で返したもの（claude.ai の親ページ・枠・favicon）のほかに、ページからの要求が無い', net.refused.length === 0,
    net.refused.length + ' 件: ' + JSON.stringify(net.refused.slice(0, 10)));
  fact('route で返した要求', Array.from(new Set(net.served)).join(' ・ ') + '（' + net.served.length + ' 件）');
  check('誤り', 'claude.ai のタブ（親と枠）の pageerror と console error が無い', errs.length === 0, errs.length + ' 件: ' + errs.join(' | ').slice(0, 600));
  fact('一回の所要時間', ((Date.now() - tStart) / 1000).toFixed(1) + ' 秒');

  clearTimeout(killer);
  finish();
})().catch(function (e) {
  console.error('試験そのものが落ちた: ' + (e && e.stack || e));
  check('試験', '最後まで走った', false, String(e && e.message || e));
  Promise.race([closeAll(), new Promise(function (r) { setTimeout(r, 5000); })]).then(function () { finish(2); });
});
