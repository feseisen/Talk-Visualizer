#!/usr/bin/env node
/*
 * run_node.js — verify.js と fold.js の試験を node で走らせる（ブラウザの tests.html と同じ試験）
 *
 *   node tests/run_node.js            すべて走らせ、結果を表に出す。1 件でも落ちれば終了コード 1
 *   node tests/run_node.js --verbose  通った件の中身も出す
 *   node tests/run_node.js --fresh    生成物 _data.js を使わず、元のファイル（規則表・cases・fixtures）から読む
 *
 * 試験データは tests/_data.js（tools/make_test_data.py が作る）。無いか、元のファイルより古ければ、元から直接読む
 * （古い生成物で試験しても今の規則表・cases を見たことにならない。ブラウザ用には作り直しが要るので、その旨を出す）
 *
 * ここだけで走らせる試験（ブラウザの tests.html には無い）:
 *   素材の読み  src/intake.js の素材ファイルの読み手が、tests/fixtures/materials.json に並べた共通の試験素材
 *               （alone・tsv・inline・vtt・mixed・mixed_alone・tail・none・vtt_bare・srt・blank・tsv_who）を、それぞれの
 *               *.expect.json と一字違わず同じ書き方・発話の列・読めない行・時刻が飛んでいる行・時刻で始まる本文の行・
 *               黙って飛ばした行・知らせを付ける発話・発話の無い素材の断りの文に読むか（rt.py も、その試験で同じ素材と期待値を通す）。先頭の BOM・CR LF の改行・最後の改行の無い写しでも
 *               同じか。先を読まないか。ファイルの入口と刻み（cut.js）で流したときの窓と、その窓で出す知らせの文が期待値と同じか。
 *               知らせの文の型（notice_text）。書き方ごとの小さな境目・WebVTT の端の形・時刻の書き方。打つ入口の時刻を単調にするか
 *   話者の切り出し  打つ入口の splitWho が format/FORMAT.md「話者の切り出し」のとおりか（時刻・比・URL で始まる行を
 *               話者にしない）。打った 1 行の読み方（readTypedLine）が tests/fixtures/typed_lines.json と同じか。
 *               打つ入口が素材ログに渡す {who, text}。時刻の列の知らせは emit.notice に渡し、札を書き換えないか
 *   音声認識の入口  中断と再開を素早く繰り返しても、認識を 1 つしか動かさないか。聞き終えるときに、いま動いている認識の
 *               終わりを待ち（上限 3 秒）、止めた後に届いた確定の結果も渡すか。何も聞き取れないまま失敗する認識が続くと、
 *               始め直しの待ちを 0.3・1・2・4 秒と延ばし、5 回で止めるか（聞き取れたら数え直す。黙っている間の「声が聞こえない」は
 *               数えない）。再開しない誤りのあと終わりの知らせが来なくても、500 ミリ秒で終わったものとし、聞き終えるときに
 *               3 秒待たないか（作り物の認識と作り物の時計で確かめる）
 *   違反文      P30 の長い素材の名前を、終わりを残して短くするか
 */
'use strict';
const fs = require('fs');
const path = require('path');

const KIT = path.resolve(__dirname, '..');
const verifyApi = require(path.join(KIT, 'src', 'verify.js'));
const fold = require(path.join(KIT, 'src', 'fold.js'));
const tests = require(path.join(__dirname, '_runner.js'));
const intake = require(path.join(KIT, 'src', 'intake.js'));
const CUT = require(path.join(KIT, 'src', 'cut.js'));

// _data.js の元になるファイル。どれか1つでも _data.js より新しければ生成物は古い
function sourceFiles() {
  const casesDir = path.join(__dirname, 'cases');
  const fixDir = path.join(__dirname, 'fixtures');
  return [path.join(KIT, 'format', 'rules.json')]
    .concat(fs.readdirSync(casesDir).filter(function (f) { return f.endsWith('.json'); }).map(function (f) { return path.join(casesDir, f); }))
    .concat(fs.readdirSync(fixDir).map(function (f) { return path.join(fixDir, f); }));
}

function loadData() {
  const p = path.join(__dirname, '_data.js');
  if (fs.existsSync(p) && process.argv.indexOf('--fresh') < 0) {
    const built = fs.statSync(p).mtimeMs;
    const newer = sourceFiles().filter(function (f) { return fs.statSync(f).mtimeMs > built; });
    if (!newer.length) return require(p);
    console.log('_data.js より新しい元のファイルがある（' + newer.map(function (f) { return path.relative(KIT, f); }).join(', ') + '）ので、元から直接読む。ブラウザ用には python3 tools/make_test_data.py で作り直すこと');
  }
  // 生成物が無い・古い・--fresh なら元から読む（make_test_data.py と同じ読み方）
  const readJsonl = function (f) { return fs.readFileSync(f, 'utf8').split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); }); };
  const casesDir = path.join(__dirname, 'cases');
  const cases = fs.readdirSync(casesDir).filter(function (f) { return f.endsWith('.json'); }).sort().map(function (f) {
    const c = JSON.parse(fs.readFileSync(path.join(casesDir, f), 'utf8')); c._file = f; return c;
  });
  const src = fs.readFileSync(path.join(__dirname, 'fixtures', 'meeting10.txt'), 'utf8').split('\n').filter(function (l) { return l.trim(); }).map(function (l, i) {
    const p3 = l.split('\t'); const ts = p3[0].split(':').map(Number);
    return { i: i + 1, t: ts.length === 3 ? ts[0] * 3600 + ts[1] * 60 + ts[2] : ts[0] * 60 + ts[1], who: p3[1], text: p3[2] };
  });
  return {
    rules: JSON.parse(fs.readFileSync(path.join(KIT, 'format', 'rules.json'), 'utf8')),
    cases: cases,
    fixture: readJsonl(path.join(__dirname, 'fixtures', 'meeting10.jsonl')),
    src: src,
    status: JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'meeting10.status.json'), 'utf8'))
  };
}

// ---- 素材の読み（format/FORMAT.md「素材ファイルの形」） ----
// 素材を読み切った結果: 書き方・発話の列・知らせ（種類ごと）・黙って読み飛ばした行・知らせを付ける発話
function readMaterial(text) {
  const r = intake.makeMaterialReader(text);
  const got = [], attach = [], starts = [];
  let u;
  while ((u = r.next())) {
    got.push(u);
    // 返した時点の、発話の時刻のある行と、それまでに持っていた知らせのいちばん後ろの行
    starts.push([r.startLine(), r.notices().reduce(function (m, x) { return Math.max(m, x.line); }, 0)]);
    r.notes().forEach(function (x) { attach.push({ kind: x.kind, line: x.line, i: u.i }); });
  }
  // 発話 k を返した時点で持っていた知らせは、どれも発話 k + 1 の時刻のある行より前（先を読まない）
  let ahead = [];
  for (let k = 0; k + 1 < starts.length; k++) if (starts[k][1] >= starts[k + 1][0]) { ahead = [k + 1, starts[k][1]]; break; }
  const last = got.length ? got[got.length - 1].i : null;
  r.tail().forEach(function (x) { attach.push({ kind: x.kind, line: x.line, i: last }); });
  const ns = r.notices();
  return {
    format: r.format(), utterances: got, skipped_lines: r.skipped(), attach: attach, ahead: ahead, refuse: r.refusal(),
    unreadable: ns.filter(function (x) { return x.kind === 'unreadable'; }).map(function (x) { return { line: x.line, raw: x.raw }; }),
    bad_bytes: ns.filter(function (x) { return x.kind === 'badbyte'; }).map(function (x) { return { line: x.line, raw: x.raw }; }),
    jumps: ns.filter(function (x) { return x.kind === 'jump'; }).map(function (x) { return { line: x.line, t: x.t, prev: x.prev }; }),
    time_head: ns.filter(function (x) { return x.kind === 'timehead'; }).map(function (x) { return { line: x.line }; })
  };
}
const MATERIAL_KEYS = ['format', 'utterances', 'unreadable', 'bad_bytes', 'jumps', 'time_head', 'skipped_lines', 'attach', 'refuse'];
function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }   // 鍵の順まで同じ
function diffKeys(a, want) { return MATERIAL_KEYS.filter(function (k) { return !sameJson(a[k], want[k]); }); }

