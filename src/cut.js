/*
 * cut.js — 刻み。確定した発話を窓にまとめ、分析役に渡す pack（format/pack.md の形）を組み立てる
 *
 * 窓の決まり（format/FORMAT.md「1ステップ＝1窓」）:
 *   - 既定の幅は open.window 秒（5〜180 の整数。既定 30）。窓は発話の境界でしか閉じない（確定した発話だけが入るので、途中の発話は入らない）
 *   - 発話は t[0] ≦ 発話.t ＜ t[1] の窓に入る。終わりちょうどの発話は、それが最後の発話でも次の窓に回す
 *     （「素材がここで終わる」を窓の中身から先に分からせない）。その次の窓は、素材の終わりで閉じる最後の窓になる
 *   - 返事が来るまで次の窓を出さない。追いつかなければ次の窓は溜まった発話を全部渡す。ただし幅は window × 3 まで。
 *     超える分は、その次の窓に回す
 *   - 1 つの窓に入る発話は maxLines 件まで（規則表の limits の step.max_lines。渡されなければ 40）。
 *     超えた分は、時刻が窓の中でも次の窓に回す（時刻の打ち間違い・巻き戻りで、窓が素材の残りを丸ごと渡さないため）。
 *     上限に当たった窓は、終わりを「渡さなかった最初の発話（maxLines + 1 件目）の時刻 T」まで縮める（そこまでしか
 *     聞いていないことにする）。窓の中に T と同じ時刻の発話があれば、その同じ時刻の塊の手前で切る（窓は maxLines 件
 *     未満になる）。こうして「t[0] ≦ 発話.t ＜ t[1]」を自分で破らない。塊が窓の最初の発話から始まる（窓の maxLines + 1 件
 *     以上がすべて同じ時刻）ときだけ、幅 0 の窓 [T, T] に maxLines 件ちょうど（始まりも T まで進む）。
 *     T が窓の始まり以下（遅れて届いた発話。live の素材ログを読み直したとき）なら、始まりより前には縮めず、
 *     幅 0 の窓 [始まり, 始まり] に maxLines 件ちょうど。
 *     次の窓はその縮めた終わりから始まり、同じ時刻の残りを含む（format/FORMAT.md「1ステップ＝1窓」。rt.py と同じ切り方）
 *   - 時刻は受け取るときに単調にする（直前に受け取った発話より前の時刻は、その時刻に揃えた写しにする。
 *     入口でも揃えているので、ふだんは何もしない。続きから聞くときの素材ログの読み直しなどの守り）
 *   - 発話が 1 つも無い窓は出さない（step も書かない）。窓の始まりは、直前の窓の終わりから window 刻みで、最初の発話が入る位置まで進める
 *     （rt.py の窓の計算と同じ割り算。発話の時刻を切り捨てずに比べる）
 *   - 窓の終わりの置き方は入口で違う:
 *       ライブ（打つ・音声認識）  刻みの位置（始まり + window、それに window を足した値、もう 1 つ足した値。window × 3 まで）の
 *                                 うち、時計が過ぎた最も後ろ。追いつかずに遅れて閉じても、時計の秒では閉じない
 *                                 （rt.py の compute_window と同じ足し算。中断のあとに遅れて閉じた窓も rt.py と同じ終わりになる）
 *       ファイル（fixed: true）   窓の始まり + window（rt.py が同じ素材から計算する窓と同じ）。時計が先へ進んでいても広げない
 *   - 手動の輪（L3）は 60〜180 秒。ただし open.window × 3 を超えない
 *   - 素材の終わりで閉じる窓（close の eof）の終わりは、入口で違う:
 *       ファイル（fixed: true）   窓の始まりから window 刻みで、溜まった発話がどれも手前に入る最初の位置（ふだんの窓と同じ刻み。
 *                                 window × 3 まで。入りきらない分は、もう 1 つ後の最後の窓へ）。ただし聞き終えている時刻
 *                                 （heard。ファイルを途中で終えたときのファイルの時計）より先には置かない
 *       ライブ（打つ・音声認識）  聞き終えた時計の整数の秒 H（heard を切り捨て。無ければ nowT）。刻みには合わせない（K23。
 *                                 rt.py の next --last と同じ。中断の後に再開せずに聞き終えたときも同じ）。ただし幅は open.window × 3
 *                                 （baseWindow × factor）まで: H が始まり + その幅 以上なら、終わりは始まり + その幅で、そこちょうどか
 *                                 後の発話は次の最後の窓へ。H のほうが手前で、溜まった発話に H ちょうどか後のもの（同じ秒に
 *                                 届いた発話）があれば、閉じずに null を返す（時計が次の秒へ進んでから呼び直す。rt.py も待つ）。
 *                                 壁時計 − 聞き始め ≧ 窓の終わり（P27）はこれで守られる
 *
 * 使い方:
 *   const cutter = makeCutter({window: 30, factor: 3, maxLines: 40, fixed: false, onWindow: function (w) {...}});
 *                                //   window は整数の秒（整数でなければ例外。画面の欄で先に断る）
 *   cutter.push(line);           // 確定した発話 {i, t, who, text}（i の順に来ること。時刻が前に戻っていれば揃えた写しを溜める）
 *   cutter.tick(nowT);           // 時計（素材時間）。窓が満ちていれば閉じて onWindow を呼ぶ
 *   cutter.ready(nowT);          // 返事を書き終えた。溜まっていれば次の窓を閉じる
 *   cutter.ready(nowT, {eof:true, heard:H}); // 聞き終えた後に返事を書き終えた。溜まりを最後の窓として閉じる（close の eof と同じ）
 *   cutter.close(nowT, {eof:true, heard:H}); // 素材の終わり。溜まった発話を最後の窓として出す（H は聞き終えている時刻。
 *                                //   ファイルで無ければ上限なし＝ファイルを読み切った。ライブで無ければ nowT）。
 *                                //   窓に入る発話が無いか、ライブで同じ秒に届いた発話があれば null（あとで呼び直す）
 *   cutter.requeue(w);           // 出した窓を記録に書けなかった。発話を溜まりの先頭に戻し、次の窓に合流させる
 *                                //   （busy を解き、窓の始まりを w.t[0] に戻す。次の窓は w.t[1] + window 以降に閉じるので、
 *                                //   同じ窓をすぐ閉じ直さず、そのあとに来た発話と一緒に出す。行の連番は切れない）
 *   w = {t:[t0,t1], lines:[i0,i1], items:[...発話], last:bool}
 *
 *   const pack = buildPack(F, st, log, w, {now, attempt, violations, gap_lines});  // F は fold.js の api
 */
