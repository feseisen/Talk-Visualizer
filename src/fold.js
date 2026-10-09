/*
 * fold.js — 判断ログを畳み込んで「時刻 T の状態」を作る純粋関数
 *
 * やること:
 *   - ログを先頭から順に畳み、カード・保留・括り・数え上げ・最上位・所感の状態を作る
 *   - rename を扱う（括りの名前の現在値と履歴）
 *   - card への fix（d / ti / b / role）を状態に反映する
 *   - 並ぶ位置は card.t、画面に出る時刻はそのカードを書き込んだ step で決める（二つを混ぜない）
 *   - 増分で畳める形（foldInc）を持ち、全量（fold）と同じ結果になることを試験で縛る
 *
 * 規則（docs/rules.md の R1・R2b）:
 *   R1  縦の並びは t の位置に挿入するだけ。並べ替え関数を持たない
 *   R2b 時刻 T の状態に入れるのは、その時点で書き終わっていたステップの結果に限る
 *
 * 使い方:
 *   const st  = fold(events, T);          // 時刻 T の時点で書き終わっていたステップだけを畳む。T 省略で全量
 *   const st2 = foldInc(st, newEvents);   // 前の状態に新しいイベントを足す（元の状態は変えない）
 *
 * T の意味（どちらも「ステップ単位」で畳む。カード等は自分の t では切らず、自分を書き込んだ step に従う）:
 *   - 数        素材時間（秒）。step.t[1]（その窓で聞き終えた時刻）が T 以下のステップを入れる。
 *               end / pause は自分の t が T 以下なら入れる
 *   - 文字列    壁時計（ISO 8601 UTC。例 "2026-10-07T09:03:00Z"）。step.at が T 以下のステップを入れる。
 *               end / pause は自分の at で見る。比べるのは時刻そのもの（Date.parse）なので、
 *               "…:00Z" と "…:00.000Z" のように形が違っても同じ瞬間なら同じ扱い。
 *               at の無い記録（v1 の step）は壁時計では一つも「書き終えた」と判定できないので、
 *               文字列の T では open だけの状態になる。v1 の記録は数（素材時間）の T で切ること
 *   - 省略      全量
 *   どちらの T でも、あるステップを入れたらその後ろに並ぶカード・保留・訂正などは全部入れ、
 *   入れないステップの後ろは次の step まで全部外す（R2b: 書き終えていないステップの結果を出さない）。
 *   open は常に入れる。
 *
 * 版: open を畳むとき verify.js の TSV_VERIFY.versionOf(open) で決める（1 か 2。知らない版は null）。
 *   自前で open.v を読まない。verify.js が無ければ Error を投げる（黙って既定にしない）。
 *   node では require("./verify.js")、ブラウザでは globalThis.TSV_VERIFY（fold.js より先に読み込む）
 *
 * 状態は JSON にできる素のオブジェクト（Map / Set を使わない）。ただし id で引く表（cards / holds / groups / lists）は
 * 原型の無いオブジェクト（Object.create(null)）で持ち、在るかどうかは自前の欄かどうかで見る。
 * constructor・toString・__proto__ のような id でも「在る」と誤らず、__proto__ という id で原型を書き換えない。
 * foldInc で写したあとも表は原型の無いオブジェクトに戻す（写すと素のオブジェクトになるため）。
 * ブラウザでは globalThis.TSV_FOLD、node では module.exports に同じものを出す。
 */