// ファイルの入口（intake.js）と刻み（cut.js の fixed。app.js のファイルの入口と同じつなぎ方）で素材を流したときの
// 窓と、その窓で出した知らせの文（emit.notice が最後に渡した並び）。「次の窓を流す」を読み切るまで押し、残りは素材の終わりで閉じる
function materialWindows(text, win) {
  const wins = [];
  let lastNotice = null, eof = false, n = 0;
  const statusAfterLoad = [];
  const cutter = CUT.makeCutter({ window: win, factor: 3, maxLines: 40, fixed: true, onWindow: function (w) {
    wins.push({ t: w.t.slice(), lines: w.lines.slice(), notices: lastNotice || [] });
    lastNotice = null;
  } });
  let loaded = false;
  const emit = {
    line: function (l) { n++; cutter.push({ i: n, t: l.t, who: l.who, text: l.text }); },
    event: function () {}, interim: function () {},
    status: function (x) { if (loaded) statusAfterLoad.push(x); },
    notice: function (lines) { lastNotice = lines; }
  };
  const fi = intake.makeFileIntake(emit, { windowEnd: cutter.windowEnd, setLastT1: cutter.setLastT1, pendingCount: cutter.pendingCount });
  fi.on('clock', function (t) { if (cutter.tick(t)) cutter.ready(t); });
  fi.on('eof', function () { eof = true; });
  fi.load(text); fi.start(); loaded = true;
  for (let k = 0; k < 500 && !eof; k++) fi.playWindow();
  for (let k = 0; k < 50 && cutter.pendingCount(); k++) { if (!cutter.close(fi.clock(), { eof: true })) break; cutter.ready(fi.clock()); }
  return { windows: wins, status: statusAfterLoad, fi: fi };
}
// 同じ流し方で、入口が emit.notes（発話ごとの知らせ）を渡す形。app.js と同じく、知らせを発話の番号ごとに預かり、
// 窓を出したときにその窓の発話に付いた知らせから文を組む（40 件の上限で切れる窓でも、窓に入った発話の知らせだけ）
function materialWindowsByNotes(text, win) {
  const wins = [], byI = {}, calls = { notice: 0, status: 0 };
  let eof = false, n = 0, loaded = false;
  const cutter = CUT.makeCutter({ window: win, factor: 3, maxLines: 40, fixed: true, onWindow: function (w) {
    const notes = [];
    for (let i = w.lines[0]; i <= w.lines[1]; i++) if (byI[i]) Array.prototype.push.apply(notes, byI[i]);
    w.notesAt = notes;
    wins.push(w);
  } });
  const emit = {
    line: function (l) { n++; cutter.push({ i: n, t: l.t, who: l.who, text: l.text }); },
    event: function () {}, interim: function () {},
    status: function () { if (loaded) calls.status++; },
    notice: function () { calls.notice++; },
    notes: function (list) { const i = n > 0 ? n : 0; byI[i] = (byI[i] || []).concat(list); }
  };
  const fi = intake.makeFileIntake(emit, { windowEnd: cutter.windowEnd, setLastT1: cutter.setLastT1, pendingCount: cutter.pendingCount });
  fi.on('clock', function (t) { if (cutter.tick(t)) cutter.ready(t); });
  fi.on('eof', function () { eof = true; });
  fi.load(text); fi.start(); loaded = true;
  for (let k = 0; k < 500 && !eof; k++) fi.playWindow();
  for (let k = 0; k < 50 && cutter.pendingCount(); k++) { if (!cutter.close(fi.clock(), { eof: true })) break; cutter.ready(fi.clock()); }
  // 最後の発話より後ろの知らせは、読み切ったときに最後の発話の分として届く（窓を出したあとに届くこともあるので、ここで組み直す）
  const windows = wins.map(function (w) {
    const notes = [];
    for (let i = w.lines[0]; i <= w.lines[1]; i++) if (byI[i]) Array.prototype.push.apply(notes, byI[i]);
    return { t: w.t.slice(), lines: w.lines.slice(), notices: intake.noticeSentences(notes), early: intake.noticeSentences(w.notesAt) };
  });
  return { windows: windows, calls: calls, none: byI[0] || [] };
}

