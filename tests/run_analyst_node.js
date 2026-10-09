#!/usr/bin/env node
/*
 * run_analyst_node.js — src/analyst.js の試験（node で走らせる。fetch は呼ばない）
 *
 *   node tests/run_analyst_node.js
 *
 * 群:
 *   1. parseReply   返事の全体を包んだ囲み・前置き・壊れた JSON・形の違いを読み分ける
 *   2. makePrompt   指示＋状態の最小表現が1つの文字列になり、pack がそのまま入っている
 *   3. 台本（mock） fixtures/meeting10.jsonl を台本にした mock が、製品側の toBatch と verify.js を通して fixture を一字違わず
 *                  作り直せる。ステップ 6（gap の窓）では壊れた返事を3回返し、3回とも拒否される
 *   4. 組み立て     Anthropic / OpenAI 互換の本文とヘッダの形。設定の書き出しに鍵が入らない。スキーマの札が外れる。
 *                  API の誤りの文に返事の本文が入らない
 *   5. toBatch      返事 → 追記の直し方が rt.py の reply_to_batch と同じ（li:null を欄ごと落とす、無いものを補わない、など）
 *   6. 刻み         src/cut.js の窓の切り方。終わりちょうどの発話は、最後の発話でも次の窓。素材の終わりで閉じる窓は、
 *                  ファイルではふだんと同じ刻みで、聞き終えている時刻より先に終わりを置かない。ライブでは聞き終えた時計の
 *                  整数の秒（窓幅 × 3 を超えるなら刻みの最後の位置。同じ秒に届いた発話があれば時計が進むまで閉じない）。
 *                  1 つの窓の発話は規則表の上限（40）まで。
 *                  上限で切った窓は、終わりを渡さなかった最初の発話の時刻まで縮め、その時刻と同じ時刻の塊の手前で切る
 *                  （塊が窓の最初の発話から始まるときだけ幅 0 の窓に 40 件）。窓の幅は整数の秒。
 *                  受け取った時刻が前に戻っていれば、直前の時刻に揃えた写しで渡す。ライブで遅れて閉じる窓の終わりは、
 *                  刻みの位置（始まり + 窓幅の 1〜3 倍）のうち時計が過ぎた最も後ろ（rt.py と同じ。中断のあとも）
 *   どの群も、画面に出す文（msg）に英字の項目名が無く、分析役に返す文（error）は項目名を使うことも見る
 */
'use strict';
const fs = require('fs');
const path = require('path');

const KIT = path.resolve(__dirname, '..');
const A = require(path.join(KIT, 'src', 'analyst.js'));
const CUT = require(path.join(KIT, 'src', 'cut.js'));
const V = require(path.join(KIT, 'src', 'verify.js'));

const readJsonl = function (f) { return fs.readFileSync(f, 'utf8').split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return JSON.parse(l); }); };
const rules = JSON.parse(fs.readFileSync(path.join(KIT, 'format', 'rules.json'), 'utf8'));
const schema = JSON.parse(fs.readFileSync(path.join(KIT, 'format', 'schema.json'), 'utf8'));
const fixture = readJsonl(path.join(__dirname, 'fixtures', 'meeting10.jsonl'));
const src = fs.readFileSync(path.join(__dirname, 'fixtures', 'meeting10.txt'), 'utf8').split('\n').filter(function (l) { return l.trim(); }).map(function (l, i) {
  const p3 = l.split('\t'); const ts = p3[0].split(':').map(Number);
  return { i: i + 1, t: ts.length === 3 ? ts[0] * 3600 + ts[1] * 60 + ts[2] : ts[0] * 60 + ts[1], who: p3[1], text: p3[2] };
});

const results = [];
function t(group, name, ok, detail) { results.push({ group: group, name: name, ok: !!ok, detail: detail || '' }); }
function canon(x) {
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(x[k]); }).join(',') + '}';
  return JSON.stringify(x);
}
function deepEq(a, b) { return canon(a) === canon(b); }