(function () {
  'use strict';

  // ---- 状態の形 ----

  // id で引く表。原型が無いので、constructor などの名前も「無い」と分かり、__proto__ も普通の鍵として入る
  function table(from) {
    const o = Object.create(null);
    if (from) Object.keys(from).forEach(function (k) { o[k] = from[k]; });
    return o;
  }
  const HAS = Object.prototype.hasOwnProperty;
  function own(o, k) { return o != null && HAS.call(o, k) ? o[k] : undefined; }
  const TABLES = ['cards', 'holds', 'groups', 'lists'];

  // 版の判定は verify.js に任せる（規則表だけが版を知っている）。無ければ分かる文で止める
  let verifyApi = null;
  function versionOf(openEv) {
    if (!verifyApi) {
      if (typeof module !== 'undefined' && module.exports && typeof require === 'function') verifyApi = require('./verify.js');
      else if (typeof globalThis !== 'undefined' && globalThis.TSV_VERIFY) verifyApi = globalThis.TSV_VERIFY;
      else throw new Error('verify.js が読み込まれていないので版を判定できません（fold.js より先に verify.js を読み込む）');
    }
    return verifyApi.versionOf(openEv);
  }

  function initState() {
    return {
      v: null,          // 版（verify.js の versionOf。1 か 2。知らない版は null）
      open: null,       // open イベントそのもの
      n: 0,             // いちばん新しい書き終わったステップの番号
      step: null,       // いちばん新しい書き終わったステップ {n, lines, t, at}
      cards: table(),   // id -> カード（現在値。訂正の履歴は fixes）
      holds: table(),   // id -> 保留（答えの履歴は answers。閉じた瞬間は closed）
      groups: table(),  // id -> 括り（現在の span / lb。履歴は fixes / renames / echoes）
      lists: table(),   // id -> 数え上げ（現在の n / items。at_item は最後に指された番目）
      rows: [],         // 縦の並び。{k:'c'|'g', id, t, sn, at, seen}。t の位置に挿入するだけ
      top: null,        // 最上位候補 {id, prev, why, t, sn, at, seen}
      tops: [],         // これまでに最上位になったカードの id（順）
      swaps: 0,         // 最上位の入れ替わりの回数
      notes: [],        // 最後のステップの所感 [{t, x, sn}]
      ended: null,      // end {t, at}
      paused: null,     // 直近の pause（次の step で消える）{t, why, at}
      pauses: [],       // すべての pause
      count: 0          // 畳んだイベントの数
    };
  }

  // 出現の情報。sn＝書いたステップ番号、at＝そのステップの壁時計（v1 は null）、seen＝そのステップで聞き終えた素材時間
  function appear(st) {
    const s = st.step;
    return s ? { sn: s.n, at: s.at == null ? null : s.at, seen: s.t[1] } : { sn: 0, at: null, seen: null };
  }

  // 行を t の位置に挿入する。同じ t は到着順（後から来たものが後ろ）。並べ替えはしない（R1）
  function insertRow(rows, row) {
    let i = rows.length;
    while (i > 0 && rows[i - 1].t > row.t) i--;
    rows.splice(i, 0, row);
  }

  function clone(x) {
    if (typeof structuredClone === 'function') return structuredClone(x);
    return JSON.parse(JSON.stringify(x));
  }

  // ---- 1イベントを状態に足す ----

  function apply(st, e) {
    st.count++;
    const k = e.e;
    if (k === 'open') {
      st.open = clone(e);
      st.v = versionOf(e);
      return;
    }
    if (k === 'step') {
      st.step = { n: e.n, lines: e.lines.slice(), t: e.t.slice(), at: e.at == null ? null : e.at };
      st.n = e.n;
      st.notes = [];
      st.paused = null; // 再開は次の step がそのまま表す
      return;
    }
    if (k === 'end') { st.ended = { t: e.t, at: e.at == null ? null : e.at }; return; }
    if (k === 'pause') {
      const p = { t: e.t, why: e.why == null ? '' : e.why, at: e.at == null ? null : e.at };
      st.paused = p; st.pauses.push(clone(p));
      return;
    }
    const ap = appear(st);
    if (k === 'card') {
      const c = {
        id: e.id, t: e.t, d: e.d, role: e.role,
        who: e.who == null ? null : e.who,
        src: Array.isArray(e.src) ? e.src.slice() : [],
        li: Array.isArray(e.li) ? e.li.slice() : null,
        ti: e.ti, b: e.b,
        sn: ap.sn, at: ap.at, seen: ap.seen,
        orig: { d: e.d, role: e.role, ti: e.ti, b: e.b }, // 書いた時点の値（訂正は fixes に積む）
        fixes: []
      };
      st.cards[e.id] = c;
      insertRow(st.rows, { k: 'c', id: e.id, t: e.t, sn: ap.sn, at: ap.at, seen: ap.seen });
      const l = c.li ? own(st.lists, c.li[0]) : undefined;
      if (l) l.at_item = c.li[1];
      return;
    }
    if (k === 'hold') {
      st.holds[e.id] = {
        id: e.id, t: e.t, who: e.who == null ? null : e.who, q: e.q,
        kind: e.kind == null ? null : e.kind,
        sn: ap.sn, at: ap.at, seen: ap.seen,
        answers: [], closed: null
      };
      return;
    }
    if (k === 'close') {
      const h = own(st.holds, e.id);
      if (!h) return; // 検査器が通した記録には無い。畳む側は黙って無視する
      const a = { t: e.t, as: e.as, by: Array.isArray(e.by) ? e.by.slice() : [], sn: ap.sn, at: ap.at, seen: ap.seen };
      h.answers.push(a); // 最初の答えで保留は閉じる。その後の答えも前の答えを残したまま、順に並べる（穴 4）
      if (!h.closed) h.closed = { t: e.t, sn: ap.sn, at: ap.at, seen: ap.seen };
      return;
    }
    if (k === 'group') {
      st.groups[e.id] = {
        id: e.id, t: e.t, span: e.span.slice(), lb: e.lb, kind: e.kind,
        sn: ap.sn, at: ap.at, seen: ap.seen,
        span0: e.span.slice(), lb0: e.lb,
        fixes: [], renames: [], echoes: []
      };
      insertRow(st.rows, { k: 'g', id: e.id, t: e.t, sn: ap.sn, at: ap.at, seen: ap.seen });
      return;
    }
    if (k === 'fix') {
      const f = e.field;
      let target = null;
      if (f === 'd' || f === 'ti' || f === 'b' || f === 'role') target = own(st.cards, e.id);
      else if (f === 'span') target = own(st.groups, e.id);
      else if (f === 'items' || f === 'n') target = own(st.lists, e.id);
      if (!target) return;
      const was = (e.was === undefined) ? clone(target[f]) : clone(e.was);
      target[f] = clone(e.now);
      target.fixes.push({ field: f, was: was, now: clone(e.now), why: e.why == null ? '' : e.why, t: e.t, sn: ap.sn, at: ap.at, seen: ap.seen });
      return;
    }
    if (k === 'rename') {
      const g = own(st.groups, e.id);
      if (!g) return;
      const was = (e.was === undefined) ? g.lb : e.was;
      g.lb = e.now;
      g.renames.push({ was: was, now: e.now, t: e.t, sn: ap.sn, at: ap.at, seen: ap.seen });
      return;
    }
    if (k === 'top') {
      st.top = { id: e.id, prev: e.prev == null ? null : e.prev, why: e.why == null ? '' : e.why, t: e.t, sn: ap.sn, at: ap.at, seen: ap.seen };
      st.swaps++;
      if (st.tops.indexOf(e.id) < 0) st.tops.push(e.id);
      return;
    }
    if (k === 'echo') {
      const g = own(st.groups, e.id);
      if (!g) return;
      g.echoes.push({ t: e.t, why: e.why == null ? '' : e.why, sn: ap.sn, at: ap.at, seen: ap.seen });
      return;
    }
    if (k === 'note') {
      st.notes.push({ t: e.t, x: e.x, sn: ap.sn });
      return;
    }
    if (k === 'list') {
      st.lists[e.id] = {
        id: e.id, t: e.t, who: e.who == null ? null : e.who, n: e.n,
        items: Array.isArray(e.items) ? e.items.slice() : [],
        sn: ap.sn, at: ap.at, seen: ap.seen,
        fixes: [], at_item: null
      };
      return;
    }
    // 知らない種類は無視する（検査器が先に落としている前提）
  }

  // ---- 入口 ----

  // 前の状態に新しいイベントを足す。元の状態は変えない
  function foldInc(state, events) {
    const st = clone(state || initState());
    TABLES.forEach(function (k) { st[k] = table(st[k]); }); // 写すと素のオブジェクトになるので、原型の無い表に戻す
    for (const e of events) apply(st, e);
    return st;
  }

  // 壁時計 a が b 以下か。時刻そのもので比べる（"…:00Z" と "…:00.000Z" は同じ瞬間）。読めない文字列なら文字列として比べる
  function clockLE(a, b) {
    const x = Date.parse(a), y = Date.parse(b);
    if (isFinite(x) && isFinite(y)) return x <= y;
    return String(a) <= String(b);
  }

  // そのステップ（または end / pause）が T までに書き終わっているか
  function doneBy(e, T) {
    if (T == null) return true;
    if (typeof T === 'string') return e.at != null && clockLE(e.at, T);  // 壁時計（at の無い v1 の step は入らない）
    return e.t != null && (Array.isArray(e.t) ? e.t[1] : e.t) <= T;      // 素材時間
  }

  // 全量。時刻 T の時点で書き終わっていたステップ（と end / pause）の結果だけを畳む。
  // 判定はステップ単位: step を入れるかどうかを doneBy で決め、その後ろのイベントはその step に従う（自分の t では切らない）
  function fold(events, T) {
    const st = initState();
    let include = true;
    for (const e of events) {
      if (e.e === 'open') { apply(st, e); continue; }
      if (e.e === 'step') include = doneBy(e, T);
      else if (e.e === 'end' || e.e === 'pause') include = doneBy(e, T);
      if (include) apply(st, e);
    }
    return st;
  }

  // ---- 状態から導くもの ----

  function numOf(id) { const m = /\d+$/.exec(id); return m ? Number(m[0]) : 0; }

  // 開いている保留。古い順（t、同じなら id の番号）
  function openHolds(st) {
    return Object.keys(st.holds).map(function (id) { return st.holds[id]; })
      .filter(function (h) { return !h.closed; })
      .sort(function (a, b) { return a.t - b.t || numOf(a.id) - numOf(b.id); });
  }

  // 決着した保留の統計。kind:"gap" は入れない。同じ保留に答えが2つあれば1つ目で数える。中央値は下側（rt.py と同じ）
  function settled(st) {
    const durs = Object.keys(st.holds).map(function (id) { return st.holds[id]; })
      .filter(function (h) { return h.closed && h.kind !== 'gap'; })
      .map(function (h) { return h.answers[0].t - h.t; })
      .sort(function (a, b) { return a - b; });
    if (!durs.length) return { count: 0, median: null, longest: null };
    return { count: durs.length, median: durs[Math.floor((durs.length - 1) / 2)], longest: durs[durs.length - 1] };
  }

  // 表計算の列名。1→A、26→Z、27→AA、52→AZ、53→BA、702→ZZ、703→AAA
  function colName(k) {
    let s = '';
    while (k > 0) { k--; s = String.fromCharCode(65 + (k % 26)) + s; k = Math.floor(k / 26); }
    return s;
  }

  // 次に使う id（v2 の採番規則。v1 の記録には当てない）
  function nextIds(st) {
    return {
      card: 'C' + (Object.keys(st.cards).length + 1),
      hold: 'H' + (Object.keys(st.holds).length + 1),
      list: 'L' + (Object.keys(st.lists).length + 1),
      group: colName(Object.keys(st.groups).length + 1)
    };
  }

  // 試験や左欄のための要約（開いている保留・最上位・括り・数え上げ・決着の統計）
  function summary(st) {
    const groups = table();
    Object.keys(st.groups).sort().forEach(function (id) {
      const g = st.groups[id];
      groups[id] = { lb: g.lb, span: g.span.slice(), kind: g.kind, echoes: g.echoes.length };
    });
    const lists = table();
    Object.keys(st.lists).sort().forEach(function (id) {
      const l = st.lists[id];
      lists[id] = { n: l.n, items: l.items.slice(), at_item: l.at_item };
    });
    return {
      n: st.n,
      at: st.step ? st.step.at : null,
      open_holds: openHolds(st).map(function (h) { return h.id; }),
      gaps: openHolds(st).filter(function (h) { return h.kind === 'gap'; }).map(function (h) { return h.id; }),
      top: st.top ? st.top.id : null,
      groups: groups,
      lists: lists,
      cards: Object.keys(st.cards).length,
      settled: settled(st),
      ended: !!st.ended
    };
  }

  const api = { initState: initState, fold: fold, foldInc: foldInc, openHolds: openHolds, settled: settled, nextIds: nextIds, colName: colName, summary: summary, insertRow: insertRow };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TSV_FOLD = api;
})();