function runMaterial() {
  const out = [];
  const G = '素材の読み';
  const same = sameJson;
  const FX = path.join(__dirname, 'fixtures');
  const index = JSON.parse(fs.readFileSync(path.join(FX, 'materials.json'), 'utf8'));
  // 共通の試験素材と期待値（rt.py の試験も同じ表を通す）
  index.materials.forEach(function (m) {
    const text = fs.readFileSync(path.join(FX, m.file), 'utf8');
    const want = JSON.parse(fs.readFileSync(path.join(FX, m.expect), 'utf8'));
    const a = readMaterial(text);
    const bad = diffKeys(a, want);
    out.push({ group: G, name: m.name + '（' + m.file + '）: 書き方 ' + want.format + '・' + want.utterances.length + ' 発話・読めない行・時刻の飛び・時刻で始まる本文の行・黙って飛ばした行・知らせを付ける発話・断りの文が期待値と一字違わず同じ',
      ok: bad.length === 0, detail: bad.map(function (k) { return k + ' の結果 ' + JSON.stringify(a[k]); }).join(' / ') });
    out.push({ group: G, name: m.name + ': 先を読まない（発話を返した時点で持っている知らせは、どれも次の発話の時刻のある行より前）',
      ok: a.ahead.length === 0, detail: a.ahead.length ? '発話 ' + a.ahead[0] + ' を返した時点で ' + a.ahead[1] + ' 行目の知らせを持っていた' : '' });
    const b = readMaterial('﻿' + text.replace(/\n/g, '\r\n'));
    const bb = diffKeys(b, want);
    out.push({ group: G, name: m.name + ': 先頭の BOM と CR LF の改行でも同じ結果', ok: bb.length === 0, detail: bb.join(',') });
    const c = readMaterial(text.replace(/\n$/, ''));
    const cb = diffKeys(c, want);
    out.push({ group: G, name: m.name + ': 最後の行に改行が無くても同じ結果', ok: cb.length === 0, detail: cb.join(',') });
    // 発話の無い素材の断り（K21）: ページのファイルの入口は記録を作る前に materialRefusal で見る。発話のある素材では null
    const mr = intake.materialRefusal(text);
    out.push({ group: G, name: m.name + ': materialRefusal（記録を作る前の見分け）が期待値の refuse と同じ（' + (want.refuse ? '断る' : 'null') + '）',
      ok: same(mr, want.refuse), detail: JSON.stringify(mr) });
    const w = materialWindows(text, want.window);
    out.push({ group: G, name: m.name + ': ファイルの入口で窓幅 ' + want.window + ' 秒に流すと、窓（' + want.windows.length + ' 個）とその窓で出す知らせの文が期待値と同じ（知らせは付けた発話を渡す窓で、種類ごとに 1 文）',
      ok: same(w.windows, want.windows), detail: same(w.windows, want.windows) ? '' : '結果 ' + JSON.stringify(w.windows) });
    out.push({ group: G, name: m.name + ': emit.notice があれば、流しているあいだ知らせで入口の札（emit.status）を変えない',
      ok: w.status.length === 0, detail: JSON.stringify(w.status) });
    const wn = materialWindowsByNotes(text, want.window);
    const wnv = wn.windows.map(function (x) { return { t: x.t, lines: x.lines, notices: x.notices }; });
    out.push({ group: G, name: m.name + ': 入口が発話ごとの知らせ（emit.notes。ページはこちら）を渡す形でも、窓とその窓の発話に付いた知らせの文が期待値と同じ（emit.notice・emit.status は呼ばない）',
      ok: same(wnv, want.windows) && wn.calls.notice === 0 && wn.calls.status === 0,
      detail: same(wnv, want.windows) ? JSON.stringify(wn.calls) : '結果 ' + JSON.stringify(wnv) });
  });
  // 40 件の上限で切れる窓。同じ時刻の発話が 40 を超えると、窓は 40 件で切れて残りは次の窓に回る。後ろの窓に回った発話に
  // 付いた知らせ（46 行目の読めない行は、次の発話 47 行目＝発話 46 に付く）を、前の窓では出さない（rt.py の next と同じ）
  const m40 = ['0:05\t甲\t発話1'];
  for (let k = 2; k <= 45; k++) m40.push('0:10\t甲\t発話' + k);
  m40.push('0:3\t乙\t壊れた', '0:20\t乙\t後ろ');
  const w40 = materialWindowsByNotes(m40.join('\n') + '\n', 30);
  const s46 = intake.NOTICE_TEXT.unreadable.replace('{lines}', '46 行目');
  const g40 = w40.windows.map(function (x) { return [x.t, x.lines, x.early]; });
  out.push({ group: G, name: '40 件の上限で切れる窓: 窓を出した時点で、その窓の発話に付いた知らせだけを出す（後ろの窓に回った発話の知らせを前の窓で出さない）',
    ok: same(g40, [[[0, 10], [1, 1], []], [[10, 10], [2, 41], []], [[10, 40], [42, 46], [s46]]]), detail: JSON.stringify(g40) });
  // 知らせの文（rt.py と同じ文。種類ごとに 1 文、行番号は 5 つまで）
  const nt = index.notice_text;
  out.push({ group: G, name: '知らせの文の型が共通の期待値（materials.json の notice_text）と同じ（読めないバイトを含む行の badbyte も）',
    ok: intake.NOTICE_TEXT.unreadable === nt.unreadable && intake.NOTICE_TEXT.badbyte === nt.badbyte && intake.NOTICE_TEXT.jump === nt.jump && intake.NOTICE_TEXT.timehead === nt.timehead &&
      Object.keys(intake.NOTICE_TEXT).join() === 'unreadable,badbyte,jump,timehead', detail: JSON.stringify(intake.NOTICE_TEXT) });
  out.push({ group: G, name: 'WEBVTT の行の無いまま字幕と決めた素材を断るときに添える文（K31）が共通の期待値（materials.json の vtt_decided_text）と同じ',
    ok: intake.VTT_DECIDED_TEXT === index.vtt_decided_text, detail: intake.VTT_DECIDED_TEXT });
  const badRows = nt.rows.filter(function (r) { return !same(intake.noticeSentences(r.notices), r.text); });
  out.push({ group: G, name: '1 つの窓の知らせを文にする（種類の順・行の順・重なりを除く・6 つ目からは数だけ。' + nt.rows.length + ' 通り）', ok: badRows.length === 0,
    detail: badRows.map(function (r) { return JSON.stringify(intake.noticeSentences(r.notices)); }).join(' / ') });
  const ky = intake.noticeSentences({ unreadable: [9, 2], jump: [], timehead: [4] });
  out.push({ group: G, name: '知らせを種類ごとの行番号の表 {unreadable, jump, timehead} で渡しても同じ文', ok: same(ky, [nt.unreadable.replace('{lines}', '2・9 行目'), nt.timehead.replace('{lines}', '4 行目')]), detail: JSON.stringify(ky) });

  // 時刻の書き方の境目（全角の数字とコロンは半角に直して読む）
  const ts = [['0:05', 5], ['0:5', null], ['１:００', 60], ['１：２０', 80], ['1：40', 100], ['０:０５', 5], ['1:60', null], ['1:02:03', 3723], ['1:60:00', null], ['1:00:60', null],
    ['75:30', 4530], ['123456:00', 7407360], ['1234567:00', null], ['0:05.25', 5.25], ['0:05.', null], ['0:05．25', null], [' 0:05 ', 5], ['　0:05', 5], ['-0:05', null], ['0:05:', null]];
  const bad = ts.filter(function (p) { return intake.parseTs(p[0]) !== p[1]; });
  out.push({ group: G, name: '時刻の書き方（秒は 2 桁で 00〜59、全角の数字とコロンは半角に直す、先頭の数は 6 桁まで、小数部は任意）', ok: bad.length === 0,
    detail: bad.length ? bad.map(function (p) { return JSON.stringify(p[0]) + '→' + intake.parseTs(p[0]) + '（期待 ' + p[1] + '）'; }).join(' ') : ts.length + ' 通り' });
  const pick = function (x) { return x.utterances.map(function (u) { return [u.t, u.who, u.text]; }); };
  const lns = function (a) { return a.map(function (x) { return x.line; }); };
  // 書き方ごとの小さな形（共通の期待値の素材より細かい境目）
  const k1 = readMaterial('0:10\t甲\t一\n0:3\n続きの本文\n0:20\t乙\t二\n');
  out.push({ group: G, name: 'tsv: 「0:3」だけの行とその下の本文は読めない行で、前の発話に混ぜない', ok: same(pick(k1), [[10, '甲', '一'], [20, '乙', '二']]) && same(lns(k1.unreadable), [2, 3]), detail: JSON.stringify(k1) });
  const k2 = readMaterial('見出し\n0:05\n一\n3:2 の割合で\n0:06\n二\n');
  out.push({ group: G, name: 'alone: 時刻らしい頭の本文の行（「3:2 の割合で」）は前の発話の本文の続きにして、その発話に知らせを付ける',
    ok: k2.format === 'alone' && same(pick(k2), [[5, null, '一 3:2 の割合で'], [6, null, '二']]) && k2.unreadable.length === 0 && same(k2.attach, [{ kind: 'timehead', line: 4, i: 1 }]) && same(k2.skipped_lines, [1]), detail: JSON.stringify(k2) });
  const k2t = readMaterial('0:05\t甲\t一\n3:2 の割合で\n0:06\t甲\t二\n');
  out.push({ group: G, name: 'tsv: 時刻として読めない頭に空白と本文が続く行（「3:2 の割合で」）は読めない行で、後ろの発話に知らせを付ける',
    ok: k2t.format === 'tsv' && same(pick(k2t), [[5, '甲', '一'], [6, '甲', '二']]) && same(k2t.attach, [{ kind: 'unreadable', line: 2, i: 2 }]), detail: JSON.stringify(k2t) });
  const k2b = readMaterial('0:00\n予定です。\n9:00 から始めて、\n12:00 に昼休みを取ります。\n午後は 13:00 から再開です。\n0:40\n質問はありますか。\n');
  out.push({ group: G, name: 'alone: 本文の行が時刻で始まっても、発話も続く行も落とさない（本文の続きにして知らせる）',
    ok: same(pick(k2b), [[0, null, '予定です。 9:00 から始めて、 12:00 に昼休みを取ります。 午後は 13:00 から再開です。'], [40, null, '質問はありますか。']]) && k2b.unreadable.length === 0 && same(lns(k2b.time_head), [3, 4]), detail: JSON.stringify(k2b) });
  const k2bt = readMaterial('0:00\t司会\t予定です。\n9:00 から始めて、\n12:00 に昼休みを取ります。\n午後は 13:00 から再開です。\n0:40\t司会\t質問はありますか。\n');
  out.push({ group: G, name: 'tsv: 時刻＋空白＋本文の行は、その時刻の新しい発話（本文は時刻の後ろ。どの行の字も落とさない。後ろの 0:40 は戻った時刻）',
    ok: same(pick(k2bt), [[0, '司会', '予定です。'], [540, null, 'から始めて、'], [720, null, 'に昼休みを取ります。 午後は 13:00 から再開です。'], [720, '司会', '質問はありますか。']]) && same(k2bt.jumps, [{ line: 5, t: 40, prev: 720 }]) && k2bt.time_head.length === 0,
    detail: JSON.stringify(k2bt) });
  const k2c = readMaterial('0:00\t甲\t始めます\n0:45 乙 反対です\n0:50\t甲\t続けます\n');
  out.push({ group: G, name: 'tsv: 「0:45 乙 反対です」は 0:45 の新しい発話（話者は話者の切り出しで切るので、「乙 」は本文に残る）',
    ok: same(pick(k2c), [[0, '甲', '始めます'], [45, null, '乙 反対です'], [50, '甲', '続けます']]) && k2c.unreadable.length === 0 && k2c.time_head.length === 0, detail: JSON.stringify(k2c) });
  const k2ca = readMaterial('0:00\n始めます\n0:45 乙 反対です\n0:50\n続けます\n');
  out.push({ group: G, name: 'alone: 同じ行は前の発話の本文の続き（時刻で始まる本文の行として知らせる）',
    ok: same(pick(k2ca), [[0, null, '始めます 0:45 乙 反対です'], [50, null, '続けます']]) && same(lns(k2ca.time_head), [3]), detail: JSON.stringify(k2ca) });
  const k2d = readMaterial('0:00\t甲\t一\n0:5\n1:2:3:4\n0:10\t甲\t二\n12:345\n9:00 から始める\n0:20\t甲\t三\n');
  out.push({ group: G, name: 'tsv: 行の全体が時刻らしいのに読めない行（0:5・1:2:3:4・12:345）は読めない行。読めない行の後でも、時刻のある行（「9:00 から始める」）は新しい発話',
    ok: same(pick(k2d), [[0, '甲', '一'], [10, '甲', '二'], [540, null, 'から始める'], [540, '甲', '三']]) && same(lns(k2d.unreadable), [2, 3, 5]) && same(lns(k2d.jumps), [7]), detail: JSON.stringify(k2d) });
  const k2e = readMaterial('見出し\n1:2 の比で分けた資料\n0:05\t甲\t一\n');
  out.push({ group: G, name: '書き方が決まる前に、時刻として読めない頭に本文が続く行は読めない行（見出しとして黙って飛ばさない）',
    ok: k2e.format === 'tsv' && same(lns(k2e.unreadable), [2]) && same(k2e.skipped_lines, [1]) && same(k2e.attach, [{ kind: 'unreadable', line: 2, i: 1 }]), detail: JSON.stringify(k2e) });
  const k2f = readMaterial('議事メモ\n0:05 司会: 始めます\n0:5 読めない\n続き\n0:20 乙: 二\n');
  out.push({ group: G, name: 'inline: 最初の時刻のある行が「時刻＋空白＋本文」なら inline。話者は話者の切り出し。読めない行の続きも読めない行',
    ok: k2f.format === 'inline' && same(pick(k2f), [[5, '司会', '始めます'], [20, '乙', '二']]) && same(lns(k2f.unreadable), [3, 4]) && same(k2f.skipped_lines, [1]), detail: JSON.stringify(k2f) });
  const k3 = readMaterial('0:05\t甲\t一\n本文の続き\n2026年の話\n0:06\t甲\t二\n');
  out.push({ group: G, name: '時刻らしくない頭の行（「2026年の話」）は、今までどおり本文の続き', ok: same(pick(k3), [[5, '甲', '一 本文の続き 2026年の話'], [6, '甲', '二']]) && k3.unreadable.length === 0, detail: JSON.stringify(k3.utterances) });
  const k4 = readMaterial('0:00\t甲\t一\n0:10\t甲\t二\n10:11\t甲\t三\n10:12\t甲\t四\n');
  out.push({ group: G, name: '600 秒ちょうどの進みは飛びではなく、それを超えたら飛び', ok: same(k4.jumps, [{ line: 3, t: 611, prev: 10 }]), detail: JSON.stringify(k4.jumps) });
  const typo = readMaterial('0:10\t甲\t一\n50:00\t甲\t二\n0:30\t甲\t三\n0:40\t甲\t四\n');
  out.push({ group: G, name: '時刻の打ち間違い（50:00）のあとは 50:00 に揃い、飛びとして 2・3 行目を知らせる', ok: same(typo.utterances.map(function (u) { return u.t; }), [10, 3000, 3000, 3000]) && same(lns(typo.jumps), [2, 3]), detail: JSON.stringify(typo.utterances.map(function (u) { return u.t; })) + ' ' + JSON.stringify(typo.jumps) });
  // WebVTT の端の形
  const v1 = readMaterial('﻿WEBVTT - 題\n\nNOTE\n注の --> は時刻の行\n00:01.000 --> 00:02.000\n<v 甲>一</v>\n');
  out.push({ group: G, name: 'vtt: --> を含む行は NOTE の塊の中でも字幕の時刻の行（NOTE の塊はそこで終わる）',
    ok: v1.format === 'vtt' && same(pick(v1), [[1, '甲', '一']]) && same(v1.skipped_lines, [1, 3]) && same(lns(v1.unreadable), [4]), detail: JSON.stringify(v1) });
  const v2 = readMaterial('WEBVTT\n\n1\n00:00:05.999 --> 00:00:07.000 align:start\n<v.loud 司会 太郎>&lt;開始&gt; します</v>\n<c.y>二行目</c>\n\n00:60.000 --> 01:00.000\n読めない\n\n01:02.500-->01:03.000\n\n');
  out.push({ group: G, name: 'vtt: ミリ秒は切り捨て、設定は無視、<v.クラス 名前> の名前が話者、札を除いて &lt; &gt; を戻す。秒が 60 の時刻の行は読めない行。本文の無い字幕は発話にしない',
    ok: same(pick(v2), [[5, '司会 太郎', '<開始> します 二行目']]) && same(lns(v2.unreadable), [8, 9]) && same(v2.skipped_lines, [1, 3]), detail: JSON.stringify(v2) });
  const v3 = readMaterial('WEBVTT\n\n00:01.000 --> 00:02.000\n一\n00:03.000 --> 00:04.000\n二\n\n迷い込んだ行\n');
  out.push({ group: G, name: 'vtt: 空行の無い時刻の行でも前の字幕を閉じる。時刻の行の無い塊（最後の発話より後ろ）は読めない行で、最後の発話に付ける',
    ok: same(pick(v3), [[1, null, '一'], [3, null, '二']]) && same(v3.attach, [{ kind: 'unreadable', line: 8, i: 2 }]), detail: JSON.stringify(v3) });
  const v4 = readMaterial('WEBVTT\n\n０１:００.０００ --> 01:01.000\n全角の数字\n\n1:00.000 --> 1:01.000\n1 桁の分\n\n01:00.00 --> 01:01.000\n2 桁のミリ秒\n');
  out.push({ group: G, name: 'vtt: 時刻の字は直さない（全角の数字は読めない）。分と秒はちょうど 2 桁、ミリ秒はちょうど 3 桁。読めない時刻の行から空行までは読めない行',
    ok: v4.utterances.length === 0 && same(lns(v4.unreadable), [3, 4, 6, 7, 9, 10]), detail: JSON.stringify(v4) });
  // WEBVTT の行の無い字幕（K21）: 書き方が決まる前に字幕の時刻の行の形が来たら、その行から vtt。決まった後は変えない
  const vb1 = readMaterial('0:5 x\n00:01.000 --> 00:02.000\n<v 甲>一\n');
  out.push({ group: G, name: 'vtt: 先頭に WEBVTT が無くても、書き方が決まる前の字幕の時刻の行の形の行から vtt（その前の読めない行は読めない行のまま、後ろの発話に付ける）',
    ok: vb1.format === 'vtt' && same(pick(vb1), [[1, '甲', '一']]) && same(vb1.attach, [{ kind: 'unreadable', line: 1, i: 1 }]) && vb1.refuse === null, detail: JSON.stringify(vb1) });
  const vb2 = readMaterial('0:00\t甲\t一\n00:01.000 --> 00:02.000\n二\n');
  out.push({ group: G, name: 'tsv に決まった後の字幕の時刻の形の行は vtt にしない（書き方は途中で変わらない。頭の時刻の新しい発話になる）',
    ok: vb2.format === 'tsv' && same(pick(vb2), [[0, '甲', '一'], [1, null, '--> 00:02.000 二']]), detail: JSON.stringify(vb2) });
  const vb3 = readMaterial('議事 --> 要点\n0:05\t甲\t一\n');
  out.push({ group: G, name: '--> を含んでも字幕の時刻の行の形でない見出しは、見出しとして飛ばす（tsv）',
    ok: vb3.format === 'tsv' && same(pick(vb3), [[5, '甲', '一']]) && same(vb3.skipped_lines, [1]), detail: JSON.stringify(vb3) });
  const vb4 = readMaterial('00:00:01,000 --> 00:00:02,000\n一\n');
  out.push({ group: G, name: 'SRT の時刻の行（ミリ秒の区切りが「,」）は字幕の時刻の行の形ではない。書き方が決まる前の、時刻に字が続く頭の行（K30 の a）なので読めない行で、続く行も読めない行。発話が無いので断りの文を出す',
    ok: vb4.format === null && vb4.utterances.length === 0 && same(vb4.refuse, [intake.NO_TIMED_TEXT.replace('{n}', '0'), nt.unreadable.replace('{lines}', '1・2 行目')]), detail: JSON.stringify(vb4.refuse) });
  const vb5 = readMaterial('');
  out.push({ group: G, name: '空の素材も断る（見出しとして飛ばした行 0 行）', ok: same(vb5.refuse, [intake.NO_TIMED_TEXT.replace('{n}', '0')]) && intake.materialRefusal('0:01 a\n') === null, detail: JSON.stringify(vb5.refuse) });

  // ファイルの入口: 知らせは、付けた発話を渡すときに出す（読めない行は素材ログにも残す）。emit.notice が無ければ札に出す
  const runFile = function (txt) {
    const log = [];
    const em = { line: function (l) { log.push(['発話', l.t, l.text]); }, event: function (e) { log.push(['出来事', e.ev, e.line, e.t, e.raw]); }, interim: function () {}, status: function (x) { log.push(['札', x]); } };
    let lastT1 = 0;
    const cut = { windowEnd: function () { return lastT1 + 30; }, setLastT1: function (t) { lastT1 = t; }, pendingCount: function () { return 0; } };
    const fi = intake.makeFileIntake(em, cut);
    let eof = false;
    fi.on('eof', function () { eof = true; });
    fi.load(txt); fi.start();
    for (let k = 0; k < 50 && !eof; k++) { fi.playWindow(); lastT1 = fi.clock(); }
    return { log: log, fi: fi };
  };
  const f1 = runFile('0:01\t甲\t一\n0:2\t甲\t壊れた時刻\n0:40\t乙\t二\n0:3\t乙\t最後の後ろの壊れた行\n');
  const ev1 = f1.log.filter(function (x) { return x[0] !== '札'; });
  out.push({ group: G, name: 'ファイルの入口: 読めない行は付けた発話（後ろの発話）を渡したあとに素材ログへ残し、最後の発話より後ろは、最後の発話を渡した窓で読み切ったときに残す',
    ok: same(ev1, [['発話', 1, '一'], ['発話', 40, '二'], ['出来事', 'unreadable', 2, 40, '0:2\t甲\t壊れた時刻'], ['出来事', 'unreadable', 4, 60, '0:3\t乙\t最後の後ろの壊れた行']]), detail: JSON.stringify(ev1) });
  const st1 = f1.log.filter(function (x) { return x[0] === '札'; }).map(function (x) { return x[1]; });
  out.push({ group: G, name: 'ファイルの入口: emit.notice が無ければ、札にその窓の知らせの文を出す（同じ窓の 2 行は 1 文に「2・4 行目」）',
    ok: st1.indexOf(nt.unreadable.replace('{lines}', '2・4 行目')) >= 0 && same(f1.fi.noticed(), { unreadable: [2, 4], badbyte: [], jump: [], timehead: [] }), detail: st1.join(' / ') });
  const f3 = runFile('0:01\n一\n9:00 から始めます\n0:40\n二\n');
  const head3 = nt.timehead.replace('{lines}', '3 行目');
  const at3 = f3.log.map(function (x) { return x[0] === '札' ? x[1] : x[0]; });
  out.push({ group: G, name: 'ファイルの入口: 時刻で始まる本文の行は、その行を本文に入れた発話を渡した直後に知らせる（次の発話を待たない）',
    ok: same(f3.log.filter(function (x) { return x[0] === '発話'; }), [['発話', 1, '一 9:00 から始めます'], ['発話', 40, '二']]) && at3.indexOf(head3) === at3.indexOf('発話') + 1 && same(f3.fi.noticed(), { unreadable: [], badbyte: [], jump: [], timehead: [3] }),
    detail: JSON.stringify(at3) });
  // 打つ入口: 壁時計が戻っても、確定した発話の t は前の発話以上。setFloor で続きの下限を足せる
  const lines = [];
  const emit = { line: function (l) { lines.push(l); }, event: function () {}, interim: function () {}, status: function () {} };
  const ta = { value: '', disabled: true, focus: function () {}, addEventListener: function () {} };
  const clocks = [100.6, 90.2, 95, 120.9];
  let k = 0;
  const ti = intake.makeTextIntake(ta, emit, function () { return clocks[Math.min(k, clocks.length - 1)]; });
  ti.start();
  ti.setFloor(50);
  ['甲: 一つ目', '乙: 二つ目', '三つ目', '甲: 四つ目'].forEach(function (v, j) { k = j; ta.value = v; ti.flush(); });
  const tts = lines.map(function (l) { return l.t; });
  out.push({ group: G, name: '打つ入口: 時計が戻っても t は前の発話以上で、整数の秒（100.6, 90.2, 95, 120.9 → 100, 100, 100, 120）', ok: same(tts, [100, 100, 100, 120]), detail: tts.join(',') });
  const lines2 = [];
  const ti2 = intake.makeTextIntake(ta, { line: function (l) { lines2.push(l); }, event: function () {}, interim: function () {}, status: function () {} }, function () { return 10; });
  ti2.start(); ti2.setFloor(600); ta.value = '続きの発話'; ti2.flush();
  out.push({ group: G, name: '打つ入口: setFloor(600) のあとの発話は 600 以上', ok: lines2.length === 1 && lines2[0].t === 600, detail: JSON.stringify(lines2) });
  return out.concat(runWho(), runSpeech(), runSpeechLocal(), runSpeechRetry());
}