// ---- 1. parseReply ----
(function () {
  const good = '{"step":{"t":[0,30]},"events":[],"note":{"x":"a"}}';
  let r = A.parseReply(good);
  t('parseReply', '素の JSON を読む', r.ok && r.step.t[1] === 30 && r.note.x === 'a');
  r = A.parseReply('```json\n' + good + '\n```');
  t('parseReply', '返事の全体を 1 回だけ包んだ囲み（```json … ```）は外して読む', r.ok && r.note.x === 'a', r.error);
  r = A.parseReply('```\n' + good + '\n```');
  t('parseReply', '言語名の無い囲み（``` … ```）も外して読む', r.ok && r.note.x === 'a', r.error);
  r = A.parseReply('はい、返事です。\n```json\n' + good + '\n```\n以上です。');
  t('parseReply', '囲みの外に前置き・後書きがあれば読まない（rt.py と同じ）', !r.ok, r.error);
  r = A.parseReply('{"step":{"t":[0,30]},"events":[{"e":"card","id":"C1","t":1,"d":0,"role":"claim","who":null,"src":[1],"li":null,"ti":"} の字","b":""}],"note":{"x":"}}"}}');
  t('parseReply', '文字列の中に } があっても読める', r.ok && r.events.length === 1 && r.note.x === '}}', r.error);
  r = A.parseReply('{"step":{"t":[0,30]},"events":[],"note":{"x":"```json の囲みと ``` の閉じの話が出た"}}');
  t('parseReply', '文字列の中に ``` があっても読める', r.ok && /```json/.test(r.note.x), r.error);
  r = A.parseReply('{"step":{"t":[0,30]},"note":{"x":"静かな窓"}}');
  t('parseReply', 'events の欄が無い返事は、何も書かない窓（events は空）として読む', r.ok && Array.isArray(r.events) && r.events.length === 0, r.error);
  r = A.parseReply('前置き {"step":{"t":[0,30]},"events":[],"note":{"x":"a"}} 後書き');
  t('parseReply', '前後に文がある返事は読まない', !r.ok, r.error);
  r = A.parseReply('{"step":{"t":[0,30]},"events":[{"e":"note","t":30,"x":"所感"}]}');
  t('parseReply', '所感を events の中に書いた返事は読まない（所感は上の段に 1 つ）', !r.ok, r.error);
  r = A.parseReply('{"step":{"t":[0,30]},"events":[],"note":{"x":"a"}');
  t('parseReply', '閉じていない JSON は拒む', !r.ok, r.error);
  r = A.parseReply('{"step":{"t":[0,30]},"events":[{"e":"step","n":1}],"note":{"x":"a"}}');
  t('parseReply', 'events に step が入っていたら拒む', !r.ok, r.error);
  r = A.parseReply('{"step":{"t":[0,30]},"events":[],"note":{"x":"a"},"extra":1}');
  t('parseReply', '知らない欄は捨てて通す（中身は検査器が見る）', r.ok && !('extra' in r));
  r = A.parseReply('{"step":{"t":[0,30]},"events":[],"note":{"x":"a"},"e":"reply"}');
  const rNull = A.parseReply('{"e":null,"step":{"t":[0,30]},"events":[],"note":{"x":"a"}}');
  t('parseReply', '一番外に e の欄がある返事は読まない（rt.py は JSONL の 1 行として読んで断る。値が null でも同じ）', !r.ok && !rNull.ok && /e の欄/.test(r.error) && !/[A-Za-z]{2,}/.test(r.msg), r.error);
  r = A.parseReply('{"step":{"t":[0,30]},"events":[]}');
  t('parseReply', 'note が無ければ拒む', !r.ok, r.error);
  r = A.parseReply('');
  t('parseReply', '空は拒む', !r.ok, r.error);
  r = A.parseReply('[1,2]');
  t('parseReply', '配列は拒む', !r.ok, r.error);
  // 画面に出す文と、分析役に返す文を分けて持つ
  const shapes = ['これは機械向けの形ではない', '{"step":{"t":[0,30]},"events":{},"note":{"x":"a"}}', '{"step":{"t":[0]},"events":[],"note":{"x":"a"}}',
    '{"step":{"t":[0,30]},"events":[{"e":"zzz"}],"note":{"x":"a"}}', '{"step":{"t":[0,30]},"events":[],"note":{}}', '[1]', ''];
  const outs = shapes.map(function (x) { return A.parseReply(x); });
  t('parseReply', '読めない返事は、画面向けの文（msg）に英字の項目名が無い', outs.every(function (o) { return !o.ok && typeof o.msg === 'string' && o.msg && !/[A-Za-z]{2,}/.test(o.msg); }), outs.map(function (o) { return o.msg; }).join(' / '));
  t('parseReply', '分析役に返す文（error）は項目名で言う（JSON・events・step.t・note.x）', /JSON/.test(outs[0].error) && /events/.test(outs[1].error) && /step\.t/.test(outs[2].error) && /zzz/.test(outs[3].error) && /note\.x/.test(outs[4].error), outs.map(function (o) { return o.error; }).join(' / '));
  t('parseReply', 'shapeReply も同じ口で使える（形で来た返事の検査）', typeof A.shapeReply === 'function' && !A.shapeReply({ step: { t: [0, 30] }, events: {}, note: { x: 'a' } }).ok && A.shapeReply({ step: { t: [0, 30] }, events: [], note: { x: 'a' } }).ok);

  // events が null の返事は読めない（欄が無いときだけ空の並びとして読む）。読めない返事なので、検査に落ちたのと同じ 1 回に数える
  r = A.parseReply('{"step":{"t":[0,30]},"events":null,"note":{"x":"a"}}');
  t('parseReply', 'events が null の返事は読まない（欄が無いときだけ空として読む）', !r.ok && /events/.test(r.error) && !/[A-Za-z]{2,}/.test(r.msg), r.error);

  // 文字の入れ子の事前検査（rt.py の PARSE_DEPTH_MAX と同じ 500 段。文字列の外の [ と { を数える）
  const deep = function (n) { return '{"step":{"t":[0,30]},"events":[],"note":{"x":"a"},"zz":' + '['.repeat(n) + ']'.repeat(n) + '}'; };
  // deep(n) の入れ子は、外側の { の 1 段＋ n 段
  r = A.parseReply(deep(499));
  t('parseReply', '文字の入れ子が 500 段ちょうど（知らない欄の中）なら読む', r.ok, r.error);
  r = A.parseReply(deep(500));
  t('parseReply', '文字の入れ子が 501 段（知らない欄の中）なら、JSON として読む前に F02 で断る', !r.ok && /^F02: /.test(r.error) && /500/.test(r.error) && !/[A-Za-z]{2,}/.test(r.msg), r.error);
  r = A.parseReply('```json\n' + deep(500) + '\n```');
  t('parseReply', '囲みの内側でも同じ数え方で断る', !r.ok && /^F02: /.test(r.error), r.error);
  r = A.parseReply('{"step":{"t":[0,30]},"events":[],"note":{"x":"' + '['.repeat(600) + '{\\"' + '{'.repeat(10) + '"}}');
  t('parseReply', '文字列の中の [ と {（\\" のあとも文字列の中）は数えない', r.ok && r.note.x.length === 600 + 2 + 10, r.error);
  r = A.parseReply('{"step":{"t":[0,30]},"events":[],"note":{"x":"\\\\"},"zz":' + '['.repeat(500) + ']'.repeat(500) + '}');
  t('parseReply', '\\\\ で終わる文字列のあとは、文字列の外として数える', !r.ok && /^F02: /.test(r.error), r.error);

  // 前後の空白は、書き出した集まり（JS の trim と同じ。rt.py の WS_CHARS と同じ）だけを除く
  const ws = ['\t', '\n', '\u000b', '\u000c', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿'];
  const wsOk = ws.every(function (c) { const x = A.parseReply(c + c + good + c); return x.ok; });
  t('parseReply', '空白の集まりの字（BOM・全角空白・行区切りを含む 17 字）は前後から除いて読む', wsOk);
  t('parseReply', '囲みの内側も同じ集まりで除く', A.parseReply('﻿```json　' + good + ' ``` ').ok);
  const notWs = ['\u0085', '\u001c', '​', '᠎'];
  const notOk = notWs.every(function (c) { const x = A.parseReply(c + good); return !x.ok; });
  t('parseReply', '集まりに無い字（U+0085・U+001C・U+200B・U+180E）は空白として除かない（前に付いていれば読まない）', notOk);
  r = A.parseReply('　﻿\n');
  t('parseReply', '空白だけの返事は空として拒む', !r.ok && /空/.test(r.error), r.error);
  r = A.parseReply('```json\n  \n```');
  t('parseReply', '囲みの中が空白だけでも空として拒む', !r.ok && /空/.test(r.error), r.error);
})();

// ---- 2. makePrompt ----
(function () {
  const pack = { now: { n: 1, t: 30, at: '2026-10-07T09:00:00Z' }, new: { t: [0, 30], lines: [{ i: 1, t: 1, who: '話者A', text: 'こんにちは。' }] } };
  const p = A.makePrompt('# 指示\n\n本文\n\n', pack);
  t('makePrompt', '指示の後ろに pack の JSON がそのまま入る', p.indexOf('# 指示\n\n本文\n\n---') === 0 && p.indexOf(JSON.stringify(pack)) > 0);
  t('makePrompt', '画面の文字が日本語で、内部名を説明しない', p.indexOf('状態の最小表現') > 0);
})();

// ---- 3. 台本（mock）で fixture を作り直す ----
(async function () {
  const verify = V.makeVerifier(rules);
  const an = A.makeAnalyst({ kind: 'mock', script: fixture });
  t('台本', 'makeAnalyst の label が日本語', an.label === '試験用の台本');

  // 窓の切り方（tests/README.md）: ステップ n の窓は [30(n-1), 30n]。発話は 30(n-1) <= t < 30n（終わりちょうどの発話は、最後でも次の窓）
  const steps = fixture.filter(function (e) { return e.e === 'step'; });
  const open = fixture[0];
  let log = [open];
  let allOk = true, rejectedGap = 0, diffs = [];
  for (let n = 1; n <= steps.length; n++) {
    const want = steps[n - 1];
    const win = { t: [30 * (n - 1), 30 * n], lines: want.lines };
    const next_ids = verify.nextIds(log);
    const lines = src.filter(function (u) { return u.i >= win.lines[0] && u.i <= win.lines[1]; });
    const pack = { now: { n: n, t: win.t[1], at: want.at }, next_ids: next_ids, new: { t: win.t, lines: lines } };
    let attempt = 1, written = false;
    while (attempt <= 3 && !written) {
      const reply = await an.analyze(Object.assign({ attempt: attempt }, pack), '（指示）');
      if (reply.ended) { allOk = false; t('台本', 'ステップ ' + n + ' で台本が尽きた', false); break; }
      // 製品側の toBatch（rt.py の reply_to_batch と同じ直し方）で追記に直す
      const batch = A.toBatch(reply, { n: n, lines: win.lines, t: win.t });
      const r = verify(log, batch, { now: want.at, next_ids: next_ids, window: win, src: src });
      if (r.ok) {
        log = log.concat(r.batch);
        written = true;
      } else {
        if (n === 6) rejectedGap++;
        else { allOk = false; t('台本', 'ステップ ' + n + ' の返事が拒否された', false, r.errors.join(' / ')); break; }
        attempt++;
      }
    }
    if (!written && n === 6) {
      // 3回落ちたので、道具が gap の最小バッチを書く（fixture のステップ 6 そのもの）
      const gapBatch = [];
      let on = false;
      fixture.forEach(function (e) {
        if (e.e === 'step') on = (e.n === 6);
        else if (e.e === 'end' || e.e === 'pause') on = false;
        if (on) gapBatch.push(JSON.parse(JSON.stringify(e)));
      });
      const r = verify(log, gapBatch, { now: want.at, next_ids: next_ids, window: win, src: src });
      if (!r.ok) { allOk = false; t('台本', 'gap の最小バッチが拒否された', false, r.errors.join(' / ')); }
      else log = log.concat(r.batch);
    } else if (!written) { allOk = false; }
  }
  const end = fixture[fixture.length - 1];
  const rEnd = verify(log, [{ e: 'end', t: end.t }], { now: end.at });
  if (rEnd.ok) log = log.concat(rEnd.batch); else allOk = false;
  for (let i = 0; i < Math.max(log.length, fixture.length); i++) {
    if (!deepEq(log[i], fixture[i])) diffs.push(i + 1);
  }
  t('台本', 'mock の返事を verify に通して、全ステップが受理される', allOk);
  t('台本', 'ステップ 6（gap の窓）では壊れた返事が3回とも拒否される', rejectedGap === 3, rejectedGap + ' 回');
  t('台本', '作り直した記録が fixture と一字も違わない（at・was を含む）', diffs.length === 0, diffs.length ? '違う行: ' + diffs.slice(0, 10).join(',') : log.length + ' 行');
  const after = await an.analyze({ now: { n: 21 }, new: { t: [600, 630], lines: [] } }, '');
  t('台本', '台本の先を求めると ended で返る', after.ended === true && after.events.length === 0);

  // ---- 4. 組み立て ----
  const I = A._internal;
  const body = I.anthropicBody({ kind: 'anthropic', key: 'x', effort: 'low' }, 'PREFIX', 'USER', { schema: A.prepareSchema(schema) });
  t('組み立て', 'Anthropic: system が cache_control 付きの1ブロックで、output_config に effort と format がある',
    body.system.length === 1 && body.system[0].cache_control.type === 'ephemeral' && body.system[0].text === 'PREFIX' &&
    body.output_config.effort === 'low' && body.output_config.format.type === 'json_schema' && body.output_config.format.schema.type === 'object' &&
    body.model === 'claude-opus-5-5' && !('thinking' in body) && body.messages[0].role === 'user' && body.messages[0].content === 'USER');
  const body2 = I.anthropicBody({ kind: 'anthropic', key: 'x', model: 'claude-haiku-4-5', think: 'summarized' }, 'P', 'U', {});
  t('組み立て', 'Anthropic: think=summarized のときだけ thinking を送り、既定でないモデルで effort 無しなら output_config も無い', body2.thinking && body2.thinking.display === 'summarized' && !('output_config' in body2));
  const body3 = I.anthropicBody({ kind: 'anthropic', key: 'x' }, 'P', 'U', {});
  t('組み立て', 'Anthropic: 既定のモデルで effort 無しなら medium を明示し、上限は 16000（思考を含む）', body3.model === 'claude-opus-5-5' && body3.output_config && body3.output_config.effort === 'medium' && Object.keys(body3.output_config).length === 1 && body3.max_tokens === 16000 && !('thinking' in body3), JSON.stringify({ oc: body3.output_config, mt: body3.max_tokens }));
  const body4 = I.anthropicBody({ kind: 'anthropic', key: 'x', model: 'claude-opus-5-5', maxTokens: 9000 }, 'P', 'U', { maxTokens: 1024 });
  t('組み立て', 'Anthropic: 呼び出しごとの上限が設定の上限より先に効き、モデルを既定と同じ名で打っても medium を送る', body4.max_tokens === 1024 && body4.output_config.effort === 'medium');
  const h = I.anthropicHeaders({ key: 'x' });
  t('組み立て', 'Anthropic: ヘッダに x-api-key・anthropic-version・direct-browser-access がある',
    h['x-api-key'] === 'x' && h['anthropic-version'] === '2023-06-01' && h['anthropic-dangerous-direct-browser-access'] === 'true');
  const ob = I.openaiBody({ kind: 'openai', key: 'x', model: 'm' }, 'PREFIX', 'USER', { schema: A.prepareSchema(schema) });
  t('組み立て', 'OpenAI 互換: system+user の2通で、response_format が json_schema strict',
    ob.messages.length === 2 && ob.messages[0].role === 'system' && ob.response_format.type === 'json_schema' && ob.response_format.json_schema.strict === true && ob.response_format.json_schema.schema.type === 'object');
  t('組み立て', 'OpenAI 互換: URL は <base>/chat/completions（末尾の / を吸収）', I.openaiUrl({ base: 'https://example.invalid/v1/' }) === 'https://example.invalid/v1/chat/completions' && I.openaiUrl({}) === 'https://api.openai.com/v1/chat/completions');
  const oh = I.openaiHeaders({ key: 'x' }), oh2 = I.openaiHeaders({ key: 'x', keyHeader: 'api-key' });
  t('組み立て', 'OpenAI 互換: 既定は Authorization: Bearer、keyHeader で api-key に変えられる', oh.Authorization === 'Bearer x' && oh2['api-key'] === 'x' && !('Authorization' in oh2));
  const ps = A.prepareSchema(schema);
  t('組み立て', 'スキーマから $schema と $id が外れ、$defs と anyOf は残る', !('$schema' in ps) && !('$id' in ps) && ps.$defs && ps.properties.events.items.anyOf.length === 9);
  const exp = JSON.parse(A.exportSettings({ kind: 'anthropic', key: 'SECRET', model: 'claude-opus-5-5', effort: 'low', schema: schema, ask: function () {}, script: fixture }));
  t('組み立て', '設定の書き出しに鍵・関数・台本・スキーマが入らない', !('key' in exp) && !('ask' in exp) && !('script' in exp) && !('schema' in exp) && exp.model === 'claude-opus-5-5' && JSON.stringify(exp).indexOf('SECRET') < 0);
  t('組み立て', 'usage の取り出し（Anthropic / OpenAI 互換）',
    deepEq(I.usageAnthropic({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }), { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }) &&
    deepEq(I.usageOpenAI({ prompt_tokens: 5, completion_tokens: 6, prompt_tokens_details: { cached_tokens: 7 } }), { input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 7, cache_creation_input_tokens: null }));
  let threw = null;
  try { A.makeAnalyst({ kind: 'nope' }); } catch (e) { threw = e.message; }
  t('組み立て', '知らない種類は日本語の誤りで止まる', threw && threw.indexOf('分析役の種類') === 0, threw);
  const tc = await A.testConnection({ kind: 'mock' });
  t('組み立て', '接続テストは API 以外では ok:false と理由を返す（fetch を呼ばない）', tc.ok === false && /API/.test(tc.error));
  const tc2 = await A.testConnection({ kind: 'anthropic' });
  t('組み立て', '鍵が無ければ接続テストは fetch を呼ばずに止まる', tc2.ok === false && tc2.error === '鍵がありません');
  {
    // 接続テストが送るもの: 指示文と短い問いを、repeat なら 2 回。思考を含めた上限 1024、考える量は low
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async function (url, init) {
      sent.push({ url: url, body: JSON.parse(init.body) });
      return { status: 200, text: async function () { return JSON.stringify({ model: 'claude-opus-5-5', usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: sent.length === 2 ? 4000 : 0 }, content: [{ type: 'text', text: '了解' }] }); } };
    };
    let tc3;
    try { tc3 = await A.testConnection({ kind: 'anthropic', key: 'k' }, 'PREFIX', { repeat: true }); } finally { globalThis.fetch = realFetch; }
    t('組み立て', '接続テスト（Anthropic・repeat）: 指示文つきで 2 回送り、上限 1024・考える量 low、会議の発言は送らない',
      tc3.ok && sent.length === 2 && sent.every(function (x) { return x.body.max_tokens === 1024 && x.body.output_config && x.body.output_config.effort === 'low' && !('format' in x.body.output_config) && x.body.system[0].text === 'PREFIX' && x.body.messages.length === 1 && /了解/.test(x.body.messages[0].content); }) && tc3.cache_read === 4000,
      JSON.stringify(sent.map(function (x) { return { mt: x.body.max_tokens, oc: x.body.output_config }; })));
  }
  const man = A.makeAnalyst({ kind: 'manual', ask: async function (prompt) { return '```json\n{"step":{"t":[0,30]},"events":[],"note":{"x":"' + (prompt.indexOf('状態の最小表現') > 0 ? 'ok' : 'ng') + '"}}\n```'; } });
  const mr = await man.analyze({ now: { n: 1 } }, '指示');
  t('組み立て', '手動の輪: cfg.ask にプロンプトが渡り、貼られた返事を読む', mr.note.x === 'ok' && mr.usage === null);

  // API の誤りの文に、返事の本文（会社のプロキシの遮断ページなど）を流し込まない。本文は console にだけ出す
  {
    const warned = [];
    const realWarn = console.warn;
    console.warn = function () { warned.push(Array.prototype.join.call(arguments, ' ')); };
    let e1, e2, e3;
    try {
      // fetch を差し替えて、HTML の遮断ページ（403）と、error.message 付きの JSON（400）と、本文の無い 500 を返す
      const realFetch = globalThis.fetch;
      let scenario = 'html';
      globalThis.fetch = async function () {
        if (scenario === 'html') return { status: 403, text: async function () { return '<html><body><h1>Blocked by corporate proxy</h1><p>秘密の本文</p></body></html>'; } };
        if (scenario === 'json') return { status: 400, text: async function () { return JSON.stringify({ error: { type: 'invalid_request_error', message: 'モデル名が違います' } }); } };
        return { status: 500, text: async function () { return 'Internal Server Error'; } };
      };
      try { await A.analyze({ now: { n: 1 } }, 'P', { kind: 'anthropic', key: 'k', schema: schema }); } catch (e) { e1 = e; }
      scenario = 'json';
      try { await A.analyze({ now: { n: 1 } }, 'P', { kind: 'openai', key: 'k', model: 'm', schema: schema }); } catch (e) { e2 = e; }
      scenario = 'plain';
      try { await A.analyze({ now: { n: 1 } }, 'P', { kind: 'anthropic', key: 'k', schema: schema }); } catch (e) { e3 = e; }
      globalThis.fetch = realFetch;
    } finally { console.warn = realWarn; }
    t('組み立て', 'HTML の遮断ページ（403）: 画面の文は状態番号だけで、本文が入らない', e1 && /403/.test(e1.message) && !/Blocked|秘密の本文|html/.test(e1.message), e1 && e1.message);
    t('組み立て', 'JSON の誤り（400）: error.message だけが入る', e2 && /400/.test(e2.message) && /モデル名が違います/.test(e2.message) && !/invalid_request_error/.test(e2.message), e2 && e2.message);
    t('組み立て', 'JSON でない本文（500）: 「機械向けの形ではない（会社の網が遮っている可能性）」と言う', e3 && /500/.test(e3.message) && /機械向けの形ではない/.test(e3.message) && /会社の網/.test(e3.message) && !/Internal/.test(e3.message), e3 && e3.message);
    t('組み立て', '本文は console に出る', warned.length === 3 && /秘密の本文/.test(warned[0]) && /Internal Server Error/.test(warned[2]), warned.length + ' 件');
  }

  // ---- 5. toBatch ----
  (function () {
    const w = { n: 4, lines: [10, 12], t: [90, 120] };
    const reply = {
      step: { t: [90, 120] },
      events: [
        { e: 'card', id: 'C7', t: 95, d: 0, role: 'claim', who: null, src: [10], li: null, ti: 'あ', b: '' },
        { e: 'card', id: 'C8', t: 99, d: 0, role: 'case', who: null, src: [11], li: ['L1', 2], ti: 'い', b: '' },
        { e: 'fix', id: 'C1', t: 100, field: 'd', now: 1, why: '' }
      ],
      note: { x: '所感' },
      think: Array(2105).join('思')
    };
    const b = A.toBatch(reply, w);
    t('toBatch', '先頭は step で、n・lines は窓から、t は返事から', b[0].e === 'step' && b[0].n === 4 && deepEq(b[0].lines, [10, 12]) && deepEq(b[0].t, [90, 120]), JSON.stringify(b[0]));
    t('toBatch', 'step の欄の並びは e・n・lines・t・think（rt.py と同じ 1 行になる）', Object.keys(b[0]).join(',') === 'e,n,lines,t,think', Object.keys(b[0]).join(','));
    t('toBatch', 'think は 2000 字で切る', Array.from(b[0].think).length === 2000);
    t('toBatch', 'card の li:null は欄ごと落とし、li の配列は残す', !('li' in b[1]) && deepEq(b[2].li, ['L1', 2]), JSON.stringify(b[1]));
    t('toBatch', 'card 以外のイベントはそのまま（fix の was は足さない。検査器が埋める）', deepEq(b[3], reply.events[2]) && !('was' in b[3]));
    t('toBatch', '末尾は note で、t は step.t[1]', b[4].e === 'note' && b[4].t === 120 && b[4].x === '所感' && b.length === 5);
    t('toBatch', '返事を書き換えない（複製して直す）', reply.events[0].li === null && Array.from(reply.think).length === 2104);
    const b2 = A.toBatch({ events: [{ e: 'hold', id: 'H1', t: 1, who: null, q: 'q' }] }, w);
    t('toBatch', 'step.t が無ければ補わず null のまま（検査器が落とす）、note が無ければ付けない', b2.length === 2 && b2[0].t === null && !('think' in b2[0]) && b2[1].e === 'hold', JSON.stringify(b2));
    const b3 = A.toBatch({ step: { t: [0, 30] }, events: [], note: { x: '' }, think: '' }, { n: 1, lines: [1, 3], t: [0, 30] });
    t('toBatch', '空の think は載せず、空の note.x は載せる（字数の違反は検査器が出す）', !('think' in b3[0]) && b3.length === 2 && b3[1].x === '', JSON.stringify(b3));
    const V2 = V.makeVerifier(rules);
    const r = V2([fixture[0]], A.toBatch({ step: { t: [0, 30] }, events: [{ e: 'card', id: 'C1', t: 5, d: 0, role: 'claim', who: null, src: [1], li: null, ti: 'あ', b: '' }], note: { x: 'x' } }, { n: 1, lines: [1, 1], t: [0, 30] }), { now: '2026-10-07T09:00:00Z', window: { t: [0, 30], lines: [1, 1] } });
    t('toBatch', '直した追記が verify.js を通る（li を落としたカードが strict_keys で落ちない）', r.ok, r.errors.join(' / '));
  })();

  // ---- 6. 刻み（cut.js） ----
  (function () {
    const mk = function (win, lines, fixed) {
      const got = [];
      const c = CUT.makeCutter({ window: win, factor: 3, fixed: !!fixed, onWindow: function (w) { got.push(w); } });
      lines.forEach(function (l, k) { c.push({ i: k + 1, t: l }); });
      return { c: c, got: got };
    };
    const show = function (w) { return w ? JSON.stringify({ t: w.t, lines: w.lines }) : 'null'; };
    // ふだんの窓: 0:30 ちょうどの発話は次の窓
    let x = mk(30, [5, 20, 30], true);
    let w = x.c.tick(30);
    t('刻み', 'ふだんの窓: 終わりちょうど（0:30）の発話は次の窓', w && w.t.join() === '0,30' && w.lines.join() === '1,2', show(w));
    x.c.ready(30);
    w = x.c.close(30, { eof: true });
    t('刻み', 'ファイルを読み切った最後の窓は、ふだんと同じ刻み（0:30〜1:00）で、0:30 の発話を入れる', w && w.t.join() === '30,60' && w.lines.join() === '3,3', show(w));
    // 溜まりをまとめて素材の終わりで閉じる: 終わりちょうどの発話は、最後でも窓の外（もう 1 つ後の窓）
    x = mk(30, [5, 20, 30], true);
    w = x.c.close(30, { eof: true });
    t('刻み', '素材の終わりで閉じる窓は、溜まった発話がどれも手前に入る刻み（0:00〜1:00）', w && w.t.join() === '0,60' && w.lines.join() === '1,3', show(w));
    x = mk(30, [5, 20, 90], true);
    w = x.c.close(90, { eof: true });
    t('刻み', '素材の終わりで閉じる窓は window × 3 まで。1:30 ちょうどの発話は入らない', w && w.t.join() === '0,90' && w.lines.join() === '1,2', show(w));
    x.c.ready(90);
    w = x.c.close(90, { eof: true });
    t('刻み', 'その発話は、もう 1 つ後の最後の窓（1:30〜2:00）', w && w.t.join() === '90,120' && w.lines.join() === '3,3', show(w));
    // 聞き終えている時刻（ライブ）より先に終わりを置かない
    x = mk(30, [31.2, 35.7]);
    x.c.setLastT1(30);
    w = x.c.close(40.6, { eof: true, heard: 40 });
    t('刻み', 'ライブの最後の窓は、聞き終えた秒（0:40）までで閉じる', w && w.t.join() === '30,40' && w.lines.join() === '1,2', show(w));
    x = mk(30, [40.1]);
    x.c.setLastT1(30);
    w = x.c.close(40.5, { eof: true, heard: 40 });
    t('刻み', 'ライブで、聞き終えた秒ちょうどか後の発話しか無いなら、まだ閉じない（null）', w === null && x.c.pendingCount() === 1 && !x.c.isBusy(), show(w));
    w = x.c.close(41.2, { eof: true, heard: 41 });
    t('刻み', '時計が次の秒へ進んだら閉じる（0:30〜0:41）', w && w.t.join() === '30,41' && w.lines.join() === '1,1', show(w));
    x = mk(30, [12, 40]);
    w = x.c.close(40.5, { eof: true, heard: 40 });
    t('刻み', 'ライブで聞き終えた秒ちょうど（0:40）に届いた発話があれば、最後の窓を分けずに、時計が次の秒へ進むまで閉じない（null。rt.py の next --last も待つ）', w === null && x.c.pendingCount() === 2 && !x.c.isBusy(), show(w));
    w = x.c.close(41.3, { eof: true, heard: 41 });
    t('刻み', '時計が 0:41 に進むと、2 つの発話を 1 つの最後の窓（0:00〜0:41）で渡す', w && w.t.join() === '0,41' && w.lines.join() === '1,2' && w.last === true, show(w));
    // K23: ライブの最後の窓の終わりは、聞き終えた時計の整数の秒（刻みに合わせない）。窓幅 10・始まり 1:00・発話 1:08・時計 1:26 → 1:00〜1:26
    x = mk(10, [68]);
    x.c.setLastT1(60);
    w = x.c.close(86.7, { eof: true, heard: 86 });
    t('刻み', 'ライブの最後の窓は、いつもの窓がもう閉じていても刻みに合わせず、聞き終えた秒まで（窓幅 10 秒・1:00〜1:26。1:00〜1:20 にはしない）', w && w.t.join() === '60,86' && w.lines.join() === '1,1' && w.last === true, show(w));
    // 返事を待つ間に聞き終えた: ready に eof を渡せば、いつもの窓（1:00〜1:20）を先に出さず、最後の窓（1:00〜1:26）にする
    (function () {
      const mkBusy = function () {
        const c = CUT.makeCutter({ window: 10, factor: 3 });
        c.push({ i: 1, t: 55 }); c.setLastT1(50);
        const w0 = c.tick(60);
        c.push({ i: 2, t: 68 });
        return { c: c, w0: w0 };
      };
      const p = mkBusy(), q = mkBusy();
      const wLast = p.c.ready(86.4, { eof: true, heard: 86 });
      const wUsual = q.c.ready(86.4);
      t('刻み', '返事を待つ間に聞き終えたら、ready に eof を渡すと最後の窓（1:00〜1:26）で閉じる。渡さなければ、いつもの刻み（1:00〜1:20）',
        p.w0 && p.w0.t.join() === '50,60' && wLast && wLast.t.join() === '60,86' && wLast.last === true && wUsual && wUsual.t.join() === '60,80', [p.w0, wLast, wUsual].map(show).join(' '));
    })();
    // 中断の後に再開せずに聞き終えた: 窓幅 5 秒、0:05 に中断、中断の間の 0:08 に打った行、0:22 に聞き終える。
    // 聞き終えた秒（0:22）は始まり + 5 × 3（0:20）より後なので、幅の上限（始まり + 窓幅 × 3）で閉じる（0:05〜0:20）
    (function () {
      const c = CUT.makeCutter({ window: 5, factor: 3 });
      c.push({ i: 1, t: 1 });
      const a1 = c.tick(5);
      c.ready(5);
      c.setLastT1(5);              // 中断（pause.t は直前の窓の終わり）
      c.push({ i: 2, t: 8 });
      const a2 = c.close(22.4, { eof: true, heard: 22 });
      t('刻み', '中断の後に再開せずに聞き終えた最後の窓: 聞き終えた秒（0:22）が窓幅 × 3 を超えるので 0:05〜0:20（rt.py の next --last と同じ）',
        a1 && a1.t.join() === '0,5' && a2 && a2.t.join() === '5,20' && a2.lines.join() === '2,2' && a2.last === true, [a1, a2].map(show).join(' '));
      // 窓幅 × 3 を超えた後ろにも発話があれば、その発話は次の最後の窓（0:20〜聞き終えた秒）
      const c2 = CUT.makeCutter({ window: 5, factor: 3 });
      c2.push({ i: 1, t: 1 }); c2.tick(5); c2.ready(5); c2.setLastT1(5);
      c2.push({ i: 2, t: 8 }); c2.push({ i: 3, t: 21 });
      const b1 = c2.close(23.2, { eof: true, heard: 23 });
      c2.ready(23.2);
      const b2 = c2.close(23.5, { eof: true, heard: 23 });
      t('刻み', '窓幅 × 3 を超えた後ろの発話（0:21）は、次の最後の窓（0:20〜0:23）へ',
        b1 && b1.t.join() === '5,20' && b1.lines.join() === '2,2' && b1.last === false && b2 && b2.t.join() === '20,23' && b2.lines.join() === '3,3' && b2.last === true, [b1, b2].map(show).join(' '));
      // 手動の輪（窓幅を open.window より広げた刻み）でも、幅の上限は open.window × 3。聞き終えた秒が上限の後ろなら上限で閉じる
      const c3 = CUT.makeCutter({ window: 60, baseWindow: 30, factor: 3 });
      c3.push({ i: 1, t: 10 }); c3.push({ i: 2, t: 70 });
      const m1 = c3.close(95.5, { eof: true, heard: 95 });
      const c4 = CUT.makeCutter({ window: 60, baseWindow: 30, factor: 3 });
      c4.push({ i: 1, t: 10 }); c4.push({ i: 2, t: 70 });
      const m2 = c4.close(75.5, { eof: true, heard: 75 });
      t('刻み', '手動の輪の窓幅（60 秒・open.window 30 秒）でも、最後の窓の幅の上限は 30 × 3: 聞き終えた秒 1:35 → 0:00〜1:30、1:15 → 0:00〜1:15',
        m1 && m1.t.join() === '0,90' && m1.lines.join() === '1,2' && m2 && m2.t.join() === '0,75' && m2.lines.join() === '1,2', [m1, m2].map(show).join(' '));
    })();
    // ファイルを途中で終えた: 聞き終えた時刻（ファイルの時計）より先に置かない
    x = mk(30, [35, 40], true);
    x.c.setLastT1(30);
    w = x.c.close(45.5, { eof: true, heard: 45.5 });
    t('刻み', 'ファイルを途中で終えた最後の窓は、ファイルの時計（0:45.5）までで閉じる', w && w.t.join() === '30,45.5' && w.lines.join() === '1,2', show(w));

    // ライブで遅れて閉じる窓の終わりは、刻みの位置（始まり + window、+ 2·window、+ 3·window）のうち時計が過ぎた最も後ろ
    // （rt.py の compute_window と同じ。時計の秒では閉じない）
    const lateEnd = function (nowT) { const y = mk(30, [5, 20]); return y.c.tick(nowT); };
    const ends = [[30, '0,30'], [47.9, '0,30'], [60, '0,60'], [89.4, '0,60'], [90, '0,90'], [200, '0,90']].map(function (p) { const ww = lateEnd(p[0]); return [p[0], ww ? ww.t.join() : null, p[1]]; });
    t('刻み', 'ライブで遅れて閉じる窓の終わりは、時計が過ぎた刻みの位置の最も後ろ（時計 0:47.9 → 0:30、1:29.4 → 1:00、3:20 → 1:30）', ends.every(function (p) { return p[1] === p[2]; }), JSON.stringify(ends));
    x = mk(30, [5]);
    w = x.c.close(29.9, {});
    t('刻み', 'ライブで時計が最初の刻みの位置に届く前は、閉じない（null）', w === null && x.c.pendingCount() === 1, show(w));
    // 窓幅 5 秒の中断: 0:01 の発話の窓 0:00〜0:05 を閉じたあと 0:05 に中断、中断の間の 0:08 に打った行、0:12 に再開して時計が進む。
    // rt.py は 0:05〜0:10 に発話 2 を渡し、次の窓は 0:10 から（ページも同じ）
    (function () {
      const got = [];
      const c = CUT.makeCutter({ window: 5, factor: 3, onWindow: function (ww) { got.push(ww); } });
      c.push({ i: 1, t: 1 });
      const a1 = c.tick(5);
      c.ready(5);
      c.push({ i: 2, t: 8 });       // 中断の間（時計は進むが tick は呼ばない）
      const a2 = c.tick(12.4);      // 再開して最初の時計
      c.ready(12.4);
      c.push({ i: 3, t: 13 });
      const a3 = c.tick(15);
      t('刻み', '中断のあと遅れて閉じる窓も刻みの位置で閉じる（0:00〜0:05、0:05〜0:10、0:10〜0:15。0:05〜0:12 にはしない）',
        a1 && a1.t.join() === '0,5' && a2 && a2.t.join() === '5,10' && a2.lines.join() === '2,2' && a3 && a3.t.join() === '10,15' && a3.lines.join() === '3,3',
        [a1, a2, a3].map(show).join(' '));
    })();
    // 戻した窓（書けなかった窓）に合流するときも、終わりは刻みの位置（window × 3 まで）
    x = mk(30, [5]);
    w = x.c.tick(30);
    x.c.requeue(w);
    x.c.push({ i: 2, t: 40 });
    const r1 = x.c.tick(59);
    const r2 = x.c.tick(75.5);
    t('刻み', '戻した窓は、戻した窓の終わり + window（1:00）まで閉じず、閉じるときの終わりも刻みの位置（0:00〜1:00）', r1 === null && r2 && r2.t.join() === '0,60' && r2.lines.join() === '1,2', show(r1) + ' ' + show(r2));

    // 1 つの窓の発話は 40 件まで（規則表の step.max_lines）。超えた分は、時刻が窓の中でも次の窓へ
    const maxLines = rules.limits['step.max_lines'];
    t('刻み', '規則表に 1 つの窓の発話の上限（40）がある', maxLines === 40, String(maxLines));
    const mkN = function (win, ts, o) {
      const got = [];
      const c = CUT.makeCutter(Object.assign({ window: win, factor: 3, maxLines: maxLines, onWindow: function (w) { got.push(w); } }, o || {}));
      ts.forEach(function (tt, k) { c.push({ i: k + 1, t: tt }); });
      return { c: c, got: got };
    };
    const ones = []; for (let k = 0; k < 50; k++) ones.push(1);
    x = mkN(30, ones);
    w = x.c.tick(30);
    t('刻み', '50 発話が 0:01 にあっても、最初の窓は発話 1〜40 だけ。窓の最初の発話から同じ時刻が 41 件以上続くので、幅 0 の窓（0:01〜0:01。始まりも 0:01 まで進む）', w && w.t.join() === '1,1' && w.lines.join() === '1,40' && w.items.length === 40 && x.c.pendingCount() === 10, show(w));
    w = x.c.ready(30);
    t('刻み', '残りの 10 発話は、縮めた終わりから 1 窓（0:31）まで出さない', w === null && !x.c.isBusy() && x.c.windowEnd() === 31, show(w) + ' 次の終わり=' + x.c.windowEnd());
    w = x.c.tick(60);
    t('刻み', 'ライブでは次の窓は縮めた終わりから刻みの位置（0:31。時計の 1:00 は次の刻み 1:01 の手前）まで（0:01〜0:31 で発話 41〜50）', w && w.t.join() === '1,31' && w.lines.join() === '41,50', show(w));
    x = mkN(30, ones, { fixed: true });
    x.c.tick(30); x.c.ready(30);
    w = x.c.tick(60);
    t('刻み', 'ファイルでは次の窓は縮めた終わり + 窓幅（0:01〜0:31。時計が先でも広げない）で発話 41〜50', w && w.t.join() === '1,31' && w.lines.join() === '41,50', show(w));
    x = mkN(30, ones, { fixed: true });
    w = x.c.close(30, { eof: true });
    t('刻み', '素材の終わりでも 40 件まで（発話 1〜40。幅 0 の窓 0:01〜0:01。最後の窓ではない）', w && w.t.join() === '1,1' && w.lines.join() === '1,40' && w.last === false, show(w));
    x.c.ready(30);
    w = x.c.close(30, { eof: true });
    t('刻み', 'ファイル: 入りきらなかった分は、もう 1 つ後の最後の窓（0:01〜0:31、発話 41〜50）', w && w.t.join() === '1,31' && w.lines.join() === '41,50' && w.last === true, show(w));
    x = mkN(30, ones);
    w = x.c.close(30, { eof: true, heard: 30 });
    x.c.ready(30);
    const w2 = x.c.close(30.2, { eof: true, heard: 30 });
    t('刻み', 'ライブ: 最後の窓も 40 件まで（0:01〜0:01）、入りきらなかった分は聞き終えた秒までの最後の窓（0:01〜0:30、発話 41〜50）',
      w && w.t.join() === '1,1' && w.lines.join() === '1,40' && w2 && w2.t.join() === '1,30' && w2.lines.join() === '41,50' && w2.last === true, show(w) + ' ' + show(w2));
    // 0.5 秒おきの 60 発話（0:00〜0:29.5）: 最初の窓は発話 1〜40（〜0:19.5）で、終わりは 41 番目の 0:20。
    // 次の窓は 0:20 から始まり、0:20〜0:29.5 の 20 発話を渡す（まだ渡していない所に終わりを置かない）
    const half = []; for (let k = 0; k < 60; k++) half.push(k / 2);
    x = mkN(30, half, { fixed: true });
    w = x.c.tick(30);
    t('刻み', '上限で切った窓の終わりは、渡さなかった最初の発話の時刻（0:20）', w && w.t.join() === '0,20' && w.lines.join() === '1,40', show(w));
    x.c.ready(30);
    w = x.c.tick(50);
    t('刻み', '次の窓は縮めた終わりから（0:20〜0:50、発話 41〜60）', w && w.t.join() === '20,50' && w.lines.join() === '41,60', show(w));
    // 同じ時刻の発話が上限より多いと、幅 0 の窓になる
    const same = []; for (let k = 0; k < 45; k++) same.push(3000);
    x = mkN(30, same, { fixed: true });
    x.c.setLastT1(3000);
    w = x.c.tick(3030);
    t('刻み', '同じ時刻（50:00）の 45 発話: 最初の窓は幅 0（50:00〜50:00）で発話 1〜40', w && w.t.join() === '3000,3000' && w.lines.join() === '1,40', show(w));
    w = x.c.ready(3030);
    t('刻み', '残りの 5 発話は 50:00〜50:30（返事を書き終えた時点で閉じる）', w && w.t.join() === '3000,3030' && w.lines.join() === '41,45', show(w));
    // 上限の 41 件目と同じ時刻の発話が窓の中にあれば、その同じ時刻の塊の手前で切る（窓は 40 件未満。4 回目の指摘）
    const blk = []; for (let k = 0; k < 36; k++) blk.push(Math.floor(k / 2)); for (let k = 0; k < 9; k++) blk.push(20); blk.push(55);
    x = mkN(30, blk, { fixed: true });
    w = x.c.tick(30);
    t('刻み', '0:00〜0:17 の 36 発話と 0:20 の 9 発話: 41 件目（0:20）と同じ時刻の塊（発話 37〜40）の手前で切り、窓は 0:00〜0:20 で発話 1〜36', w && w.t.join() === '0,20' && w.lines.join() === '1,36' && w.items.length === 36 && x.c.pendingCount() === 10, show(w));
    t('刻み', 'その窓の発話は、どれも窓の終わり（0:20）より前', w && w.items.every(function (l) { return l.t < w.t[1]; }), show(w));
    x.c.ready(30);
    w = x.c.tick(50);
    t('刻み', '次の窓は 0:20 から始まり、同じ時刻の残り（発話 37〜45）を含む（0:20〜0:50）', w && w.t.join() === '20,50' && w.lines.join() === '37,45', show(w));
    const ten = []; for (let k = 0; k < 45; k++) ten.push(10);
    x = mkN(30, ten, { fixed: true });
    w = x.c.tick(30);
    t('刻み', '0:10 に 45 発話（直前の窓の終わりは 0:00）: 塊が窓の最初の発話から始まるので、幅 0 の窓 0:10〜0:10 に発話 1〜40', w && w.t.join() === '10,10' && w.lines.join() === '1,40', show(w));
    w = x.c.ready(40);
    t('刻み', '次の窓は 0:10 から始まり、同じ時刻の残り（発話 41〜45）を渡す（0:10〜0:40）', w && w.t.join() === '10,40' && w.lines.join() === '41,45', show(w));
    // 遅れて届いた発話（時刻が窓の始まりより前）で上限に当たったときは、始まりより前には縮めず、幅 0 の窓 [始まり, 始まり] に 40 件
    // （rt.py の compute_window と同じ。cases 123・124）
    const lateRun = function (times) {
      const c = CUT.makeCutter({ window: 30, factor: 3, maxLines: 40, fixed: false });
      c.push({ i: 1, t: 1 });
      const w1 = c.tick(30);
      c.ready(30);
      times.forEach(function (x, k) { c.push({ i: k + 2, t: x }); });
      const w2 = c.tick(60);
      const w3 = c.ready(60);
      return [w1, w2, w3];
    };
    const sameLate = []; for (let k = 0; k < 45; k++) sameLate.push(20);
    let ws = lateRun(sameLate);
    t('刻み', '0:30 より後に届いた 0:20 の 45 発話: 窓は 0:30〜0:30 に発話 2〜41（始まりより前には縮めない）', ws[0] && ws[0].t.join() === '0,30' && ws[1] && ws[1].t.join() === '30,30' && ws[1].lines.join() === '2,41', show(ws[1]));
    t('刻み', '次の窓は 0:30 から始まり、残り（発話 42〜46）を渡す', ws[2] && ws[2].t.join() === '30,60' && ws[2].lines.join() === '42,46', show(ws[2]));
    const mixLate = []; for (let k = 0; k < 39; k++) mixLate.push(19); mixLate.push(20, 20, 20);
    ws = lateRun(mixLate);
    t('刻み', '遅れて届いた 0:19 の 39 発話と 0:20 の 3 発話: 41 件目と同じ時刻の発話が窓の中にあっても、0:30〜0:30 に 40 件', ws[1] && ws[1].t.join() === '30,30' && ws[1].lines.join() === '2,41' && ws[1].items.length === 40, show(ws[1]));
    const thenLate = []; for (let k = 0; k < 40; k++) thenLate.push(20); thenLate.push(50);
    ws = lateRun(thenLate);
    t('刻み', '遅れて届いた 0:20 の 40 発話のあと 41 件目が 0:50: 窓は 0:30〜0:50 に縮める（幅 0 にはしない）', ws[1] && ws[1].t.join() === '30,50' && ws[1].lines.join() === '2,41', show(ws[1]));
    // どんな並びでも、窓は「t[0] ≦ 発話.t ＜ t[1]」か「幅 0 の窓に同じ時刻の 40 件ちょうど」のどちらか（決まった種の擬似乱数で 300 通り）
    (function () {
      let seed = 12345;
      const rnd = function (n) { seed = (seed + 0x6D2B79F5) | 0; let z = Math.imul(seed ^ (seed >>> 15), 1 | seed); z ^= z + Math.imul(z ^ (z >>> 7), 61 | z); return ((z ^ (z >>> 14)) >>> 0) % n; };
      const bad = [];
      for (let trial = 0; trial < 300 && bad.length < 3; trial++) {
        // 1 秒に数件の発話・ときどき大きく飛ぶ時刻・ときどき同じ時刻に 20〜69 件が固まる塊
        const ts = [];
        const n0 = 30 + rnd(220);
        let tt = rnd(5);
        while (ts.length < n0) {
          const r = rnd(40);
          if (r === 0) tt += 1 + rnd(40); else if (r < 6) tt += 1;
          else if (r === 6) { const b = 20 + rnd(80); for (let k = 0; k < b; k++) ts.push(tt); continue; }
          ts.push(tt);
        }
        const n = ts.length;
        const fixed = rnd(2) === 0;
        const xx = mkN(30, ts, { fixed: fixed });
        let nowT = 0, prevT1 = 0, seen = 0;
        for (let guard = 0; guard < 2000 && seen < n; guard++) {
          nowT += 1 + rnd(90);
          let ww = xx.c.tick(nowT);
          while (ww) {
            const ok = ww.t[0] >= prevT1 && (ww.t[1] > ww.t[0]
              ? ww.items.every(function (l) { return l.t >= ww.t[0] && l.t < ww.t[1]; })
              : ww.items.length === 40 && ww.items.every(function (l) { return l.t === ww.t[0]; }));
            if (!ok) bad.push({ fixed: fixed, t: ww.t, ts: ww.items.map(function (l) { return l.t; }).slice(0, 5), n: ww.items.length });
            if (ww.lines[0] !== seen + 1) bad.push({ gap: ww.lines, seen: seen });
            seen = ww.lines[1]; prevT1 = ww.t[1];
            ww = xx.c.ready(nowT);
          }
        }
        if (seen !== n) bad.push({ unfinished: seen, n: n });
      }
      t('刻み', 'どの窓も「t[0] ≦ 発話.t ＜ t[1]」か「幅 0 の窓に同じ時刻の 40 件ちょうど」で、発話は番号の順に全部渡る（300 通り）', bad.length === 0, JSON.stringify(bad).slice(0, 400));
    })();
    // 窓の始まりを刻みで進める割り算は rt.py と同じ（始まり 0:19.5 のあと 0:49.7 の発話 → 始まりは 0:49.5）
    x = mkN(30, [], { fixed: true });
    x.c.setLastT1(19.5);
    x.c.push({ i: 1, t: 49.7 });
    t('刻み', '縮めた終わり（0:19.5）から刻みで進める: 0:49.7 の発話の窓は 0:49.5〜1:19.5', x.c.windowEnd() === 79.5, String(x.c.windowEnd()));
    // 窓の幅は整数の秒
    let threw = null;
    try { CUT.makeCutter({ window: 7.5 }); } catch (e) { threw = e.message; }
    t('刻み', '窓の幅が整数でなければ例外（画面の欄で先に断る）', threw && /整数/.test(threw), String(threw));
    x = mkN(30, [1, 2, 3, 4, 5], { maxLines: 2 });
    w = x.c.tick(30);
    t('刻み', '上限は渡した値に従う（2 件なら発話 1〜2）', w && w.lines.join() === '1,2' && x.c.maxLines() === 2, show(w));
    // 時刻の打ち間違い（15 番目だけ 50:00）と、そのあとの戻り: 受け取るときに単調にし、窓は 40 件ずつ
    const typo = []; for (let k = 0; k < 150; k++) typo.push(k === 14 ? 3000 : (k + 1) * 20);
    x = mkN(30, typo);
    const seen = [];
    let now = 0;
    // 返事を書き終えた（ready）時点で次の窓が閉じることもある（幅 0 の窓のあと）ので、閉じた窓は全部受け取る
    const takeAll = function (ww) { while (ww) { ww.items.forEach(function (l) { seen.push(l.i); }); ww = x.c.ready(now); } };
    for (let guard = 0; guard < 400 && seen.length < 150; guard++) {
      now += 30;
      takeAll(x.c.tick(now));
    }
    const wins = x.got.map(function (ww) { return { t: ww.t, lines: ww.lines, n: ww.items.length, ts: ww.items.map(function (l) { return l.t; }) }; });
    const after = wins.filter(function (ww) { return ww.lines[0] >= 15; });
    t('刻み', '時刻の打ち間違いのあとも、どの窓も 40 発話まで', wins.every(function (ww) { return ww.n <= 40; }) && after.length >= 4, JSON.stringify(wins.map(function (ww) { return [ww.t, ww.lines]; })).slice(0, 300));
    t('刻み', '発話は番号の順に 1 度ずつ全部渡る', seen.length === 150 && seen.every(function (i, k) { return i === k + 1; }), seen.length + ' 件');
    t('刻み', '戻った時刻は直前の時刻（50:00）に揃えた写しで渡る', after.every(function (ww) { return ww.ts.every(function (tt) { return tt === 3000; }); }), JSON.stringify(after.map(function (ww) { return ww.ts.slice(0, 3); })));
    const orig = { i: 2, t: 10 };
    const cm = CUT.makeCutter({ window: 30 });
    cm.push({ i: 1, t: 20 }); cm.push(orig);
    w = cm.tick(30);
    t('刻み', '揃えるのは写しで、渡された発話そのものは書き換えない', orig.t === 10 && w && w.items[1].t === 20 && w.items[1] !== orig, show(w));
  })();

  report();
})().catch(function (e) { console.error('試験そのものが例外で止まりました: ' + (e && e.stack || e)); process.exit(1); });

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
