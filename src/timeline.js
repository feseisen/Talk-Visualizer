/*
 * timeline.js — 中央の縦の時系列（行の作り・rail・訂正の札・echo の描き方）
 *
 * 違い（ライブ特有）:
 *   - 起動時の一括生成ではなく、到着ごとに行を t の位置に挿入する。並べ替え関数を持たない（R1）
 *   - 未来の行は DOM に存在しない（R2b）。畳んだ状態（fold.js）に無い行は作らない。追体験で T を戻せば行は消える
 *   - 印は ●（カード）と ◆（区切り）の 2 種だけ。深さは rail の幅で表す（R5）
 *   - 札はカード枠の中に置く。縦線（.itl-spine）の上に文字を置かない（R7）
 *   - 画面を拡大縮小する CSS を使わない（R8）
 *
 * 使い方:
 *   const tl = makeTimeline(rowsEl, {fmt});
 *   tl.setMode('key' | 'all');
 *   tl.sync(state, {T, fresh});   // state は fold.js の状態。T は素材時間（echo の光らせ方と「最上位」札の判定に使う）
 *   tl.jump(kind, id)             // その行へスクロール
 *   tl.lastVisible()              // いちばん下の見えている行（追従のため）
 */
(function () {
  'use strict';

  const ROLE = { claim: '主張', counter: '揺り戻し', case: '実例', land: '着地' };
  const FIELD = { d: '深さ', ti: '見出し', b: '本文', role: '役割', span: '範囲', items: '項目', n: '数' };
  const ECHO_WIN = 90; // 補強を光らせる長さ（素材の秒数。補強を記録した窓の終わりを起点に数える）

  function fmtDefault(s) {
    if (s == null || !isFinite(s)) return '—';
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x;
  }

  function makeTimeline(rowsEl, opts) {
    opts = opts || {};
    const fmt = opts.fmt || fmtDefault;
    const el = function (tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const spanText = function (v) { return fmt(v[0]) + '〜' + (v[1] == null ? '（続いている）' : fmt(v[1])); };
    const val = function (f, v) {
      if (f === 'role') return ROLE[v] || String(v);
      if (f === 'd') return v + '段';
      if (f === 'span') return spanText(v);
      if (f === 'items') return Array.isArray(v) ? v.join('・') : String(v);
      return String(v);
    };
    const rows = Object.create(null); // 'c:C1' / 'g:A' -> {node, k, id, t}。記録の id を鍵にするので、素の表にする
    let mode = 'key';

    // t の位置に挿入する。同じ t は到着順（後から来たものが後ろ）。並べ替えはしない（R1）
    function insert(node, t) {
      let ref = null;
      let c = rowsEl.lastElementChild;
      while (c && c._t > t) { ref = c; c = c.previousElementSibling; }
      rowsEl.insertBefore(node, ref);
    }

    function buildCard(c) {
      const row = el('div', 'trow crow');
      const rail = el('div', 'rail'); row.appendChild(rail);
      const mc = el('div', 'markcol'); const m = el('span', 'mark ' + c.role, '●'); mc.appendChild(m); row.appendChild(mc);
      const tc = el('div', 'timecol'); const tm = el('span', 'tm', fmt(c.t)); const sid = el('span', 'sid', 'S' + c.sn); tm.appendChild(sid); tc.appendChild(tm); row.appendChild(tc);
      const cw = el('div', 'cardwrap');
      const card = el('div', 'card ' + c.role);
      const rl = el('span', 'role', ROLE[c.role] || c.role);
      const idl = el('span', 'cid', c.id + (c.who ? '　' + c.who : ''));
      const tg = el('span', 'toptag', 'いまの最上位の候補'); tg.hidden = true;
      const wh = el('span', 'when', fmt(c.t) + ' に語られ、' + fmt(c.seen) + ' に書き留めた（S' + c.sn + '）');
      const ti = el('div', 'ti', c.ti);
      const b = el('div', 'b', c.b);
      const fx = el('span', 'fixnote'); fx.hidden = true;
      [rl, idl, tg, wh, ti, b, fx].forEach(function (x) { card.appendChild(x); });
      cw.appendChild(card); row.appendChild(cw);
      row._t = c.t;
      return { node: row, rail: rail, mark: m, card: card, rl: rl, tg: tg, ti: ti, b: b, fx: fx, k: 'c', id: c.id, t: c.t };
    }

    function buildGroup(g) {
      const row = el('div', 'trow dvrow ' + g.kind);
      const rail = el('div', 'rail'); row.appendChild(rail);
      const mc = el('div', 'markcol'); const m = el('span', 'mark g ' + g.kind, '◆'); mc.appendChild(m); row.appendChild(mc);
      const tc = el('div', 'timecol'); const tm = el('span', 'tm', fmt(g.t)); const sid = el('span', 'sid', 'S' + g.sn); tm.appendChild(sid); tc.appendChild(tm); row.appendChild(tc);
      const dw = el('div', 'dvwrap');
      const dv = el('div', 'dv ' + g.kind);
      const n = el('span', 'dno', '章' + g.id);
      const lb = el('span', 'dlb', g.lb);
      const sb = el('span', 'dsub', spanText(g.span));
      [n, lb, sb].forEach(function (x) { dv.appendChild(x); });
      if (g.kind === 'retro') dv.appendChild(el('span', 'rf', 'あとから括った。印の位置は、ひとまとまりだと気づいた時刻'));
      const gf = el('span', 'gfix'); gf.hidden = true; dv.appendChild(gf);
      const rn = el('span', 'gfix'); rn.hidden = true; dv.appendChild(rn);
      const et = el('span', 'echotag'); et.hidden = true; dv.appendChild(et);
      dw.appendChild(dv); row.appendChild(dw);
      row._t = g.t;
      return { node: row, rail: rail, dv: dv, lb: lb, sb: sb, gf: gf, rn: rn, et: et, k: 'g', id: g.id, t: g.t };
    }

    // 括りの入れ子の深さ（t を含む括りの数）。自分より内側の括りは数えない
    function nesting(st, t, selfId) {
      let n = 0;
      Object.keys(st.groups).forEach(function (id) {
        if (id === selfId) return;
        const g = st.groups[id];
        const end = g.span[1] == null ? Infinity : g.span[1];
        if (!(g.span[0] <= t && t <= end)) return;
        if (selfId) {
          const me = st.groups[selfId];
          const meEnd = me.span[1] == null ? Infinity : me.span[1];
          // 自分の範囲の中に収まる括りは、自分の外ではない
          if (me.span[0] <= g.span[0] && end <= meEnd && !(g.span[0] === me.span[0] && end === meEnd && g.t < me.t)) return;
        }
        n++;
      });
      return n;
    }

    function sync(st, o) {
      o = o || {};
      const T = o.T;
      // 1. 状態に無い行を消す（追体験で T を戻したとき）
      Object.keys(rows).forEach(function (key) {
        const r = rows[key];
        const alive = r.k === 'c' ? !!st.cards[r.id] : !!st.groups[r.id];
        if (!alive) { if (r.node.parentNode) r.node.parentNode.removeChild(r.node); delete rows[key]; }
      });
      // 2. 無い行を t の位置に挿入する（state.rows は挿入順＝到着順の並び）
      const added = [];
      st.rows.forEach(function (row) {
        const key = row.k + ':' + row.id;
        if (rows[key]) return;
        const r = row.k === 'c' ? buildCard(st.cards[row.id]) : buildGroup(st.groups[row.id]);
        insert(r.node, r.t);
        rows[key] = r;
        added.push(r);
        if (o.fresh) { r.node.classList.add('fresh'); }
      });
      // 光らせている最中の補強（書いてから一定の時間内のもの）
      const activeEcho = Object.create(null); // 鍵は記録の id（素の表。__proto__ などの名前でも壊れない）
      Object.keys(st.groups).forEach(function (id) {
        const g = st.groups[id];
        if (!g.echoes.length) return;
        const last = g.echoes[g.echoes.length - 1];
        if (T == null || (last.seen != null && T - last.seen <= ECHO_WIN)) activeEcho[id] = last;
      });
      // 3. 全行を状態に合わせる
      Object.keys(rows).forEach(function (key) {
        const r = rows[key];
        if (r.k === 'c') {
          const c = st.cards[r.id];
          const vis = mode === 'all' || (c.role === 'land' && c.d === 0) || st.tops.indexOf(c.id) >= 0;
          r.node.hidden = !vis;
          const dd = c.d + nesting(st, c.t, null);
          const w = (dd * 26) + 'px';
          if (r.rail.style.width !== w) r.rail.style.width = w;
          r.card.className = 'card ' + c.role;
          r.mark.className = 'mark ' + c.role;
          r.rl.textContent = ROLE[c.role] || c.role;
          if (r.ti.textContent !== c.ti) r.ti.textContent = c.ti;
          if (r.b.textContent !== c.b) r.b.textContent = c.b;
          if (c.fixes.length) {
            r.fx.hidden = false;
            r.fx.textContent = c.fixes.map(function (f) {
              return fmt(f.seen) + ' に訂正（S' + f.sn + '）：' + (FIELD[f.field] || f.field) + 'を ' + val(f.field, f.was) + ' → ' + val(f.field, f.now) + (f.why ? '（' + f.why + '）' : '');
            }).join('　');
          } else r.fx.hidden = true;
          const isTop = !!(st.top && st.top.id === c.id);
          r.tg.hidden = !isTop;
          r.card.classList.toggle('istop', isTop);
          // このカードを含む括りがあり、その括りが補強された直後なら光らせる
          let gid = null;
          Object.keys(st.groups).forEach(function (id) { const g = st.groups[id]; const e = g.span[1] == null ? Infinity : g.span[1]; if (g.span[0] <= c.t && c.t <= e) gid = id; });
          r.node.classList.toggle('echo', !!(gid && activeEcho[gid]));
        } else {
          const g = st.groups[r.id];
          r.node.hidden = false;
          const dd = nesting(st, g.t, g.id);
          const w = (dd * 26) + 'px';
          if (r.rail.style.width !== w) r.rail.style.width = w;
          if (r.lb.textContent !== g.lb) r.lb.textContent = g.lb;
          r.sb.textContent = spanText(g.span);
          if (g.fixes.length) {
            r.gf.hidden = false;
            r.gf.textContent = g.fixes.map(function (f) { return fmt(f.seen) + ' に範囲を訂正（S' + f.sn + '）：' + spanText(f.was) + ' → ' + spanText(f.now) + (f.why ? '（' + f.why + '）' : ''); }).join('　');
          } else r.gf.hidden = true;
          if (g.renames.length) {
            r.rn.hidden = false;
            r.rn.textContent = g.renames.map(function (x) { return fmt(x.seen) + ' に名前を変えた（S' + x.sn + '）：「' + x.was + '」→「' + x.now + '」'; }).join('　');
          } else r.rn.hidden = true;
          if (g.echoes.length) {
            const l = g.echoes[g.echoes.length - 1];
            const now = !!activeEcho[g.id];
            r.et.hidden = false;
            r.et.classList.toggle('now', now);
            r.et.textContent = (now ? '補強が入った直後（' + fmt(l.seen) + '）：' : '括ったあとに補強 ' + g.echoes.length + ' 回（最新 ' + fmt(l.seen) + '：') + (l.why || '') + (now ? '' : '）');
          } else r.et.hidden = true;
          r.node.classList.toggle('echo', !!activeEcho[g.id]);
        }
      });
      return added;
    }

    function lastVisible() {
      let c = rowsEl.lastElementChild;
      while (c && c.hidden) c = c.previousElementSibling;
      return c;
    }
    function jump(k, id) {
      const r = rows[k + ':' + id];
      if (!r) return false;
      if (r.node.hidden) return 'mode'; // 「要点のみ」で隠れている。呼ぶ側が「すべてのカード」に切り替えてから呼び直す
      r.node.scrollIntoView({ block: 'center' });
      return true;
    }

    return {
      sync: sync,
      setMode: function (m) { mode = m; },
      mode: function () { return mode; },
      jump: jump,
      lastVisible: lastVisible,
      count: function () { return Object.keys(rows).length; }
    };
  }

  const api = { makeTimeline: makeTimeline, fmt: fmtDefault, ROLE: ROLE, FIELD: FIELD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TSV_TIMELINE = api;
})();