// ---- 音声認識の入口: この PC の中で文字にする（opts.local）と、再開しない誤り ----
// 調べる口（speechLocal・speechInstall）は Promise なので、e2e_routes.js の Z で確かめる
function runSpeechLocal() {
  const out = [];
  const G = '音声認識の入口';
  const saved = { sr: globalThis.SpeechRecognition, to: globalThis.setTimeout };
  const made = [], timers = [];
  function FakeSR() { made.push(this); }
  FakeSR.prototype.start = function () { if (this.onstart) this.onstart(); };
  FakeSR.prototype.stop = function () {};
  try {
    globalThis.SpeechRecognition = FakeSR;
    globalThis.setTimeout = function (f) { timers.push(f); return timers.length; };
    const run = function (opts, err) {
      made.length = 0; timers.length = 0;
      const events = [], status = [];
      const emit = { line: function () {}, event: function (e) { events.push(e); }, interim: function () {}, status: function (x) { status.push(x); } };
      const si = intake.makeSpeechIntake(emit, function () { return 1; }, opts);
      si.start();
      const r = made[0];
      if (err) { r.onerror({ error: err }); r.onend(); while (timers.length) timers.shift()(); }
      return { si: si, r: r, events: events, status: status, made: made.length };
    };
    const a = run({ local: true });
    out.push({ group: G, name: 'opts.local: 認識に processLocally を立て、始まりの出来事に local:true、札は「この PC の中で文字にしている」',
      ok: a.r.processLocally === true && a.r.lang === 'ja-JP' && a.events.some(function (e) { return e.ev === 'asr_start' && e.local === true; }) && /この PC の中で文字にしている/.test(a.status.join('|')) && a.si.local === true,
      detail: JSON.stringify({ pl: a.r.processLocally, ev: a.events, st: a.status }) });
    const b = run(undefined);
    out.push({ group: G, name: 'opts 無し: processLocally を立てず、始まりの出来事に local:false、札は「提供元のサーバーへ送られている」',
      ok: b.r.processLocally !== true && b.events.some(function (e) { return e.ev === 'asr_start' && e.local === false; }) && /提供元のサーバーへ送られている/.test(b.status.join('|')),
      detail: JSON.stringify({ pl: b.r.processLocally, ev: b.events, st: b.status }) });
    const c = run({ local: true }, 'language-not-supported');
    out.push({ group: G, name: 'opts.local で「言語が使えない」: 再開せず（認識は 1 つのまま）、サーバーへは切り替えないと言う',
      ok: c.made === 1 && made.length === 1 && /提供元のサーバーへは切り替えない/.test(c.status.join('|')) && !c.events.some(function (e) { return e.ev === 'asr_restart'; }),
      detail: JSON.stringify({ made: made.length, st: c.status }) });
    const d = run(undefined, 'service-not-allowed');
    out.push({ group: G, name: '「認識が許されていない」は再開しない',
      ok: made.length === 1 && /許されていない/.test(d.status.join('|')) && !d.events.some(function (e) { return e.ev === 'asr_restart'; }), detail: JSON.stringify({ made: made.length, st: d.status }) });
    const e = run({ local: true }, 'network');
    out.push({ group: G, name: '「通信が切れた」はこれまでどおり再開する（2 つ目の認識も processLocally を立てる）',
      ok: made.length === 2 && made[1].processLocally === true && e.events.some(function (x) { return x.ev === 'asr_restart'; }), detail: JSON.stringify({ made: made.length }) });
  } finally {
    globalThis.SpeechRecognition = saved.sr; globalThis.setTimeout = saved.to;
  }
  return out;
}

