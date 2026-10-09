#!/usr/bin/env node
/*
 * e2e_routes.js — kiku.html の他の経路・入口を画面から押す（Chromium headless、file://）
 *
 *   node tests/e2e/e2e_routes.js [道具の根のパス] [出力フォルダ]
 *   （playwright と Chromium が要る。Chromium の場所は環境変数 CHROMIUM_PATH で渡す。無ければ playwright の既定）
 *
 * A. 手動の輪（L3）: 入口=ファイル。「次の窓を流す」→ プロンプトが出る → 返事を貼って「取り込む」→ S1 が書かれる。
 *    違反文（規則の id つき）は「分析役に返した文（そのまま）」の畳んだ欄にだけあり、見えている文は日本語
 * B. 人が書く（L0）: 入口=ファイル。「次の窓を流す」→ フォームでカードを足して「この窓を書く」→ S1 が書かれる。
 *    所感が空のままでは送れない
 * C. 打つ／貼る（T0）＋ 内蔵の模擬: 窓幅 5 秒。textarea に打って Enter → 5 秒で窓が閉じ、模擬が S1 を書く
 * D. 聞き終える: C の続きで「聞き終える」→ end が書かれ、札が「聞き終えた」
 * E. ファイル入口の穴: 貼った全文が聞き始めた後の DOM に残らない。窓幅より長い沈黙でも「次の窓を流す」が
 *    発話の入る次の窓まで進む。gap の最小バッチすら書けない窓（壁時計の巻き戻しで P08）は捨てず次の窓に
 *    合流させ、3 窓続けば聞き取りを止めて大きく知らせる
 * F. ブラウザ音声認識（模擬の認識器）: 認識の切断・再開の行（i の無い出来事）が逐語に日本語の札で出て、追体験で T を
 *    戻すと消え、戻し直しても二重にならない。ライブで聞いた記録の追体験は壁時計で畳む
 * G. 手動の輪の壊れた返事と追体験: 機械向けの形でない返事・判断の並びが無い返事も同じ窓の 1 回に数え、3 回で未確定の窓。
 *    画面の文は日本語で、分析役に返した文は畳んだ欄に。追体験で T を戻すと、運転状態の札「未確定の窓」は T で畳んだ状態から
 *    数え（左の欄と食い違わない）、手動の輪のプロンプト欄と分析役の欄に T より先の窓が出ない（DOM にも無い）。
 *    ライブに戻すと、預けたプロンプトがそのまま戻り、返事を取り込める
 * H. 打つ／貼る（ライブ）の終わりと中断: 打ってすぐ「聞き終える」→ 最後の窓は聞き終えた秒までで閉じ、聞き終える前に
 *    判断を押した違反（P27）に落ちずに書かれる。窓を書いたあと時間をおいて「中断する」→ 中断は読み終えた所に置かれ（P22）、
 *    再開して続きが書ける。最初の窓より前の中断は 0 に置かれる
 * I. ファイルの終わりちょうどの発話: 0:05・0:20・0:30 で終わる素材の最初の窓は 0:00〜0:30 で発話 1〜2 だけ
 *    （0:30 の発話は、最後の発話でも次の窓）
 * J. 時刻の打ち間違い（3 番目だけ 50:00）のある素材: 時刻は読むときに単調になり、1 つの窓の発話は 40 件まで。
 *    上限で切った窓は、終わりを渡さなかった最初の発話の時刻まで縮める（ここでは幅 0 の窓になる）。
 *    追体験の逐語は、T で畳んだ最後のステップが渡した発話だけを出す（時刻が T 以下でも、まだ渡していない発話は出ない）
 * K. 人が書く＋ファイル＋時刻の打ち間違いと読めない行: ライブの右の逐語も、窓として渡した発話だけ（窓を待っている数だけを
 *    知らせる）。読めない行は発話にせず、逐語と入口の欄に行の番号を出す。時刻が飛んでいる行も入口の欄に出す
 * L. 続きから聞く（ファイル）: 読み込み直して同じ名前・同じ素材で聞き始めると、素材ログの発話の数だけ素材の頭を読み飛ばす
 *    （済んだ発話と読めない行の記録を二重に入れない。窓は前の続き）。素材が違う・短い・読み込んでいない・入口が違う、は断る
 * M. 窓幅は 5〜180 の整数の秒。小数・範囲の外は聞き始めずに断る
 * N. 中断の間に打った行（打つ／貼る、窓幅 5）: 中断の前・中断の間・再開の後の 3 行がすべて素材ログに残り、中断の間の行は
 *    再開した後の最初の窓に入る。中断の間も欄は打てて、入口の札が「打った行は捨てない」と言う。
 *    中断の間に打ったまま「聞き終える」を押しても、その行は最後の窓に入る
 * O. 話者の切り出し（打つ／貼る）: 「司会: 始めます」「司会：始めます」は話者「司会」。「15:00までに…」「9:00 から…」
 *    「16:9 の…」「https://…」「0:05 司会: …」は行の全体が話者無しの本文。「結論：A案」は話者「結論」（形からは区別できない）。
 *    画面の説明も、半角の「:」のあとの空白と、時刻・住所で始まる行のことを言う
 * P. 時刻で始まる本文の行（ファイル）: 前の発話の続きとして読み、入口の欄に行の番号を残す
 * Q. WebVTT の素材（ファイル）: 発話・窓・窓ごとの知らせの文・end の t が共通の期待値と rt.py と同じ
 * R. ライブで遅れて閉じる窓の終わりは窓幅の目盛り。中断中の札を知らせで上書きしない。end の t は rt.py と同じ
 * S. 音声の入口で中断と再開を素早く繰り返しても、動く認識は 1 つで、同じ発話が二重にならない
 * T. 40 件の上限で切れる窓: 後ろの窓に回った発話の知らせを、前の窓の入口の欄に出さない
 * U. 音声の入口の「聞き終える」: 認識の終わりの知らせを 3 秒まで待ち、その間に届いた確定の結果も最後の窓に入れる。
 *    3 秒で来なければ、知らせの欄と素材ログにそう残して閉じる
 * V. 中断のあと再開せずに聞き終える（打つ／貼る、窓幅 5）: 最後の窓の終わりは聞き終えた時計の秒（幅は窓幅の 3 倍まで）。
 *    同じ並びと時計を rt.py（open --live・watch --once・next・append・pause・next --last）に渡した窓と同じ
 * W. 発話の無い素材（ファイル）: 記録を作らずに断り、断りの文が共通の期待値と rt.py と同じ。WEBVTT の行の無い字幕は字幕として読む。
 *    0 バイトのファイル・空白だけのファイル・空白だけを貼った素材も「先に読み込む」とは言わずに同じ文で断り、見出しの行のせいで
 *    字幕と決めた素材は、何行目で字幕と決めたかを文に添える（K31）
 * X. 続きから聞くときの知らせ（ファイル）: まだ窓で渡していない発話の知らせを、その発話を渡す窓で出す（rt.py と同じ文）
 * Y. 音声の入口で中断し、古い認識の終わりの知らせが来る前に再開して、そのまま聞き終える（K29）: 古い認識が 3 秒の中で返した
 *    結果は最後の窓に入り、3 秒より後に返した結果は記録に入れずに素材ログの出来事 late として残って知らせの欄に出る。聞き終えた
 *    後は late のほかの出来事を素材ログに足さない。聞き終えて別の記録を開いた後に届いた結果は、前の記録の素材ログに残る
 * Z. 音声をどこで文字にするか（模擬の認識器）: この PC の中で文字にできるなら承知の印なしで始まり processLocally を立てる。
 *    できない（調べる口が無い）なら承知の印が無いと聞き始めず記録も作らない。日本語の部品はボタンで入れられ、入ったら端末内で
 *    始まる。端末内で始めた後に「言語が使えない」と言われたら再開せず、提供元のサーバーへ切り替えず、「止まっている」と出す。
 *    終わりの知らせが来ない形（Chromium の実物）でも同じに止まり、「聞き終える」は 3 秒待たずに進む（Z2b）。
 *    認識の通信が止められている形では、始め直しの待ちを延ばして 5 回で止め、素材ログの行は限られ、入口を「打つ／貼る」に
 *    して「聞き始める」を押すと同じ記録の続きを書ける（Z5）。「聞き始める」を押してから記録を開き終えるまでは入口と音声の
 *    行き先の欄を変えられず、その間に入口が音声に変わっても承知の印が無ければ認識を作らない（Z4。保存を遅らせて確かめる）
 * AA. API の設定の断り: 鍵が空・OpenAI 互換のモデルが空・Anthropic で住所の欄に何かある、は聞き始めず（「接続を試す」も送らず）、
 *    外へ要求を出さない。分析役を変えると「接続を試す」の結果の文を消す。API の設定の欄と手動の輪の欄が、外へ何を渡すかを言う。
 *    「記録を消す」で読み込み直した後に、消したことを 1 行で言う
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
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
const txt = function (page, id) { return page.evaluate(function (id) { const e = document.getElementById(id); return e ? e.innerText : ''; }, id); };
// 分析役の欄の畳んだ欄（機械向けの文）の中身。閉じていると innerText に出ないので textContent で読む
const rawTxt = function (page) { return page.evaluate(function () { return Array.from(document.querySelectorAll('#an-msgs details')).map(function (d) { return d.textContent; }).join(' | '); }); };
const rowCount = function (page) { return page.evaluate(function () { return document.getElementById('rows').children.length; }); };

async function fresh(ctx, name) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', function (e) { errs.push(String(e && e.message || e)); });
  await page.goto('file://' + path.join(KIT, 'kiku.html'));
  await page.waitForTimeout(300);
  await page.fill('#name', name);
  return { page: page, errs: errs };
}
async function loadFixture(page) {
  await page.selectOption('#intake', 'file');
  await page.setInputFiles('#file', path.join(KIT, 'tests', 'fixtures', 'meeting10.txt'));
  await page.click('#file-load');
  await page.waitForFunction(function () { return /ファイルを読んだ/.test(document.getElementById('intakemsg').textContent); }, null, { timeout: 5000 });
}

(async function main() {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });

  // ---------- A. 手動の輪 ----------
  {
    const f = await fresh(ctx, '手動の輪の試験'); const page = f.page;
    await page.selectOption('#route', 'manual');
    await loadFixture(page);
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    await page.waitForFunction(function () { return document.getElementById('man-prompt').value.length > 100; }, null, { timeout: 5000 });
    const prompt = await page.evaluate(function () { return document.getElementById('man-prompt').value; });
    const packPart = await page.evaluate(function () { const v = document.getElementById('man-prompt').value; const pre = globalThis.TSV_PROMPT || ''; return v.indexOf(pre) === 0 ? v.slice(pre.length) : v; });
    check('L3', 'プロンプトが出た（指示文＋状態＋窓）', prompt.length > 5000 && /では始めます/.test(prompt) && /"next_ids"/.test(prompt), prompt.length + ' 字（指示文の後ろ ' + packPart.length + ' 字）');
    check('L3', '状態と窓の部分に総尺・残り・先の発話が無い', !/総尺|残り|"i":\s*1[1-9]|"i":\s*[2-9]\d|10:00|"t":\s*6\d\d/.test(packPart), packPart.slice(0, 200));
    const an0 = await txt(page, 'an-msgs');
    const wm = /窓 (\d+):(\d\d)〜(\d+):(\d\d)（(\d+) 発話）/.exec(an0);
    const w0 = wm ? Number(wm[1]) * 60 + Number(wm[2]) : 0, w1 = wm ? Number(wm[3]) * 60 + Number(wm[4]) : 30, nl = wm ? Number(wm[5]) : 0;
    check('L3', '分析役の欄に手順（手動の輪は 60 秒窓）', /プロンプトを出した/.test(an0) && w1 - w0 === 60, an0.replace(/\n/g, ' '));
    // わざと壊れた返事（未来の時刻）→ 検証に落ちて出し直し
    const bad = JSON.stringify({ step: { t: [w0, w1] }, events: [{ e: 'card', id: 'C1', t: w1 + 15, d: 0, role: 'claim', who: '日向', src: [1, 2], li: null, ti: '未来のカード', b: '' }], note: { x: '壊れた返事' } });
    await page.fill('#man-reply', bad);
    await page.click('#man-apply');
    await page.waitForTimeout(200);
    const an1 = await txt(page, 'an-msgs');
    const raw1 = await rawTxt(page);
    check('L3', '未来の時刻のカードは P09 で落ち、出し直し 2 回目（違反文は畳んだ欄「分析役に返した文（そのまま）」に）', /出し直し 2 回目/.test(an1) && /分析役に返した文（そのまま）/.test(an1) && /P09/.test(raw1) && !/P07/.test(raw1), an1.replace(/\n/g, ' ').slice(0, 200) + ' / 畳んだ欄: ' + raw1.slice(0, 120));
    check('画面の言葉', '手動の輪: 見えている文に規則の id も英字の項目名も無い', !/[A-Za-z]{2,}|P\d\d/.test(an1), an1.replace(/\n/g, ' ').slice(0, 200));
    const prompt2 = await page.evaluate(function () { return document.getElementById('man-prompt').value; });
    check('L3', '出し直しのプロンプトに違反文が載る', /"attempt":\s*2/.test(prompt2) && /P09/.test(prompt2), '');
    // 正しい返事（返事の全体を囲み ```json … ``` で 1 回だけ包んだもの → parseReply が外して読む。囲みの外の前置きは読まない）
    const good = '```json\n' + JSON.stringify({ step: { t: [w0, w1] }, events: [{ e: 'card', id: 'C1', t: w0, d: 0, role: 'claim', who: '日向', src: [1, 2, 3], li: null, ti: '手動の輪の試験カード', b: '三点の宣言。' }, { e: 'hold', id: 'H1', t: w0 + 20, who: '栗原', q: '三社の反応はどう割れているのか' }], note: { x: '手動の輪の試験。予測はしない。' } }, null, 1) + '\n```';
    await page.fill('#man-reply', good);
    await page.click('#man-apply');
    await page.waitForFunction(function () { return /S1 を書いた/.test(document.getElementById('an-msgs').textContent); }, null, { timeout: 5000 });
    const edge = await txt(page, 'edge');
    check('L3', '返事を取り込んで S1 が書かれた（' + nl + ' 発話）', /S1/.test(edge) && (await rowCount(page)) === 1 && new RegExp('1〜' + nl + ' 発話目').test(edge), edge);
    const holds = await txt(page, 'holds');
    check('L3', '左に H1', /H1/.test(holds), holds.replace(/\n/g, ' '));
    check('L3', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- B. 人が書く ----------
  {
    const f = await fresh(ctx, '人が書く試験'); const page = f.page;
    await page.selectOption('#route', 'human');
    await loadFixture(page);
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /0:00〜0:30/.test(document.getElementById('h-win').textContent); }, null, { timeout: 5000 });
    const hwin = await txt(page, 'h-win');
    check('L0', '窓の発話がフォームに出た（0:00〜0:30 の 6 発話、先の発話は無い）', /では始めます/.test(hwin) && /反応は割れています/.test(hwin) && !/一社目は/.test(hwin), hwin.slice(0, 80));
    await page.fill('#h-cti', '人が書いたカード');
    await page.fill('#h-cb', '三点の宣言');
    await page.click('#h-cadd');
    await page.fill('#h-hq', '人が立てた問い');
    await page.click('#h-hadd');
    const hl = await txt(page, 'h-list');
    check('L0', '足したものの一覧', /人が書いたカード/.test(hl) && /人が立てた問い/.test(hl), hl);
    await page.fill('#h-note', '人が書いた窓');
    await page.click('#h-write');
    await page.waitForFunction(function () { return /S1 を書いた/.test(document.getElementById('an-msgs').textContent); }, null, { timeout: 5000 });
    check('L0', 'S1 が書かれ、行が 1 つ', (await rowCount(page)) === 1 && /S1/.test(await txt(page, 'edge')), await txt(page, 'edge'));
    const holds = await txt(page, 'holds');
    check('L0', '左に H1（番号は自動）', /H1　人が立てた問い/.test(holds), holds.replace(/\n/g, ' '));
    const noteAfter = await page.evaluate(function () { return document.getElementById('h-note').value; });
    check('L0', '書いたあと所感の欄は空になる（前の窓の所感を次に持ち越さない）', noteAfter === '', JSON.stringify(noteAfter));
    // 2 つ目の窓: 所感が空のままでは送れない（道具が埋めない）
    await page.click('#file-next');
    await page.waitForFunction(function () { return /0:30〜1:00/.test(document.getElementById('h-win').textContent); }, null, { timeout: 5000 });
    await page.selectOption('#h-xid', 'H1');
    await page.fill('#h-xas', '人が閉じた');
    await page.click('#h-xadd');
    await page.click('#h-write');
    await page.waitForTimeout(300);
    const anEmpty = await txt(page, 'an-msgs');
    check('L0', '所感が空だと「所感を一行書く」と言って送らない（S2 は書かれない）', /所感を一行書く/.test(anEmpty) && !/S2 を書いた/.test(anEmpty) && (await rowCount(page)) === 1 && /S1/.test(await txt(page, 'edge')), anEmpty.replace(/\n/g, ' ').slice(0, 120));
    check('L0', '所感が空でも足したもの（決着）は消えない', /決着 H1/.test(await txt(page, 'h-list')), await txt(page, 'h-list'));
    await page.fill('#h-note', '人が書いた 2 つ目の窓');
    await page.click('#h-write');
    await page.waitForFunction(function () { return /S2 を書いた/.test(document.getElementById('an-msgs').textContent); }, null, { timeout: 5000 });
    const closed = await txt(page, 'closed');
    check('L0', 'S2 で H1 を閉じた（決着の欄に）', /H1/.test(closed) && /人が閉じた/.test(closed), closed.replace(/\n/g, ' ').slice(0, 120));
    check('L0', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- C/D. 打つ／貼る ＋ mock（5 秒窓）→ 聞き終える ----------
  {
    const f = await fresh(ctx, '打つ入口の試験'); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'text');
    await page.fill('#win', '5');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('ta').disabled; }, null, { timeout: 10000 });
    await page.click('#ta');
    await page.keyboard.type('日向: 打つ入口の試験です。');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    const feedOf = function () { return page.evaluate(function () { return Array.from(document.querySelectorAll('#feed .fl')).filter(function (n) { return !n.hidden && !n.classList.contains('interim'); }).map(function (n) { return n.innerText; }); }); };
    const feed1 = await feedOf();
    const wait1 = await page.evaluate(function () { const n = document.querySelector('#feed .fl.interim'); return n && !n.hidden ? n.innerText : ''; });
    check('T0', 'Enter で確定しても、窓として渡すまでは右の逐語に出ない（窓を待っている数だけ出る）', feed1.length === 0 && /窓を待っている発話 1 件/.test(wait1), JSON.stringify(feed1) + ' / ' + wait1);
    await page.keyboard.type('二つ目の発話。');
    await page.keyboard.press('Enter');
    // 5 秒窓が閉じて mock が書くまで待つ
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent); }, null, { timeout: 15000 });
    check('T0', '5 秒窓が閉じ、mock が S1 を書いた', (await rowCount(page)) === 1, await txt(page, 'edge'));
    const feed2 = await feedOf();
    check('T0', '窓として渡したあと、逐語に話者つきで 2 発話が出た', feed2.length === 2 && /日向/.test(feed2[0]) && /打つ入口の試験です/.test(feed2[0]) && /二つ目の発話/.test(feed2[1]), JSON.stringify(feed2));
    const stWin = await txt(page, 'st-win');
    check('T0', '札の窓幅が 5 秒', /^5 秒/.test(stWin), stWin);
    // 聞き終える
    await page.click('#end');
    await page.waitForFunction(function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 15000 });
    check('D', '「聞き終える」で end が書かれ、札が「聞き終えた」', true, await txt(page, 'setupmsg'));
    const holdhead = await txt(page, 'holdhead');
    check('D', '左の見出しが「答えが出ないまま終わった問い」', /答えが出ないまま終わった問い/.test(holdhead), holdhead);
    // 再読込して同じ名前で始めると「もう聞き終えている」
    await page.reload();
    await page.waitForTimeout(500);
    const rec = await txt(page, 'recmsg');
    check('D', '再読込後、このブラウザに残っている記録の名前が出る', /打つ入口の試験/.test(rec), rec);
    await page.fill('#name', '打つ入口の試験');
    await page.selectOption('#route', 'mock');
    await page.click('#start');
    await page.waitForFunction(function () { return /聞き終えている/.test(document.getElementById('setupmsg').textContent); }, null, { timeout: 5000 });
    check('D', '聞き終えた記録には続きを書かせない', true, await txt(page, 'setupmsg'));
    check('T0', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- E. ファイル入口の穴（貼り付け欄・沈黙の窓・書けない窓の合流と停止） ----------
  {
    // E1/E2: 貼った全文（0:05 のあと 1:10 まで沈黙、9:50 に 1 発話）
    const f = await fresh(ctx, '沈黙のある貼り付け'); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'file');
    const pasted = '0:05\t甲\t最初の発話\n1:10\t乙\t沈黙のあとの発話\n1:12\t甲\t三つ目\n9:50\t甲\t九分五十秒の発話\n';
    await page.fill('#file-paste', pasted);
    await page.dispatchEvent('#file-paste', 'change');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    const d0 = await page.evaluate(function () { return { paste: document.getElementById('file-paste').value, text: document.body.innerText, html: document.body.innerHTML }; });
    check('貼り付け', '聞き始めたら貼り付け欄の値が空（全文を DOM に残さない）', d0.paste === '', JSON.stringify(d0.paste).slice(0, 60));
    check('貼り付け', '聞き始めた時点で、先の発話の文字が画面にも DOM にも無い', d0.text.indexOf('九分五十秒') < 0 && d0.html.indexOf('九分五十秒') < 0 && d0.html.indexOf('沈黙のあとの発話') < 0, '');
    await page.click('#file-next');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    check('沈黙', '窓 1: 発話 1〜1（0:00〜0:30）', /いま 1〜1 発話目/.test(await txt(page, 'edge')), await txt(page, 'edge'));
    await page.click('#file-next');
    await page.waitForFunction(function () { return /（S2）/.test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    const edge2 = await txt(page, 'edge');
    const clock2 = await txt(page, 'clock');
    check('沈黙', '窓幅より長い沈黙（0:05→1:10）でも 1 回押せば発話の入る窓 1:00〜1:30 に進む（S2 は発話 2〜3）', /いま 2〜3 発話目/.test(edge2) && clock2 === '1:30', edge2 + ' / いま ' + clock2);
    const rows2 = await page.evaluate(function () { return Array.from(document.getElementById('rows').children).map(function (c) { return c._t; }); });
    check('沈黙', '発話の無い窓（0:30〜1:00）には step もカードも書かれない', rows2.length === 3 && rows2.indexOf(70) >= 0 && !rows2.some(function (t) { return t >= 30 && t < 60; }), rows2.join(','));
    await page.click('#file-next');
    await page.waitForFunction(function () { return /（S3）/.test(document.getElementById('edge').textContent); }, null, { timeout: 10000 });
    await page.waitForFunction(function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 10000 });
    const rows3 = await page.evaluate(function () { return Array.from(document.getElementById('rows').children).map(function (c) { return c._t; }); });
    check('沈黙', '8 分の沈黙を 1 回で送り、9:50 の発話が最後の窓 S3 になって聞き終える', /いま 4〜4 発話目/.test(await txt(page, 'edge')) && rows3.indexOf(590) >= 0, await txt(page, 'edge') + ' rows=' + rows3.join(','));
    check('貼り付け', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }
  {
    // E3: gap の最小バッチすら書けない窓（壁時計が巻き戻って P08）→ 合流 → 3 窓続いたら止める
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', function (e) { errs.push(String(e && e.message || e)); });
    // 壁時計を外からずらせるようにする（__clockOffset ミリ秒）。保存の画面は headless では取りやめになるので外し、a[download] で落とす
    await page.addInitScript(function () {
      try { delete globalThis.showSaveFilePicker; globalThis.showSaveFilePicker = undefined; } catch (e) { /* 消せない */ }
      const RealDate = Date;
      globalThis.__clockOffset = 0;
      function FakeDate() {
        if (!(this instanceof FakeDate)) return RealDate();
        if (arguments.length === 0) return new RealDate(RealDate.now() + globalThis.__clockOffset);
        return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(arguments))))();
      }
      FakeDate.prototype = RealDate.prototype;
      FakeDate.now = function () { return RealDate.now() + globalThis.__clockOffset; };
      FakeDate.parse = RealDate.parse;
      FakeDate.UTC = RealDate.UTC;
      globalThis.Date = FakeDate;
    });
    await page.goto('file://' + path.join(KIT, 'kiku.html'));
    await page.waitForTimeout(300);
    await page.fill('#name', '書けない窓の合流');
    await page.selectOption('#route', 'mock');
    await loadFixture(page);
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    // 壁時計を 20 秒戻す → 次の窓は返事が正しくても P08 で 3 回落ち、gap の最小バッチも P08 で落ちる
    await page.evaluate(function () { globalThis.__clockOffset = -20000; });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /合流させる/.test(document.getElementById('an-msgs').textContent) && !document.getElementById('file-next').disabled; }, null, { timeout: 15000 });
    const anReq = await txt(page, 'an-msgs');
    const rawReq = await rawTxt(page);
    const edgeReq = await txt(page, 'edge');
    check('合流', 'gap の最小バッチも落ちた窓は「記録の検査で止まった」と知らせ（P08 の文は畳んだ欄に）、捨てずに次の窓へ合流させる', /記録の検査で止まった/.test(anReq) && /P08/.test(rawReq) && !/P08/.test(anReq) && /次の窓に合流させる/.test(anReq) && /続けて 1 窓目/.test(anReq), anReq.replace(/\n/g, ' ').slice(0, 200) + ' / 畳んだ欄: ' + rawReq.slice(0, 120));
    check('合流', '記録は S1 のまま（嘘の行を書かない）で、入口はまだ聞いている', /（S1）/.test(edgeReq) && /聞いている/.test(await txt(page, 'st-listen')), edgeReq);
    // 壁時計を戻す → 次に押すと、戻した発話と次の窓の発話が 1 つの窓になり、行の連番が切れない（P04 が起きない）
    await page.evaluate(function () { globalThis.__clockOffset = 0; });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /（S2）/.test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, null, { timeout: 15000 });
    const edgeMerged = await txt(page, 'edge');
    const an2 = await txt(page, 'an-msgs');
    const m2 = /いま (\d+)〜(\d+) 発話目/.exec(edgeMerged);
    check('合流', '合流した窓が S2 として書かれ、発話は S1 の続き（7〜）から', m2 && Number(m2[1]) === 7 && Number(m2[2]) > 9 && /S2 を書いた/.test(an2) && !/P04/.test(an2), edgeMerged + ' / ' + an2.replace(/\n/g, ' ').slice(0, 80));
    const stWin = await txt(page, 'st-win');
    check('合流', '合流した窓の幅は 1 窓分より広い（0:30〜1:30）', /0:30〜1:30/.test(an2) || /1:30/.test(await txt(page, 'clock')), an2.replace(/\n/g, ' ').slice(0, 80) + ' / ' + stWin);
    // もう一度壁時計を戻し、3 窓続けて書けなければ止まる
    await page.evaluate(function () { globalThis.__clockOffset = -20000; });
    for (let k = 1; k <= 3; k++) {
      await page.click('#file-next');
      await page.waitForFunction(function (k) {
        const a = document.getElementById('an-msgs').textContent;
        return (k < 3 && new RegExp('続けて ' + k + ' 窓目').test(a) && !document.getElementById('file-next').disabled) || (k === 3 && !document.getElementById('halt').hidden);
      }, k, { timeout: 15000 });
    }
    const haltBox = await page.evaluate(function () { const h = document.getElementById('halt'); return { hidden: h.hidden, text: h.textContent, size: parseFloat(getComputedStyle(h).fontSize) }; });
    check('停止', '3 窓続けて書けないと、大きな知らせ「止まった（記録に書けない）。記録を書き出して原因を調べる」が出る', !haltBox.hidden && haltBox.text === '止まった（記録に書けない）。記録を書き出して原因を調べる' && haltBox.size >= 18, JSON.stringify(haltBox));
    const stL = await txt(page, 'st-listen'), stI = await txt(page, 'st-intake');
    check('停止', '札が「聞いている」のままにならない（聞く: 止まった、入口: 止まっている）', /止まった（記録に書けない）/.test(stL) && /止まっている/.test(stI), stL + ' / ' + stI);
    const btn = await page.evaluate(function () { return { next: document.getElementById('file-next').disabled, start: document.getElementById('start').disabled, end: document.getElementById('end').disabled, exp: document.getElementById('export').disabled }; });
    check('停止', '次の窓は流せず、聞き始めるも押せないが、書き出すは押せる', btn.next && btn.start && btn.end && !btn.exp, JSON.stringify(btn));
    await page.click('#export');
    await page.waitForFunction(function () { return /落とした|保存/.test(document.getElementById('recmsg').textContent); }, null, { timeout: 5000 });
    check('停止', '止まった後も記録を書き出せる', /2 つのファイルを落とした/.test(await txt(page, 'recmsg')), await txt(page, 'recmsg'));
    check('停止', '記録は S2 まで（書けなかった窓の行は無い）', /（S2）/.test(await txt(page, 'edge')), await txt(page, 'edge'));
    check('合流', 'ページ内エラー無し', errs.length === 0, errs.join(' | '));
    await page.close();
  }

  // ---------- F. ブラウザ音声認識（模擬の認識器）: 出来事の行と、壁時計で畳む追体験 ----------
  {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', function (e) { errs.push(String(e && e.message || e)); });
    // 認識器を模擬する。start() で globalThis.__sr に自分を置き、試験が onresult / onend を外から呼ぶ
    await page.addInitScript(function () {
      function FakeSR() { this.lang = ''; this.continuous = false; this.interimResults = false; }
      FakeSR.prototype.start = function () { const self = this; globalThis.__sr = self; setTimeout(function () { if (self.onstart) self.onstart(); }, 0); };
      FakeSR.prototype.stop = function () { const self = this; setTimeout(function () { if (self.onend) self.onend(); }, 0); };
      globalThis.SpeechRecognition = undefined;
      globalThis.webkitSpeechRecognition = FakeSR;
    });
    await page.goto('file://' + path.join(KIT, 'kiku.html'));
    await page.waitForTimeout(300);
    await page.fill('#name', '音声認識の試験');
    // 経路は「人が書く」: 窓が閉じてから返事を書くまでの遅れを試験が作れる（壁時計で畳む追体験を見るため）
    await page.selectOption('#route', 'human');
    await page.selectOption('#intake', 'speech');
    // 模擬の認識器には端末内の口が無いので、音声を外へ送る承知の印を付けてから始める
    await page.check('#speech-cloud');
    await page.fill('#win', '5');
    await page.click('#start');
    await page.waitForFunction(function () { return !!globalThis.__sr && /聞いている/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 5000 });
    const say = function (text) { return page.evaluate(function (text) { const r = [{ transcript: text }]; r.isFinal = true; globalThis.__sr.onresult({ resultIndex: 0, results: [r] }); }, text); };
    await page.waitForTimeout(200);
    await say('一つ目の発話。');
    await page.waitForTimeout(200);
    // 認識が切れる → 入口が再開する（切断・再開・開始の出来事が素材ログに残る）
    await page.evaluate(function () { const s = globalThis.__sr; globalThis.__sr = null; s.onend(); });
    await page.waitForFunction(function () { return !!globalThis.__sr; }, null, { timeout: 3000 });
    await page.waitForTimeout(200);
    await say('二つ目の発話。');
    const liveFeed = function () { return page.evaluate(function () { return Array.from(document.querySelectorAll('#feed .fl')).filter(function (n) { return !n.hidden && !n.classList.contains('interim'); }).map(function (n) { return n.innerText.replace(/\s+/g, ' '); }); }); };
    const feedBefore = await liveFeed();
    check('出来事', 'ライブ: 窓として渡す前は、逐語に発話が出ず、出来事の 4 行だけ', feedBefore.length === 4 && !feedBefore.some(function (x) { return /一つ目の発話|二つ目の発話/.test(x); }), feedBefore.join(' | '));
    // 5 秒窓が閉じてフォームが出るまで待ち、1.5 秒置いてから（返事が遅れた形で）S1 を書く
    await page.waitForFunction(function () { return /0:00〜0:05/.test(document.getElementById('h-win').textContent); }, null, { timeout: 15000 });
    const feedLive = await liveFeed();
    check('出来事', 'ライブ: 窓として渡したあと、逐語に発話 2 行と出来事 4 行（始めた・切れた・再開した・始めた）が日本語の札で出る', feedLive.length === 6 && feedLive.filter(function (s) { return /認識を始めた/.test(s); }).length === 2 && feedLive.filter(function (s) { return /認識が切れた/.test(s); }).length === 1 && feedLive.filter(function (s) { return /認識を再開した/.test(s); }).length === 1 && !feedLive.some(function (s) { return /asr_|[A-Za-z]{2,}/.test(s); }), feedLive.join(' | '));
    await page.waitForTimeout(1500);
    await page.fill('#h-cti', '音声の試験カード');
    await page.click('#h-cadd');
    await page.fill('#h-note', '音声入口の試験。所感。');
    await page.click('#h-write');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent); }, null, { timeout: 5000 });
    const rowsLive = await rowCount(page);
    check('出来事', 'ライブで S1 が書かれ、中央に 1 行', rowsLive === 1, rowsLive);
    // 追体験: T を 0 に戻すと出来事の行も消え、終端に戻すと二重にならない
    await page.click('#views button[data-v="replay"]');
    await page.waitForTimeout(100);
    const scrubMax = await page.evaluate(function () { return Number(document.getElementById('scrub').max); });
    await page.evaluate(function () { const s = document.getElementById('scrub'); s.value = 0; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(200);
    const feed0 = await page.evaluate(function () { return Array.from(document.querySelectorAll('#feed .fl')).filter(function (n) { return !n.hidden && !n.classList.contains('interim'); }).map(function (n) { return n.innerText.replace(/\s+/g, ' '); }); });
    check('出来事', '追体験 T=0: 発話も出来事の行も DOM から消える', feed0.length === 0, feed0.join(' | '));
    // 窓の終わり（T=5）: 発話は全部聞こえているが、返事はまだ書かれていない（ライブでは何も出ていなかった時刻）
    await page.evaluate(function () { const s = document.getElementById('scrub'); s.value = 5; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(200);
    const rows5 = await rowCount(page);
    const feed5 = await page.evaluate(function () { return Array.from(document.querySelectorAll('#feed .fl')).filter(function (n) { return !n.hidden && !n.classList.contains('interim'); }).map(function (n) { return n.innerText.replace(/\s+/g, ' '); }); });
    check('壁時計', '追体験 T=5（窓の終わり）: 1.5 秒遅れて書かれた S1 のカードはまだ出ない（ライブと同じ。素材時間で畳むと出てしまう）', rows5 === 0, 'rows=' + rows5);
    check('壁時計', '追体験 T=5: S1 がまだ書かれていないので、逐語に発話は出ず、出来事の 4 行だけ（発話はステップに渡ってから出る）', feed5.length === 4 && !feed5.some(function (x) { return /一つ目の発話|二つ目の発話/.test(x); }), feed5.join(' | '));
    check('壁時計', 'シークバーの終端は、最後のステップを書き終えた壁時計に当たる素材時間まで伸びる（6 以上）', scrubMax >= 6, scrubMax);
    await page.evaluate(function () { const s = document.getElementById('scrub'); s.value = s.max; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(200);
    const rowsEnd = await rowCount(page);
    const feedEnd = await page.evaluate(function () { return Array.from(document.querySelectorAll('#feed .fl')).filter(function (n) { return !n.hidden && !n.classList.contains('interim'); }).map(function (n) { return n.innerText.replace(/\s+/g, ' '); }); });
    check('壁時計', '追体験の終端: S1 のカードが出る', rowsEnd === 1, rowsEnd);
    // ライブの写しは S1 を書く前なので、カードへの飛び先（→ C1）を除いて並びを比べる
    const strip = function (a) { return a.map(function (s) { return s.replace(/\s*→ C\d+/g, ''); }).join('|'); };
    check('出来事', '終端に戻し直しても出来事の行は二重にならない（6 行のまま、並びも同じ）', feedEnd.length === 6 && strip(feedEnd) === strip(feedLive), feedEnd.join(' | '));
    await page.click('#views button[data-v="live"]');
    await page.click('#end');
    await page.waitForFunction(function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 15000 });
    check('出来事', 'ページ内エラー無し', errs.length === 0, errs.join(' | '));
    await page.close();
  }

  // ---------- G. 手動の輪の壊れた返事と、追体験の間の分析役の欄 ----------
  {
    const f = await fresh(ctx, '壊れた返事と追体験'); const page = f.page;
    await page.selectOption('#route', 'manual');
    await loadFixture(page);
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    // 窓 1（0:00〜1:00）: 正しい返事
    await page.click('#file-next');
    await page.waitForFunction(function () { return document.getElementById('man-prompt').value.length > 100; }, null, { timeout: 5000 });
    const good1 = JSON.stringify({ step: { t: [0, 60] }, events: [{ e: 'card', id: 'C1', t: 0, d: 0, role: 'claim', who: '日向', src: [1, 2], li: null, ti: '一つ目の窓のカード', b: '' }], note: { x: '一つ目の窓' } });
    await page.fill('#man-reply', good1); await page.click('#man-apply');
    await page.waitForFunction(function () { return /S1 を書いた/.test(document.getElementById('an-msgs').textContent); }, null, { timeout: 5000 });
    // 窓 2（1:00〜2:00）: 機械向けの形でない返事 → 判断の並びが無い返事 → 種類の分からない判断。3 回とも同じ窓の 1 回に数える
    await page.click('#file-next');
    await page.waitForFunction(function () { return /1:00〜2:00/.test(document.getElementById('an-msgs').textContent); }, null, { timeout: 5000 });
    const broken = [
      { text: 'これは機械向けの形ではない', shown: /返事を読めなかった/, raw: /JSON/ },
      { text: JSON.stringify({ step: { t: [60, 120] }, events: {}, note: { x: '並びが無い' } }), shown: /判断の並びが無い/, raw: /events/ },
      { text: JSON.stringify({ step: { t: [60, 120] }, events: [{ e: 'zzz' }], note: { x: '種類が分からない' } }), shown: /判断の種類が分からない/, raw: /zzz/ }
    ];
    for (let k = 0; k < broken.length; k++) {
      await page.fill('#man-reply', broken[k].text);
      await page.click('#man-apply');
      await page.waitForTimeout(250);
      const shown = await txt(page, 'an-msgs');
      const raw = await rawTxt(page);
      if (k < 2) {
        check('壊れた返事', (k + 1) + ' 回目の壊れた返事も 1 回に数え、出し直し ' + (k + 2) + ' 回目になる', new RegExp('出し直し ' + (k + 2) + ' 回目').test(shown) && broken[k].shown.test(shown) && broken[k].raw.test(raw), shown.replace(/\n/g, ' ').slice(0, 200) + ' / 畳んだ欄: ' + raw.slice(0, 120));
      } else {
        const edge = await txt(page, 'edge');
        check('壊れた返事', '3 回目も壊れていたら未確定の窓（S2）として記録して進む', /（S2）/.test(edge) && /未確定の窓として記録して進んだ/.test(shown) && broken[k].shown.test(shown) && broken[k].raw.test(raw), edge + ' / ' + shown.replace(/\n/g, ' ').slice(0, 160));
      }
      check('画面の言葉', '壊れた返事 ' + (k + 1) + ' 回目: 見えている文に英字の項目名が無い（機械向けの文は畳んだ欄にだけある）', !/[A-Za-z]{2,}/.test(shown), shown.replace(/\n/g, ' ').slice(0, 200));
    }
    // 窓 3（2:00〜3:00）のプロンプトを出しておく（ライブの作業はそのまま）
    await page.click('#file-next');
    await page.waitForFunction(function () { return /2:00〜3:00/.test(document.getElementById('an-msgs').textContent); }, null, { timeout: 5000 });
    const FUTURE = '待ってください。そもそも値段';   // 2:08 の発話（窓 3 の中）
    const promptLive = await page.evaluate(function () { return document.getElementById('man-prompt').value; });
    check('追体験', '（前提）ライブでは窓 3 のプロンプトに 2:08 の発話がある', promptLive.indexOf(FUTURE) >= 0, promptLive.length + ' 字');
    await page.waitForTimeout(1200);
    const gapsLive = await txt(page, 'st-gaps');
    check('追体験', '（前提）ライブの札「未確定の窓」は 1 件', /^1 件/.test(gapsLive), gapsLive);
    // 追体験へ。T=30 に戻す
    await page.click('#views button[data-v="replay"]');
    await page.evaluate(function () { const s = document.getElementById('scrub'); s.value = 30; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(1300);   // 運転状態の札は 1 秒ごとに描き直される
    const r30 = await page.evaluate(function (FUTURE) {
      const vis = function (el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); };
      const mp = document.getElementById('man-prompt');
      return {
        stGaps: document.getElementById('st-gaps').textContent, gapsPanel: document.getElementById('gaps').innerText, gaphead: document.getElementById('gaphead').textContent,
        stSince: document.getElementById('st-since').textContent,
        promptVisible: vis(mp), promptValue: mp ? mp.value : '(無い)',
        an: document.getElementById('an-msgs').innerText,
        htmlHasFuture: document.documentElement.outerHTML.indexOf(FUTURE) >= 0,
        textHasFuture: document.body.innerText.indexOf(FUTURE) >= 0,
        promptInDom: Array.from(document.querySelectorAll('textarea')).some(function (t) { return t.value.indexOf(FUTURE) >= 0; })
      };
    }, FUTURE);
    check('追体験', 'T=0:30: 札「未確定の窓」は T で畳んだ状態から数えて 0 件（左の欄「無い」と食い違わない）', /^0 件/.test(r30.stGaps) && /無い/.test(r30.gapsPanel), r30.stGaps + ' / 左: ' + r30.gapsPanel);
    check('追体験', 'T=0:30: 札「最後の判断から」は、まだ判断が無いと言う', /まだ 1 回も判断していない/.test(r30.stSince), r30.stSince);
    check('追体験', 'T=0:30: 手動の輪のプロンプト欄は見えず、値も空', !r30.promptVisible && r30.promptValue === '', JSON.stringify({ visible: r30.promptVisible, value: r30.promptValue.slice(0, 40) }));
    check('追体験', 'T=0:30: 分析役の欄に先の窓（2:00〜3:00）が出ず、しまってあると言う', !/2:00〜3:00/.test(r30.an) && /しまってある/.test(r30.an), r30.an.replace(/\n/g, ' ').slice(0, 120));
    check('追体験', 'T=0:30: 2:08 の発話が画面にも DOM（入力欄の値を含む）にも無い', !r30.htmlHasFuture && !r30.textHasFuture && !r30.promptInDom, JSON.stringify(r30).slice(0, 160));
    // T=2:30（未確定の窓 S2 の後）: 札と左の欄がどちらも 1 件
    await page.evaluate(function () { const s = document.getElementById('scrub'); s.value = 150; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(1300);
    const r150 = await page.evaluate(function () { return { stGaps: document.getElementById('st-gaps').textContent, gaphead: document.getElementById('gaphead').textContent, stSince: document.getElementById('st-since').textContent }; });
    check('追体験', 'T=2:30: 札「未確定の窓」1 件と左の欄「未確定の窓（1 件）」が揃う', /^1 件/.test(r150.stGaps) && /1 件/.test(r150.gaphead), r150.stGaps + ' / ' + r150.gaphead);
    check('追体験', 'T=2:30: ファイルから聞いた記録では「最後の判断から」を出さない（壁時計と素材時間の対応が無い）', r150.stSince === '—', r150.stSince);
    // ライブに戻すと、預けたプロンプトがそのまま戻り、窓 3 の返事を取り込める
    await page.click('#views button[data-v="live"]');
    await page.waitForTimeout(200);
    const back = await page.evaluate(function () { return { prompt: document.getElementById('man-prompt').value, an: document.getElementById('an-msgs').innerText, n: document.querySelectorAll('#man-prompt').length }; });
    check('追体験', 'ライブに戻すと、窓 3 のプロンプトと知らせがそのまま戻る（欄は 1 つだけ）', back.prompt === promptLive && /2:00〜3:00/.test(back.an) && back.n === 1, back.prompt.length + ' 字 / ' + back.an.replace(/\n/g, ' ').slice(0, 80));
    const good3 = JSON.stringify({ step: { t: [120, 180] }, events: [{ e: 'card', id: 'C2', t: 128, d: 0, role: 'counter', who: null, src: [22], li: null, ti: '値段の話だけでよいかという問い直し', b: '' }], note: { x: '三つ目の窓' } });
    await page.fill('#man-reply', good3); await page.click('#man-apply');
    await page.waitForFunction(function () { return /S3 を書いた/.test(document.getElementById('an-msgs').textContent); }, null, { timeout: 5000 });
    check('追体験', 'ライブに戻した後、窓 3 の返事を取り込んで S3 が書かれる', /（S3）/.test(await txt(page, 'edge')), await txt(page, 'edge'));
    // 追体験の間に裏で窓が進んでも（ここでは窓 4 を出してから追体験へ）、DOM には出ない
    await page.click('#file-next');
    await page.waitForFunction(function () { return /3:00〜4:00/.test(document.getElementById('an-msgs').textContent); }, null, { timeout: 5000 });
    await page.click('#views button[data-v="replay"]');
    await page.evaluate(function () { const s = document.getElementById('scrub'); s.value = 30; s.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(200);
    const inReplay = await page.evaluate(function () { return document.documentElement.outerHTML.indexOf('3:00〜4:00') >= 0; });
    check('追体験', '窓 4 を出した後に追体験へ入っても、窓 4 の知らせは DOM に無い', !inReplay, String(inReplay));
    await page.click('#views button[data-v="live"]');
    check('壊れた返事', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // 待って、来なければ false（試験そのものを落とさず、不合格として数える）
  const waitOr = function (page, f, arg, timeout) { return page.waitForFunction(f, arg, { timeout: timeout }).then(function () { return true; }, function () { return false; }); };
  // 記録（ブラウザの中）を読む。判断ログの行の配列
  const readLog = function (page, name) {
    return page.evaluate(function (name) { const r = globalThis.TSV_RECORD.makeRecord(name); return r.load().then(function () { return r.log; }); }, name);
  };
  const isoSec = function (s) { return Date.parse(s) / 1000; };

  // ---------- H. 打つ／貼る（ライブ）の終わりと中断 ----------
  {
    const f = await fresh(ctx, '打ってすぐ終える'); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'text');
    await page.fill('#win', '30');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('ta').disabled; }, null, { timeout: 10000 });
    await page.click('#ta');
    await page.keyboard.type('日向: 打ってすぐ終える試験です。');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    await page.click('#end');
    const ended = await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    check('終わり', '打ってすぐ「聞き終える」→ 聞き終えた', ended, await txt(page, 'an-msgs'));
    const log = await readLog(page, '打ってすぐ終える');
    const open = log[0], steps = log.filter(function (e) { return e.e === 'step'; }), end = log[log.length - 1];
    const gaps = log.filter(function (e) { return e.e === 'hold' && e.kind === 'gap'; });
    const s1 = steps[0];
    const heard = s1 ? isoSec(s1.at) - isoSec(open.t0) : -1;
    check('終わり', '打ってすぐ「聞き終える」: 最後の窓は聞き終えた秒までで閉じ、未確定の窓にならずに S1 と end が書かれる', steps.length === 1 && gaps.length === 0 && end.e === 'end' && s1.t[0] === 0 && s1.t[1] >= 1 && s1.t[1] < 30, JSON.stringify(steps.map(function (s) { return s.t; })) + ' gaps=' + gaps.length + ' 最後=' + end.e);
    check('終わり', '最後の窓の終わりは、壁時計 − 聞き始め 以下（聞き終える前に判断を押していない）', s1 && heard >= s1.t[1], 'step.t[1]=' + (s1 && s1.t[1]) + ' 経った秒=' + heard);
    check('終わり', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }
  {
    const f = await fresh(ctx, '中断の試験'); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'text');
    await page.fill('#win', '5');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('ta').disabled; }, null, { timeout: 10000 });
    await page.click('#ta');
    await page.keyboard.type('日向: 中断の前の発話。');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('pause').disabled; }, null, { timeout: 15000 });
    await page.waitForTimeout(2500);   // 窓の終わりより時計が進んでから中断する
    await page.click('#pause');
    await page.waitForTimeout(300);
    const st = await txt(page, 'st-listen');
    const an = await txt(page, 'an-msgs');
    check('中断', '窓を書いたあと時間をおいて「中断する」→ 記録に書けて、札が「中断中」', /中断中/.test(st) && !/記録の検査で止まった/.test(an), st + ' / ' + an.replace(/\n/g, ' ').slice(0, 120));
    await page.$eval('#resume', function (b) { b.click(); });   // 中断に失敗していると隠れたままなので、押せなくても試験は続ける
    await page.click('#ta');
    await page.keyboard.type('日向: 再開した後の発話。');
    await page.keyboard.press('Enter');
    const s2 = await waitOr(page, function () { return /（S2）/.test(document.getElementById('edge').textContent); }, null, 15000);
    check('中断', '再開した後の窓が S2 として書かれる', s2, await txt(page, 'an-msgs'));
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    const log = await readLog(page, '中断の試験');
    const steps = log.filter(function (e) { return e.e === 'step'; });
    const pause = log.filter(function (e) { return e.e === 'pause'; })[0];
    check('中断', '中断は読み終えた所（S1 の終わり）に置かれ、再開後の窓はそこから先', pause && steps.length === 2 && pause.t === steps[0].t[1] && steps[1].t[0] >= pause.t, JSON.stringify({ pause: pause && pause.t, steps: steps.map(function (s) { return s.t; }) }));
    check('中断', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }
  {
    // まだ 1 つも窓を書いていないうちの中断は 0 に置く（P22）。打った発話は溜まりに残り、再開後の窓に入る
    const f = await fresh(ctx, '最初の窓の前の中断'); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'text');
    await page.fill('#win', '5');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('ta').disabled; }, null, { timeout: 10000 });
    await page.click('#ta');
    await page.keyboard.type('日向: 窓が閉じる前の発話。');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.click('#pause');
    await page.waitForTimeout(300);
    const st = await txt(page, 'st-listen');
    await page.$eval('#resume', function (b) { b.click(); });
    const s1 = await waitOr(page, function () { return /（S1）/.test(document.getElementById('edge').textContent); }, null, 15000);
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    const log = await readLog(page, '最初の窓の前の中断');
    const pause = log.filter(function (e) { return e.e === 'pause'; })[0];
    const steps = log.filter(function (e) { return e.e === 'step'; });
    check('中断', '最初の窓より前の中断は 0 に置かれて書け、再開後の S1 に中断前の発話が入る', /中断中/.test(st) && pause && pause.t === 0 && s1 && steps.length >= 1 && steps[0].lines[0] === 1 && steps[0].t[0] === 0, JSON.stringify({ st: st, pause: pause && pause.t, steps: steps.map(function (x) { return [x.t, x.lines]; }) }));
    check('中断', 'ページ内エラー無し（最初の窓の前の中断）', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- J. 時刻の打ち間違いと 40 件の上限、追体験の逐語 ----------
  {
    const f = await fresh(ctx, '時刻の打ち間違い'); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'file');
    const L = ['0:05\t甲\t一番目の発話', '0:10\t乙\t二番目の発話', '50:00\t甲\t三番目の発話（時刻を打ち間違えた）'];
    for (let k = 4; k <= 60; k++) { const tt = k * 20; L.push(Math.floor(tt / 60) + ':' + String(tt % 60).padStart(2, '0') + '\t' + (k % 2 ? '甲' : '乙') + '\t' + k + '番目の発話'); }
    await page.fill('#file-paste', L.join('\n') + '\n');
    await page.dispatchEvent('#file-paste', 'change');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    const ended = await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 20000);
    const log = await readLog(page, '時刻の打ち間違い');
    const steps = log.filter(function (e) { return e.e === 'step'; });
    const src = await page.evaluate(function () { const r = globalThis.TSV_RECORD.makeRecord('時刻の打ち間違い'); return r.load().then(function () { return r.src; }); });
    const shape = JSON.stringify(steps.map(function (x) { return [x.t, x.lines]; }));
    // 50:00 の発話が 58 個並ぶので、S2 は 40 件で切れ、終わりは渡さなかった 43 番目の時刻（50:00）まで縮む（幅 0 の窓）
    check('40 件', '打ち間違いのあとは 1 回押すごとに 40 発話まで: S1 0:00〜0:30（1〜2）、S2 50:00〜50:00（3〜42。上限で切って終わりを縮めた）、S3 50:00〜50:30（43〜60）で聞き終える', ended && shape === JSON.stringify([[[0, 30], [1, 2]], [[3000, 3000], [3, 42]], [[3000, 3030], [43, 60]]]), shape);
    check('40 件', 'どのステップも 40 発話以下', steps.every(function (x) { return x.lines[1] - x.lines[0] + 1 <= 40; }), shape);
    const ts = src.filter(function (l) { return l.i != null; }).map(function (l) { return l.t; });
    check('40 件', '素材ログの時刻は読むときに単調にしてある（3 番目より後は 50:00 に揃う）', ts.length === 60 && ts.every(function (tt, k) { return k === 0 || tt >= ts[k - 1]; }) && ts.slice(2).every(function (tt) { return tt === 3000; }), ts.slice(0, 6).join(','));
    // 追体験: T=50:00 は S2 まで。時刻 50:00 の発話は 58 個あるが、渡したのは 3〜42 だけ
    await page.click('#views button[data-v="replay"]');
    await page.waitForTimeout(100);
    const feedAt = async function (T) {
      await page.evaluate(function (T) { const s = document.getElementById('scrub'); s.value = T; s.dispatchEvent(new Event('input', { bubbles: true })); }, T);
      await page.waitForTimeout(150);
      return page.evaluate(function () {
        const n = Array.from(document.querySelectorAll('#feed .fl')).filter(function (x) { return !x.hidden && !x.classList.contains('interim'); });
        return { n: n.length, text: n.map(function (x) { return x.innerText.replace(/\s+/g, ' '); }).join(' | '), html: document.getElementById('feed').innerHTML, edge: document.getElementById('edge').textContent };
      }, T);
    };
    const r0 = await feedAt(0), r30 = await feedAt(30), r3000 = await feedAt(3000), rEnd = await feedAt(3030);
    check('追体験の逐語', 'T=0:00: まだ何も渡していないので逐語は空', r0.n === 0, r0.text.slice(0, 80));
    check('追体験の逐語', 'T=0:30: S1 が渡した 2 発話だけ', r30.n === 2 && /一番目/.test(r30.text) && !/三番目/.test(r30.html), r30.n + ' 行');
    check('追体験の逐語', 'T=50:00: S2 までに渡した 42 発話だけ。時刻が T 以下でも、S3 で渡した 43 番目以降は DOM にも無い', r3000.n === 42 && r3000.html.indexOf('43番目の発話') < 0 && r3000.html.indexOf('60番目の発話') < 0 && /3〜42 発話目/.test(r3000.edge), r3000.n + ' 行 / ' + r3000.edge);
    check('追体験の逐語', '終端（50:30）: 60 発話すべて', rEnd.n === 60, rEnd.n + ' 行');
    check('40 件', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- I. ファイルの終わりちょうどの発話 ----------
  {
    const f = await fresh(ctx, '終わりちょうどの発話'); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'file');
    await page.fill('#file-paste', '0:05\t甲\t一つ目\n0:20\t乙\t二つ目\n0:30\t甲\t三つ目\n');
    await page.dispatchEvent('#file-paste', 'change');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    check('終わりちょうど', '最初の窓は 0:00〜0:30 で発話 1〜2 だけ（0:30 の発話は、最後の発話でも次の窓）', /いま 1〜2 発話目/.test(await txt(page, 'edge')), await txt(page, 'edge'));
    await page.click('#file-next');
    await page.waitForFunction(function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 10000 });
    const log = await readLog(page, '終わりちょうどの発話');
    const steps = log.filter(function (e) { return e.e === 'step'; });
    check('終わりちょうど', '0:30 の発話は次の窓 0:30〜1:00（ふだんの窓と同じ幅）に入って聞き終える', steps.length === 2 && steps[0].t.join() === '0,30' && steps[0].lines.join() === '1,2' && steps[1].t.join() === '30,60' && steps[1].lines.join() === '3,3', JSON.stringify(steps.map(function (s) { return [s.t, s.lines]; })));
    check('終わりちょうど', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // 右の逐語（ライブ）の行と、窓を待っている数の知らせ
  const feedLines = function (page) {
    return page.evaluate(function () {
      const n = Array.from(document.querySelectorAll('#feed .fl')).filter(function (x) { return !x.hidden && !x.classList.contains('interim'); });
      const w = document.querySelector('#feed .fl.interim');
      return { lines: n.map(function (x) { return x.innerText.replace(/\s+/g, ' '); }), waiting: w && !w.hidden ? w.innerText : '', html: document.getElementById('feed').innerHTML };
    });
  };
  const readSrc = function (page, name) {
    return page.evaluate(function (name) { const r = globalThis.TSV_RECORD.makeRecord(name); return r.load().then(function () { return r.src; }); }, name);
  };
  const paste = async function (page, text) {
    await page.fill('#file-paste', text);
    await page.dispatchEvent('#file-paste', 'change');
  };

  // ---------- K. 人が書く＋ファイル＋時刻の打ち間違い・読めない行: ライブの逐語は渡した窓まで、知らせは入口の欄に ----------
  {
    const f = await fresh(ctx, '人が書く打ち間違い'); const page = f.page;
    await page.selectOption('#route', 'human');
    await page.selectOption('#intake', 'file');
    const L = ['0:05\t甲\t一番目の発話', '0:10\t乙\t二番目の発話', '1:2\t甲\t時刻を打ち間違えた行', '0:15\t乙\t三番目の発話', '50:00\t甲\t四番目の発話（時刻を打ち間違えた）'];
    for (let k = 5; k <= 60; k++) { const tt = k * 20; L.push(Math.floor(tt / 60) + ':' + String(tt % 60).padStart(2, '0') + '\t' + (k % 2 ? '甲' : '乙') + '\t' + k + '番目の発話' + (k === 60 ? '。結論は案Bに決める' : '')); }
    await paste(page, L.join('\n') + '\n');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /0:00〜0:30/.test(document.getElementById('h-win').textContent); }, null, { timeout: 10000 });
    const k1 = await feedLines(page);
    const notice1 = await page.evaluate(function () { const e = document.getElementById('intakenotice'); return { text: e.innerText, hidden: e.hidden }; });
    check('読めない行', '窓 1: 3 行目（時刻 1:2）は発話にせず、逐語に「読めない行があった。3 行目」と出る（中身と英字の名前は出さない）', k1.lines.filter(function (x) { return /番目の発話/.test(x); }).length === 3 && k1.lines.some(function (x) { return /読めない行があった。3 行目/.test(x); }) && !/時刻を打ち間違えた行|unreadable/.test(k1.html), k1.lines.join(' | '));
    check('読めない行', '入口の欄に「読めない行があった（3 行目）」が残る', !notice1.hidden && /読めない行があった（3 行目）/.test(notice1.text), JSON.stringify(notice1));
    await page.fill('#h-note', '窓 1 の所感');
    await page.click('#h-write');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /50:00〜50:00/.test(document.getElementById('h-win').textContent); }, null, { timeout: 10000 });
    const k2 = await feedLines(page);
    const hwin = await txt(page, 'h-win');
    const notice2 = await page.evaluate(function () { return document.getElementById('intakenotice').innerText; });
    const nUtt = k2.lines.filter(function (x) { return /番目の発話/.test(x); }).length;
    check('逐語は渡した窓まで', '窓 2（打ち間違いの窓。40 発話で切れる）: ライブの逐語は渡した 43 発話まで。44 番目以降と結論の発話は DOM に無い', nUtt === 43 && k2.html.indexOf('44番目の発話') < 0 && k2.html.indexOf('結論は案B') < 0, nUtt + ' 発話 / ' + k2.lines.slice(-2).join(' | '));
    check('逐語は渡した窓まで', '人が書く欄の窓も 40 発話（4〜43 番目）で、結論の発話は無い', /四番目の発話/.test(hwin) && /43番目の発話/.test(hwin) && !/44番目の発話|結論は案B/.test(hwin), hwin.slice(0, 60) + '…' + hwin.slice(-40));
    check('逐語は渡した窓まで', '窓を待っている発話の数だけを知らせる（17 件）', /窓を待っている発話 17 件/.test(k2.waiting), k2.waiting);
    // 入口の欄は、いまの窓の知らせを rt.py と同じ文で出し、前の窓の知らせは種類と行番号だけを 1 行に残す（説明の文は繰り返さない）
    check('時刻の飛び', '入口の欄に、この窓の「時刻が飛んでいる行（5・6 行目）」が出て、窓 1 の読めない行は「前の窓までの知らせ」の 1 行に残る（説明の文は繰り返さない）', /時刻が飛んでいる行（5・6 行目）/.test(notice2) && /前の窓までの知らせ：読めない行（3 行目）/.test(notice2) && !/読めない行があった/.test(notice2), notice2.replace(/\n/g, ' | '));
    const srcK = await readSrc(page, '人が書く打ち間違い');
    const unr = srcK.filter(function (l) { return l.i == null && l.ev === 'unreadable'; });
    check('読めない行', '素材ログに読めない行の記録が 1 件（行の番号と中身）', unr.length === 1 && unr[0].line === 3 && /打ち間違えた行/.test(unr[0].raw), JSON.stringify(unr));
    check('逐語は渡した窓まで', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- K2. 読めないバイトを含む行の知らせも、次の窓で「前の窓までの知らせ」の 1 行に残る（種類を落とさない） ----------
  {
    const f = await fresh(ctx, '読めないバイトの前の窓'); const page = f.page;
    await page.selectOption('#route', 'human');
    await page.selectOption('#intake', 'file');
    await paste(page, ['0:05\t甲\t一番目の発話', '0:10\t乙\t�読めないバイトの行', '0:15\t甲\t二番目の発話', '0:40\t乙\t三番目の発話'].join('\n') + '\n');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /0:00〜0:30/.test(document.getElementById('h-win').textContent); }, null, { timeout: 10000 });
    const b1 = await page.evaluate(function () { return document.getElementById('intakenotice').innerText; });
    check('読めないバイト', '窓 1: 入口の欄に「読めないバイトを含む行（2 行目）」の文が出る', /読めないバイトを含む行（2 行目）。発話にしていない/.test(b1), b1.replace(/\n/g, ' | '));
    await page.fill('#h-note', '窓 1 の所感');
    await page.click('#h-write');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /0:30〜/.test(document.getElementById('h-win').textContent); }, null, { timeout: 10000 });
    const b2 = await page.evaluate(function () { return document.getElementById('intakenotice').innerText; });
    check('読めないバイト', '窓 2: 窓 1 の読めないバイトを含む行が「前の窓までの知らせ」の 1 行に残る（説明の文は繰り返さない）', /前の窓までの知らせ：読めないバイトを含む行（2 行目）/.test(b2) && !/発話にしていない/.test(b2), b2.replace(/\n/g, ' | '));
    const srcB = await readSrc(page, '読めないバイトの前の窓');
    const ub = srcB.filter(function (l) { return l.i == null && l.ev === 'unreadable'; });
    check('読めないバイト', '素材ログに読めない行の出来事が 1 件（2 行目）。発話は 3 件', ub.length === 1 && ub[0].line === 2 && srcB.filter(function (l) { return l.i != null; }).length === 3, JSON.stringify(srcB));
    check('読めないバイト', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- L. 続きから聞く（ファイル）: 素材の頭を素材ログの発話の数だけ読み飛ばし、最後の 1 件を照らす ----------
  {
    const NAME = '続きから聞く';
    const mk = function (alter) {
      const L = [];
      for (let k = 1; k <= 12; k++) {
        const tt = k * 20;
        L.push(Math.floor(tt / 60) + ':' + String(tt % 60).padStart(2, '0') + '\t' + (k % 2 ? '甲' : '乙') + '\t' + (alter && k === 2 ? '二番目の発話（中身が違う）' : k + '番目の発話'));
        if (k === 1) L.push('1:2\t乙\t読めない行');
      }
      return L.join('\n') + '\n';
    };
    const M = mk(false), M2 = mk(true);
    const f = await fresh(ctx, NAME); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'file');
    await paste(page, M);
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    for (let k = 1; k <= 2; k++) {
      await page.click('#file-next');
      await page.waitForFunction(function (k) { return new RegExp('（S' + k + '）').test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, k, { timeout: 10000 });
    }
    const before = await readSrc(page, NAME);
    // 読み込み直して、同じ名前・同じ素材で聞き始める
    await page.reload();
    await page.waitForTimeout(400);
    await page.fill('#name', NAME);
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'file');
    await paste(page, M);
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    const sm = await txt(page, 'setupmsg'), im = await txt(page, 'intakemsg');
    check('続きから', '同じ名前・同じ素材: 続きからと言い、前に聞いた 2 発話を読み飛ばす', /続きから/.test(sm) && /2 発話は前に聞いたので読み飛ばす/.test(sm) && /前に聞いた 2 発話を読み飛ばした/.test(im), sm + ' / ' + im);
    for (let k = 3; k <= 4; k++) {
      await page.click('#file-next');
      await page.waitForFunction(function (k) { return new RegExp('（S' + k + '）').test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, k, { timeout: 10000 });
    }
    const after = await readSrc(page, NAME);
    const logL = await readLog(page, NAME);
    const utts = after.filter(function (l) { return l.i != null; });
    const texts = utts.map(function (l) { return l.text; });
    const stepsL = logL.filter(function (e) { return e.e === 'step'; });
    const gapsL = logL.filter(function (e) { return e.e === 'hold' && e.kind === 'gap'; });
    check('続きから', '素材ログの発話は 1〜5 番目が 1 度ずつ（済んだ発話を二重に入れない）', texts.join('|') === ['1番目の発話', '2番目の発話', '3番目の発話', '4番目の発話', '5番目の発話'].join('|') && utts.every(function (l, k) { return l.i === k + 1; }), texts.join('|') + ' / 前: ' + before.filter(function (l) { return l.i != null; }).length);
    check('続きから', '読めない行の記録も二重にならない（1 件）', after.filter(function (l) { return l.ev === 'unreadable'; }).length === 1, JSON.stringify(after.filter(function (l) { return l.i == null; })));
    check('続きから', '窓は前の続き（S3 は 1:00〜1:30 で発話 3〜4、S4 は 1:30〜2:00 で発話 5）。未確定の窓は無い', JSON.stringify(stepsL.map(function (x) { return [x.t, x.lines]; })) === JSON.stringify([[[0, 30], [1, 1]], [[30, 60], [2, 2]], [[60, 90], [3, 4]], [[90, 120], [5, 5]]]) && gapsL.length === 0, JSON.stringify(stepsL.map(function (x) { return [x.t, x.lines]; })) + ' gap=' + gapsL.length);
    const fl = await feedLines(page);
    check('続きから', 'ライブの逐語は 5 発話（重なりなし）', fl.lines.filter(function (x) { return /番目の発話/.test(x); }).length === 5, fl.lines.join(' | '));
    // 素材が違う（2 番目の中身が違う）: 断って、聞き始めない。記録も増えない
    const tryResume = async function (intake, text) {
      await page.reload();
      await page.waitForTimeout(400);
      await page.fill('#name', NAME);
      await page.selectOption('#route', 'mock');
      await page.selectOption('#intake', intake);
      if (text != null) await paste(page, text);
      await page.click('#start');
      await page.waitForFunction(function () { return /続きから聞けない/.test(document.getElementById('setupmsg').textContent); }, null, { timeout: 5000 }).catch(function () {});
      return { sm: await txt(page, 'setupmsg'), listen: await txt(page, 'st-listen') };
    };
    const shortM = M.split('\n').slice(0, 4).join('\n') + '\n';
    const r1 = await tryResume('file', M2);
    check('続きから', '素材の頭が素材ログと合わない: 「続きから聞けない」と理由（本文が違う）を出し、聞き始めない', /続きから聞けない/.test(r1.sm) && /合わない/.test(r1.sm) && /本文/.test(r1.sm) && !/聞いている/.test(r1.listen), r1.sm + ' / ' + r1.listen);
    const r2 = await tryResume('file', null);
    check('続きから', '素材を読み込んでいない: 前と同じ素材を読み込んでから、と言う', /続きから聞けない/.test(r2.sm) && /素材ファイルを読み込んでから/.test(r2.sm), r2.sm);
    const r3 = await tryResume('file', shortM);
    check('続きから', '素材が素材ログより短い: 断る', /続きから聞けない/.test(r3.sm) && /少ない/.test(r3.sm), r3.sm);
    const r4 = await tryResume('text', null);
    check('続きから', 'ファイルから聞いた記録の続きを打つ入口で聞こうとすると断る', /続きから聞けない/.test(r4.sm) && /ファイル/.test(r4.sm) && !/聞いている/.test(r4.listen), r4.sm);
    const last = await readSrc(page, NAME);
    check('続きから', '断った回は素材ログを増やさない', last.length === after.length, last.length + ' / ' + after.length);
    check('続きから', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- M. 窓幅は整数の秒 ----------
  {
    const f = await fresh(ctx, '窓幅の試験'); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'text');
    for (const v of ['7.5', '4', '181']) {
      await page.fill('#win', v);
      await page.click('#start');
      await page.waitForTimeout(150);
      const sm = await txt(page, 'setupmsg'), st = await txt(page, 'st-listen');
      check('窓幅', '窓幅 ' + v + ' は「5〜180 の整数の秒」と言って聞き始めない', /5〜180 の整数の秒/.test(sm) && !/聞いている/.test(st), sm + ' / ' + st);
    }
    const names = await page.evaluate(function () { return globalThis.TSV_RECORD.listNames(); });
    check('窓幅', '断った回は記録を作らない', names.indexOf('窓幅の試験') < 0, JSON.stringify(names));
    check('窓幅', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- N. 中断の間に打った行（捨てない。再開した後の最初の窓に入る） ----------
  // 記録はブラウザの保存領域へ非同期に書かれるので、札が「聞き終えた」になった直後に読むと end がまだ無いことがある。
  // end が読めるまで（最大 5 秒）読み直す
  const readLogEnded = async function (page, name) {
    let log = [];
    for (let k = 0; k < 25; k++) {
      log = await readLog(page, name);
      if (log.length && log[log.length - 1].e === 'end') break;
      await page.waitForTimeout(200);
    }
    return log;
  };
  {
    const NAME = '中断の間に打つ';
    const f = await fresh(ctx, NAME); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'text');
    await page.fill('#win', '5');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('ta').disabled; }, null, { timeout: 10000 });
    await page.click('#ta');
    await page.keyboard.type('日向: 中断の前の発話。');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('pause').disabled; }, null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.click('#pause');
    await page.waitForTimeout(300);
    const st = await page.evaluate(function () { return { listen: document.getElementById('st-listen').textContent, taDisabled: document.getElementById('ta').disabled, msg: document.getElementById('intakemsg').textContent }; });
    check('中断の間の行', '中断した後も打つ欄は打てて、入口の札が「打った行は捨てない」と言う', /中断中/.test(st.listen) && !st.taDisabled && /捨てない/.test(st.msg) && /再開した後の最初の窓/.test(st.msg), JSON.stringify(st));
    await page.click('#ta');
    await page.keyboard.type('月見: 中断の間に打った行。');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(6500);   // 中断の間は、窓の幅より長く待っても窓を閉じない
    const mid = await page.evaluate(function () { return { ta: document.getElementById('ta').value, edge: document.getElementById('edge').textContent, feed: document.getElementById('feed').innerText }; });
    check('中断の間の行', '中断の間は、窓の幅より長く待っても次の窓を出さず、行は窓を待つ発話として数える', /（S1）/.test(mid.edge) && /窓を待っている発話 1 件/.test(mid.feed) && mid.ta === '', JSON.stringify(mid).slice(0, 200));
    await page.$eval('#resume', function (b) { b.click(); });
    await page.waitForTimeout(200);
    const msgR = await txt(page, 'intakemsg');
    check('中断の間の行', '再開すると、札が中断の間の行は次の窓に入ると言う', /中断の間に打った行は、次の窓に入る/.test(msgR), msgR);
    const s2 = await waitOr(page, function () { return /（S2）/.test(document.getElementById('edge').textContent); }, null, 15000);
    check('中断の間の行', '再開した後、次の時計の刻みで窓が閉じて S2 が書かれる', s2, await txt(page, 'edge'));
    await page.click('#ta');
    await page.keyboard.type('日向: 再開した後の発話。');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    const log = await readLogEnded(page, NAME);
    const src = (await readSrc(page, NAME)).filter(function (l) { return l.i != null; });
    const texts = src.map(function (l) { return l.text; });
    check('中断の間の行', '中断の前・中断の間・再開の後の 3 行がすべて素材ログに残る（話者も）', src.length === 3 && texts[0] === '中断の前の発話。' && texts[1] === '中断の間に打った行。' && texts[2] === '再開した後の発話。' && src[1].who === '月見', JSON.stringify(src.map(function (l) { return [l.i, l.t, l.who, l.text]; })));
    const steps = log.filter(function (e) { return e.e === 'step'; });
    const pause = log.filter(function (e) { return e.e === 'pause'; })[0];
    const firstAfter = steps.filter(function (x) { return pause && x.t[0] >= pause.t && x.n > 1; })[0];
    check('中断の間の行', '中断の間の行は、再開した後の最初の窓に入る（S2 は中断の位置から始まり、発話 2 だけ）', pause && firstAfter && firstAfter.n === 2 && firstAfter.lines[0] === 2 && firstAfter.lines[1] === 2 && firstAfter.t[0] === pause.t && src[1].t >= firstAfter.t[0] && src[1].t < firstAfter.t[1], JSON.stringify({ pause: pause && pause.t, steps: steps.map(function (x) { return [x.n, x.t, x.lines]; }), t2: src[1] && src[1].t }));
    const covered = src.every(function (l) { return steps.some(function (x) { return l.i >= x.lines[0] && l.i <= x.lines[1]; }); });
    check('中断の間の行', '3 行とも判断ログのどれかの窓に入り、end で閉じる', covered && log[log.length - 1].e === 'end', JSON.stringify(steps.map(function (x) { return x.lines; })) + ' 最後=' + log[log.length - 1].e);
    check('中断の間の行', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }
  {
    // 中断の間に打ったまま「聞き終える」: その行は最後の窓に入る（捨てない）
    const NAME = '中断のまま終える';
    const f = await fresh(ctx, NAME); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'text');
    await page.fill('#win', '5');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('ta').disabled; }, null, { timeout: 10000 });
    await page.click('#ta');
    await page.keyboard.type('日向: 中断の前の発話。');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('pause').disabled; }, null, { timeout: 15000 });
    await page.waitForTimeout(1200);
    await page.click('#pause');
    await page.waitForTimeout(300);
    await page.click('#ta');
    await page.keyboard.type('月見: 中断の間の結論。');   // Enter を押さないまま「聞き終える」
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    const log = await readLogEnded(page, NAME);
    const src = (await readSrc(page, NAME)).filter(function (l) { return l.i != null; });
    const steps = log.filter(function (e) { return e.e === 'step'; });
    const lastI = src.length ? src[src.length - 1].i : 0;
    check('中断の間の行', '中断の間に打ったまま「聞き終える」: その行も素材ログに残り、最後の窓に入って end で閉じる', src.length === 2 && src[1].text === '中断の間の結論。' && steps.length && steps[steps.length - 1].lines[1] === lastI && log[log.length - 1].e === 'end', JSON.stringify({ src: src.map(function (l) { return [l.i, l.t, l.text]; }), steps: steps.map(function (x) { return [x.t, x.lines]; }), last: log[log.length - 1].e }));
    check('中断の間の行', 'ページ内エラー無し（中断のまま終える）', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- O. 話者の切り出し（打つ／貼る） ----------
  {
    const NAME = '話者の切り出し';
    const f = await fresh(ctx, NAME); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'text');
    await page.fill('#win', '30');
    const help = await page.evaluate(function () { return document.querySelector('#in-text p.soft').textContent; });
    check('話者', '打つ入口の説明が、半角の「:」のあとの空白と、時刻・住所で始まる行のことを言う', /半角の「:」のあとに空白/.test(help) && /全角の「：」/.test(help) && /15:00までに/.test(help) && /話者は無し/.test(help), help);
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('ta').disabled; }, null, { timeout: 10000 });
    const lines = [
      ['司会: 始めます', '司会', '始めます'],
      ['司会：始めます', '司会', '始めます'],
      ['15:00までに資料を送ってください。', null, '15:00までに資料を送ってください。'],
      ['9:00 から始めます', null, '9:00 から始めます'],
      ['16:9 の画面で映します', null, '16:9 の画面で映します'],
      ['https://example.com の表を見てください。', null, 'https://example.com の表を見てください。'],
      ['0:05 司会: 始めます', null, '0:05 司会: 始めます'],
      ['結論：A案にします', '結論', 'A案にします']
    ];
    for (const l of lines) {
      await page.click('#ta');
      await page.keyboard.type(l[0]);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(80);
    }
    // 表から貼った行（1 列目の時刻は使わない）と、話者だけの行（捨てずに話者無しの本文）。rt.py のメモ帳と同じ読み方
    await page.fill('#ta', '0:20\t乙\t貼った表の行\n司会：');
    await page.press('#ta', 'Enter');
    await page.waitForTimeout(200);
    const noticeT = await page.evaluate(function () { const e = document.getElementById('intakenotice'); return { text: e.innerText, hidden: e.hidden }; });
    check('話者', '表の行を貼ると、入口の欄に「打った行の 1 列目の時刻は使わない」が出る', !noticeT.hidden && /1 列目の時刻は使わない/.test(noticeT.text), JSON.stringify(noticeT));
    lines.push(['0:20\t乙\t貼った表の行', '乙', '貼った表の行'], ['司会：', null, '司会：']);
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 20000);
    const src = (await readSrc(page, NAME)).filter(function (l) { return l.i != null; });
    lines.forEach(function (l, k) {
      const got = src[k] || {};
      check('話者', '「' + l[0] + '」→ 話者 ' + (l[1] == null ? '無し' : '「' + l[1] + '」') + '、本文「' + l[2] + '」', got.who === l[1] && got.text === l[2], JSON.stringify({ who: got.who, text: got.text }));
    });
    const feed = await txt(page, 'feed');
    check('話者', '右の逐語に「15」「https」が話者として出ない', !/(^|\n)\S*\s*15\s+00までに/.test(feed) && feed.indexOf('15:00までに資料を送ってください。') >= 0 && feed.indexOf('https://example.com') >= 0, feed.replace(/\n/g, ' | ').slice(0, 300));
    check('話者', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- P. 時刻で始まる本文の行（ファイル）: 前の発話の続きとして読み、入口の欄に行の番号を残す ----------
  {
    const NAME = '時刻で始まる本文の行';
    const f = await fresh(ctx, NAME); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'file');
    // 時刻だけの行と本文の行の書き方（alone）。時刻で始まる本文の行（3 行目）は前の発話の続き
    await paste(page, '0:05\n一つ目の発話\n9:00 から続けます\n0:20\n二つ目の発話\n0:40\n三つ目の発話\n');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    const notice = await page.evaluate(function () { const e = document.getElementById('intakenotice'); return { text: e.innerText, hidden: e.hidden }; });
    check('時刻で始まる本文の行', '時刻だけの行と本文の行の書き方: 入口の欄に「時刻で始まる行は本文として読んだ（3 行目）」が残る', !notice.hidden && /時刻で始まる行は本文として読んだ（3 行目）/.test(notice.text), JSON.stringify(notice));
    const src = (await readSrc(page, NAME)).filter(function (l) { return l.i != null; });
    check('時刻で始まる本文の行', '3 行目は 1 つ目の発話の本文の続き（読めない行にしない）', src.length >= 2 && src[0].text === '一つ目の発話 9:00 から続けます' && src[1].text === '二つ目の発話', JSON.stringify(src.map(function (l) { return [l.i, l.t, l.text]; })));
    check('時刻で始まる本文の行', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // rt.py に同じ記録を渡して、窓（compute_window）と end の t（end_t）を計算させる（tools/rt.py を読むだけ。何も書かない）。
  // 入力は JSON で渡す: {log, src, now_t}（窓）と {log_end, end_clock}（end の t）。python3 が無ければ null
  const rtCalc = function (input) {
    const code = [
      'import json, sys',
      'sys.path.insert(0, sys.argv[1])',
      'import rt',
      'd = json.load(sys.stdin)',
      'rules = rt.load_rules()',
      'out = {}',
      'if "log" in d:',
      '    st = rt.fold(d["log"], rules)',
      '    utts = [u for u in d["src"] if u.get("i") is not None]',
      '    r = rt.compute_window(st, utts, now_t=d["now_t"], live=True)',
      '    out["win"] = None if r is None else [r[0], r[1], r[2]]',
      'if "log_end" in d:',
      '    out["end_t"] = rt.end_t(rt.fold(d["log_end"], rules), d["end_clock"])',
      'print(json.dumps(out))'
    ].join('\n');
    const r = spawnSync('python3', ['-B', '-c', code, path.join(KIT, 'tools')], { input: JSON.stringify(input), encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
    if (r.status !== 0) return { error: (r.stderr || String(r.error || '')).slice(-400) };
    try { return JSON.parse(r.stdout); } catch (e) { return { error: 'rt.py の出力が読めない: ' + r.stdout.slice(0, 200) }; }
  };
  const boxLines = function (page) {
    return page.evaluate(function () { const e = document.getElementById('intakenotice'); return e.hidden ? [] : Array.from(e.children).map(function (d) { return d.textContent; }); });
  };

  // ---------- Q. WebVTT の素材をファイルの入口で読む（tests/fixtures/material_vtt.vtt と、その期待値） ----------
  // 発話の列・窓・窓ごとの知らせの文が、共通の期待値（rt.py の試験と同じ material_vtt.expect.json）と一字違わず同じ。
  // 入口の欄の「前の窓までの知らせ」の行は除いて比べる。end の t は直前の窓の終わり（ファイルの記録）
  {
    const NAME = 'WebVTT の素材';
    const exp = JSON.parse(fs.readFileSync(path.join(KIT, 'tests', 'fixtures', 'material_vtt.expect.json'), 'utf8'));
    const f = await fresh(ctx, NAME); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'file');
    await page.fill('#win', String(exp.window));
    const accept = await page.evaluate(function () { return document.getElementById('file').accept; });
    check('WebVTT', 'ファイルを選ぶ欄が .vtt を受ける', /\.vtt/.test(accept), accept);
    await page.setInputFiles('#file', path.join(KIT, 'tests', 'fixtures', 'material_vtt.vtt'));
    await page.click('#file-load');
    await page.waitForFunction(function () { return /ファイルを読んだ/.test(document.getElementById('intakemsg').textContent); }, null, { timeout: 5000 });
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    const perWin = [];
    for (let k = 1; k <= exp.windows.length; k++) {
      await page.click('#file-next');
      const last = k === exp.windows.length;
      const ok = await waitOr(page, last ? function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }
        : function (k) { return new RegExp('（S' + k + '）').test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, k, 15000);
      perWin.push({ ok: ok, box: (await boxLines(page)).filter(function (l) { return !/^前の窓までの知らせ/.test(l); }) });
    }
    const log = await readLogEnded(page, NAME);
    const src = (await readSrc(page, NAME)).filter(function (l) { return l.i != null; }).map(function (l) { return { i: l.i, t: l.t, who: l.who, text: l.text }; });
    check('WebVTT', '発話の列が期待値と一字違わず同じ（' + exp.utterances.length + ' 発話。話者の札・識別子・NOTE・&amp; の戻し・時刻の揃え）', JSON.stringify(src) === JSON.stringify(exp.utterances), JSON.stringify(src).slice(0, 300));
    const steps = log.filter(function (e) { return e.e === 'step'; }).map(function (x) { return { t: x.t, lines: x.lines }; });
    check('WebVTT', '窓が期待値と同じ（' + JSON.stringify(exp.windows.map(function (w) { return w.t; })) + '）', JSON.stringify(steps) === JSON.stringify(exp.windows.map(function (w) { return { t: w.t, lines: w.lines }; })), JSON.stringify(steps));
    exp.windows.forEach(function (w, k) {
      const got = perWin[k] || { box: [] };
      check('WebVTT', '窓 ' + (k + 1) + '（' + w.t.join('〜') + '）の入口の欄が、その窓の知らせの文と同じ（' + w.notices.length + ' 文。rt.py と同じ文）', JSON.stringify(got.box) === JSON.stringify(w.notices), JSON.stringify(got.box));
    });
    const unr = (await readSrc(page, NAME)).filter(function (l) { return l.i == null && l.ev === 'unreadable'; }).map(function (l) { return l.line; });
    check('WebVTT', '読めない行が素材ログに残る（' + exp.unreadable.map(function (u) { return u.line; }).join('・') + ' 行目）', JSON.stringify(unr) === JSON.stringify(exp.unreadable.map(function (u) { return u.line; })), JSON.stringify(unr));
    const end = log[log.length - 1];
    const lastEnd = exp.windows[exp.windows.length - 1].t[1];
    const rtEnd = rtCalc({ log_end: log.slice(0, -1), end_clock: end.at });
    check('end の t', 'ファイルの記録の end の t は直前の窓の終わり（' + lastEnd + '）で、rt.py の end_t と同じ', end.e === 'end' && end.t === lastEnd && rtEnd.end_t === end.t, JSON.stringify({ end: end, rt: rtEnd }));
    check('WebVTT', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- R. ライブで遅れて閉じる窓の終わり・中断中の札・end の t（打つ／貼る、窓幅 5） ----------
  // 0:05 に S1 を書いて中断し、中断の間に表の行を貼る（入口の札は「中断中。打った行は捨てない」のまま。1 列目の時刻の知らせは
  // 下の欄だけ）。0:16 すぎに再開すると、窓の終わりは時計の秒（0:16・0:17）ではなく窓幅の刻みの 0:15。rt.py の
  // compute_window に同じ記録と時計を渡すと同じ窓になる。end の t は rt.py の end_t と同じ
  {
    const NAME = '遅れて閉じる窓';
    const f = await fresh(ctx, NAME); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'text');
    await page.fill('#win', '5');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('ta').disabled; }, null, { timeout: 10000 });
    const t0 = isoSec((await readLog(page, NAME))[0].t0);
    const untilSec = async function (sec) { const ms = (t0 + sec) * 1000 - Date.now(); if (ms > 0) await page.waitForTimeout(ms); };
    await page.click('#ta');
    await page.keyboard.type('日向: 中断の前の発話。');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('pause').disabled; }, null, { timeout: 15000 });
    await untilSec(6.2);
    await page.click('#pause');
    await page.waitForTimeout(200);
    await page.fill('#ta', '0:20\t月見\t中断の間に貼った表の行');
    await page.press('#ta', 'Enter');
    await page.waitForTimeout(300);
    const lab = await page.evaluate(function () { const n = document.getElementById('intakenotice'); return { msg: document.getElementById('intakemsg').textContent, notice: n.hidden ? '' : n.innerText, listen: document.getElementById('st-listen').textContent }; });
    check('中断中の札', '中断の間に表の行を貼っても、入口の札は「中断中。打った行は捨てない」のまま。1 列目の時刻の知らせは下の欄にだけ出る', /中断中/.test(lab.listen) && /^中断中。打った行は捨てない/.test(lab.msg) && !/1 列目の時刻/.test(lab.msg) && /1 列目の時刻は使わない/.test(lab.notice), JSON.stringify(lab));
    await untilSec(16.3);
    await page.$eval('#resume', function (b) { b.click(); });
    const s2 = await waitOr(page, function () { return /（S2）/.test(document.getElementById('edge').textContent); }, null, 15000);
    const logS2 = await readLog(page, NAME);
    const srcS2 = await readSrc(page, NAME);
    const st2 = logS2.filter(function (e) { return e.e === 'step'; });
    const S2 = st2[1];
    const pre = logS2.slice(0, logS2.indexOf(S2));
    const nowT = S2 ? Math.floor(isoSec(S2.at) - t0) : -1;
    const rtW = rtCalc({ log: pre, src: srcS2, now_t: nowT });
    check('遅れて閉じる窓', '中断が窓幅より長いとき、再開後の窓の終わりは窓幅の刻み（0:05〜0:15）。時計の秒（0:16・0:17）では閉じない', s2 && S2 && JSON.stringify(S2.t) === '[5,15]' && JSON.stringify(S2.lines) === '[2,2]', JSON.stringify(st2.map(function (x) { return [x.t, x.lines, x.at]; })));
    check('遅れて閉じる窓', 'rt.py の compute_window に同じ記録と同じ時計（' + nowT + ' 秒）を渡すと、同じ窓になる', rtW.win && S2 && rtW.win[0] === S2.t[0] && rtW.win[1] === S2.t[1] && JSON.stringify(rtW.win[2]) === JSON.stringify(S2.lines), JSON.stringify(rtW));
    const t2 = srcS2.filter(function (l) { return l.i === 2; })[0];
    check('遅れて閉じる窓', '中断の間に貼った行は届いた時刻（1 列目の 0:20 ではない）で、話者「月見」', t2 && t2.t >= 6 && t2.t < 15 && t2.who === '月見' && t2.text === '中断の間に貼った表の行', JSON.stringify(t2));
    await untilSec(18.4);
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    const log = await readLogEnded(page, NAME);
    const end = log[log.length - 1];
    const rtE = rtCalc({ log_end: log.slice(0, -1), end_clock: end.at });
    const lastT1 = log.filter(function (e) { return e.e === 'step'; }).slice(-1)[0].t[1];
    check('end の t', 'ライブの記録の end の t は「直前の窓の終わり」と「聞き終えた時計の秒」の大きいほうで、rt.py の end_t と同じ', end.e === 'end' && end.t === Math.max(lastT1, Math.floor(isoSec(end.at) - t0)) && end.t === rtE.end_t && end.t >= 18, JSON.stringify({ end: end, lastT1: lastT1, rt: rtE }));
    check('遅れて閉じる窓', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- S. 音声の入口で中断と再開を素早く繰り返す（模擬の認識器。止めてから終わりの知らせが届くまで 800 ミリ秒） ----------
  // 古い認識の遅れた終わりの知らせで、2 つ目の認識を始めない（世代の数で見分ける）。動いている認識は 1 つだけで、
  // 同じ発話が二重に記録されない
  {
    const NAME = '音声の中断と再開';
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', function (e) { errs.push(String(e && e.message || e)); });
    await page.addInitScript(function () {
      globalThis.__srs = [];
      function FakeSR() { this.lang = ''; this.continuous = false; this.interimResults = false; this.ended = false; }
      FakeSR.prototype.start = function () { const self = this; globalThis.__srs.push(self); globalThis.__sr = self; setTimeout(function () { if (self.onstart) self.onstart(); }, 0); };
      FakeSR.prototype.stop = function () { const self = this; setTimeout(function () { self.ended = true; if (self.onend) self.onend(); }, 800); };
      globalThis.SpeechRecognition = undefined;
      globalThis.webkitSpeechRecognition = FakeSR;
    });
    await page.goto('file://' + path.join(KIT, 'kiku.html'));
    await page.waitForTimeout(300);
    await page.fill('#name', NAME);
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'speech');
    // 模擬の認識器には端末内の口が無いので、音声を外へ送る承知の印を付けてから始める
    await page.check('#speech-cloud');
    await page.fill('#win', '5');
    await page.click('#start');
    await page.waitForFunction(function () { return !!globalThis.__sr && /聞いている/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 5000 });
    // 模擬の認識器: 動いているもの（終わりの知らせがまだ来ていないもの）のうち、いちばん新しいものに話させる
    const say = function (text) { return page.evaluate(function (text) { const live = globalThis.__srs.filter(function (r) { return !r.ended; }); live.forEach(function (sr) { const r = [{ transcript: text }]; r.isFinal = true; sr.onresult({ resultIndex: 0, results: [r] }); }); return live.length; }, text); };
    await page.waitForTimeout(200);
    await say('中断の前の発話。');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('pause').disabled; }, null, { timeout: 15000 });
    await page.click('#pause');
    await page.waitForTimeout(150);
    await page.$eval('#resume', function (b) { b.click(); });
    await page.waitForTimeout(150);
    await page.$eval('#pause', function (b) { b.click(); });
    await page.waitForTimeout(150);
    await page.$eval('#resume', function (b) { b.click(); });
    await page.waitForTimeout(2000);   // 古い認識の終わりの知らせ（800 ミリ秒後）が全部届いてから数える
    const live = await page.evaluate(function () { return { made: globalThis.__srs.length, live: globalThis.__srs.filter(function (r) { return !r.ended; }).length }; });
    check('音声の中断と再開', '中断と再開を素早く 2 回繰り返しても、動いている認識は 1 つだけ', live.live === 1, JSON.stringify(live));
    const spoke = await say('再開した後の発話。');
    await page.waitForTimeout(300);
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    const src = (await readSrc(page, NAME)).filter(function (l) { return l.i != null; }).map(function (l) { return l.text; });
    check('音声の中断と再開', '同じ発話が二重に記録されない（素材ログの発話は 2 件）', spoke === 1 && JSON.stringify(src) === JSON.stringify(['中断の前の発話。', '再開した後の発話。']), JSON.stringify({ spoke: spoke, src: src }));
    const log = await readLogEnded(page, NAME);
    const steps = log.filter(function (e) { return e.e === 'step'; });
    check('音声の中断と再開', '2 つの発話はどれも窓に入り、end で閉じる', steps.length >= 1 && steps[steps.length - 1].lines[1] === 2 && log[log.length - 1].e === 'end', JSON.stringify(steps.map(function (x) { return [x.t, x.lines]; })));
    check('音声の中断と再開', 'ページ内エラー無し', errs.length === 0, errs.join(' | '));
    await page.close();
  }

  // ---------- T. 40 件の上限で切れる窓と入口の欄（人が書く＋ファイル、窓幅 30） ----------
  // 同じ時刻の発話が 40 を超える素材。46 行目の読めない行は、次の発話（47 行目＝発話 46）に付く。発話 46 は 3 つ目の窓で
  // 渡すので、入口の欄にその知らせが出るのは 3 つ目の窓から（1 つ目・2 つ目の窓では出さない）。文は rt.py が同じ窓で出す文と同じ
  {
    const NAME = '上限で切れる窓の知らせ';
    const L = ['0:05\t甲\t発話1'];
    for (let k = 2; k <= 45; k++) L.push('0:10\t甲\t発話' + k);
    L.push('0:3\t乙\t壊れた', '0:20\t乙\t後ろ');
    const text = L.join('\n') + '\n';
    const mpath = path.join(OUT, 'material_cap40.tsv');
    fs.writeFileSync(mpath, text);
    // rt.py が窓（発話 lo〜hi）で出す知らせの文（file_notices → notice_lines）。読むだけ
    const rtNotices = function (wins) {
      const code = ['import json, sys', 'sys.path.insert(0, sys.argv[1])', 'import rt', 'd = json.load(sys.stdin)',
        'print(json.dumps([rt.notice_lines(rt.file_notices(d["path"], w[0], w[1])) for w in d["wins"]], ensure_ascii=False))'].join('\n');
      const r = spawnSync('python3', ['-B', '-c', code, path.join(KIT, 'tools')], { input: JSON.stringify({ path: mpath, wins: wins }), encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
      if (r.status !== 0) return { error: (r.stderr || String(r.error || '')).slice(-400) };
      try { return JSON.parse(r.stdout); } catch (e) { return { error: r.stdout.slice(0, 200) }; }
    };
    const f = await fresh(ctx, NAME); const page = f.page;
    await page.selectOption('#route', 'human');
    await page.selectOption('#intake', 'file');
    await paste(page, text);
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    const want = [['0:00〜0:10', [1, 1]], ['0:10〜0:10', [2, 41]], ['0:10〜0:40', [42, 46]]];
    const boxes = [];
    for (let k = 0; k < want.length; k++) {
      // 窓が人が書く欄に出るまで待つ（出ていなければ「次の窓を流す」を押す）
      let shown = await waitOr(page, function (w) { return document.getElementById('h-win').textContent.indexOf(w) >= 0; }, want[k][0], 1500);
      if (!shown) {
        await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
        await page.click('#file-next');
        shown = await waitOr(page, function (w) { return document.getElementById('h-win').textContent.indexOf(w) >= 0; }, want[k][0], 10000);
      }
      boxes.push({ shown: shown, box: (await boxLines(page)).filter(function (l) { return !/^前の窓までの知らせ/.test(l); }) });
      await page.fill('#h-note', '窓 ' + (k + 1) + ' の所感');
      await page.click('#h-write');
      await page.waitForFunction(function (k) { return new RegExp('（S' + k + '）').test(document.getElementById('edge').textContent); }, k + 1, { timeout: 10000 });
    }
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 10000);
    const log = await readLogEnded(page, NAME);
    const steps = log.filter(function (e) { return e.e === 'step'; }).map(function (x) { return [x.t, x.lines]; });
    check('上限で切れる窓の知らせ', '窓は 0:00〜0:10（発話 1）・0:10〜0:10（2〜41。40 件で切った）・0:10〜0:40（42〜46）', JSON.stringify(steps) === JSON.stringify([[[0, 10], [1, 1]], [[10, 10], [2, 41]], [[10, 40], [42, 46]]]), JSON.stringify(steps));
    const rtw = rtNotices(want.map(function (w) { return w[1]; }));
    const s46 = '読めない行があった（46 行目）。発話にしていない。時刻の書き方を確かめる';
    check('上限で切れる窓の知らせ', '1 つ目・2 つ目の窓では入口の欄に 46 行目の知らせを出さない（その発話はまだ渡していない）', boxes[0].shown && boxes[1].shown && boxes[0].box.length === 0 && boxes[1].box.length === 0, JSON.stringify(boxes.slice(0, 2)));
    check('上限で切れる窓の知らせ', '3 つ目の窓で入口の欄に 46 行目の知らせが出る', boxes[2] && boxes[2].shown && JSON.stringify(boxes[2].box) === JSON.stringify([s46]), JSON.stringify(boxes[2]));
    check('上限で切れる窓の知らせ', '窓ごとの入口の欄の文が、rt.py が同じ窓で出す文と同じ', !rtw.error && JSON.stringify(boxes.map(function (b) { return b.box; })) === JSON.stringify(rtw), JSON.stringify(rtw));
    check('上限で切れる窓の知らせ', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- U. 音声の入口の聞き終え（K19。模擬の認識器: stop の後に確定の結果を返し、そのあとに終わりの知らせ） ----------
  // 「聞き終える」を押したら、いま動いている認識の終わりの知らせを待ってから最後の窓 → end。止めた後に届いた確定の結果も
  // 素材ログに残り、最後の窓に入る（中断の道と同じ）。終わりの知らせが 3 秒待っても来なければ、知らせの欄にそう出して進む
  const speechPage = async function (name, cfg) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', function (e) { errs.push(String(e && e.message || e)); });
    await page.addInitScript(function (cfg) {
      globalThis.__srs = [];
      globalThis.__inflight = null;   // stop() の後に確定の結果として返す発話（試験が置く）
      function FakeSR() { this.lang = ''; this.continuous = false; this.interimResults = false; this.ended = false; this.stopped = false; }
      FakeSR.prototype.start = function () { const self = this; globalThis.__srs.push(self); globalThis.__sr = self; setTimeout(function () { if (self.onstart) self.onstart(); }, 0); };
      // 仕様の順: stop → それまでの音声の確定の結果 → 終わりの知らせ。どちらも遅れて届く（cfg.resultMs・cfg.endMs）
      FakeSR.prototype.stop = function () {
        const self = this;
        if (self.stopped) return;
        self.stopped = true;
        const text = globalThis.__inflight; globalThis.__inflight = null;
        if (text) setTimeout(function () { const r = [{ transcript: text }]; r.isFinal = true; if (self.onresult) self.onresult({ resultIndex: 0, results: [r] }); }, cfg.resultMs);
        setTimeout(function () { self.ended = true; if (self.onend) self.onend(); }, cfg.endMs);
      };
      globalThis.SpeechRecognition = undefined;
      globalThis.webkitSpeechRecognition = FakeSR;
    }, cfg);
    await page.goto('file://' + path.join(KIT, 'kiku.html'));
    await page.waitForTimeout(300);
    await page.fill('#name', name);
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'speech');
    // 模擬の認識器には端末内の口が無いので、音声を外へ送る承知の印を付けてから始める
    await page.check('#speech-cloud');
    await page.fill('#win', String(cfg.win || 30));
    await page.click('#start');
    await page.waitForFunction(function () { return !!globalThis.__sr && /聞いている/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 5000 });
    const say = function (text) { return page.evaluate(function (text) { const r = [{ transcript: text }]; r.isFinal = true; globalThis.__sr.onresult({ resultIndex: 0, results: [r] }); }, text); };
    return { page: page, errs: errs, say: say };
  };
  {
    // U1: 止めてから 0.2 秒で確定の結果、0.6 秒で終わりの知らせ。窓幅 5 秒で、最初の発話を渡した窓（S1）が書かれ、
    // まだ窓にしていない発話が 1 つも無いときに押す（溜まった発話があると、最後の窓を待つ間に遅れた結果が間に合ってしまい、
    // 待たない作りとの違いが出ない）
    const NAME = '音声の聞き終え';
    const s = await speechPage(NAME, { resultMs: 200, endMs: 600, win: 5 });
    const page = s.page;
    await page.waitForTimeout(200);
    await s.say('最初の発話。');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent); }, null, { timeout: 15000 });
    await page.waitForTimeout(300);
    await page.evaluate(function () { globalThis.__inflight = '聞き終える直前に話した発話。'; });
    await page.click('#end');
    await page.waitForTimeout(100);
    const during = await page.evaluate(function () { return { end: document.getElementById('end').disabled, pause: document.getElementById('pause').disabled, msg: document.getElementById('intakemsg').textContent }; });
    check('音声の聞き終え', '待つ間は「聞き終える」「中断する」を押せず、入口の札が終わりの知らせを待っていると言う', during.end && during.pause && /終わりの知らせを待っている/.test(during.msg), JSON.stringify(during));
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    const log = await readLogEnded(page, NAME);
    const src = await readSrc(page, NAME);
    const utts = src.filter(function (l) { return l.i != null; });
    const steps = log.filter(function (e) { return e.e === 'step'; });
    const last = steps[steps.length - 1];
    check('音声の聞き終え', 'stop の後に届いた確定の結果も素材ログに残る（発話 2 件）', JSON.stringify(utts.map(function (l) { return l.text; })) === JSON.stringify(['最初の発話。', '聞き終える直前に話した発話。']), JSON.stringify(utts.map(function (l) { return [l.i, l.t, l.text]; })));
    check('音声の聞き終え', 'その発話は最後の窓に入り、end で閉じる（最後の窓の終わりは、どの発話の時刻よりも後）', last && last.lines[1] === 2 && utts.length === 2 && last.t[1] > utts[1].t && log[log.length - 1].e === 'end' && log[log.length - 1].t >= last.t[1], JSON.stringify({ steps: steps.map(function (x) { return [x.t, x.lines]; }), end: log[log.length - 1] }));
    const evs = src.filter(function (l) { return l.i == null; }).map(function (l) { return l.ev; });
    check('音声の聞き終え', '終わりの知らせが届いたので、待ちきれなかった出来事は残らない', evs.indexOf('asr_stop_timeout') < 0 && evs.indexOf('asr_end') >= 0, JSON.stringify(evs));
    const box = await boxLines(page);
    check('音声の聞き終え', '入口の知らせの欄に、待ちきれなかった知らせは出ない', !box.some(function (l) { return /待っても来なかった/.test(l); }), JSON.stringify(box));
    check('音声の聞き終え', 'ページ内エラー無し', s.errs.length === 0, s.errs.join(' | '));
    await page.close();
  }
  {
    // U2: 終わりの知らせが 3 秒より後（止めてから 4.2 秒）。確定の結果は 3.6 秒（聞き終えた後）に届く
    const NAME = '音声の聞き終え（待ちきれない）';
    const s = await speechPage(NAME, { resultMs: 3600, endMs: 4200 });
    const page = s.page;
    await page.waitForTimeout(200);
    await s.say('最初の発話。');
    await page.waitForTimeout(800);
    await page.evaluate(function () { globalThis.__inflight = '止めてから 3.6 秒で届く発話。'; });
    const c0 = Date.now();
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    const waited = Date.now() - c0;
    const want = await page.evaluate(function () { return globalThis.TSV_INTAKE.STOP_WAIT_TEXT; });
    const box = await boxLines(page);
    check('音声の聞き終え', '終わりの知らせを上限（3 秒）まで待ってから聞き終える（' + waited + ' ミリ秒）', waited >= 2900 && waited < 9000, waited);
    check('音声の聞き終え', '上限を過ぎたことを入口の知らせの欄に出す（intake.js の文と同じ）', typeof want === 'string' && /3 秒待っても来なかった/.test(want) && box.indexOf(want) >= 0, JSON.stringify(box));
    await page.waitForTimeout(1800);   // 遅れた確定の結果（3.6 秒）と終わりの知らせ（4.2 秒）が届くのを待つ
    const log = await readLogEnded(page, NAME);
    const src = await readSrc(page, NAME);
    const ev = src.filter(function (l) { return l.ev === 'asr_stop_timeout'; })[0];
    check('音声の聞き終え', '素材ログに「待ちきれなかった」出来事が残る（待った長さ 3000 ミリ秒）', ev && ev.ms === 3000, JSON.stringify(ev));
    const feed = await page.evaluate(function () { return document.getElementById('feed').innerText; });
    check('音声の聞き終え', '逐語の欄には日本語の札で出る（英字の符号は出さない）', /認識の終わりを待ちきれずに聞き終えた/.test(feed) && !/asr_/.test(feed), feed.replace(/\n/g, ' | ').slice(0, 300));
    const utts = src.filter(function (l) { return l.i != null; });
    const steps = log.filter(function (e) { return e.e === 'step'; });
    const covered = utts.every(function (l) { return steps.some(function (x) { return l.i >= x.lines[0] && l.i <= x.lines[1]; }); });
    check('音声の聞き終え', '聞き終えた後に届いた結果で記録は崩れない（end で閉じたまま、素材ログの発話はどれも窓に入っている。知らせのとおり、遅れた結果は入らない）', log[log.length - 1].e === 'end' && covered && utts.length === 1, JSON.stringify({ utts: utts.map(function (l) { return l.text; }), steps: steps.map(function (x) { return x.lines; }) }));
    check('音声の聞き終え', 'ページ内エラー無し（待ちきれない）', s.errs.length === 0, s.errs.join(' | '));
    await page.close();
  }

  // ---------- V. ライブの最後の窓の終わりは聞き終えた時計の秒（K23。打つ／貼る、窓幅 5、中断のあと再開せずに聞き終える） ----------
  // 0:05 に S1 を書いて中断し、中断の間に 1 行打って、再開せずに聞き終える。最後の窓の終わりは時計の秒（刻みの 0:10 ではない）。
  // 幅は open.window × 3 まで（0:22 に聞き終えたら 0:05〜0:20）。rt.py に同じ並びと同じ時計を渡し（試験の時計）、next --last の
  // 窓が同じことと、end の t が rt.py の end_t と同じことを確かめる
  const isoOf = function (sec) { return new Date(Math.round(sec * 1000)).toISOString().replace(/\.\d{3}Z$/, 'Z'); };
  // rt.py の live を、ページと同じ並び・同じ時計で通す（試験の時計 KIKU_TEST_CLOCK=1 と --now。出力フォルダの下に書く）
  const rtLiveReplay = function (input) {
    const code = [
      'import json, os, subprocess, sys',
      'kit = sys.argv[1]',
      'd = json.load(sys.stdin)',
      'env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", KIKU_TEST_CLOCK="1")',
      'D = d["dir"]',
      'os.makedirs(os.path.join(D, "live"), exist_ok=True)',
      'log = os.path.join(D, "live", "会議.jsonl")',
      'memo = os.path.join(D, "live", "会議.txt")',
      'def rt(*a):',
      '    r = subprocess.run([sys.executable, os.path.join(kit, "tools", "rt.py"), *map(str, a)], cwd=kit, capture_output=True, text=True, env=env)',
      '    return r.returncode, r.stdout, r.stderr',
      'def win(o):',
      '    p = json.loads(o)',
      '    ls = p["new"]["lines"]',
      '    return [p["new"]["t"], [ls[0]["i"], ls[-1]["i"]]], p.get("notices", [])',
      'out = {"steps": []}',
      'open(memo, "w", encoding="utf-8").close()',
      'c, o, e = rt("open", log, "--live", "--name", "会議", "--transcript", memo, "--window", d["window"], "--now", d["t0"])',
      'if c:',
      '    print(json.dumps({"error": "open: " + (o + e)[-400:]}, ensure_ascii=False)); sys.exit()',
      'for ev in d["events"]:',
      '    k = ev["kind"]',
      '    if k == "line":',
      '        with open(memo, "a", encoding="utf-8") as f:',
      '            f.write((ev["who"] + "\\t" if ev.get("who") else "") + ev["text"] + "\\n")',
      '        c, o, e = rt("watch", log, "--once", "--now", ev["at"])',
      '    elif k == "step":',
      '        c, o, e = rt("next", log, "--json", "--now", ev["at"])',
      '        if not c:',
      '            out["steps"].append(win(o)[0])',
      '            b = os.path.join(D, "b.json")',
      '            with open(b, "w", encoding="utf-8") as f:',
      '                json.dump({"step": {"t": json.loads(o)["new"]["t"]}, "events": [], "note": {"x": "e2e"}}, f, ensure_ascii=False)',
      '            c, o, e = rt("append", log, b, "--now", ev["at"])',
      '    elif k == "pause":',
      '        c, o, e = rt("pause", log, "--now", ev["at"])',
      '    elif k == "last":',
      '        c, o, e = rt("next", log, "--last", "--json", "--now", ev["at"])',
      '        if not c:',
      '            out["last"], out["notices"] = win(o)',
      '    if c:',
      '        print(json.dumps({"error": k + ": " + (o + e)[-400:]}, ensure_ascii=False)); sys.exit()',
      'print(json.dumps(out, ensure_ascii=False))'
    ].join('\n');
    const r = spawnSync('python3', ['-B', '-c', code, KIT], { input: JSON.stringify(input), encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
    if (r.status !== 0) return { error: (r.stderr || String(r.error || '')).slice(-400) };
    try { return JSON.parse(r.stdout); } catch (e) { return { error: 'rt.py の出力が読めない: ' + r.stdout.slice(0, 300) }; }
  };
  // ページの記録（判断ログ・素材ログ）から、rt.py に渡す並びを作る。行は届いた秒に、窓は閉じた秒（t[1]）に、
  // 中断は書いた壁時計に、最後の窓は閉じた秒に置く（同じ秒なら行を先に）
  const replayInput = function (log, src, dir, lastSec) {
    const t0 = isoSec(log[0].t0);
    const evs = [];
    src.filter(function (l) { return l.i != null; }).forEach(function (l) { evs.push({ s: t0 + l.t, o: 0, kind: 'line', at: isoOf(t0 + l.t), who: l.who, text: l.text }); });
    const steps = log.filter(function (e) { return e.e === 'step'; });
    steps.forEach(function (x, k) {
      const sec = t0 + x.t[1];
      // 最後の窓は、ページがそれを閉じた時計の秒（lastSec。幅の上限で t[1] より後のことがある）で next --last を打つ
      if (k === steps.length - 1) evs.push({ s: t0 + (lastSec != null ? lastSec : x.t[1]), o: 2, kind: 'last', at: isoOf(t0 + (lastSec != null ? lastSec : x.t[1])) });
      else evs.push({ s: sec, o: 1, kind: 'step', at: isoOf(sec) });
    });
    log.filter(function (e) { return e.e === 'pause'; }).forEach(function (p) { evs.push({ s: isoSec(p.at), o: 1, kind: 'pause', at: p.at }); });
    evs.sort(function (a, b) { return a.s - b.s || a.o - b.o; });
    return { dir: dir, t0: log[0].t0, window: log[0].window, events: evs.map(function (e) { const x = Object.assign({}, e); delete x.s; delete x.o; return x; }) };
  };
  const pausedEnd = async function (NAME, endAt) {
    const f = await fresh(ctx, NAME); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'text');
    await page.fill('#win', '5');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('ta').disabled; }, null, { timeout: 10000 });
    const t0 = isoSec((await readLog(page, NAME))[0].t0);
    const untilSec = async function (sec) { const ms = (t0 + sec) * 1000 - Date.now(); if (ms > 0) await page.waitForTimeout(ms); };
    await untilSec(0.5);
    await page.click('#ta');
    await page.keyboard.type('日向: 中断の前の発話。');
    await page.keyboard.press('Enter');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('pause').disabled; }, null, { timeout: 15000 });
    await untilSec(6.2);
    await page.click('#pause');
    await untilSec(7.3);
    await page.click('#ta');
    await page.keyboard.type('月見: 中断の間に打った行。');
    await page.keyboard.press('Enter');
    await untilSec(endAt + 0.2);
    const clickT = Date.now() / 1000 - t0;
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    const log = await readLogEnded(page, NAME);
    const src = await readSrc(page, NAME);
    return { f: f, page: page, log: log, src: src, t0: t0, clickT: clickT };
  };
  for (const c of [{ endAt: 12, want: [[5, 12], [2, 2]], tag: '0:12 に聞き終える' }, { endAt: 22, want: [[5, 20], [2, 2]], tag: '0:22 に聞き終える（幅の上限）' }]) {
    const NAME = '最後の窓は時計の秒（' + c.endAt + '）';
    const r = await pausedEnd(NAME, c.endAt);
    const steps = r.log.filter(function (e) { return e.e === 'step'; });
    const last = steps[steps.length - 1];
    const end = r.log[r.log.length - 1];
    const H = Math.floor(r.clickT);
    check('最後の窓の終わり', c.tag + '（中断のあと再開せず）: 最後の窓は ' + JSON.stringify(c.want[0]) + '（刻みの 0:10 ではない）で、中断の間の行が入る', H === c.endAt && last && JSON.stringify([last.t, last.lines]) === JSON.stringify(c.want), JSON.stringify({ H: H, steps: steps.map(function (x) { return [x.t, x.lines]; }) }));
    const rtE = rtCalc({ log_end: r.log.slice(0, -1), end_clock: end.at });
    check('最後の窓の終わり', c.tag + ': end の t は聞き終えた時計の秒（' + c.endAt + '）で、rt.py の end_t と同じ', end.e === 'end' && end.t === c.endAt && rtE.end_t === end.t, JSON.stringify({ end: end, rt: rtE }));
    const rr = rtLiveReplay(replayInput(r.log, r.src, path.join(OUT, 'rt-live-' + c.endAt + '-' + Date.now()), H));
    const mine = steps.map(function (x) { return [x.t, x.lines]; });
    check('最後の窓の終わり', c.tag + ': rt.py に同じ並びと同じ時計を渡すと、どの窓も同じ（最後の窓は next --last）', !rr.error && JSON.stringify(rr.steps.concat([rr.last])) === JSON.stringify(mine), JSON.stringify({ rt: rr, page: mine }));
    check('最後の窓の終わり', c.tag + ': ページ内エラー無し', r.f.errs.length === 0, r.f.errs.join(' | '));
    await r.page.close();
  }

  // ---------- W. 時刻のある行が 1 つも無い素材（K21）: 記録を作らずに断り、断りの文を知らせの欄に出す ----------
  // 断りの文は共通の期待値（tests/fixtures/*.expect.json の refuse。rt.py の file の open と同じ文）と一字違わず同じ。
  // WebVTT の行の無い字幕（material_vtt_bare.vtt）は、字幕として読んで窓まで期待値と同じ
  // 0 バイトのファイル（v7_m45）・空白だけのファイル（v7_m48）・見出しの行が「10:00 --> 11:00 定例」の形で字幕と決まった素材
  // （v7_m51。何行目で字幕と決めたかを断りの文に添える）も、同じ文で断る（K31）
  for (const m of ['material_none.txt', 'material_blank.txt', 'material_srt.txt', 'material_v7_m45.txt', 'material_v7_m48.txt', 'material_v7_m51.txt']) {
    const exp = JSON.parse(fs.readFileSync(path.join(KIT, 'tests', 'fixtures', m.replace(/\.[a-z]+$/, '.expect.json')), 'utf8'));
    const NAME = '発話の無い素材 ' + m;
    const f = await fresh(ctx, NAME); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'file');
    await page.setInputFiles('#file', path.join(KIT, 'tests', 'fixtures', m));
    await page.click('#file-load');
    await page.waitForFunction(function () { return /ファイルを読んだ/.test(document.getElementById('intakemsg').textContent); }, null, { timeout: 5000 });
    const im = await txt(page, 'intakemsg');
    check('発話の無い素材', m + ': 読み込んだときに、発話が 1 つも無いので聞き始められないと言う', /発話が 1 つも無い/.test(im), im);
    await page.click('#start');
    await page.waitForTimeout(500);
    const sm = await txt(page, 'setupmsg');
    const box = await boxLines(page);
    const st = await page.evaluate(function (name) {
      return globalThis.TSV_RECORD.listNames().then(function (names) { const r = globalThis.TSV_RECORD.makeRecord(name); return r.load().then(function () { return { names: names, log: r.log.length, src: r.src.length, listen: document.getElementById('st-listen').textContent }; }); });
    }, NAME);
    check('発話の無い素材', m + ': 記録を作らない（判断ログも素材ログも 0 行、残っている記録の名前にも無い）', st.log === 0 && st.src === 0 && st.names.indexOf(NAME) < 0 && !/聞いている/.test(st.listen), JSON.stringify(st));
    check('発話の無い素材', m + ': 上の札に断りの文を出す（「先に素材のファイルを読み込む」とは言わない）', sm.indexOf(exp.refuse[0]) >= 0 && !/先に素材のファイルを読み込む/.test(sm), sm);
    check('発話の無い素材', m + ': 知らせの欄の文が共通の期待値（refuse）と一字違わず同じ', JSON.stringify(box) === JSON.stringify(exp.refuse), JSON.stringify(box));
    const rtR = (function () {
      const code = ['import json, sys', 'sys.path.insert(0, sys.argv[1])', 'import rt', 'print(json.dumps(rt.material_refusal(sys.argv[2]), ensure_ascii=False))'].join('\n');
      const r = spawnSync('python3', ['-B', '-c', code, path.join(KIT, 'tools'), path.join(KIT, 'tests', 'fixtures', m)], { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
      try { return JSON.parse(r.stdout); } catch (e) { return { error: (r.stderr || r.stdout).slice(-300) }; }
    })();
    check('発話の無い素材', m + ': rt.py の断りの文（material_refusal）と同じ', JSON.stringify(rtR) === JSON.stringify(box), JSON.stringify(rtR));
    check('発話の無い素材', m + ': ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }
  {
    // 空白だけを貼った素材（K31）: 貼った字を素材として受け、聞き始めると 0 バイトの素材と同じ文で断る（「先に読み込む」とは言わない）
    const NAME = '空白だけを貼った素材';
    const text = '  \n\t\n\u3000\n';
    const mpath = path.join(OUT, 'material_paste_blank.txt');
    fs.writeFileSync(mpath, text);
    const f = await fresh(ctx, NAME); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'file');
    await paste(page, text);
    const im = await txt(page, 'intakemsg');
    await page.click('#start');
    await page.waitForTimeout(500);
    const sm = await txt(page, 'setupmsg');
    const box = await boxLines(page);
    const rtR = (function () {
      const code = ['import json, sys', 'sys.path.insert(0, sys.argv[1])', 'import rt', 'print(json.dumps(rt.material_refusal(sys.argv[2]), ensure_ascii=False))'].join('\n');
      const r = spawnSync('python3', ['-B', '-c', code, path.join(KIT, 'tools'), mpath], { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
      try { return JSON.parse(r.stdout); } catch (e) { return { error: (r.stderr || r.stdout).slice(-300) }; }
    })();
    const st = await page.evaluate(function (name) { const r = globalThis.TSV_RECORD.makeRecord(name); return r.load().then(function () { return { log: r.log.length, src: r.src.length }; }); }, NAME);
    check('発話の無い素材', '空白だけを貼る: 貼ったときに、発話が 1 つも無いので聞き始められないと言う', /貼った文字をファイルとして使う/.test(im) && /発話が 1 つも無い/.test(im), im);
    check('発話の無い素材', '空白だけを貼る: 聞き始めると「先に読み込む」ではなく、rt.py と同じ断りの文で断り、記録を作らない', !/先に素材のファイルを読み込む/.test(sm) && Array.isArray(rtR) && sm.indexOf(rtR[0]) >= 0 && JSON.stringify(box) === JSON.stringify(rtR) && st.log === 0 && st.src === 0, JSON.stringify({ sm: sm, box: box, rt: rtR, st: st }));
    check('発話の無い素材', '空白だけを貼る: ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }
  {
    const exp = JSON.parse(fs.readFileSync(path.join(KIT, 'tests', 'fixtures', 'material_vtt_bare.expect.json'), 'utf8'));
    const NAME = 'WEBVTT の行の無い字幕';
    const f = await fresh(ctx, NAME); const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'file');
    await page.fill('#win', String(exp.window));
    await page.setInputFiles('#file', path.join(KIT, 'tests', 'fixtures', 'material_vtt_bare.vtt'));
    await page.click('#file-load');
    await page.waitForFunction(function () { return /ファイルを読んだ/.test(document.getElementById('intakemsg').textContent); }, null, { timeout: 5000 });
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    for (let k = 1; k <= exp.windows.length; k++) {
      await page.click('#file-next');
      const lastW = k === exp.windows.length;
      await waitOr(page, lastW ? function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }
        : function (k) { return new RegExp('（S' + k + '）').test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, k, 15000);
    }
    const log = await readLogEnded(page, NAME);
    const src = (await readSrc(page, NAME)).filter(function (l) { return l.i != null; }).map(function (l) { return { i: l.i, t: l.t, who: l.who, text: l.text }; });
    const steps = log.filter(function (e) { return e.e === 'step'; }).map(function (x) { return { t: x.t, lines: x.lines }; });
    check('発話の無い素材', 'WEBVTT の行の無い字幕は字幕として読む: 発話の列が期待値と同じ（' + exp.utterances.length + ' 発話）', JSON.stringify(src) === JSON.stringify(exp.utterances), JSON.stringify(src).slice(0, 300));
    check('発話の無い素材', 'WEBVTT の行の無い字幕: 窓が期待値と同じ', JSON.stringify(steps) === JSON.stringify(exp.windows.map(function (w) { return { t: w.t, lines: w.lines }; })), JSON.stringify(steps));
    check('発話の無い素材', 'WEBVTT の行の無い字幕: ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- X. 続きから聞くときの知らせ（K22。ファイル） ----------
  // 読み込み直して「続きから」聞くとき、読み飛ばす発話のうち、まだ窓で渡していない発話に付いた知らせ（40 件の上限で次の窓に
  // 回った発話・返事を書く前に読み込み直した窓の発話・最後の発話より後ろの知らせ）は捨てず、その発話を渡す窓で出す。
  // 文は rt.py が同じ窓で出す文（file_notices → notice_lines）と同じ
  const rtWinNotices = function (mpath, wins) {
    const code = ['import json, sys', 'sys.path.insert(0, sys.argv[1])', 'import rt', 'd = json.load(sys.stdin)',
      'print(json.dumps([rt.notice_lines(rt.file_notices(d["path"], w[0], w[1])) for w in d["wins"]], ensure_ascii=False))'].join('\n');
    const r = spawnSync('python3', ['-B', '-c', code, path.join(KIT, 'tools')], { input: JSON.stringify({ path: mpath, wins: wins }), encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
    if (r.status !== 0) return { error: (r.stderr || String(r.error || '')).slice(-400) };
    try { return JSON.parse(r.stdout); } catch (e) { return { error: r.stdout.slice(0, 200) }; }
  };
  const openFile = async function (page, name, route, text) {
    await page.fill('#name', name);
    await page.selectOption('#route', route);
    await page.selectOption('#intake', 'file');
    await paste(page, text);
    await page.click('#start');
  };
  const nowBox = async function (page) { return (await boxLines(page)).filter(function (l) { return !/^前の窓までの知らせ/.test(l); }); };
  {
    // X1: 40 件の上限で次の窓に回った発話（43 番目）に付いた知らせ。S1 を書いたあと、S2 を渡す前に読み込み直す
    const NAME = '続きからの知らせ（上限）';
    const L = [];
    for (let k = 1; k <= 42; k++) L.push('0:10\t甲\t発話' + k);
    L.push('1:2\t乙\t読めない行');
    for (let k = 43; k <= 45; k++) L.push('0:10\t甲\t発話' + k);
    L.push('0:50\t乙\t発話46', '1:30\t甲\t発話47');
    const text = L.join('\n') + '\n';
    const mpath = path.join(OUT, 'material_resume_cap.tsv');
    fs.writeFileSync(mpath, text);
    const f = await fresh(ctx, NAME); const page = f.page;
    await openFile(page, NAME, 'mock', text);
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    const box1 = await nowBox(page);
    await page.reload();
    await page.waitForTimeout(400);
    await openFile(page, NAME, 'mock', text);
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    const sm = await txt(page, 'setupmsg');
    await page.click('#file-next');
    await page.waitForFunction(function () { return /（S2）/.test(document.getElementById('edge').textContent) && !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    const box2 = await nowBox(page);
    const log = await readLog(page, NAME);
    const steps = log.filter(function (e) { return e.e === 'step'; }).map(function (x) { return [x.t, x.lines]; });
    const rtw = rtWinNotices(mpath, steps.map(function (x) { return x[1]; }));
    check('続きからの知らせ', '上限で次の窓に回った発話: 読み込み直して続きから聞いても、その発話を渡す S2 で 43 行目の知らせを出す', /続きから/.test(sm) && box1.length === 0 && JSON.stringify(box2) === JSON.stringify(['読めない行があった（43 行目）。発話にしていない。時刻の書き方を確かめる']), JSON.stringify({ sm: sm, box1: box1, box2: box2, steps: steps }));
    check('続きからの知らせ', '上限で次の窓に回った発話: 窓ごとの知らせの文が、rt.py が同じ窓で出す文と同じ', !rtw.error && JSON.stringify([box1, box2]) === JSON.stringify(rtw), JSON.stringify(rtw));
    check('続きからの知らせ', 'ページ内エラー無し（上限）', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }
  {
    // X2: 渡した窓の返事を書く前に読み込み直す（人が書く）。窓の中の読めない行（2 行目）と、最後の発話より後ろの読めない行（6 行目）
    const NAME = '続きからの知らせ（返事の前）';
    const text = '0:05\t甲\t一つ目\n1:2\t乙\t壊れた行\n0:10\t甲\t二つ目\n0:20\t乙\t三つ目\n\n1:2\t乙\t末尾の壊れた行\n';
    const mpath = path.join(OUT, 'material_resume_tail.tsv');
    fs.writeFileSync(mpath, text);
    const f = await fresh(ctx, NAME); const page = f.page;
    await openFile(page, NAME, 'human', text);
    await page.waitForFunction(function () { return !document.getElementById('file-next').disabled; }, null, { timeout: 10000 });
    await page.click('#file-next');
    await page.waitForFunction(function () { return /0:00〜0:30/.test(document.getElementById('h-win').textContent); }, null, { timeout: 10000 });
    const box1 = await nowBox(page);
    await page.reload();
    await page.waitForTimeout(400);
    await openFile(page, NAME, 'human', text);
    const shown = await waitOr(page, function () { return /0:00〜0:30/.test(document.getElementById('h-win').textContent); }, null, 10000);
    const sm = await txt(page, 'setupmsg');
    const box2 = await nowBox(page);
    const rtw = rtWinNotices(mpath, [[1, 3]]);
    check('続きからの知らせ', '返事を書く前に読み込み直す: 続きから開くと同じ窓（0:00〜0:30）がまた出て、窓の中と末尾の知らせ（2・6 行目）もまた出る', /続きから/.test(sm) && shown && box1.length > 0 && JSON.stringify(box2) === JSON.stringify(box1), JSON.stringify({ sm: sm, box1: box1, box2: box2 }));
    check('続きからの知らせ', '返事を書く前に読み込み直す: 知らせの文が rt.py が同じ窓で出す文と同じ', !rtw.error && JSON.stringify(box2) === JSON.stringify(rtw[0]), JSON.stringify(rtw));
    await page.fill('#h-note', '続きからの窓の所感');
    await page.click('#h-write');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 10000);
    const src = await readSrc(page, NAME);
    check('続きからの知らせ', '返事を書く前に読み込み直す: 読めない行の記録は二重にならない（2・6 行目が 1 度ずつ）', JSON.stringify(src.filter(function (l) { return l.ev === 'unreadable'; }).map(function (l) { return l.line; })) === '[2,6]', JSON.stringify(src.filter(function (l) { return l.i == null; })));
    check('続きからの知らせ', 'ページ内エラー無し（返事の前）', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  // ---------- Y. 音声の入口: 中断して古い認識が終わる前に再開し、そのまま聞き終える（K29。模擬の認識器） ----------
  // 認識は作った順に gens の設定を使う（止めてから確定の結果を返すまでと、終わりの知らせまでのミリ秒）。中断で止めた古い
  // 認識の終わりの知らせが来る前に再開し、すぐ「聞き終える」を押す。聞き終えるときは、古い認識もいまの認識も合わせて 3 秒まで
  // 待つ。その間に古い認識が返した結果は最後の窓に入り、3 秒より後に返した結果は記録に入れずに素材ログの出来事 late として
  // 残り、知らせの欄にそう出る。聞き終えた後は late のほかの出来事を素材ログに足さない
  const speechGensPage = async function (name, gens, win) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', function (e) { errs.push(String(e && e.message || e)); });
    await page.addInitScript(function (gens) {
      globalThis.__srs = [];
      function FakeSR() { this.lang = ''; this.continuous = false; this.interimResults = false; this.ended = false; this.stopped = false; this.inflight = null; }
      FakeSR.prototype.start = function () { const self = this; self.k = globalThis.__srs.length; globalThis.__srs.push(self); globalThis.__sr = self; setTimeout(function () { if (self.onstart) self.onstart(); }, 0); };
      FakeSR.prototype.stop = function () {
        const self = this;
        if (self.stopped) return;
        self.stopped = true;
        const g = gens[Math.min(self.k, gens.length - 1)];
        const text = self.inflight; self.inflight = null;
        if (text) setTimeout(function () { const r = [{ transcript: text }]; r.isFinal = true; if (self.onresult) self.onresult({ resultIndex: 0, results: [r] }); }, g.resultMs);
        setTimeout(function () { self.ended = true; if (self.onend) self.onend(); }, g.endMs);
      };
      globalThis.SpeechRecognition = undefined;
      globalThis.webkitSpeechRecognition = FakeSR;
    }, gens);
    await page.goto('file://' + path.join(KIT, 'kiku.html'));
    await page.waitForTimeout(300);
    await page.fill('#name', name);
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'speech');
    // 模擬の認識器には端末内の口が無いので、音声を外へ送る承知の印を付けてから始める
    await page.check('#speech-cloud');
    await page.fill('#win', String(win || 5));
    await page.click('#start');
    await page.waitForFunction(function () { return !!globalThis.__sr && /聞いている/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 5000 });
    // いちばん新しい認識に話させる
    const say = function (text) { return page.evaluate(function (text) { const r = [{ transcript: text }]; r.isFinal = true; globalThis.__sr.onresult({ resultIndex: 0, results: [r] }); }, text); };
    // 中断 → 古い認識の終わりの前に再開 → 再開した後に 1 つ話す → 聞き終える。古い認識・新しい認識には、止めた後に返す結果を置く
    const run = async function (oldText) {
      await page.waitForTimeout(200);
      await say('中断の前の発話。');
      await page.waitForFunction(function () { return /（S1）/.test(document.getElementById('edge').textContent) && !document.getElementById('pause').disabled; }, null, { timeout: 15000 });
      await page.evaluate(function (t) { globalThis.__srs[0].inflight = t; }, oldText);
      await page.click('#pause');
      const t0 = Date.now();
      await page.waitForTimeout(200);
      await page.$eval('#resume', function (b) { b.click(); });
      await page.waitForFunction(function () { return globalThis.__srs.length === 2 && /聞いている/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 5000 });
      await say('再開した後の発話。');
      await page.evaluate(function () { globalThis.__srs[1].inflight = '新しい認識の止めた後の結果。'; });
      await page.waitForTimeout(100);
      const oldAlive = await page.evaluate(function () { return !globalThis.__srs[0].ended; });
      const c0 = Date.now();
      await page.click('#end');
      await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
      return { t0: t0, c0: c0, waited: Date.now() - c0, oldAlive: oldAlive };
    };
    return { page: page, errs: errs, say: say, run: run };
  };
  const evAfter = function (src, ev) {
    let k = -1;
    src.forEach(function (l, j) { if (l.ev === ev) k = j; });
    return k < 0 ? null : src.slice(k + 1).filter(function (l) { return l.i == null; }).map(function (l) { return l.ev; });
  };
  {
    // Y1: 古い認識は中断の stop から 2.6 秒で結果、2.7 秒で終わりの知らせ。新しい認識は 0.2 秒・0.3 秒。どちらも 3 秒の中
    const NAME = '古い認識の遅れた結果';
    const s = await speechGensPage(NAME, [{ resultMs: 2600, endMs: 2700 }, { resultMs: 200, endMs: 300 }], 5);
    const page = s.page;
    const r = await s.run('古い認識が止めた後に返した結果。');
    const log = await readLogEnded(page, NAME);
    const src = await readSrc(page, NAME);
    const utts = src.filter(function (l) { return l.i != null; });
    const steps = log.filter(function (e) { return e.e === 'step'; });
    const last = steps[steps.length - 1];
    const covered = utts.every(function (l) { return steps.some(function (x) { return l.i >= x.lines[0] && l.i <= x.lines[1]; }); });
    const texts = utts.map(function (l) { return l.text; }).slice().sort();
    const want = ['中断の前の発話。', '再開した後の発話。', '新しい認識の止めた後の結果。', '古い認識が止めた後に返した結果。'].sort();
    check('古い認識の結果', '場面の確かめ: 聞き終えるを押したとき、中断で止めた古い認識の終わりの知らせはまだ来ていない（認識は 2 つ作った）', r.oldAlive && (await page.evaluate(function () { return globalThis.__srs.length; })) === 2, JSON.stringify(r));
    check('古い認識の結果', '古い認識の終わりの知らせ（中断から 2.7 秒）まで待ってから聞き終える（' + r.waited + ' ミリ秒）', r.waited >= 1800 && r.waited < 9000, r.waited);
    check('古い認識の結果', '古い認識が中断の後に返した結果も素材ログの発話になる（発話 4 件。黙って欠けない・二重にならない）', JSON.stringify(texts) === JSON.stringify(want), JSON.stringify(utts.map(function (l) { return [l.i, l.t, l.text]; })));
    check('古い認識の結果', 'その発話は最後の窓に入り、end で閉じる', covered && last && last.lines[1] === 4 && log[log.length - 1].e === 'end' && log[log.length - 1].t >= last.t[1], JSON.stringify({ steps: steps.map(function (x) { return [x.t, x.lines]; }), end: log[log.length - 1] }));
    const evs = src.filter(function (l) { return l.i == null; }).map(function (l) { return l.ev; });
    check('古い認識の結果', '3 秒の中で終わったので、待ちきれなかった出来事も late も残らない', evs.indexOf('asr_stop_timeout') < 0 && evs.indexOf('late') < 0, JSON.stringify(evs));
    const box = await boxLines(page);
    check('古い認識の結果', '入口の知らせの欄に、待ちきれなかった知らせも捨てた知らせも出ない', !box.some(function (l) { return /待っても来なかった|捨てました/.test(l); }), JSON.stringify(box));
    check('古い認識の結果', 'ページ内エラー無し', s.errs.length === 0, s.errs.join(' | '));
    await page.close();
  }
  {
    // Y2: 古い認識は中断の stop から 4.0 秒で結果、4.5 秒で終わりの知らせ（聞き終えるの 3 秒の上限より後）
    const NAME = '古い認識の遅れた結果（上限の後）';
    const OLD = '上限を過ぎてから古い認識が返した結果。';
    const s = await speechGensPage(NAME, [{ resultMs: 4000, endMs: 4500 }, { resultMs: 200, endMs: 300 }], 5);
    const page = s.page;
    const r = await s.run(OLD);
    check('古い認識の結果', '上限の後: 止めた認識を合わせて 3 秒まで待ってから聞き終える（' + r.waited + ' ミリ秒）', r.oldAlive && r.waited >= 2900 && r.waited < 9000, JSON.stringify(r));
    const rest = r.t0 + 5200 - Date.now();
    if (rest > 0) await page.waitForTimeout(rest);   // 古い認識の結果（4.0 秒）と終わりの知らせ（4.5 秒）が届くのを待つ
    const log = await readLogEnded(page, NAME);
    const src = await readSrc(page, NAME);
    const utts = src.filter(function (l) { return l.i != null; });
    const steps = log.filter(function (e) { return e.e === 'step'; });
    const covered = utts.every(function (l) { return steps.some(function (x) { return l.i >= x.lines[0] && l.i <= x.lines[1]; }); });
    const lates = src.filter(function (l) { return l.ev === 'late'; });
    const consts = await page.evaluate(function () { const I = globalThis.TSV_INTAKE; return { stop: I.STOP_WAIT_TEXT, late1: typeof I.lateText === 'function' ? I.lateText(1) : null }; });
    check('古い認識の結果', '上限の後: 遅れた結果は記録（発話・窓）に入らない（発話 3 件で、どれも窓に入り end で閉じる）', utts.length === 3 && utts.every(function (l) { return l.text !== OLD; }) && covered && log[log.length - 1].e === 'end', JSON.stringify({ utts: utts.map(function (l) { return l.text; }), steps: steps.map(function (x) { return x.lines; }) }));
    check('古い認識の結果', '上限の後: 遅れた結果を素材ログに出来事 late として残す（本文と届いた時刻つき）', lates.length === 1 && lates[0].text === OLD && typeof lates[0].t === 'number' && lates[0].t > 0, JSON.stringify(lates));
    const ev = src.filter(function (l) { return l.ev === 'asr_stop_timeout'; })[0];
    check('古い認識の結果', '上限の後: 待ちきれなかった出来事（3000 ミリ秒）が残る', ev && ev.ms === 3000, JSON.stringify(ev));
    const after = evAfter(src, 'asr_stop_timeout');
    check('古い認識の結果', '上限の後: 聞き終えた後は late のほかの出来事（古い認識の終わりなど）を素材ログに足さない', JSON.stringify(after) === JSON.stringify(['late']), JSON.stringify(after));
    const box = await boxLines(page);
    check('古い認識の結果', '上限の後: 知らせの欄に、待ちきれなかったことと、聞き終えた後の結果を 1 件捨てたことが出る（intake.js の文と同じ）', box.indexOf(consts.stop) >= 0 && box.indexOf(consts.late1) >= 0 && consts.late1 === '聞き終えた後に届いた認識の結果を 1 件捨てました（記録の外）', JSON.stringify(box));
    const feed = await page.evaluate(function () { return document.getElementById('feed').innerText; });
    check('古い認識の結果', '上限の後: 逐語の欄に、記録の外の結果として本文つきで出る（英字の符号は出さない）', feed.indexOf('聞き取りを止めた後に届いた認識の結果。記録の外：' + OLD) >= 0 && !/asr_|late/.test(feed), feed.replace(/\n/g, ' | ').slice(-300));
    check('古い認識の結果', '上限の後: ページ内エラー無し', s.errs.length === 0, s.errs.join(' | '));
    await page.close();
  }
  {
    // Y3: 古い認識の結果が、聞き終えて別の記録を開いた後に届く（中断の stop から 7.0 秒）。その結果は前の記録の素材ログに
    // late として残り、新しい記録には入らない。知らせの欄には、前の記録に残したことを出す
    const NAME = '聞き終えた後に別の記録';
    const NEXT = NAME + '（次）';
    const OLD = '次の記録を開いてから届いた古い結果。';
    const s = await speechGensPage(NAME, [{ resultMs: 7000, endMs: 7500 }, { resultMs: 200, endMs: 300 }], 5);
    const page = s.page;
    const r = await s.run(OLD);
    await readLogEnded(page, NAME);
    await page.fill('#name', NEXT);
    await page.selectOption('#intake', 'text');
    await page.click('#start');
    await page.waitForFunction(function () { return /聞いている/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 5000 });
    const opened = Date.now() - r.t0;
    const rest = r.t0 + 7800 - Date.now();
    if (rest > 0) await page.waitForTimeout(rest);
    const srcOld = await readSrc(page, NAME);
    const srcNew = await readSrc(page, NEXT);
    const box = await boxLines(page);
    check('古い認識の結果', '別の記録の後: 場面の確かめ（次の記録を開いたのは、古い結果が届く前: 中断から ' + opened + ' ミリ秒）', opened < 7000, opened);
    check('古い認識の結果', '別の記録の後: 遅れた結果は前の記録の素材ログに late として残る', srcOld.filter(function (l) { return l.ev === 'late' && l.text === OLD; }).length === 1 && srcOld.filter(function (l) { return l.i != null && l.text === OLD; }).length === 0, JSON.stringify(srcOld.filter(function (l) { return l.i == null; })));
    check('古い認識の結果', '別の記録の後: 新しい記録の素材ログには何も入らない（発話も出来事も）', srcNew.every(function (l) { return l.text !== OLD && l.ev !== 'late'; }), JSON.stringify(srcNew));
    check('古い認識の結果', '別の記録の後: 知らせの欄に、前の記録の素材ログに残したことを出す（黙らない）', box.indexOf('前の記録「' + NAME + '」で聞き終えた後に届いた認識の結果を 1 件、その記録の素材ログに残しました（記録の外）') >= 0 && !box.some(function (l) { return /^聞き終えた後に届いた/.test(l); }), JSON.stringify(box));
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    check('古い認識の結果', '別の記録の後: ページ内エラー無し', s.errs.length === 0, s.errs.join(' | '));
    await page.close();
  }

  // ---------- Z. 音声をどこで文字にするか（模擬の認識器）: この PC の中で文字にできれば外へ出さず、できなければ承知の印が要る ----------
  // mode: 'none'（端末内を調べる口が無い）・'available'・'downloadable'（install で available になる）・'hang'（install が終わらない）・
  //       'netfail'（口が無く、始めるとすぐ「通信が切れた」で終わる。職場の PC で認識の通信が止められている形）
  // 試験が認識に dead を立ててから誤りを知らせると、その認識は stop() にも abort() にも終わりの知らせを出さない
  // （Chromium の端末内の認識で、日本語が無いときに見た形）
  const whereScript = function (mode) {
    return function (mode) {
      globalThis.__srs = []; globalThis.__installs = 0; globalThis.__asks = []; globalThis.__aborts = 0;
      let state = mode === 'downloadable' || mode === 'hang' ? 'downloadable' : 'available';
      function FakeSR() { this.lang = ''; this.continuous = false; this.interimResults = false; }
      if (mode !== 'none' && mode !== 'netfail') {
        FakeSR.prototype.processLocally = false;
        FakeSR.available = function (q) { globalThis.__asks.push(JSON.stringify(q)); return Promise.resolve(state); };
        FakeSR.install = function (q) {
          globalThis.__installs++;
          if (mode === 'hang') return new Promise(function () {});
          return new Promise(function (res) { setTimeout(function () { state = 'available'; res(true); }, 100); });
        };
      }
      FakeSR.prototype.start = function () {
        const self = this; globalThis.__srs.push(self); globalThis.__sr = self;
        setTimeout(function () {
          if (self.onstart) self.onstart();
          if (mode === 'netfail') { if (self.onerror) self.onerror({ error: 'network' }); if (self.onend) self.onend(); }
        }, mode === 'netfail' ? 20 : 0);
      };
      FakeSR.prototype.stop = function () { const self = this; if (self.dead) return; setTimeout(function () { if (self.onend) self.onend(); }, 0); };
      FakeSR.prototype.abort = function () { const self = this; globalThis.__aborts++; if (self.dead) return; setTimeout(function () { if (self.onend) self.onend(); }, 0); };
      globalThis.SpeechRecognition = undefined;
      globalThis.webkitSpeechRecognition = FakeSR;
    };
  };
  const wherePage = async function (name, mode) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', function (e) { errs.push(String(e && e.message || e)); });
    await page.addInitScript(whereScript(mode), mode);
    await page.goto('file://' + path.join(KIT, 'kiku.html'));
    await page.waitForTimeout(300);
    await page.fill('#name', name);
    await page.selectOption('#route', 'human');
    await page.fill('#win', '5');
    await page.selectOption('#intake', 'speech');
    await page.waitForTimeout(200);
    return { page: page, errs: errs };
  };
  const vis = function (page, id) { return page.evaluate(function (id) { const e = document.getElementById(id); return !!e && !e.hidden && e.offsetParent !== null; }, id); };
  {
    // Z1: 端末内を調べる口が無い（Edge・古い Chrome の形）。印が無ければ聞き始めず、記録も作らない。印を付ければ始まり、local は立てない
    const NAME = '音声の行き先（口が無い）';
    const w = await wherePage(NAME, 'none');
    const page = w.page;
    const where = await txt(page, 'speechwhere');
    check('音声の行き先', '口が無い: 入口の欄が「提供元のサーバーへ送ることになる」と言い、承知の印を出す', /提供元のサーバーへ送ることになる/.test(where) && await vis(page, 'speech-cloudrow') && !(await vis(page, 'speech-installrow')), where);
    await page.click('#start');
    await page.waitForTimeout(300);
    const m1 = await txt(page, 'setupmsg');
    const n1 = await page.evaluate(function () { return globalThis.__srs.length; });
    const src1 = await readSrc(page, NAME);
    check('音声の行き先', '口が無い: 印が無ければ聞き始めない（認識を作らず、記録も作らない）', /承知する印が要る/.test(m1) && n1 === 0 && src1.length === 0, m1 + ' / 認識 ' + n1 + ' / 素材ログ ' + src1.length);
    await page.check('#speech-cloud');
    await page.click('#start');
    await page.waitForFunction(function () { return !!globalThis.__sr && /聞いている/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 5000 });
    const r = await page.evaluate(function () { return { local: globalThis.__sr.processLocally, lang: globalThis.__sr.lang, msg: document.getElementById('intakemsg').textContent, dis: document.getElementById('speech-cloud').disabled }; });
    check('音声の行き先', '口が無い: 印を付けると始まり、processLocally は立てない。札が「提供元のサーバーへ送られている」と言う', r.local !== true && r.lang === 'ja-JP' && /提供元のサーバーへ送られている/.test(r.msg), JSON.stringify(r));
    check('音声の行き先', '口が無い: 聞いている間は印を変えられない', r.dis === true, r.dis);
    await page.waitForTimeout(100);
    const src2 = await readSrc(page, NAME);
    check('音声の行き先', '口が無い: 素材ログの認識の始まりに local:false', src2.some(function (l) { return l.ev === 'asr_start' && l.local === false; }), JSON.stringify(src2));
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    check('音声の行き先', '口が無い: ページ内エラー無し', w.errs.length === 0, w.errs.join(' | '));
    await page.close();
  }
  {
    // Z2: この PC の中で文字にできる。印は出さず、印が無くても始まり、processLocally を立てる。言語が使えないと言われたら再開しない
    const NAME = '音声の行き先（端末内）';
    const w = await wherePage(NAME, 'available');
    const page = w.page;
    const where = await txt(page, 'speechwhere');
    const asks = await page.evaluate(function () { return globalThis.__asks; });
    check('音声の行き先', '端末内: 入口の欄が「この PC の中で文字にする（音声は外へ出ない）」と言い、承知の印を出さない', /この PC の中で文字にする（音声は外へ出ない）/.test(where) && !(await vis(page, 'speech-cloudrow')), where);
    check('音声の行き先', '端末内: 調べるときは ja-JP と processLocally:true で尋ねる', asks.length >= 1 && asks.every(function (q) { return q === JSON.stringify({ langs: ['ja-JP'], processLocally: true }); }), JSON.stringify(asks));
    await page.click('#start');
    await page.waitForFunction(function () { return !!globalThis.__sr && /聞いている/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 5000 });
    const r = await page.evaluate(function () { return { local: globalThis.__sr.processLocally, msg: document.getElementById('intakemsg').textContent }; });
    check('音声の行き先', '端末内: 印が無くても始まり、processLocally を立てる。札が「この PC の中で文字にしている」と言う', r.local === true && /この PC の中で文字にしている/.test(r.msg), JSON.stringify(r));
    await page.waitForTimeout(100);
    // 端末内で始めた後に「言語が使えない」: 再開しない（提供元のサーバーへ黙って切り替えない）
    await page.evaluate(function () { const s = globalThis.__sr; s.onerror({ error: 'language-not-supported' }); s.onend(); });
    await page.waitForTimeout(800);
    const after = await page.evaluate(function () { return { n: globalThis.__srs.length, local: globalThis.__srs.map(function (x) { return x.processLocally; }), msg: document.getElementById('intakemsg').textContent }; });
    check('音声の行き先', '端末内: 言語が使えないと言われたら再開せず、サーバーへ切り替えない', after.n === 1 && after.local.every(function (x) { return x === true; }) && /提供元のサーバーへは切り替えない/.test(after.msg), JSON.stringify(after));
    const st2 = await page.evaluate(function () { return { listen: document.getElementById('st-listen').textContent, start: document.getElementById('start').disabled, end: document.getElementById('end').disabled, intake: document.getElementById('intake').disabled }; });
    check('音声の行き先', '端末内: 止まった後は「聞いている」と言わず（止まっている）、入口を選び直して「聞き始める」を押せる。「聞き終える」も押せる', st2.listen === '止まっている' && !st2.start && !st2.end && !st2.intake && /「聞き始める」を押す/.test(after.msg), JSON.stringify(st2));
    const src = await readSrc(page, NAME);
    check('音声の行き先', '端末内: 素材ログの認識の始まりに local:true', src.some(function (l) { return l.ev === 'asr_start' && l.local === true; }) && !src.some(function (l) { return l.ev === 'asr_restart'; }), JSON.stringify(src));
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    check('音声の行き先', '端末内: ページ内エラー無し', w.errs.length === 0, w.errs.join(' | '));
    await page.close();
  }
  {
    // Z3: 日本語の部品を入れればできる。ボタンを出し、押すと install を呼び、入ったら端末内で始まる
    const NAME = '音声の行き先（部品を入れる）';
    const w = await wherePage(NAME, 'downloadable');
    const page = w.page;
    const where0 = await txt(page, 'speechwhere');
    check('音声の行き先', '部品無し: 「日本語の部品を入れる」と承知の印の両方を出す', /日本語の部品を入れる/.test(where0) && await vis(page, 'speech-installrow') && await vis(page, 'speech-cloudrow'), where0);
    await page.click('#speech-install');
    await page.waitForFunction(function () { return /日本語の部品が入った/.test(document.getElementById('speechmsg').textContent); }, null, { timeout: 5000 });
    await page.waitForTimeout(100);
    const where1 = await txt(page, 'speechwhere');
    const inst = await page.evaluate(function () { return globalThis.__installs; });
    check('音声の行き先', '部品無し: 押すと install を 1 回呼び、入ったら「この PC の中で文字にする」に変わる', inst === 1 && /この PC の中で文字にする（音声は外へ出ない）/.test(where1) && !(await vis(page, 'speech-cloudrow')), inst + ' / ' + where1);
    await page.click('#start');
    await page.waitForFunction(function () { return !!globalThis.__sr && /聞いている/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 5000 });
    const loc = await page.evaluate(function () { return globalThis.__sr.processLocally; });
    check('音声の行き先', '部品無し: 入れた後は端末内で始まる', loc === true, loc);
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    check('音声の行き先', '部品無し: ページ内エラー無し', w.errs.length === 0, w.errs.join(' | '));
    await page.close();
  }

  {
    // Z2b: 端末内で「言語が使えない」と言われ、終わりの知らせが来ない（Chromium の実物の形。abort() でも来ない）。
    //      少し待って終わったものとし、止まった理由を出す。そのあと「聞き終える」は待たずに進み、「待っても来なかった」と言わない
    const NAME = '音声の行き先（終わりが来ない）';
    const w = await wherePage(NAME, 'available');
    const page = w.page;
    await page.click('#start');
    await page.waitForFunction(function () { return !!globalThis.__sr && /聞いている/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 5000 });
    await page.waitForTimeout(100);
    await page.evaluate(function () { const s = globalThis.__sr; s.dead = true; s.onerror({ error: 'language-not-supported' }); });
    const stalled = await waitOr(page, function () { return document.getElementById('st-listen').textContent === '止まっている'; }, null, 3000);
    const r = await page.evaluate(function () { return { n: globalThis.__srs.length, aborts: globalThis.__aborts, msg: document.getElementById('intakemsg').textContent, start: document.getElementById('start').disabled, end: document.getElementById('end').disabled }; });
    check('音声の行き先', '終わりが来ない: 言語が使えないと言われて終わりの知らせが来なくても、すぐに「止まっている」になり、理由と次の手を出す（止め直しを 1 回試み、始め直さない）',
      stalled && r.n === 1 && r.aborts === 1 && /提供元のサーバーへは切り替えない/.test(r.msg) && /打つ／貼る/.test(r.msg) && !r.start && !r.end, JSON.stringify(r));
    const t0 = Date.now();
    await page.click('#end');
    const ended = await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    const took = Date.now() - t0;
    const notice = await txt(page, 'intakenotice');
    const src = await readSrc(page, NAME);
    check('音声の行き先', '終わりが来ない: そのあと「聞き終える」は 3 秒待たずに進み、「待っても来なかった」と言わず、素材ログにも残さない',
      ended && took < 2500 && !/待っても来なかった/.test(notice) && !src.some(function (l) { return l.ev === 'asr_stop_timeout'; }) && !src.some(function (l) { return l.ev === 'asr_end'; }),
      took + ' ミリ秒 / ' + notice + ' / ' + JSON.stringify(src.map(function (l) { return l.ev || l.i; })));
    check('音声の行き先', '終わりが来ない: ページ内エラー無し', w.errs.length === 0, w.errs.join(' | '));
    await page.close();
  }
  {
    // Z5: 認識の通信が止められている（始めるとすぐ「通信が切れた」で終わる）。始め直しの待ちを延ばして 5 回で止め、素材ログの行は
    //     限られる。止まった後に入口を「打つ／貼る」にして「聞き始める」を押すと、同じ記録の続きを打って書ける
    const NAME = '音声の通信が止められている';
    const w = await wherePage(NAME, 'netfail');
    const page = w.page;
    await page.selectOption('#route', 'mock');
    await page.check('#speech-cloud');
    const t0 = Date.now();
    await page.click('#start');
    const stopped = await waitOr(page, function () { return /5 回続けて失敗した/.test(document.getElementById('intakemsg').textContent); }, null, 20000);
    const took = Date.now() - t0;
    await page.waitForTimeout(500);
    const r = await page.evaluate(function () { return { n: globalThis.__srs.length, msg: document.getElementById('intakemsg').textContent, listen: document.getElementById('st-listen').textContent, start: document.getElementById('start').disabled, intake: document.getElementById('intake').disabled }; });
    const src1 = await readSrc(page, NAME);
    const evs = {}; src1.forEach(function (l) { if (l.ev) evs[l.ev] = (evs[l.ev] || 0) + 1; });
    check('続けて失敗', '通信が止められている: 始め直しの待ちを延ばし（合わせて 7 秒ほど）、5 回で止める。素材ログの認識の行は 19 行で止まる',
      stopped && took >= 6500 && r.n === 5 && src1.length === 19 && evs.asr_start === 5 && evs.asr_error === 5 && evs.asr_end === 5 && evs.asr_restart === 4,
      took + ' ミリ秒 / ' + JSON.stringify({ n: r.n, rows: src1.length, evs: evs }));
    check('続けて失敗', '通信が止められている: 札が、続けて失敗したこと・最後の誤り（network）・入口を「打つ／貼る」にするか「聞き始める」をもう一度押すことを言い、「止まっている」と出す',
      /認識の通信が切れた（network）/.test(r.msg) && /「打つ／貼る」/.test(r.msg) && /「聞き始める」/.test(r.msg) && r.listen === '止まっている' && !r.start && !r.intake, JSON.stringify(r));
    await page.waitForTimeout(1500);
    const src2 = await readSrc(page, NAME);
    check('続けて失敗', '通信が止められている: 止めた後は始め直さず、素材ログも増えない', src2.length === src1.length && (await page.evaluate(function () { return globalThis.__srs.length; })) === 5, src2.length);
    // 入口を「打つ／貼る」にして聞き直す（同じ記録の続き）
    await page.selectOption('#intake', 'text');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('ta').disabled; }, null, { timeout: 5000 });
    const relisten = await page.evaluate(function () { return { listen: document.getElementById('st-listen').textContent, intake: document.getElementById('st-intake').textContent, setup: document.getElementById('setupmsg').textContent, name: document.getElementById('name').disabled }; });
    check('続けて失敗', '「打つ／貼る」にして「聞き始める」: 同じ記録のまま聞いている（名前の欄は変えられないまま）', relisten.listen === '聞いている' && /打つ／貼る/.test(relisten.intake) && /同じ記録の続き/.test(relisten.setup) && relisten.name, JSON.stringify(relisten));
    await page.click('#ta');
    await page.keyboard.type('日向: 音声が止まった後に打った行です。');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await page.click('#end');
    await page.waitForFunction(function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 20000 });
    const log = await readLogEnded(page, NAME);
    const src3 = await readSrc(page, NAME);
    const typed = src3.filter(function (l) { return l.i != null; });
    const steps = log.filter(function (e) { return e.e === 'step'; });
    check('続けて失敗', '「打つ／貼る」で打った行は同じ記録の素材ログに入り、窓に渡され、end まで書ける（記録の先頭は 1 つ、認識は増えない）',
      log.filter(function (e) { return e.e === 'open'; }).length === 1 && log[0].mode === 'live' && typed.length === 1 && typed[0].i === 1 && typed[0].who === '日向' &&
        steps.length >= 1 && steps[steps.length - 1].lines[1] === 1 && log[log.length - 1].e === 'end' && (await page.evaluate(function () { return globalThis.__srs.length; })) === 5,
      JSON.stringify({ log: log.map(function (e) { return e.e; }), typed: typed }));
    check('続けて失敗', 'ページ内エラー無し', w.errs.length === 0, w.errs.join(' | '));
    await page.close();
  }
  {
    // Z4: 「聞き始める」を押してから記録を開き終えるまで（ブラウザ内の保存を 1.5 秒遅らせる）。その間は入口・音声の行き先の欄と
    //     「聞き始める」を押せない。画面を通さずに入口を音声に書き換えても、承知の印が無ければ認識を作らず、記録にも何も書かない
    const NAME = '押してから開くまで';
    const DELAY = 1500;
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', function (e) { errs.push(String(e && e.message || e)); });
    await page.addInitScript(function (delay) {
      globalThis.__srs = [];
      function FakeSR() { this.lang = ''; }
      FakeSR.prototype.start = function () { const s = this; globalThis.__srs.push({ pl: s.processLocally, tick: document.getElementById('speech-cloud').checked }); setTimeout(function () { if (s.onstart) s.onstart(); }, 0); };
      FakeSR.prototype.stop = function () { const s = this; setTimeout(function () { if (s.onend) s.onend(); }, 0); };
      globalThis.SpeechRecognition = undefined;
      globalThis.webkitSpeechRecognition = FakeSR;
      // ブラウザ内の保存を開く知らせ（onsuccess）を遅らせる（__slowIdb が立っている間だけ）
      globalThis.__slowIdb = true;
      const realOpen = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function () {
        const req = realOpen.apply(this, arguments);
        if (!globalThis.__slowIdb) return req;
        const fake = { get result() { return req.result; }, get error() { return req.error; } };
        let ok = null, ng = null, up = null;
        Object.defineProperty(fake, 'onsuccess', { set: function (f) { ok = f; }, get: function () { return ok; } });
        Object.defineProperty(fake, 'onerror', { set: function (f) { ng = f; }, get: function () { return ng; } });
        Object.defineProperty(fake, 'onupgradeneeded', { set: function (f) { up = f; }, get: function () { return up; } });
        req.onupgradeneeded = function (ev) { if (up) up.call(fake, ev); };
        req.onsuccess = function (ev) { setTimeout(function () { if (ok) ok.call(fake, ev); }, delay); };
        req.onerror = function (ev) { if (ng) ng.call(fake, ev); };
        return fake;
      };
    }, DELAY);
    await page.goto('file://' + path.join(KIT, 'kiku.html'));
    await page.waitForTimeout(300);
    await page.fill('#name', NAME);
    await page.selectOption('#route', 'human');
    await page.fill('#win', '5');
    await page.selectOption('#intake', 'text');
    await page.click('#start');
    const during = await page.evaluate(function () { const d = function (id) { return document.getElementById(id).disabled; }; return { intake: d('intake'), cloud: d('speech-cloud'), install: d('speech-install'), start: d('start'), route: d('route'), name: d('name'), msg: document.getElementById('setupmsg').textContent }; });
    check('押してから開くまで', '記録を開いている間は、入口・音声の行き先の欄・「聞き始める」を押せない', during.intake && during.cloud && during.install && during.start && during.route && during.name && /記録を開いている/.test(during.msg), JSON.stringify(during));
    // 画面を通さずに入口を音声に書き換える（欄が押せない間にも変わった場合の守りを確かめる）
    await page.evaluate(function () { const s = document.getElementById('intake'); s.value = 'speech'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(DELAY + 1000);
    const after = await page.evaluate(function () { const d = function (id) { return document.getElementById(id).disabled; }; return { srs: globalThis.__srs, tick: document.getElementById('speech-cloud').checked, listen: document.getElementById('st-listen').textContent, msg: document.getElementById('setupmsg').textContent, start: d('start'), intake: d('intake'), cloud: d('speech-cloud') }; });
    await page.evaluate(function () { globalThis.__slowIdb = false; });
    const src0 = await readSrc(page, NAME);
    const log0 = await readLog(page, NAME);
    check('押してから開くまで', '開いている間に入口が音声に変わっても、承知の印が無ければ認識を作らず（音声を外へ送らず）、記録にも何も書かず、聞いていない状態に戻る',
      after.srs.length === 0 && !after.tick && after.listen !== '聞いている' && /承知する印が要る/.test(after.msg) && /記録には何も書いていない/.test(after.msg) && !after.start && !after.intake && !after.cloud && src0.length === 0 && log0.length === 0,
      JSON.stringify(after) + ' / 素材ログ ' + src0.length + ' / 判断ログ ' + log0.length);
    // 断った後は、印を付けて押し直せば始まる（印があるので提供元のサーバーへ送る。端末内の印は立てない）
    await page.check('#speech-cloud');
    await page.click('#start');
    await page.waitForFunction(function () { return /聞いている/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 5000 });
    const srs = await page.evaluate(function () { return globalThis.__srs; });
    check('押してから開くまで', '印を付けて押し直すと始まる。認識はどれも、端末内で文字にするか、印が付いているときだけ作っている',
      srs.length === 1 && srs.every(function (x) { return x.pl === true || x.tick === true; }), JSON.stringify(srs));
    await page.click('#end');
    await waitOr(page, function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, 15000);
    check('押してから開くまで', 'ページ内エラー無し', errs.length === 0, errs.join(' | '));
    await page.close();
  }

  // ---------- AA. API の設定の断り: 鍵が空・OpenAI 互換のモデルが空・Anthropic に住所 ----------
  {
    const f = await fresh(ctx, 'API の断り');
    const page = f.page;
    await page.evaluate(function () { try { localStorage.removeItem('kiku.key'); localStorage.removeItem('kiku.api'); sessionStorage.removeItem('kiku.key'); } catch (e) { /* 無視 */ } });
    // 要求を数える（送ったら試験が分かる。どこへも届かせない）
    await page.route(/^https?:/, function (route) { return route.abort(); });
    let sent = 0;
    page.on('request', function (r) { if (!/^file:/.test(r.url())) sent++; });
    await page.selectOption('#intake', 'text');
    const tryStart = async function () { await page.click('#start'); await page.waitForTimeout(300); return { msg: await txt(page, 'setupmsg'), listen: await txt(page, 'st-listen'), rows: (await readSrc(page, 'API の断り')).length }; };
    await page.selectOption('#route', 'anthropic');
    await page.fill('#api-key', '');
    let r = await tryStart();
    check('API の断り', '鍵が空なら聞き始めない（記録も作らない）', /API の鍵が空/.test(r.msg) && !/聞いている/.test(r.listen) && r.rows === 0, JSON.stringify(r));
    await page.fill('#api-key', 'x');
    await page.fill('#api-url', 'https://example.invalid/v1');
    r = await tryStart();
    check('API の断り', 'Anthropic で住所の欄に何かあれば聞き始めない（いつも api.anthropic.com に送るため）', /送り先の住所を変えられない/.test(r.msg) && !/聞いている/.test(r.listen) && r.rows === 0, JSON.stringify(r));
    await page.click('#api-test');
    await page.waitForTimeout(300);
    const t1 = await txt(page, 'api-msg');
    check('API の断り', 'Anthropic で住所があると「接続を試す」も送らずに断る', /送り先の住所を変えられない/.test(t1) && sent === 0, t1 + ' / 要求 ' + sent);
    await page.selectOption('#route', 'openai');
    const t2 = await txt(page, 'api-msg');
    check('API の断り', '分析役を変えると、前の分析役で「接続を試す」を押した結果の文を消す', t2 === '', JSON.stringify(t2));
    await page.fill('#api-model', '');
    r = await tryStart();
    check('API の断り', 'OpenAI 互換でモデルが空なら聞き始めない', /モデル名が要る/.test(r.msg) && !/聞いている/.test(r.listen) && r.rows === 0, JSON.stringify(r));
    const notice = await page.evaluate(function () { return { api: document.getElementById('apibox').innerText, open: document.getElementById('apibox').open }; });
    check('API の断り', 'API の設定の欄が開き、窓ごとに何を送るかを書いてある', notice.open && /窓が閉じるたびに/.test(notice.api) && /API の提供元へ送る/.test(notice.api), notice.api.slice(0, 200));
    check('API の断り', 'どの断りでも外へ要求を出していない', sent === 0, sent);
    await page.fill('#api-key', ''); await page.fill('#api-url', ''); await page.fill('#api-model', '');
    await page.dispatchEvent('#api-key', 'change');
    check('API の断り', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }
  {
    // 手動の輪の欄は、プロンプトに会議の言葉が入っていることを言う
    const f = await fresh(ctx, '手動の輪の注意');
    const page = f.page;
    await page.selectOption('#route', 'manual');
    const t = await txt(page, 'an-manual');
    // 文の言い回しは変わりうるので、言っている中身（その窓の発言・話者名・貼った先の提供元に渡る）で見る
    check('API の断り', '手動の輪: プロンプトに発言と話者名が入り、貼った先に渡ることを画面が言う', /その窓の発言/.test(t) && /話者名/.test(t) && /貼った先のチャットの提供元に渡る/.test(t), t.slice(0, 200));
    await page.close();
  }

  {
    // 「記録を消す」: 読み込み直した後に、消したことを 1 行で言う（もう一度読み込んだら言わない）
    const NAME = '消す試験';
    const f = await fresh(ctx, NAME);
    const page = f.page;
    await page.selectOption('#route', 'mock');
    await page.selectOption('#intake', 'text');
    await page.fill('#win', '5');
    await page.click('#start');
    await page.waitForFunction(function () { return !document.getElementById('ta').disabled; }, null, { timeout: 10000 });
    await page.click('#end');
    await page.waitForFunction(function () { return /聞き終えた/.test(document.getElementById('st-listen').textContent); }, null, { timeout: 15000 });
    const before = (await readLog(page, NAME)).length;
    page.once('dialog', function (d) { d.accept(); });
    await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('#clear')]);
    await page.waitForTimeout(500);
    const m1 = await txt(page, 'recmsg');
    const after = (await readLog(page, NAME)).length;
    check('記録を消す', '消した後に読み込み直すと、「「消す試験」の記録を消した」と 1 行で言う（記録は消えている）', before > 0 && after === 0 && /「消す試験」の記録を消した。/.test(m1), before + ' → ' + after + ' / ' + m1);
    await page.reload();
    await page.waitForTimeout(500);
    const m2 = await txt(page, 'recmsg');
    check('記録を消す', 'もう一度読み込んだら、消したことはもう言わない', !/消した/.test(m2), m2);
    check('記録を消す', 'ページ内エラー無し', f.errs.length === 0, f.errs.join(' | '));
    await page.close();
  }

  await browser.close();
  const ng = results.filter(function (r) { return !r.ok; });
  fs.writeFileSync(path.join(OUT, 'e2e_routes_result.json'), JSON.stringify({ results: results, ng: ng.length, total: results.length }, null, 1));
  console.log(JSON.stringify({ total: results.length, ng: ng.length }));
  process.exit(ng.length ? 1 : 0);
})().catch(function (e) { console.error('試験そのものが落ちた: ' + (e && e.stack || e)); process.exit(2); });
