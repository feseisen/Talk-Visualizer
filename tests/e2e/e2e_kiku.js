#!/usr/bin/env node
/*
 * e2e_kiku.js — 道具（kiku.html）を画面から通しで確かめる試験（Chromium headless、file://）
 *
 *   node tests/e2e/e2e_kiku.js [道具の根のパス] [出力フォルダ]
 *   （playwright と Chromium が要る。試験ページ tests/tests.html と違い、node 無しでは走らない。
 *    Chromium の場所は環境変数 CHROMIUM_PATH で渡す。無ければ playwright の既定の Chromium を使う）
 *
 * 1. tests/tests.html を開き、結果の表（#total）を読む
 * 2. kiku.html の縦の一筋: 経路=内蔵の模擬、入口=ファイル（tests/fixtures/meeting10.txt）、
 *    「聞き始める」→「次の窓を流す」×5。窓ごとに中央の行・左の保留と最上位・右の逐語を読む
 *    DOM の行の t が上から単調非減少、未来の行が無い、を確かめる。
 *    内蔵の模擬の台本に数え上げ（窓 1）・括り（窓 2）・括りの範囲の訂正（窓 4）があり、左の欄と中央の札に出る。
 *    分析役の欄の見えている文に英字の項目名が無く、検査器の文（規則の id つき）は畳んだ欄の中にだけある
 * 3. 「書き出す」で 2 つのファイルを落として出力フォルダに保存する（tools/audit_r2b.py に通して確かめられる）。
 *    保存先の選択を取りやめたときは「保存した」と言わない。1 つ目の保存の画面で 5 秒より長く迷って 2 つ目の画面が開けない
 *    ときは、ファイルごとにどうなったかを言う（模擬の保存の画面で確かめる）
 * 4. R10: 400/1024/1920px で横スクロール無し。R9: 「等倍」があり「1×」「1x」が無い
 * 5. 追体験: T を戻すと未来の行が DOM から消え、逐語は T で畳んだ最後のステップが渡した発話までになる
 *
 * 結果は JSON で標準出力に出す。1 件でも落ちれば終了コード 1
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const KIT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..'));
const OUT = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'kiku-e2e'));
fs.mkdirSync(OUT, { recursive: true });

// Chromium の場所は環境変数で渡す（ファイルにパスを書かない）。無ければ playwright の既定
const LAUNCH = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, headless: true } : { headless: true };

const results = [];
function check(group, name, ok, detail) {
  results.push({ group: group, name: name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.error((ok ? '合格 ' : '不合格 ') + '[' + group + '] ' + name + (detail != null ? '  — ' + String(detail).slice(0, 300) : ''));
}

async function readRows(page) {
  // #rows の子（.trow）を上から。t は timeline.js が node._t に持たせている
  return page.evaluate(function () {
    const rows = document.getElementById('rows');
    return Array.from(rows.children).map(function (c) {
      return { t: c._t, hidden: c.hidden, cls: c.className, id: (c.querySelector('.cid') || c.querySelector('.dno') || {}).textContent || '' };
    });
  });
}
async function readPanels(page) {
  return page.evaluate(function () {
    const g = function (id) { const e = document.getElementById(id); return e ? e.innerText : ''; };
    const feed = Array.from(document.querySelectorAll('#feed .fl')).filter(function (n) { return !n.classList.contains('interim') && !n.hidden; });
    return {
      edge: g('edge'), holds: g('holds'), holdhead: g('holdhead'), gaps: g('gaps'), top: g('topbox'), closed: g('closed'), notex: g('notex'),
      lists: g('lists'), chaps: g('chaps'),
      gfix: Array.from(document.querySelectorAll('#rows .gfix')).filter(function (n) { return !n.hidden; }).map(function (n) { return n.textContent; }).join(' | '),
      feedCount: feed.length,
      feedTimes: feed.map(function (n) { const ft = n.querySelector('.ft'); return ft ? ft.textContent : ''; }),
      feedJumps: Array.from(document.querySelectorAll('#feed .fc button')).map(function (b) { return b.textContent; }),
      stListen: g('st-listen'), stSince: g('st-since'), stGaps: g('st-gaps'), stRoute: g('st-route'), stIntake: g('st-intake'), clock: g('clock'), anmsgs: g('an-msgs'),
      // 畳んだ欄（検査器・分析役の機械向けの文）の中身。閉じていると innerText に出ないので textContent で読む
      anraw: Array.from(document.querySelectorAll('#an-msgs details')).map(function (d) { return d.textContent; }).join(' | ')
    };
  });
}
function parseEdge(edge) {
  // 「いま 1〜6 発話目まで判断した（S1）。…」
  const m = /いま (\d+)〜(\d+) 発話目まで判断した（S(\d+)）/.exec(edge || '');
  return m ? { l0: Number(m[1]), l1: Number(m[2]), n: Number(m[3]) } : null;
}
function toSec(s) { const p = s.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; }

(async function main() {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });

  // ---------- 1. tests.html ----------
  {
    const page = await ctx.newPage();
    const errs = []; const ext = [];
    page.on('pageerror', function (e) { errs.push(String(e && e.message || e)); });
    page.on('request', function (r) { if (!/^file:/.test(r.url())) ext.push(r.url()); });
    await page.goto('file://' + path.join(KIT, 'tests', 'tests.html'));
    await page.waitForFunction(function () { const t = document.getElementById('total'); return t && !/走らせています/.test(t.textContent); }, null, { timeout: 60000 });
    const total = await page.evaluate(function () { return document.getElementById('total').textContent; });
    const title = await page.title();
    const ng = await page.evaluate(function () { return Array.from(document.querySelectorAll('tr.ng')).map(function (tr) { return tr.innerText; }); });
    check('tests.html', '結果の表', /不合格 0 件/.test(total) && ng.length === 0, total + ' / ' + title + (ng.length ? ' / 不合格: ' + ng.join(' | ') : ''));
    check('tests.html', 'ページ内エラー無し', errs.length === 0, errs.join(' | '));
    check('tests.html', '外部リクエスト無し', ext.length === 0, ext.join(' | '));
    await page.close();
  }

  // ---------- 2. kiku.html 縦の一筋 ----------
  const page = await ctx.newPage();
  await page.addInitScript(function () { try { delete globalThis.showSaveFilePicker; globalThis.showSaveFilePicker = undefined; } catch (e) { /* 消せない */ } });
  const errs = []; const ext = []; const consoleErr = [];
  page.on('pageerror', function (e) { errs.push(String(e && e.stack || e && e.message || e)); });
  page.on('console', function (m) { if (m.type() === 'error') consoleErr.push(m.text()); });
  page.on('request', function (r) { if (!/^(file|blob|data):/.test(r.url())) ext.push(r.url()); });
  const downloads = [];
  page.on('download', function (d) { downloads.push(d); });
  await page.goto('file://' + path.join(KIT, 'kiku.html'));
  await page.waitForTimeout(500);

  // 起動直後: 画面の文字
  const bodyText0 = await page.evaluate(function () { return document.body.textContent; });
  check('R9', '「等倍」が DOM にある（速度の操作は追体験でだけ見える）', /等倍/.test(bodyText0));
  check('R9', '「1×」「1x」が無い', !/(^|[^\d\w])1[×x]([^\w]|$)/.test(bodyText0), (bodyText0.match(/.{0,10}1[×x].{0,10}/g) || []).join(' | '));
  // 速度ボタンの文字そのもの
  const speedLabels = await page.evaluate(function () { return Array.from(document.querySelectorAll('#speeds button')).map(function (b) { return b.textContent; }); });
  check('R9', '速度ボタン', speedLabels.indexOf('等倍') >= 0 && !speedLabels.some(function (s) { return /1[×x]/.test(s); }), speedLabels.join('/'));

  // R10（中身が無い状態）
  for (const w of [400, 1024, 1920]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(100);
    const r = await page.evaluate(function () { const d = document.scrollingElement; return { sw: d.scrollWidth, cw: d.clientWidth }; });
    check('R10', '空の画面 ' + w + 'px', r.sw <= r.cw, 'scrollWidth=' + r.sw + ' clientWidth=' + r.cw);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // 配線の有無（画面に「未配線」が出ていないこと）
  await page.selectOption('#route', 'mock');
  await page.selectOption('#intake', 'file');
  const setupmsg0 = await page.evaluate(function () { return document.getElementById('setupmsg').textContent; });
  check('配線', '未配線の知らせが無い（mock）', !/未配線/.test(setupmsg0), setupmsg0);
  const wiring = await page.evaluate(function () {
    const A = globalThis.TSV_ANALYST || {};
    return {
      makeVerifier: typeof globalThis.makeVerifier, fold: typeof (globalThis.TSV_FOLD && globalThis.TSV_FOLD.fold),
      analyze: typeof A.analyze, makePrompt: typeof A.makePrompt, parseReply: typeof A.parseReply, testConnection: typeof A.testConnection,
      cut: typeof (globalThis.TSV_CUT && globalThis.TSV_CUT.makeCutter), record: typeof (globalThis.TSV_RECORD && globalThis.TSV_RECORD.makeRecord),
      intake: typeof (globalThis.TSV_INTAKE && globalThis.TSV_INTAKE.makeFileIntake), timeline: typeof (globalThis.TSV_TIMELINE && globalThis.TSV_TIMELINE.makeTimeline),
      panels: typeof (globalThis.TSV_PANELS && globalThis.TSV_PANELS.makePanels),
      rules: typeof globalThis.TSV_RULES, schema: typeof globalThis.TSV_SCHEMA, prompt: typeof globalThis.TSV_PROMPT === 'string' ? globalThis.TSV_PROMPT.length : 'none'
    };
  });
  check('配線', '各部品が globalThis にある', Object.keys(wiring).every(function (k) { return k === 'prompt' ? wiring[k] > 1000 : (wiring[k] === 'function' || wiring[k] === 'object'); }), JSON.stringify(wiring));
  // 手動の輪・API を選んでも「未配線」が出ないこと（mock に戻す）
  for (const r of ['manual', 'anthropic', 'openai', 'human']) {
    await page.selectOption('#route', r);
    const m = await page.evaluate(function () { return document.getElementById('setupmsg').textContent; });
    check('配線', '経路 ' + r + ' で未配線の知らせが無い', !/未配線/.test(m), m);
  }
  await page.selectOption('#route', 'mock');

  // ファイルを選んで読む
  const fixture = path.join(KIT, 'tests', 'fixtures', 'meeting10.txt');
  await page.setInputFiles('#file', fixture);
  await page.click('#file-load');
  await page.waitForFunction(function () { return /ファイルを読んだ/.test(document.getElementById('intakemsg').textContent); }, null, { timeout: 5000 });
  await page.fill('#name', '縦の一筋');
  await page.click('#start');
  await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
  const p0 = await readPanels(page);
  check('一筋', '聞き始めた', /聞いている/.test(p0.stListen) && /内蔵の模擬/.test(p0.stRoute) && /ファイル/.test(p0.stIntake), p0.stListen + ' / ' + p0.stRoute + ' / ' + p0.stIntake);
  const rows0 = await readRows(page);
  check('一筋', '始める前は中央に行が無い', rows0.length === 0, rows0.length);

  // 「次の窓を流す」を 5 回
  const perWindow = [];
  let prevRowCount = 0;
  let prevHolds = null;
  for (let k = 1; k <= 5; k++) {
    await page.click('#file-next');
    // mock は 300ms 後に返す。書き終えると file-next が再び押せる
    await page.waitForFunction(function (n) {
      const e = document.getElementById('edge').textContent;
      const m = /（S(\d+)）/.exec(e);
      return m && Number(m[1]) === n && !document.getElementById('file-next').disabled;
    }, k, { timeout: 10000 });
    const rows = await readRows(page);
    const pn = await readPanels(page);
    const edge = parseEdge(pn.edge);
    const ts = rows.map(function (r) { return r.t; });
    const monotone = ts.every(function (t, i) { return i === 0 || ts[i - 1] <= t; });
    const heardUntil = 30 * k;
    const future = rows.filter(function (r) { return !(r.t <= heardUntil); });
    const feedMax = pn.feedTimes.length ? Math.max.apply(null, pn.feedTimes.map(toSec)) : -1;
    perWindow.push({ k: k, rows: rows.length, ts: ts, edge: edge, feedCount: pn.feedCount, feedMax: feedMax, holds: pn.holds, top: pn.top, closed: pn.closed, since: pn.stSince, gaps: pn.stGaps, notex: pn.notex.slice(0, 60), jumps: pn.feedJumps, lists: pn.lists, chaps: pn.chaps, gfix: pn.gfix });
    // 内蔵の模擬の台本: 窓 2 で括り（◆ の行）が 1 つ足される。他の窓はカード 1 枚
    const wantAdd = k === 2 ? 2 : 1;
    check('一筋', '窓 ' + k + ': 中央の行が ' + wantAdd + ' つ増えた' + (k === 2 ? '（カードと括り）' : ''), rows.length === prevRowCount + wantAdd, prevRowCount + ' → ' + rows.length);
    // 台本に数え上げ・括り・訂正がある
    if (k === 1) check('台本', '窓 1: 左の「数え上げ」に L1（3 点）が出て、いま 1 点目', /L1/.test(pn.lists) && /3 点と宣言/.test(pn.lists) && /いま 1 点目/.test(pn.lists), pn.lists.replace(/\n/g, ' ').slice(0, 120));
    if (k === 2) check('台本', '窓 2: 左の「章」に A が開いたまま出る', /章A/.test(pn.chaps) && /続いている/.test(pn.chaps), pn.chaps.replace(/\n/g, ' ').slice(0, 120));
    if (k === 2) check('台本', '窓 2: 中央に ◆ の括りの行がある', rows.some(function (r) { return /dvrow/.test(r.cls); }), rows.map(function (r) { return r.cls; }).join(','));
    if (k === 3) check('台本', '窓 3: 章 A はまだ開いている', /章A/.test(pn.chaps) && /続いている/.test(pn.chaps), pn.chaps.replace(/\n/g, ' ').slice(0, 120));
    if (k === 4) check('台本', '窓 4: 訂正（fix の span）で章 A が 2:00 で閉じ、中央の括りに「範囲を訂正」の札', /章A/.test(pn.chaps) && !/続いている/.test(pn.chaps) && /〜2:00/.test(pn.chaps) && /範囲を訂正/.test(pn.gfix), pn.chaps.replace(/\n/g, ' ').slice(0, 80) + ' / ' + pn.gfix.slice(0, 80));
    check('R1', '窓 ' + k + ': DOM の行の t が単調非減少', monotone, ts.join(','));
    check('R2b', '窓 ' + k + ': 未来の行が DOM に無い（t ≦ ' + heardUntil + '）', future.length === 0, JSON.stringify(future));
    check('一筋', '窓 ' + k + ': 判断した範囲の札（S' + k + '）', edge && edge.n === k, pn.edge);
    check('一筋', '窓 ' + k + ': 右の逐語が確定分だけ（件数 = 判断した発話数、最大 t < 窓の終わり）', edge && pn.feedCount === edge.l1 && feedMax < heardUntil, 'feed=' + pn.feedCount + ' lines[1]=' + (edge && edge.l1) + ' feedMax=' + feedMax);
    check('一筋', '窓 ' + k + ': 逐語からカードへの飛び先がある', pn.feedJumps.length >= k, pn.feedJumps.slice(-3).join(' '));
    // 左: 保留と最上位。mock は n 奇数で hold、age≧60 で close、n=1 で top
    if (k === 1) {
      check('一筋', '窓 1: 左の最上位候補が立った（C1）', /C1/.test(pn.top), pn.top.replace(/\n/g, ' '));
      check('一筋', '窓 1: 左の開いている問いに H1', /H1/.test(pn.holds), pn.holds.replace(/\n/g, ' '));
    }
    if (k === 2) check('一筋', '窓 2: H1 が決着に移った', /H1/.test(pn.closed) && !/H1/.test(pn.holds), 'closed=' + pn.closed.replace(/\n/g, ' ').slice(0, 80) + ' holds=' + pn.holds.replace(/\n/g, ' ').slice(0, 60));
    if (k === 3) check('一筋', '窓 3: 新しい保留 H2 が開いた', /H2/.test(pn.holds), pn.holds.replace(/\n/g, ' '));
    if (k === 4) check('一筋', '窓 4: H2 はまだ開いている（立ててから 59 秒）', /H2/.test(pn.holds) && !/H2/.test(pn.closed), pn.holds.replace(/\n/g, ' ').slice(0, 120));
    if (k === 5) check('一筋', '窓 5: H2 が決着に移った（89 秒）', /H2/.test(pn.closed) && !/H2/.test(pn.holds), pn.closed.replace(/\n/g, ' ').slice(0, 120));
    check('一筋', '窓 ' + k + ': 左の保留の欄が前の窓から変わった', prevHolds === null || prevHolds !== pn.holds, '');
    check('一筋', '窓 ' + k + ': 考えたこと（note）が出ている', /試験用の分析役/.test(pn.notex), pn.notex.slice(0, 40));
    check('一筋', '窓 ' + k + ': 未確定の窓 0 件', /^0 件/.test(pn.stGaps), pn.stGaps);
    check('一筋', '窓 ' + k + ': 分析役の欄に「S' + k + ' を書いた」', new RegExp('S' + k + ' を書いた').test(pn.anmsgs), pn.anmsgs.replace(/\n/g, ' ').slice(0, 160));
    if (k === 4) check('検査の一致', '窓 4: verify.js も P24 の警告を出す（rt.py status と同じ）。規則の id は畳んだ欄の中にあり、見えている文には無い', /P24/.test(pn.anraw) && !/P24/.test(pn.anmsgs) && /警告 1 件/.test(pn.anmsgs), pn.anmsgs.replace(/\n/g, ' ').slice(0, 200) + ' / 畳んだ欄: ' + pn.anraw.slice(0, 120));
    check('画面の言葉', '窓 ' + k + ': 分析役の欄の見えている文に英字の項目名が無い', !/[A-Za-z]{2,}/.test(pn.anmsgs), pn.anmsgs.replace(/\n/g, ' ').slice(0, 200));
    perWindow[perWindow.length - 1].anmsgs = pn.anmsgs;
    prevRowCount = rows.length; prevHolds = pn.holds;
  }
  await page.waitForTimeout(1600);
  const pIdle = await readPanels(page);
  check('運転状態', '5 窓の後、返事待ちでない（最後の判断から N 秒）', !/返事を待っている/.test(pIdle.stSince) && /^\d+:\d\d/.test(pIdle.stSince), pIdle.stSince);
  // 「すべてのカード」にして見える行を数える（「要点のみ」では hidden の行がある）
  await page.click('#modes button[data-m="all"]');
  await page.waitForTimeout(100);
  const rowsAll = await readRows(page);
  check('一筋', '「すべてのカード」で 6 行（カード 5 ＋ 括り 1）すべて見える', rowsAll.length === 6 && rowsAll.every(function (r) { return !r.hidden; }) && rowsAll.filter(function (r) { return /^C\d/.test(r.id); }).length === 5 && rowsAll.filter(function (r) { return /^章/.test(r.id); }).length === 1, JSON.stringify(rowsAll.map(function (r) { return [r.id, r.t, r.hidden]; })));
  const marks = await page.evaluate(function () { return Array.from(document.querySelectorAll('#rows .mark')).map(function (m) { return m.textContent; }); });
  check('R5', '印は ● と ◆ だけ', marks.every(function (m) { return m === '●' || m === '◆'; }), Array.from(new Set(marks)).join(''));

  // R7: 縦線と文字の矩形が交差しない
  const r7 = await page.evaluate(function () {
    const spine = document.querySelector('.itl-spine');
    if (!spine) return { ok: false, why: 'spine が無い' };
    const s = spine.getBoundingClientRect();
    if (s.width === 0) return { ok: true, why: '縦線の幅 0' };
    const walker = document.createTreeWalker(document.getElementById('itl'), NodeFilter.SHOW_TEXT);
    const hits = [];
    let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (!el || el.hidden || el.closest('[hidden]')) continue;
      if (el.classList.contains('mark')) continue; // 節点の記号 ●◆ は縦線の上に置く作り（除く）
      const range = document.createRange(); range.selectNodeContents(n);
      Array.from(range.getClientRects()).forEach(function (r) {
        if (r.width === 0 || r.height === 0) return;
        const ox = Math.min(r.right, s.right) - Math.max(r.left, s.left);
        const oy = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
        if (ox > 0 && oy > 0) hits.push(n.textContent.trim().slice(0, 20));
      });
    }
    return { ok: hits.length === 0, why: hits.join(' | ') };
  });
  check('R7', '縦線と文字の矩形が交差しない（節点の記号 ●◆ は除く）', r7.ok, r7.why);
  const r7marks = await page.evaluate(function () { const s = document.querySelector('.itl-spine').getBoundingClientRect(); return Array.from(document.querySelectorAll('#rows .mark')).map(function (m) { const r = m.getBoundingClientRect(); return (Math.min(r.right, s.right) - Math.max(r.left, s.left)) > 0; }); });
  check('R7', '（参考）縦線の上に乗っている印の数', true, r7marks.filter(Boolean).length + ' / ' + r7marks.length + '（深さ 0 の印は縦線の上、深さ 1 は右へずれる）');

  // R10（中身がある状態）
  for (const w of [400, 1024, 1920]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(150);
    const r = await page.evaluate(function () { const d = document.scrollingElement; return { sw: d.scrollWidth, cw: d.clientWidth }; });
    check('R10', '5 窓の後 ' + w + 'px', r.sw <= r.cw, 'scrollWidth=' + r.sw + ' clientWidth=' + r.cw);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(OUT, 'kiku_after5.png'), fullPage: true });

  // 画面の文字に英字の内部名が無いか（粗い: 英単語だけの行）
  const bodyText = await page.evaluate(function () { return document.body.innerText; });
  const engLines = bodyText.split('\n').map(function (s) { return s.trim(); }).filter(function (s) { return /^[A-Za-z_][A-Za-z0-9_]{3,}$/.test(s); });
  check('画面の言葉', '英字だけの行が無い', engLines.length === 0, engLines.join(' | '));

  // ---------- 追体験: T を戻すと未来の行が消える（おまけ） ----------
  await page.click('#views button[data-v="replay"]');
  await page.waitForTimeout(100);
  await page.evaluate(function () { const s = document.getElementById('scrub'); s.value = 75; s.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(200);
  const rowsT = await readRows(page);
  const pT = await readPanels(page);
  // at（壁時計）で畳む設計なので、T=75 の時点では S1・S2 の分まで（mock は窓の終わりちょうどに返すわけではないので「2 行以下」で見る）
  check('R2b', '追体験 T=75: 行が減り、t > 75 の行が無い', rowsT.length < 6 && rowsT.every(function (r) { return r.t <= 75; }), JSON.stringify(rowsT.map(function (r) { return [r.id, r.t]; })) + ' feed=' + pT.feedCount);
  check('R2b', '追体験 T=75: 逐語も t ≦ 75 だけ', pT.feedTimes.every(function (s) { return toSec(s) <= 75; }), 'feed=' + pT.feedCount);
  const eT = parseEdge(pT.edge);
  check('R2b', '追体験 T=75: 逐語の件数は、T で畳んだ最後のステップが渡した発話の数（その lines の終わり）と同じ', eT && eT.n === 2 && pT.feedCount === eT.l1, 'feed=' + pT.feedCount + ' / ' + pT.edge);
  const replayText = await page.evaluate(function () { return document.body.innerText; });
  check('R9', '追体験の画面の文字に「等倍」がある', /等倍/.test(replayText));
  const clockBefore = await page.evaluate(function () { return document.getElementById('clock').textContent; });
  await page.evaluate(function () { window.scrollTo(0, 400); });
  await page.waitForTimeout(200);
  const clockAfter = await page.evaluate(function () { return document.getElementById('clock').textContent; });
  check('R11', '追体験でスクロールしても時計が動かない', clockBefore === clockAfter, clockBefore + ' → ' + clockAfter);
  await page.click('#views button[data-v="live"]');
  await page.waitForTimeout(200);
  const rowsBack = await readRows(page);
  check('一筋', 'ライブに戻すと 6 行', rowsBack.length === 6, rowsBack.length);

  // ---------- 3. 書き出す ----------
  await page.click('#export');
  const t0 = Date.now();
  while (downloads.length < 2 && Date.now() - t0 < 15000) await page.waitForTimeout(100);
  check('書き出し', '2 つのファイルが落ちた', downloads.length === 2, downloads.length + ' 件 ' + downloads.map(function (d) { return d.suggestedFilename(); }).join(','));
  const saved = {};
  for (const d of downloads) {
    const name = d.suggestedFilename();
    const tmp = await d.path();
    const txt = fs.readFileSync(tmp, 'utf8');
    const kind = /"e":"open"/.test(txt.split('\n')[0]) ? 'log' : 'src';
    const dst = path.join(OUT, kind === 'log' ? 'e2e.jsonl' : 'e2e.src.jsonl');
    fs.writeFileSync(dst, txt);
    saved[kind] = { name: name, path: dst, lines: txt.split('\n').filter(Boolean).length };
  }
  check('書き出し', '判断ログと素材ログが 1 つずつ', !!(saved.log && saved.src), JSON.stringify(saved));
  const recmsg = await page.evaluate(function () { return document.getElementById('recmsg').textContent; });
  if (saved.log) {
    const log = fs.readFileSync(saved.log.path, 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
    const steps = log.filter(function (e) { return e.e === 'step'; });
    const cards = log.filter(function (e) { return e.e === 'card'; });
    check('書き出し', '判断ログに open + 5 step + 5 card', log[0].e === 'open' && log[0].v === 2 && steps.length === 5 && cards.length === 5, 'open.v=' + log[0].v + ' steps=' + steps.length + ' cards=' + cards.length + ' lines=' + log.length);
    const kinds = {}; log.forEach(function (e) { kinds[e.e] = (kinds[e.e] || 0) + 1; });
    const fx = log.filter(function (e) { return e.e === 'fix'; })[0];
    check('台本', '判断ログに list・group・fix があり、fix の was は検査器が埋めて now の手前にある', kinds.list === 1 && kinds.group === 1 && kinds.fix === 1 && fx && Object.keys(fx).indexOf('was') === Object.keys(fx).indexOf('now') - 1 && JSON.stringify(fx.was) === JSON.stringify([fx.now[0], null]), JSON.stringify(kinds) + ' ' + JSON.stringify(fx));
    check('台本', 'カードの li が記録にあり（数え上げの何点目か）、li:null の欄は無い', cards.every(function (c) { return Array.isArray(c.li) && c.li[0] === 'L1'; }), cards.map(function (c) { return JSON.stringify(c.li); }).join(' '));
    check('書き出し', 'step.at がどれも入っていて単調', steps.every(function (s) { return typeof s.at === 'string'; }) && steps.every(function (s, i) { return i === 0 || steps[i - 1].at <= s.at; }), steps.map(function (s) { return s.at; }).join(' '));
    check('書き出し', 'step.lines が連続', steps.every(function (s, i) { return i === 0 ? s.lines[0] === 1 : s.lines[0] === steps[i - 1].lines[1] + 1; }), steps.map(function (s) { return s.lines.join('-'); }).join(' '));
    check('書き出し', 'step.t が 30 秒刻み', steps.every(function (s, i) { return s.t[0] === 30 * i && s.t[1] === 30 * (i + 1); }), steps.map(function (s) { return s.t.join('-'); }).join(' '));
  }
  if (saved.src) {
    const src = fs.readFileSync(saved.src.path, 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
    check('書き出し', '素材ログの i が 1 から連番で、t < 150', src.every(function (l, i) { return l.i === i + 1 && l.t < 150 && typeof l.at === 'string'; }), 'n=' + src.length + ' last=' + JSON.stringify(src[src.length - 1]));
  }

  // ---------- 3b. 保存先の選択を取りやめたとき ----------
  // 保存の画面（showSaveFilePicker）を模擬して、取りやめ（AbortError）と保存を作り分ける
  // 'slow' は 5.2 秒かけて保存する（1 つ目の画面で迷った人）。'gesture' は、押してから 5 秒を過ぎていれば SecurityError で断る
  // （Chromium は、押してから約 5 秒を過ぎると保存の画面を開かせない）
  await page.evaluate(function () {
    globalThis.__pickerCalls = 0;
    globalThis.__pickerPlan = [];   // 呼ばれた順に 'cancel'・'save'・'slow'・'gesture'
    document.getElementById('export').addEventListener('click', function () { globalThis.__clickAt = Date.now(); }, true);
    const handle = { createWritable: function () { return Promise.resolve({ write: function () { return Promise.resolve(); }, close: function () { return Promise.resolve(); } }); } };
    globalThis.showSaveFilePicker = function () {
      const plan = globalThis.__pickerPlan[globalThis.__pickerCalls++] || 'cancel';
      if (plan === 'cancel') { const e = new Error('取りやめ'); e.name = 'AbortError'; return Promise.reject(e); }
      if (plan === 'slow') return new Promise(function (res) { setTimeout(function () { res(handle); }, 5200); });
      if (plan === 'gesture' && Date.now() - globalThis.__clickAt > 5000) { const e = new Error('押してから時間がたった'); e.name = 'SecurityError'; return Promise.reject(e); }
      return Promise.resolve(handle);
    };
  });
  const dlBefore = downloads.length;
  await page.evaluate(function () { globalThis.__pickerPlan = ['cancel', 'cancel']; globalThis.__pickerCalls = 0; });
  await page.click('#export');
  await page.waitForFunction(function () { return /保存先を選ばなかった|落とした|保存した/.test(document.getElementById('recmsg').textContent); }, null, { timeout: 5000 });
  const recCancel = await page.evaluate(function () { return document.getElementById('recmsg').textContent; });
  check('書き出し', '2 つとも取りやめ: 「保存先を選ばなかった。記録はこの画面の中にだけある」と言い、「保存した」と言わない', /保存先を選ばなかった。記録はこの画面の中にだけある/.test(recCancel) && !/落とした|保存した/.test(recCancel), recCancel);
  await page.evaluate(function () { globalThis.__pickerPlan = ['save', 'cancel']; globalThis.__pickerCalls = 0; });
  await page.click('#export');
  await page.waitForFunction(function () { return /だけ保存した/.test(document.getElementById('recmsg').textContent); }, null, { timeout: 5000 });
  const recHalf = await page.evaluate(function () { return document.getElementById('recmsg').textContent; });
  check('書き出し', '判断ログだけ保存して素材ログを取りやめ: どちらを保存したかを言う', /縦の一筋\.jsonl だけ保存した/.test(recHalf) && /保存先を選ばなかった/.test(recHalf), recHalf);
  await page.waitForTimeout(300);
  check('書き出し', '取りやめのとき a[download] で勝手に落とさない', downloads.length === dlBefore, downloads.length - dlBefore + ' 件増えた');
  // 1 つ目の保存の画面で 5 秒より長く迷うと、2 つ目の画面は開けず（SecurityError）、素材ログはダウンロードのフォルダへ落ちる。
  // 一言は、1 つ目の結果だけで「保存先を選んだ」と言わず、ファイルごとにどうなったかと、名前を付け直すことを言う
  await page.evaluate(function () { globalThis.__pickerPlan = ['slow', 'gesture']; globalThis.__pickerCalls = 0; document.getElementById('recmsg').textContent = ''; });
  const dlSlow = downloads.length;
  await page.click('#export');
  await page.waitForFunction(function () { return /保存/.test(document.getElementById('recmsg').textContent); }, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  const recSlow = await page.evaluate(function () { return document.getElementById('recmsg').textContent; });
  // 落ちたファイルの名前は、file:// からだと「download」になる（headless の Chromium で見た）。中身で素材ログかを見る
  const slowFiles = [];
  for (const d of downloads.slice(dlSlow)) slowFiles.push({ name: d.suggestedFilename(), src: !/"e":"open"/.test(fs.readFileSync(await d.path(), 'utf8').split('\n')[0]) });
  check('書き出し', '1 つ目の画面で迷って 2 つ目の画面が開けない: 判断ログは選んだ保存先に、素材ログはダウンロードのフォルダに落としたと、ファイルごとに言う（名前の付け直しも）',
    /縦の一筋\.jsonl は、選んだ保存先に保存した/.test(recSlow) && /縦の一筋\.src\.jsonl は、保存の画面を開けなかったので、ダウンロードのフォルダに落とした/.test(recSlow) &&
      /縦の一筋\.src\.jsonl に付け直す/.test(recSlow) && !/保存先を選んだ）/.test(recSlow) && slowFiles.length === 1 && slowFiles[0].src &&
      (slowFiles[0].name === '縦の一筋.src.jsonl' || slowFiles[0].name === 'download'),
    recSlow + ' / 落ちたファイル ' + JSON.stringify(slowFiles));

  check('kiku.html', 'ページ内エラー無し', errs.length === 0, errs.join(' | '));
  check('kiku.html', 'console.error 無し', consoleErr.length === 0, consoleErr.join(' | '));
  check('kiku.html', '外部リクエスト無し', ext.length === 0, ext.join(' | '));

  await browser.close();
  const ng = results.filter(function (r) { return !r.ok; });
  const out = { results: results, perWindow: perWindow, saved: saved, recmsg: recmsg, ng: ng.length, total: results.length };
  fs.writeFileSync(path.join(OUT, 'e2e_result.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ total: results.length, ng: ng.length, saved: saved, recmsg: recmsg }, null, 1));
  process.exit(ng.length ? 1 : 0);
})().catch(function (e) { console.error('試験そのものが落ちた: ' + (e && e.stack || e)); process.exit(2); });