// ---- 音声認識の入口: 続けて失敗した認識の始め直し（待ちを延ばし、5 回で止める）と、終わりの知らせが来ない誤り ----
// 作り物の認識（start で onstart を呼ぶだけ）と、作り物の時計・待ち（setTimeout を預かり、試験が順に回す）で確かめる
function runSpeechRetry() {
  const out = [];
  const G = '音声認識の入口';
  const same = sameJson;
  const saved = { sr: globalThis.SpeechRecognition, to: globalThis.setTimeout };
  const made = [];
  let timers = [];
  function FakeSR() { made.push(this); this.aborted = 0; this.stopped = 0; }
  FakeSR.prototype.start = function () { if (this.onstart) this.onstart(); };
  FakeSR.prototype.stop = function () { this.stopped++; };       // 終わりの知らせは出さない（試験が呼ぶ）
  FakeSR.prototype.abort = function () { this.aborted++; };      // 同じ（Chromium は、日本語が無い端末内の認識で abort() しても出さない）
  const result = function (said, fin) { const r = [{ transcript: said }]; r.isFinal = fin !== false; return { resultIndex: 0, results: [r] }; };
  // 預かった待ちを 1 つ回す（早い順ではなく、置いた順。ここの試験では待ちが同時に 2 つ以上あることは無い）
  const runOne = function () { const x = timers.shift(); if (x) x.f(); return x ? x.ms : null; };
  const make = function (opts) {
    made.length = 0; timers = [];
    const box = { events: [], status: [], stopped: [], told: [], now: 0 };
    const emit = { line: function () {}, event: function (e) { box.events.push(e); }, interim: function () {}, status: function (x) { box.status.push(x); },
      notice: function (ls) { box.told.push(ls); }, stopped: function (why) { box.stopped.push(why); } };
    box.si = intake.makeSpeechIntake(emit, function () { return box.now; }, opts);
    box.ev = function (k) { return box.events.filter(function (e) { return e.ev === k; }).length; };
    return box;
  };
  // 1 回の失敗: いまの認識が誤りを知らせて終わり、始め直しの待ちを回す（待ちがあれば、その長さを返す）
  const failOnce = function (box, code) {
    const r = made[made.length - 1];
    if (code) r.onerror({ error: code });
    r.onend();
    return runOne();
  };
  try {
    globalThis.SpeechRecognition = FakeSR;
    globalThis.setTimeout = function (f, ms) { timers.push({ f: f, ms: ms }); return timers.length; };

    // 1. 認識の通信が止められている（network がすぐ返る）: 待ちは 0.3・1・2・4 秒と延び、5 回目で止める。素材ログの行は限られる
    const a = make(undefined);
    a.si.start();
    const waits = [];
    for (let k = 0; k < 5; k++) { const w = failOnce(a, 'network'); if (w != null) waits.push(w); }
    const evAt5 = a.events.map(function (e) { return e.ev; });
    made[made.length - 1].onerror({ error: 'network' });   // 止めた後に届いた誤り: 素材ログには残すが、札の理由は変えない
    runOne();
    const lastSt = a.status[a.status.length - 1] || '';
    out.push({ group: G, name: '続けて失敗: 何も聞き取れないまま「通信が切れた」で終わる認識が続くと、始め直しの待ちを 0.3・1・2・4 秒と延ばし、5 回目で止める（もう始め直さない）',
      ok: same(waits, [300, 1000, 2000, 4000]) && same(intake.RESTART_WAIT_MS, [300, 1000, 2000, 4000]) && intake.FAIL_LIMIT === 5 && made.length === 5 && timers.length === 0,
      detail: JSON.stringify({ waits: waits, made: made.length, timers: timers.length }) });
    out.push({ group: G, name: '続けて失敗: 止めたら札に、続けて失敗したことと最後の誤り（日本語と符号 network）を出し、emit.stopped で理由を 1 回だけ渡す',
      ok: /5 回続けて失敗した/.test(lastSt) && /認識の通信が切れた（network）/.test(lastSt) && /もう始め直さない/.test(lastSt) &&
        a.stopped.length === 1 && /認識の通信が切れた（network）/.test(a.stopped[0]),
      detail: JSON.stringify({ status: lastSt, stopped: a.stopped }) });
    out.push({ group: G, name: '続けて失敗: 素材ログの行は 5 回分で止まる（始めた 5・誤り 5・終わり 5・再開 4）。止めた後に何を呼んでも増えない',
      ok: evAt5.length === 19 && evAt5.filter(function (k) { return k === 'asr_start'; }).length === 5 && evAt5.filter(function (k) { return k === 'asr_error'; }).length === 5 &&
        evAt5.filter(function (k) { return k === 'asr_end'; }).length === 5 && evAt5.filter(function (k) { return k === 'asr_restart'; }).length === 4 &&
        a.events.length === 20 && made.length === 5 && timers.length === 0 && a.stopped.length === 1,
      detail: JSON.stringify(evAt5) });

    // 2. 何か聞き取れたら数え直す（途中結果でもよい）。待ちも最初の 0.3 秒に戻る
    const b = make(undefined);
    b.si.start();
    const wb = [];
    for (let k = 0; k < 3; k++) wb.push(failOnce(b, 'network'));
    made[made.length - 1].onresult(result('聞こえた', false));    // 途中結果
    wb.push(failOnce(b, 'network'));
    const stoppedMid = b.stopped.length;
    for (let k = 0; k < 5; k++) wb.push(failOnce(b, 'network'));
    out.push({ group: G, name: '続けて失敗: 何か 1 つ聞き取れたら（途中結果でも）数え直す。待ちは 0.3 秒に戻り、そこから 5 回続けて失敗したときだけ止める',
      ok: same(wb.slice(0, 3), [300, 1000, 2000]) && wb[3] === 300 && same(wb.slice(4), [300, 1000, 2000, 4000, null]) && stoppedMid === 0 && b.stopped.length === 1 && made.length === 9,
      detail: JSON.stringify({ waits: wb, made: made.length, stopped: b.stopped.length }) });

    // 3. 「声が聞こえない」（no-speech）は、黙っている会議でふつうに起きる。1 秒以上続いた認識なら失敗と数えない
    const c = make(undefined);
    c.si.start();
    const wc = [];
    for (let k = 0; k < 8; k++) { c.now += 8; wc.push(failOnce(c, 'no-speech')); }
    out.push({ group: G, name: '続けて失敗: 黙っていて「声が聞こえない」で終わる認識（1 秒以上続いたもの）は失敗と数えず、いつも 0.3 秒で始め直す（止めない）',
      ok: wc.every(function (w) { return w === 300; }) && c.stopped.length === 0 && made.length === 9,
      detail: JSON.stringify({ waits: wc, made: made.length }) });

    // 4. 誤りを知らせずに、始めてすぐ（1 秒未満で）何も聞き取れないまま終わる認識も失敗と数える
    const d = make({ local: true });
    d.si.start();
    const wd = [];
    for (let k = 0; k < 5; k++) wd.push(failOnce(d, null));
    const lastD = d.status[d.status.length - 1] || '';
    out.push({ group: G, name: '続けて失敗: 誤りが無くても、始めて 1 秒もたたずに何も聞き取れないまま終わる認識が 5 回続いたら止める。端末内で文字にする設定は始め直しても保つ',
      ok: same(wd, [300, 1000, 2000, 4000, null]) && d.stopped.length === 1 && /すぐに終わった/.test(lastD) && made.every(function (r) { return r.processLocally === true; }),
      detail: JSON.stringify({ waits: wd, status: lastD }) });

    // 5. 中断・再開（start）でも数え直す
    const e = make(undefined);
    e.si.start();
    for (let k = 0; k < 4; k++) failOnce(e, 'network');
    e.si.stop(); e.si.start();
    const we = [];
    for (let k = 0; k < 4; k++) we.push(failOnce(e, 'network'));
    out.push({ group: G, name: '続けて失敗: 中断して再開したら数え直す（再開の前の 4 回は数えない）',
      ok: same(we, [300, 1000, 2000, 4000]) && e.stopped.length === 0, detail: JSON.stringify({ waits: we, stopped: e.stopped }) });

    // 6. 再開しない誤りのあと、終わりの知らせ（onend）が来ない（端末内の認識に日本語が無いときの Chromium）。
    //    500 ミリ秒待って終わったものとし、札に理由を出し、emit.stopped を呼ぶ。聞き終えるときに 3 秒待たない
    const f = make({ local: true });
    f.si.start();
    const r6 = made[0];
    r6.onerror({ error: 'language-not-supported' });
    const before6 = { pending: f.si.pending(), stopped: f.stopped.length };
    const w6 = runOne();
    const doneF = [];
    f.si.stopWait(function (r) { doneF.push(r); });
    const left6 = timers.length;
    r6.onend();    // 遅れて来た終わりの知らせ（来ても二度は数えない）
    out.push({ group: G, name: '終わりの知らせが来ない誤り: 再開しない誤りのあと 500 ミリ秒待っても終わりの知らせが来なければ、終わったものとして扱い（止め直しを試み、asr_end は書かない）、札に理由を出し、emit.stopped を 1 回呼ぶ',
      ok: before6.pending === 1 && before6.stopped === 0 && w6 === intake.FATAL_END_WAIT_MS && intake.FATAL_END_WAIT_MS === 500 && f.si.pending() === 0 && r6.aborted === 1 &&
        f.ev('asr_end') === 0 && f.stopped.length === 1 && /提供元のサーバーへは切り替えない/.test(f.stopped[0]) && /止まったまま/.test(f.status[f.status.length - 1]) && made.length === 1,
      detail: JSON.stringify({ before: before6, wait: w6, pending: f.si.pending(), aborted: r6.aborted, stopped: f.stopped, status: f.status }) });
    out.push({ group: G, name: '終わりの知らせが来ない誤り: その後に聞き終えると、待たずに進む（上限の待ちを置かず、「待っても来なかった」と言わない）',
      ok: doneF.length === 1 && doneF[0].timedOut === false && left6 === 0 && f.ev('asr_stop_timeout') === 0 && f.told.length === 0 && f.si.noticed().stopTimeout === false,
      detail: JSON.stringify({ done: doneF, timers: left6, told: f.told }) });

    // 7. 再開しない誤りのあと、終わりの知らせがすぐ来たときは、今までどおり（500 ミリ秒の待ちは何もしない）
    const g = make(undefined);
    g.si.start();
    made[0].onerror({ error: 'not-allowed' });
    made[0].onend();
    const w7 = runOne();
    out.push({ group: G, name: '再開しない誤りのあと終わりの知らせが来たら、その時に emit.stopped を 1 回呼ぶ（500 ミリ秒の待ちでは二度呼ばない）',
      ok: w7 === 500 && g.stopped.length === 1 && /マイクの許可が無い/.test(g.stopped[0]) && g.ev('asr_end') === 1 && made[0].aborted === 0 && made.length === 1,
      detail: JSON.stringify({ wait: w7, stopped: g.stopped, aborted: made[0].aborted }) });

    // 8. 聞き終えるのを待っている間に、再開しない誤りが来て終わりの知らせが来ない: 500 ミリ秒で待ちが解ける（3 秒待たない）
    const h = make({ local: true });
    h.si.start();
    const doneH = [];
    h.si.stopWait(function (r) { doneH.push(r); });
    const capH = timers.length;                  // 聞き終えの上限の待ち（3 秒）
    made[0].onerror({ error: 'language-not-supported' });
    const fatalTimer = timers[timers.length - 1];
    fatalTimer.f();                              // 500 ミリ秒の待ちだけ回す
    out.push({ group: G, name: '聞き終えの待ちの間に再開しない誤りが来て終わりの知らせが来なくても、500 ミリ秒で待ちが解け、上限で進んだことにしない（止まった知らせは出す。ページは聞き終えの最中なので使わない）',
      ok: capH === 1 && fatalTimer.ms === 500 && doneH.length === 1 && doneH[0].timedOut === false && h.ev('asr_stop_timeout') === 0 && h.told.length === 0 && h.stopped.length === 1,
      detail: JSON.stringify({ cap: capH, done: doneH, stopped: h.stopped }) });
  } finally {
    if (saved.sr === undefined) delete globalThis.SpeechRecognition; else globalThis.SpeechRecognition = saved.sr;
    globalThis.setTimeout = saved.to;
  }
  return out;
}