(function () {
  'use strict';

  // 窓の幅は整数の秒（open.window の型。小数の幅は窓の境目が rt.py と食い違う）
  function intWindow(w) {
    if (typeof w !== 'number' || !Number.isInteger(w) || w < 1) throw new Error('窓の幅は 1 以上の整数の秒です（' + w + '）');
    return w;
  }
  // Python の a // b（浮動小数）と同じ値を返す。rt.py の「窓の幅の刻みで先へ進む」と同じ数にするため
  function pyFloorDiv(a, b) {
    let mod = a % b;
    let div = (a - mod) / b;
    if (mod && ((b < 0) !== (mod < 0))) { mod += b; div -= 1; }
    if (!div) return 0;
    let fd = Math.floor(div);
    if (div - fd > 0.5) fd += 1;
    return fd;
  }

  function makeCutter(opts) {
    opts = opts || {};
    let win = intWindow(opts.window == null ? 30 : opts.window);
    const fixed = !!opts.fixed;
    const factor = opts.factor || 3;
    const cap = function () { return (opts.baseWindow || win) * factor; };
    const maxLines = (typeof opts.maxLines === 'number' && opts.maxLines >= 1) ? Math.floor(opts.maxLines) : 40;
    let pending = [];
    let lastPushT = null;  // 直前に受け取った発話の時刻（単調にするため）
    let busy = false;
    let lastT1 = 0;
    let mergeEnd = null;   // requeue のあと、次の窓を閉じてよい最初の時刻（戻した窓の終わり + window）

    // 窓の始まり。直前の窓の終わりから window 刻みで、最初の発話が入る位置まで進める
    // （rt.py: 最初の発話の時刻が 始まり + window 以上なら、始まり + window × ((時刻 − 始まり) // window)）
    function t0eff() {
      if (!pending.length) return lastT1;
      const t = pending[0].t;
      if (!(t >= lastT1 + win)) return lastT1;
      return lastT1 + win * pyFloorDiv(t - lastT1, win);
    }
    function windowEnd() {
      const e = t0eff() + win;
      return (mergeEnd != null && pending.length) ? Math.max(e, mergeEnd) : e;
    }
    function due(nowT) { return !busy && pending.length > 0 && nowT >= windowEnd(); }
    // ライブの窓の終わりの候補: 始まり + window から window ずつ足した値を factor 個まで（window × 3 を超えない）。
    // rt.py の _window_ends と同じ足し算（掛け算にすると、始まりが小数のとき最後の桁が食い違うことがある）
    function liveEnds(t0) {
      const ends = [t0 + win];
      while (ends.length < factor && ends[ends.length - 1] + win <= t0 + cap()) ends.push(ends[ends.length - 1] + win);
      return ends;
    }

    function close(nowT, o) {
      o = o || {};
      if (busy || !pending.length) return null;
      const t0 = t0eff();
      let t1;
      if (o.eof && !fixed) {
        // ライブの最後の窓（K23）: 終わりは聞き終えた時計の整数の秒。window × 3 を超えるなら、いつもの窓と同じ刻みの最後の位置
        const H = Math.floor(o.heard != null && isFinite(o.heard) ? o.heard : nowT);
        if (!isFinite(H)) return null;
        if (H >= t0 + cap()) {
          // 幅の上限で閉じる（始まり + window × 3。そこちょうどか後の発話は、次の最後の窓へ）
          t1 = t0 + cap();
        } else {
          // 同じ秒（か後）に届いた発話があれば、その発話も入るように時計が進むまで待つ（窓の終わりは、どの発話よりも後）
          if (pending[pending.length - 1].t >= H) return null;
          t1 = H;
        }
      } else if (o.eof) {
        // ファイル: ふだんの窓と同じ window 刻みで、溜まった発話がどれも手前（＜）に入る最初の位置。window × 3 まで
        // 入りきる分（maxLines 件）だけを見る。残りは、もう 1 つ後の最後の窓へ
        const maxT = pending.slice(0, maxLines).reduce(function (m, l) { return Math.max(m, l.t); }, -Infinity);
        let k = 1;
        while (t0 + win * k <= maxT && t0 + win * (k + 1) <= t0 + cap()) k++;
        t1 = Math.min(t0 + win * k, t0 + cap());
        // 聞き終えている時刻より先には置かない（聞き終えていない所は窓に入れない）
        if (o.heard != null && isFinite(o.heard)) t1 = Math.min(t1, o.heard);
      } else if (fixed) {
        // ファイル: 窓の終わりは刻みの位置（始まり + window。合流のときは戻した窓の終わり + window）。時計で広げない
        t1 = Math.min(windowEnd(), t0 + cap());
        if (!(nowT >= t1)) return null;
      } else {
        // ライブ: 刻みの位置のうち、時計が過ぎた最も後ろ（window × 3 まで）。まだどれも過ぎていなければ閉じない
        if (!(nowT >= windowEnd())) return null;
        const ends = liveEnds(t0);
        t1 = ends[0];
        for (let k = 1; k < ends.length; k++) if (nowT >= ends[k]) t1 = ends[k];
        t1 = Math.min(t1, t0 + cap());
      }
      if (!(t1 > t0)) return null;
      // 境目で切る。終わりちょうどの発話は、最後の窓でも次の窓へ。境目以後の発話は、それ以降を全部残す（行の連番を切らさないため）。
      // 窓の中でも maxLines 件を超えた分は残す（次の窓へ）
      let items = [], rest = [];
      let cut = false;
      pending.forEach(function (l) {
        if (!cut && l.t < t1 && items.length < maxLines) items.push(l); else { cut = true; rest.push(l); }
      });
      if (!items.length) return null;
      let s0 = t0;
      if (items.length === maxLines && rest.length && rest[0].t < t1) {
        // 上限で切った窓は、終わりを渡さなかった最初の発話の時刻 T まで縮める（聞いたのはそこまで）。
        // 窓の中に T と同じ時刻の発話があれば、その塊（溜まりは時刻の順なので、items の末尾に並ぶ）の手前で切る。
        // 塊が窓の最初の発話から始まるときだけ、幅 0 の窓 [T, T] に maxLines 件ちょうど（始まりも T まで進む）。
        // T が窓の始まり以下（遅れて届いた発話）のときは、始まりより前には縮めず、幅 0 の窓 [始まり, 始まり] に
        // maxLines 件ちょうど（rt.py の compute_window と同じ）
        const T = rest[0].t;
        let k = items.length;
        while (k > 0 && items[k - 1].t >= T) k--;
        if (k === 0) { s0 = Math.max(t0, T); t1 = s0; }
        else if (T > t0) { rest = items.slice(k).concat(rest); items = items.slice(0, k); t1 = T; }
        else t1 = t0;
      }
      pending = rest;
      busy = true;
      lastT1 = t1;
      mergeEnd = null;
      const w = { t: [s0, t1], lines: [items[0].i, items[items.length - 1].i], items: items, last: !!o.eof && rest.length === 0 };
      if (opts.onWindow) opts.onWindow(w);
      return w;
    }

    // 出した窓を記録に書けなかったとき。発話を捨てず溜まりの先頭に戻し、次の窓に合流させる（行の連番が切れない）
    function requeue(w) {
      pending = w.items.concat(pending);
      busy = false;
      lastT1 = w.t[0];
      mergeEnd = w.t[1] + win;
    }

    return {
      push: function (line) {
        let l = line;
        if (lastPushT != null && typeof l.t === 'number' && l.t < lastPushT) l = Object.assign({}, line, { t: lastPushT });
        if (typeof l.t === 'number') lastPushT = l.t;
        pending.push(l);
      },
      tick: function (nowT) { if (due(nowT)) return close(nowT, {}); return null; },
      // o に {eof: true, heard} を渡すと、ふだんの刻みでは閉じず、溜まりを素材の終わりの窓（close の eof）として閉じる
      // （聞き終えた後に返事が届いたとき。いつもの窓を先に出さず、rt.py の next --last と同じ最後の窓にする）
      ready: function (nowT, o) { busy = false; if (o && o.eof) return close(nowT, o); if (due(nowT)) return close(nowT, {}); return null; },
      close: close,
      requeue: requeue,
      windowEnd: windowEnd,
      setWindow: function (w) { win = Math.max(1, Math.min(intWindow(w), cap())); return win; },
      setLastT1: function (t) { lastT1 = Math.max(lastT1, t); },
      isBusy: function () { return busy; },
      pendingCount: function () { return pending.length; },
      window: function () { return win; },
      lastT1: function () { return lastT1; },
      maxLines: function () { return maxLines; }
    };
  }

  // 分析役に渡す状態の最小表現（format/pack.md）
  // F: fold.js の api、st: 畳んだ状態、log: 判断ログ全体（recent_notes のため）、w: 窓
  function buildPack(F, st, log, w, o) {
    o = o || {};
    const numOf = function (id) { const m = /\d+$/.exec(id); return m ? Number(m[0]) : 0; };
    const holds = F.openHolds(st).map(function (h) {
      const x = { id: h.id, t: h.t, age: Math.max(0, w.t[1] - h.t), who: h.who, q: h.q };
      if (h.kind === 'gap') x.kind = 'gap';
      return x;
    });
    const top = (st.top && st.cards[st.top.id]) ? { id: st.top.id, ti: st.cards[st.top.id].ti } : null;
    const groups = Object.keys(st.groups).map(function (id) { return st.groups[id]; });
    const openGroups = groups.filter(function (g) { return g.span[1] == null; })
      .sort(function (a, b) { return a.t - b.t; })
      .map(function (g) { return { id: g.id, lb: g.lb, span: g.span.slice(), kind: g.kind }; });
    const closedGroups = groups.filter(function (g) { return g.span[1] != null; })
      .sort(function (a, b) { return b.sn - a.sn || b.t - a.t; }).slice(0, 8)
      .map(function (g) { return { id: g.id, lb: g.lb, span: g.span.slice() }; });
    const lists = Object.keys(st.lists).map(function (id) { return st.lists[id]; })
      .sort(function (a, b) { return numOf(a.id) - numOf(b.id); })
      .map(function (l) { return { id: l.id, n: l.n, items: l.items.slice(), at_item: l.at_item == null ? null : l.at_item }; });
    const recentCards = Object.keys(st.cards).map(function (id) { return st.cards[id]; })
      .sort(function (a, b) { return b.sn - a.sn || numOf(b.id) - numOf(a.id); }).slice(0, 8)
      .map(function (c) { return { id: c.id, t: c.t, d: c.d, role: c.role, who: c.who, ti: c.ti }; });
    const notes = [];
    for (let i = (log || []).length - 1; i >= 0 && notes.length < 3; i--) {
      if (log[i].e === 'note') notes.push(log[i].x);
    }
    return {
      now: { n: st.n + 1, t: w.t[1], at: o.now || new Date().toISOString() },
      known: st.open && st.open.known != null ? st.open.known : '',
      open_holds: holds,
      top: top,
      open_groups: openGroups,
      closed_groups: closedGroups,
      lists: lists,
      recent_cards: recentCards,
      recent_notes: notes,
      settled: F.settled(st),
      next_ids: F.nextIds(st),
      attempt: o.attempt || 1,
      violations: (o.violations || []).slice(),
      gap_lines: (o.gap_lines || []).map(stripLine),
      new: { t: w.t.slice(), lines: w.items.map(stripLine) }
    };
  }

  function stripLine(l) {
    const x = { i: l.i, t: l.t, who: l.who == null ? null : l.who, text: l.text };
    if (l.replaces != null) x.replaces = l.replaces;
    return x;
  }

  const api = { makeCutter: makeCutter, buildPack: buildPack };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TSV_CUT = api;
})();
