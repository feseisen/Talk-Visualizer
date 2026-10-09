/*
 * _runner.js — verify.js と fold.js の試験（ブラウザと node で同じものを走らせる）
 *
 * 入口: runAll({makeVerifier, fold: fold.js の api}, data) → [{group, name, ok, detail}]
 *   data は tests/_data.js（tools/make_test_data.py が作る）
 *
 * 試験の群:
 *   1. cases      tests/cases/*.json を verify に通し、受理／拒否・規則の id・警告・押した at が期待どおりか。
 *                 forbid_rules にある規則の文が出ていないか。入力を変えていないか
 *   2. fold       fixture を 1 ステップずつ foldInc で畳み、全量 fold（壁時計 at で切る／素材時間 t で切る）と一致するか。
 *                 要約が fixtures/meeting10.status.json と一致するか
 *   3. R1         畳むたびに、行（カード・括り）の t が上から単調非減少か。挿入だけで並べ替えていないか（前の並びが部分列として残る）
 *   4. rebuild    fixture を 1 ステップずつ verify に通して全部受理され、押した at・埋めた was が記録と一字も違わないか。警告はステップ 3 の P25 が 1 件だけか
 *   5. 単体        採番（列名）・共通部分の長さ
 */
(function () {
  'use strict';

  function deepEq(a, b) { return canon(a) === canon(b); }
  // 鍵の順に依らない比較
  function canon(x) {
    if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(function (k) { return JSON.stringify(k) + ':' + canon(x[k]); }).join(',') + '}';
    return JSON.stringify(x);
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function splitBatches(events) {
    const batches = []; let cur = null;
    events.forEach(function (e) {
      if (e.e === 'open' || e.e === 'step' || e.e === 'end' || e.e === 'pause') { cur = [e]; batches.push(cur); }
      else if (cur) cur.push(e);
    });
    return batches;
  }

  function runCases(makeVerifier, data) {
    const out = [];
    const verify = makeVerifier(data.rules);
    data.cases.forEach(function (c) {
      const log = clone(c.log_prefix), batch = clone(c.batch);
      const before = JSON.stringify(log) + '|' + JSON.stringify(batch);
      let r, detail = [];
      try {
        r = verify(log, batch, { now: c.clock, src: c.src, window: c.window });
      } catch (err) {
        out.push({ group: '検査', name: c._file + ' ' + c.name, ok: false, detail: '例外: ' + (err && err.stack || err) });
        return;
      }
      const got = r.ok ? 'accept' : 'reject';
      let ok = got === c.expect;
      if (!ok) detail.push('期待 ' + c.expect + ' / 結果 ' + got);
      if (c.expect === 'reject') {
        if (!r.errors.some(function (m) { return m.indexOf(c.expect_rule + ':') === 0; })) { ok = false; detail.push('規則 ' + c.expect_rule + ' の違反文が無い'); }
        // forbid_rules: 出てはいけない規則（欄の形の失敗の後の連鎖の文など）。test_rt.py と同じく、警告も含めて見る
        (c.forbid_rules || []).forEach(function (fr) {
          if (r.errors.concat(r.warnings).some(function (m) { return m.indexOf(fr + ':') === 0; })) { ok = false; detail.push('規則 ' + fr + ' の文があってはいけない'); }
        });
        if (r.batch !== null) { ok = false; detail.push('拒否なのに batch が返っている'); }
      } else {
        if (c.expect_warn && !r.warnings.some(function (m) { return m.indexOf(c.expect_warn + ':') === 0; })) { ok = false; detail.push('警告 ' + c.expect_warn + ' が無い'); }
        if (c.expect_step_at) {
          const s = (r.batch || []).filter(function (e) { return e.e === 'step'; })[0];
          if (!s || s.at !== c.expect_step_at) { ok = false; detail.push('step.at が ' + (s && s.at) + '（期待 ' + c.expect_step_at + '）'); }
        }
        if (r.ok && (!r.batch || r.batch.length !== batch.length)) { ok = false; detail.push('受理なのに batch の件数が違う'); }
      }
      if (JSON.stringify(log) + '|' + JSON.stringify(batch) !== before) { ok = false; detail.push('入力（ログか追記）を変えてしまった'); }
      const msgs = r.errors.concat(r.warnings.map(function (w) { return '（警告）' + w; }));
      out.push({ group: '検査', name: c._file + ' ' + c.name, ok: ok, detail: (detail.length ? detail.join('；') + ' ' : '') + msgs.join(' / ') });
    });
    return out;
  }

  function runFold(F, data) {
    const out = [];
    const events = data.fixture;
    const batches = splitBatches(events);
    const expect = data.status.steps || [];
    let inc = F.initState();
    let prevRows = [];
    let stepIdx = 0;
    const seenCards = {};
    batches.forEach(function (b, bi) {
      inc = F.foldInc(inc, b);
      const head = b[0];
      // 3. R1: t が上から単調非減少、挿入だけ
      const ts = inc.rows.map(function (r) { return r.t; });
      let mono = true;
      for (let i = 1; i < ts.length; i++) if (ts[i] < ts[i - 1]) mono = false;
      const ids = inc.rows.map(function (r) { return r.k + ':' + r.id; });
      let sub = true, j = 0;
      for (let i = 0; i < ids.length && j < prevRows.length; i++) if (ids[i] === prevRows[j]) j++;
      if (j !== prevRows.length) sub = false;
      out.push({ group: '並び（R1）', name: '追記 ' + (bi + 1) + '（' + head.e + (head.n != null ? ' ' + head.n : '') + '）: 行 ' + ids.length + ' 本、t が単調非減少で、前の並びが残っている', ok: mono && sub, detail: mono ? (sub ? 't: ' + ts.join(',') : '前の並びが崩れた') : 't が逆行: ' + ts.join(',') });
      prevRows = ids;
      if (head.e !== 'step') return;
      stepIdx++;
      // 2. 全量 vs 増分
      const byAt = F.fold(events, head.at);
      const nextIsEndAtSameT = batches[bi + 1] && batches[bi + 1][0].e === 'end' && batches[bi + 1][0].t <= head.t[1];
      const byT = nextIsEndAtSameT ? null : F.fold(events, head.t[1]);
      const okAt = deepEq(byAt, inc);
      const okT = byT === null ? true : deepEq(byT, inc);
      out.push({ group: '畳み込み', name: 'S' + head.n + ': 増分 ＝ 全量（壁時計 ' + head.at + ' で切る）', ok: okAt, detail: okAt ? 'イベント ' + inc.count + ' 件' : '一致しない' });
      out.push({ group: '畳み込み', name: 'S' + head.n + ': 増分 ＝ 全量（素材時間 ' + head.t[1] + ' 秒で切る）', ok: okT, detail: byT === null ? '（end が同じ時刻にあるので壁時計の側だけで見る）' : (okT ? 'イベント ' + inc.count + ' 件' : '一致しない') });
      // 要約の期待値
      const s = F.summary(inc);
      const e = expect[stepIdx - 1];
      const okS = e ? deepEq(s, e) : false;
      out.push({ group: '畳み込み', name: 'S' + head.n + ': 要約が期待値どおり（開いている保留・最上位・括り・数え上げ・決着）', ok: okS, detail: okS ? '保留 ' + s.open_holds.join(',') + ' / 最上位 ' + s.top + ' / 括り ' + Object.keys(s.groups).map(function (g) { return g + '[' + s.groups[g].span.join('〜') + ']'; }).join(' ') : '結果 ' + JSON.stringify(s) + ' 期待 ' + JSON.stringify(e) });
      // 出現と位置: 新しく出たカードの t はこのステップの終わり以下で、出現はこのステップ
      Object.keys(inc.cards).forEach(function (id) {
        if (seenCards[id]) return; seenCards[id] = true;
        const c = inc.cards[id];
        if (c.sn !== head.n || c.t > head.t[1]) out.push({ group: '畳み込み', name: 'S' + head.n + ': カード ' + id + ' の出現と位置', ok: false, detail: 'sn=' + c.sn + ' t=' + c.t });
      });
    });
    // 最後: 増分の最終状態 ＝ 全量（T 無し）
    const all = F.fold(events);
    out.push({ group: '畳み込み', name: '最後まで: 増分 ＝ 全量（T 無し）', ok: deepEq(all, inc), detail: 'ステップ ' + inc.n + '、end ' + (inc.ended ? 'あり' : 'なし') });
    // README に書かれた見どころ
    const c10 = inc.cards.C10, h3 = inc.holds.H3, h4 = inc.holds.H4, h7 = inc.holds.H7, E = inc.groups.E, c15 = inc.cards.C15, B = inc.groups.B, A = inc.groups.A;
    const checks = [
      ['C10 は位置 t:169、出現はステップ 7', c10 && c10.t === 169 && c10.sn === 7 && c10.at === '2026-10-07T09:03:00Z'],
      ['H3 は 2 回閉じる（5:38 と 8:39）。1つ目で閉じ、2つ目は答えとして足す', h3 && h3.answers.length === 2 && h3.answers[0].t === 338 && h3.answers[1].t === 519 && h3.closed.t === 338],
      ['H4（gap）は決着の統計に入らず、ステップ 7 で C10 により閉じる', h4 && h4.kind === 'gap' && h4.closed && h4.closed.sn === 7 && h4.answers[0].by[0] === 'C10' && F.settled(inc).count === 7],
      ['H7 は開いたまま終わる', h7 && !h7.closed && F.openHolds(inc).length === 1],
      ['E は retro。印は 7:08、範囲 6:31〜7:14', E && E.kind === 'retro' && E.t === 428 && E.span[0] === 391 && E.span[1] === 434],
      ['最上位は C4 → C15 → C34', inc.tops.join(',') === 'C4,C15,C34' && inc.top.id === 'C34'],
      ['C15 は fix(d) で深さ 0 → 1。書いた時点の値は orig に残る', c15 && c15.d === 1 && c15.orig.d === 0 && c15.fixes.length === 1 && c15.fixes[0].sn === 19],
      ['B の仮名は 3:01 に確定。echo は A に 2 回、B に 1 回', B && B.lb === '価値をどう説明するか' && B.lb0 === '（仮）値段の話の向きが変わる' && B.renames.length === 1 && B.renames[0].t === 181 && A.echoes.length === 2 && B.echoes.length === 1],
      ['L1 の at_item は最後に指されたカードの番目（C34・C35 は li 無しなので 1 のまま）', inc.lists.L1 && inc.lists.L1.at_item === 1],
      ['次の id は C36 / H10 / L2 / F', deepEq(F.nextIds(inc), { card: 'C36', hold: 'H10', list: 'L2', group: 'F' })]
    ];
    checks.forEach(function (ck) { out.push({ group: '畳み込み', name: ck[0], ok: !!ck[1], detail: '' }); });
    return out;
  }

  function runRebuild(makeVerifier, data) {
    const out = [];
    const verify = makeVerifier(data.rules);
    const batches = splitBatches(data.fixture);
    let log = [], warnings = [], allOk = true, diffs = [];
    batches.forEach(function (b) {
      const head = b[0];
      const r = verify(log, clone(b), { now: head.at || '2026-10-07T08:59:30Z', src: data.src });
      if (!r.ok) { allOk = false; out.push({ group: '作り直し', name: '追記 ' + head.e + (head.n != null ? ' ' + head.n : '') + ' が拒否された', ok: false, detail: r.errors.join(' / ') }); return; }
      if (!deepEq(r.batch, b)) diffs.push('S' + head.n);
      r.warnings.forEach(function (w) { warnings.push('S' + (head.n != null ? head.n : head.e) + ' ' + w); });
      log = log.concat(r.batch);
    });
    out.push({ group: '作り直し', name: 'fixture の ' + batches.length + ' 回の追記がすべて受理される', ok: allOk, detail: '' });
    out.push({ group: '作り直し', name: '押した at・埋めた was を含めて、記録と一字も違わない', ok: diffs.length === 0, detail: diffs.length ? '違うステップ: ' + diffs.join(',') : log.length + ' 行' });
    const okW = warnings.length === 1 && warnings[0].indexOf('S3 P25:') === 0;
    out.push({ group: '作り直し', name: '警告はステップ 3 の P25（H2 と C5 の「三社目の反」）1 件だけ', ok: okW, detail: warnings.join(' / ') });
    out.push({ group: '作り直し', name: 'end の後には何も追記できない（P21）', ok: !verify(log, [{ e: 'step', n: 21, lines: [101, 102], t: [600, 630] }, { e: 'note', t: 630, x: 'x' }], { now: '2026-10-07T09:10:00Z' }).ok, detail: '' });
    return out;
  }

  function runUnits(V, F) {
    const out = [];
    const cols = [[1, 'A'], [26, 'Z'], [27, 'AA'], [52, 'AZ'], [53, 'BA'], [702, 'ZZ'], [703, 'AAA']];
    const okCol = cols.every(function (p) { return F.colName(p[0]) === p[1] && V.colName(p[0]) === p[1]; });
    out.push({ group: '単体', name: '括りの id（表計算の列名）: 1→A、26→Z、27→AA、52→AZ、53→BA、702→ZZ、703→AAA', ok: okCol, detail: cols.map(function (p) { return p[0] + '→' + F.colName(p[0]); }).join(' ') });
    const okCommon = V.commonLen('費用の上限はいくらか', '費用の上限は十万円') === 6 && V.commonLen('abc', 'xyz') === 0 && V.commonLen('三社目の反対にどう答えるのか', '数字は分かるが三社目の反応が') === 5;
    out.push({ group: '単体', name: '共通部分の長さ（P25）', ok: okCommon, detail: '' });
    const st = F.foldInc(F.initState(), [{ e: 'open', v: 2, name: 'x', t0: '2026-10-07T00:00:00Z', mode: 'live', window: 30, known: '' }, { e: 'step', n: 1, lines: [1, 1], t: [0, 30], at: '2026-10-07T00:00:30Z' }, { e: 'card', id: 'C1', t: 20, d: 0, role: 'claim', who: null, src: [1], ti: 'a', b: '' }, { e: 'card', id: 'C2', t: 10, d: 0, role: 'claim', who: null, src: [1], ti: 'b', b: '' }, { e: 'card', id: 'C3', t: 10, d: 0, role: 'claim', who: null, src: [1], ti: 'c', b: '' }, { e: 'note', t: 30, x: 'x' }]);
    out.push({ group: '単体', name: '行の挿入: 後から来た過去の t は手前に入り、同じ t は到着順', ok: st.rows.map(function (r) { return r.id; }).join(',') === 'C2,C3,C1', detail: st.rows.map(function (r) { return r.id + '@' + r.t; }).join(' ') });
    const base = F.initState();
    const after = F.foldInc(base, [{ e: 'open', v: 2, name: 'x', t0: '2026-10-07T00:00:00Z', mode: 'live', window: 30, known: '' }]);
    out.push({ group: '単体', name: 'foldInc は元の状態を変えない', ok: base.open === null && after.open !== null, detail: '' });
    return out;
  }

  function runAll(deps, data) {
    let out = [];
    out = out.concat(runCases(deps.makeVerifier, data));
    out = out.concat(runFold(deps.fold, data));
    out = out.concat(runRebuild(deps.makeVerifier, data));
    out = out.concat(runUnits(deps.verifyApi, deps.fold));
    return out;
  }

  const api = { runAll: runAll, runCases: runCases, runFold: runFold, runRebuild: runRebuild, runUnits: runUnits, splitBatches: splitBatches };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TSV_TESTS = api;
})();