// ---- 話者の切り出し（format/FORMAT.md「話者の切り出し」。打つ入口が素材ログに渡す {who, text}） ----
function runWho() {
  const out = [];
  const G = '話者の切り出し';
  const same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  // [打った行, 期待する who, 期待する text]
  const table = [
    ['司会: 始めます', '司会', '始めます'],
    ['司会：始めます', '司会', '始めます'],
    ['15:00までに資料を送ってください。', null, '15:00までに資料を送ってください。'],
    ['10:30に再開します。', null, '10:30に再開します。'],
    ['9:00 から始めます', null, '9:00 から始めます'],
    ['16:9 の画面で映します', null, '16:9 の画面で映します'],
    ['https://example.com の表を見てください。', null, 'https://example.com の表を見てください。'],
    ['0:05 司会: 始めます', null, '0:05 司会: 始めます'],
    ['9：00集合', null, '9：00集合'],
    ['０番: 全角の数字で始まる', null, '０番: 全角の数字で始まる'],
    ['結論：A案にします', '結論', 'A案にします'],
    ['司会:区切りの後ろに空白が無い', null, '司会:区切りの後ろに空白が無い'],
    ['名前に 空白: 本文', null, '名前に 空白: 本文'],
    ['  司会: 前後の空白は除く  ', '司会', '前後の空白は除く'],
    ['名前:\u3000全角スペースも空白', '名前', '全角スペースも空白'],
    ['一二三四五六七八九十一二三四五六七八九十: 二十字の名前', '一二三四五六七八九十一二三四五六七八九十', '二十字の名前'],
    ['一二三四五六七八九十一二三四五六七八九十一: 二十一字の名前', null, '一二三四五六七八九十一二三四五六七八九十一: 二十一字の名前'],
    ['𠮷野: 名前の字数はコードポイントで数える', '𠮷野', '名前の字数はコードポイントで数える'],
    ['a:b 司会: 最初の区切りだけを見る', null, 'a:b 司会: 最初の区切りだけを見る']
  ];
  const bad = table.filter(function (r) { return !same(intake.splitWho(r[0]), { who: r[1], text: r[2] }); });
  out.push({ group: G, name: 'splitWho の表（' + table.length + ' 通り。時刻・比・URL で始まる行は話者にしない）', ok: bad.length === 0,
    detail: bad.map(function (r) { return JSON.stringify(r[0]) + ' → ' + JSON.stringify(intake.splitWho(r[0])); }).join(' / ') });
  // 打つ入口が素材ログに渡す発話（4 回目の指摘の 3 行と、話者のある行）
  const got = [];
  const emit = { line: function (l) { got.push([l.who, l.text]); }, event: function () {}, interim: function () {}, status: function () {} };
  const ta = { value: '', disabled: true, focus: function () {}, addEventListener: function () {} };
  const ti = intake.makeTextIntake(ta, emit, function () { return 5; });
  ti.start();
  ta.value = '15:00までに資料を送ってください。\n10:30に再開します。\nhttps://example.com の表を見てください。\n司会: 次の議題です。\n9:00 から始めます';
  ti.flush();
  out.push({ group: G, name: '打つ入口: 時刻や URL で始まる行は話者無しの全文のまま、「司会: 」の行だけ話者を切り出して素材ログへ渡す',
    ok: same(got, [[null, '15:00までに資料を送ってください。'], [null, '10:30に再開します。'], [null, 'https://example.com の表を見てください。'], ['司会', '次の議題です。'], [null, '9:00 から始めます']]),
    detail: JSON.stringify(got) });
  // 打った 1 行の読み方は rt.py のメモ帳と同じ（共通の期待値 tests/fixtures/typed_lines.json。rt.py の memo_kind も同じ表を通す）
  const typed = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'typed_lines.json'), 'utf8')).rows;
  const badTyped = typed.filter(function (r) { return !same(intake.readTypedLine(r.line), { kind: r.kind, who: r.who, text: r.text }); });
  out.push({ group: G, name: '打った 1 行の読み方が共通の期待値（typed_lines.json、' + typed.length + ' 行）と一字違わず同じ（1 列目の時刻を落とす・表の話者の列・話者だけの行も発話）', ok: badTyped.length === 0,
    detail: badTyped.map(function (r) { return JSON.stringify(r.line) + ' → ' + JSON.stringify(intake.readTypedLine(r.line)); }).join(' / ') });
  // 打つ入口に表の行を貼る: 1 列目の時刻を落とし、入口の札で 1 回だけ知らせる。話者だけの行も捨てない
  const got2 = [], said = [];
  const emit2 = { line: function (l) { got2.push([l.who, l.text, l.t]); }, event: function () {}, interim: function () {}, status: function (x) { said.push(x); } };
  const ti3 = intake.makeTextIntake(ta, emit2, function () { return 7.9; });
  ti3.start();
  const before = ti3.noticed().timecol;
  ta.value = '0:20\t甲\t貼った表の行\n9:59\t乙\t時刻は使わない\n司会：\n\u3000\n';
  ti3.flush();
  out.push({ group: G, name: '打つ入口: 表の行の 1 列目の時刻は使わず（届いた時刻 7）、知らせは 1 回、話者だけの行も話者無しの本文として残す',
    ok: same(got2, [['甲', '貼った表の行', 7], ['乙', '時刻は使わない', 7], [null, '司会：', 7]]) && before === false && ti3.noticed().timecol === true &&
      said.filter(function (x) { return x === intake.TIMECOL_TEXT; }).length === 1,
    detail: JSON.stringify(got2) + ' / ' + JSON.stringify(said) });
  // 受け取る側に emit.notice があれば、時刻の列の知らせはそちらにだけ渡し、入口の札（中断中など）を書き換えない
  const said2 = [], told = [];
  const ti4 = intake.makeTextIntake(ta, { line: function () {}, event: function () {}, interim: function () {}, status: function (x) { said2.push(x); }, notice: function (x) { told.push(x); } }, function () { return 9; });
  ti4.start();
  said2.length = 0;
  ta.value = '0:20\t甲\t中断の間に貼った表の行\n0:30\t乙\t二つ目';
  ti4.flush();
  out.push({ group: G, name: '打つ入口: emit.notice があれば、時刻の列の知らせはそちらに 1 回だけ渡し、札（emit.status）は変えない',
    ok: same(told, [[intake.TIMECOL_TEXT]]) && said2.length === 0, detail: JSON.stringify(told) + ' / ' + JSON.stringify(said2) });
  return out;
}

// ---- 音声認識の入口（K15: 認識は 1 つだけ動かす。古い世代の終わりの知らせでは始め直さない） ----
function runSpeech() {
  const out = [];
  const G = '音声認識の入口';
  const same = sameJson;
  const made = [];
  function FakeSR() { this.stopped = false; made.push(this); }
  FakeSR.prototype.start = function () { if (this.onstart) this.onstart(); };
  FakeSR.prototype.stop = function () { this.stopped = true; };   // 終わりの知らせ（onend）は、試験が遅らせて呼ぶ
  const result = function (said) { const r = [{ transcript: said }]; r.isFinal = true; return { resultIndex: 0, results: [r] }; };
  const saved = { sr: globalThis.SpeechRecognition, to: globalThis.setTimeout };
  const timers = [];
  const got = [], events = [], status = [];
  try {
    globalThis.SpeechRecognition = FakeSR;
    globalThis.setTimeout = function (f) { timers.push(f); return timers.length; };
    const emit = { line: function (l) { got.push(l.text); }, event: function (e) { events.push(e.ev); }, interim: function () {}, status: function (x) { status.push(x); } };
    const si = intake.makeSpeechIntake(emit, function () { return 3; });
    const runTimers = function () { while (timers.length) timers.shift()(); };
    const ended = function (r) { r.stopped = true; r.onend(); };   // 認識が終わった（終わりの知らせが来た）
    const live = function () { return made.filter(function (r) { return !r.stopped; }).length; };
    si.start();
    si.stop();          // 中断
    si.start();         // すぐ再開（前の認識の終わりの知らせは、まだ来ていない）
    ended(made[0]);     // 前の認識の遅れた終わりの知らせ
    runTimers();
    out.push({ group: G, name: '中断してすぐ再開し、前の認識の終わりの知らせが遅れて来ても、認識を 2 つ目に増やさない（作った認識 2 つ、動いているのは 1 つ）',
      ok: made.length === 2 && live() === 1 && !made[1].stopped && si.generation() === 2, detail: '作った ' + made.length + '・動いている ' + live() });
    made[1].onresult(result('一つ目'));
    out.push({ group: G, name: '再開後に聞いた発話は 1 回だけ渡る', ok: same(got, ['一つ目']), detail: JSON.stringify(got) });
    ended(made[1]);     // 動いている認識の終わり（ふだんの切断）→ 300 ミリ秒後に始め直す待ち
    const waiting = timers.length;
    si.stop(); si.start();   // 待ちのあいだに中断と再開
    runTimers();
    out.push({ group: G, name: '始め直しの待ちのあいだに中断と再開をしたら、待ちの側は始め直さない（作った認識 3 つ、動いているのは 1 つ）',
      ok: waiting === 1 && made.length === 3 && live() === 1 && !made[2].stopped, detail: '待ち ' + waiting + '・作った ' + made.length + '・動いている ' + live() });
    const before = status.length;
    made[1].onerror({ error: 'network' });
    made[0].onresult(result('止める前の確定'));
    out.push({ group: G, name: '古い世代の誤りの知らせは札を変えず（素材ログには残す）、古い世代の確定した結果は捨てない',
      ok: status.length === before && events[events.length - 1] === 'asr_error' && got[got.length - 1] === '止める前の確定', detail: JSON.stringify(status.slice(before)) + ' / ' + JSON.stringify(got) });
    ended(made[2]);
    runTimers();
    out.push({ group: G, name: 'いまの世代の終わりでは、今までどおり始め直す（4 つ目を作り、動いているのは 1 つ）', ok: made.length === 4 && live() === 1 && events.indexOf('asr_restart') >= 0, detail: '作った ' + made.length });

    // ---- K19 聞き終えるときの stopWait: いまの世代の終わりの知らせ（onend）を待ってから進む（上限 3 秒） ----
    const delays = [];
    globalThis.setTimeout = function (f, ms) { timers.push(f); delays.push(ms); return timers.length; };
    const newSpeech = function () {
      const box = { got: [], events: [], told: [], status: [], made0: made.length };
      const em = { line: function (l) { box.got.push(l.text); }, event: function (e) { box.events.push(e); }, interim: function () {},
        status: function (x) { box.status.push(x); }, notice: function (ls) { box.told.push(ls); } };
      box.si = intake.makeSpeechIntake(em, function () { return 7; });
      box.mine = function () { return made.slice(box.made0); };
      return box;
    };
    timers.length = 0;

    // 1. ふだん: 止めた後・終わりの知らせの前に届いた確定の結果も渡し、終わりの知らせで 1 回だけ進む
    const a = newSpeech();
    a.si.start();
    a.mine()[0].onresult(result('止める前'));
    const doneA = [];
    const pA = a.si.stopWait(function (r) { doneA.push(r); });
    const waitingA = doneA.length;
    a.mine()[0].onresult(result('止めた後に届いた確定'));
    ended(a.mine()[0]);
    runTimers();
    out.push({ group: G, name: 'K19 聞き終える: 認識を止め、終わりの知らせが来るまで待つ。その間に届いた確定の結果も渡し、知らせが来たら 1 回だけ進む（始め直さない）',
      ok: waitingA === 0 && a.mine()[0].stopped && same(a.got, ['止める前', '止めた後に届いた確定']) && doneA.length === 1 && doneA[0].timedOut === false &&
        a.si.generation() === 1 && a.events.every(function (e) { return e.ev !== 'asr_restart' && e.ev !== 'asr_stop_timeout'; }) && a.status[a.status.length - 1] === '止めた' &&
        a.si.noticed().stopTimeout === false && !!pA && typeof pA.then === 'function',
      detail: JSON.stringify({ waiting: waitingA, got: a.got, done: doneA, gen: a.si.generation(), status: a.status }) });

    // 2. 上限: 終わりの知らせが来なければ、上限（3000 ミリ秒）で進み、素材ログと知らせの欄に残す。後から来た知らせでは進まない
    const b = newSpeech();
    b.si.start();
    delays.length = 0;
    const doneB = [];
    b.si.stopWait(function (r) { doneB.push(r); });
    const beforeB = doneB.length;
    runTimers();
    const toB = b.events.filter(function (e) { return e.ev === 'asr_stop_timeout'; });
    ended(b.mine()[0]);
    runTimers();
    out.push({ group: G, name: 'K19 聞き終える: 終わりの知らせが来なければ上限 3 秒で進み（timedOut）、素材ログに asr_stop_timeout、知らせの欄に STOP_WAIT_TEXT を 1 回出す。後から来た知らせで二度進まない',
      ok: beforeB === 0 && same(delays, [intake.STOP_WAIT_MS]) && intake.STOP_WAIT_MS === 3000 && doneB.length === 1 && doneB[0].timedOut === true &&
        toB.length === 1 && toB[0].ms === 3000 && toB[0].t === 7 && same(b.told, [[intake.STOP_WAIT_TEXT]]) && b.si.noticed().stopTimeout === true && b.si.generation() === 1,
      detail: JSON.stringify({ delays: delays, done: doneB, ev: toB, told: b.told }) });

    // 3. もう終わっている: 中断して終わりの知らせが来た後・始め直しの待ちの最中・まだ始めていない は、待たずに進む
    const c = newSpeech();
    const doneC0 = [];
    c.si.stopWait(function (r) { doneC0.push(r); });
    c.si.start(); c.si.stop(); ended(c.mine()[0]);
    delays.length = 0;
    const doneC1 = [];
    c.si.stopWait(function (r) { doneC1.push(r); });
    const timersC = delays.length;     // 待たないので、上限の待ちも置かない
    const d = newSpeech();
    d.si.start();
    ended(d.mine()[0]);          // ふだんの切断。300 ミリ秒後に始め直す待ちに入る
    const doneD = [];
    d.si.stopWait(function (r) { doneD.push(r); });
    runTimers();
    out.push({ group: G, name: 'K19 聞き終える: 動いている認識が無ければ（まだ始めていない・中断して終わった・始め直しの待ちの最中）待たずに進み、始め直しもしない',
      ok: doneC0.length === 1 && doneC0[0].timedOut === false && doneC1.length === 1 && doneC1[0].timedOut === false && timersC === 0 &&
        doneD.length === 1 && doneD[0].timedOut === false && d.si.generation() === 1 && c.si.generation() === 1,
      detail: JSON.stringify({ c0: doneC0, c1: doneC1, d: doneD, genC: c.si.generation(), genD: d.si.generation() }) });

    // 4. 中断してすぐ再開した後に聞き終える: 古い世代が先に終わっても、いまの世代が終わるまで待つ
    const e = newSpeech();
    e.si.start(); e.si.stop(); e.si.start();
    const doneE = [];
    e.si.stopWait(function (r) { doneE.push(r); });
    ended(e.mine()[0]);          // 古い世代の遅れた終わり
    const afterOld = doneE.length;
    e.mine()[1].onresult(result('いまの世代の確定'));
    ended(e.mine()[1]);          // いまの世代の終わり
    runTimers();
    out.push({ group: G, name: 'K29 聞き終える: 古い世代が先に終わっても進まず、いまの世代の終わりで進む。待つ間の確定の結果も渡す',
      ok: afterOld === 0 && doneE.length === 1 && doneE[0].timedOut === false && same(e.got, ['いまの世代の確定']) && e.si.generation() === 2 && e.si.pending() === 0,
      detail: JSON.stringify({ afterOld: afterOld, done: doneE, got: e.got }) });

    // 5. K29（7 回目の確かめの Q3）: 中断 → すぐ再開 → 聞き終える。いまの世代が先に終わり、止めた古い世代が後から確定の結果を
    //    返してから終わる。古い世代の終わりまで待つので、その結果も最後の窓に入る（黙って欠けない）
    const q = newSpeech();
    q.si.start(); q.si.stop(); q.si.start();
    q.mine()[1].onresult(result('再開した後の発話'));
    delays.length = 0;
    const doneQ = [];
    q.si.stopWait(function (r) { doneQ.push(r); });
    const stoppedQ = q.mine().map(function (r) { return r.stopped; });
    ended(q.mine()[1]);          // いまの世代が先に終わる
    const afterNew = doneQ.length;
    q.mine()[0].onresult(result('古い世代の遅れた結果'));
    ended(q.mine()[0]);          // 古い世代が後から終わる
    runTimers();
    out.push({ group: G, name: 'K29 聞き終える: 止めたのに終わっていない世代をすべて待つ。いまの世代が先に終わっても、古い世代の終わりまで進まず、その間に古い世代が返した確定の結果も渡す（上限の待ちは 1 つ）',
      ok: same(stoppedQ, [true, true]) && afterNew === 0 && doneQ.length === 1 && doneQ[0].timedOut === false &&
        same(q.got, ['再開した後の発話', '古い世代の遅れた結果']) && same(delays, [intake.STOP_WAIT_MS]) && q.si.noticed().late === 0 &&
        q.events.every(function (x) { return x.ev !== 'late' && x.ev !== 'asr_stop_timeout'; }),
      detail: JSON.stringify({ afterNew: afterNew, done: doneQ, got: q.got, delays: delays, ev: q.events.map(function (x) { return x.ev; }) }) });

    // 6. K29 上限は合わせて 3 秒。待ちきれずに聞き終えた後に届いた確定の結果は、素材ログに late を残して捨て、知らせる。
    //    聞き終えた後の終わりの知らせ（asr_end）などは素材ログに足さない
    const h = newSpeech();
    h.si.start(); h.si.stop(); h.si.start();
    delays.length = 0;
    const doneH = [];
    h.si.stopWait(function (r) { doneH.push(r); });
    ended(h.mine()[1]);          // いまの世代は終わる。古い世代は終わらないまま
    const beforeCap = doneH.length;
    runTimers();                 // 上限
    const evCap = h.events.length;
    h.mine()[0].onresult(result('上限の後の結果一'));
    h.mine()[0].onresult(result('上限の後の結果二'));
    h.mine()[0].onerror({ error: 'network' });
    ended(h.mine()[0]);
    const after = h.events.slice(evCap);
    out.push({ group: G, name: 'K29 聞き終える: 待つ世代が 2 つでも上限は合わせて 3 秒（待ちは 1 つ）。上限の後に届いた確定の結果は発話にせず、素材ログに {ev:late, text, t} を残し、知らせの欄に「…1 件捨てました（記録の外）」から順に出す。その後の誤り・終わりの出来事は素材ログに足さない',
      ok: beforeCap === 0 && same(delays, [intake.STOP_WAIT_MS]) && doneH.length === 1 && doneH[0].timedOut === true && h.got.length === 0 &&
        same(after, [{ ev: 'late', text: '上限の後の結果一', t: 7 }, { ev: 'late', text: '上限の後の結果二', t: 7 }]) &&
        same(h.told, [[intake.STOP_WAIT_TEXT], [intake.lateText(1)], [intake.lateText(2)]]) &&
        intake.lateText(1) === '聞き終えた後に届いた認識の結果を 1 件捨てました（記録の外）' &&
        h.si.noticed().late === 2 && h.si.noticed().stopTimeout === true && h.si.pending() === 0,
      detail: JSON.stringify({ before: beforeCap, delays: delays, done: doneH, got: h.got, after: after, told: h.told }) });

    // 7. K29 ふだんに待ち終えた後（end の後）に届いた結果も、黙って捨てずに late として残す
    const g = newSpeech();
    g.si.start();
    const doneG = [];
    g.si.stopWait(function (r) { doneG.push(r); });
    ended(g.mine()[0]);
    const evG = g.events.length;
    g.mine()[0].onresult(result('終わりの知らせの後の結果'));
    out.push({ group: G, name: 'K29 聞き終える: 待ち終えた後に届いた確定の結果は、上限を過ぎていなくても発話にせず late として残し、知らせる',
      ok: doneG.length === 1 && doneG[0].timedOut === false && g.got.length === 0 &&
        same(g.events.slice(evG), [{ ev: 'late', text: '終わりの知らせの後の結果', t: 7 }]) && same(g.told, [[intake.lateText(1)]]),
      detail: JSON.stringify({ got: g.got, ev: g.events.slice(evG), told: g.told }) });
  } finally {
    if (saved.sr === undefined) delete globalThis.SpeechRecognition; else globalThis.SpeechRecognition = saved.sr;
    globalThis.setTimeout = saved.to;
  }
  return out;
}

// ---- 違反文の字面（K17: P30 の長い素材の名前は、終わり＝拡張子を残して短くする。rt.py と同じ） ----
function runMessages(data) {
  const out = [];
  const G = '違反文';
  const c = data.cases.filter(function (x) { return x._file === '126_reject.json'; })[0];
  const r = c ? verifyApi.makeVerifier(data.rules)(c.log_prefix, c.batch, { now: c.clock }) : { errors: [] };
  const m = r.errors.filter(function (x) { return x.indexOf('P30:') === 0; })[0] || '';
  const src = c ? c.batch[0].src : '';
  const tail = '"…' + Array.from(src).slice(-59).join('') + '"';
  out.push({ group: G, name: 'P30: 60 字を超える素材の名前は、頭に「…」を付けて終わりの 59 字を出す（断った理由の拡張子が見える。cases 126）',
    ok: !!c && Array.from(src).length > 60 && m.indexOf(tail) >= 0 && m.indexOf('.txt.jsonl"') >= 0, detail: m });
  return out;
}

const verbose = process.argv.indexOf('--verbose') >= 0;
const data = loadData();
const results = tests.runAll({ makeVerifier: verifyApi.makeVerifier, verifyApi: verifyApi, fold: fold }, data).concat(runMaterial(), runMessages(data));

const groups = {};
results.forEach(function (r) {
  groups[r.group] = groups[r.group] || { ok: 0, ng: 0 };
  groups[r.group][r.ok ? 'ok' : 'ng']++;
  if (!r.ok || verbose) console.log((r.ok ? '合格 ' : '不合格 ') + '[' + r.group + '] ' + r.name + (r.detail ? '\n        ' + r.detail : ''));
});
console.log('');
Object.keys(groups).forEach(function (g) {
  console.log(g + ': 合格 ' + groups[g].ok + ' / 不合格 ' + groups[g].ng);
});
const ng = results.filter(function (r) { return !r.ok; }).length;
console.log('合計 ' + results.length + ' 件、不合格 ' + ng + ' 件');
process.exit(ng ? 1 : 0);
