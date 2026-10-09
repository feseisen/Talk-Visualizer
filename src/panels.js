/*
 * panels.js — 左右の欄。聞きながら書き足していく前提で作った（左に 6 つ、右に 2 つの欄）
 *
 * 左: 宣言された数え上げ（list と card.li から、全部で何点あって、いまその何点目か）・開いている問い・未確定の窓（kind:gap）・
 *     最上位の候補・章・答えが出た問い
 * 右: 考えたこと（直近の note）・逐語（確定分＋途中結果 1 本。各行から、どのカードになったかへ飛べる）
 * 上: 運転状態の札（最後の判断から N 秒／窓幅／経路／未確定の窓 n 件）
 *
 * 文字は全部日本語。内部名（英字の項目名）は画面に出さない
 */
(function () {
  'use strict';

  function fmtDefault(s) {
    if (s == null || !isFinite(s)) return '—';
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + x : m + ':' + x;
  }

  function makePanels(els, opts) {
    opts = opts || {};
    const fmt = opts.fmt || fmtDefault;
    const el = function (tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const empty = function (box, text) { box.innerHTML = ''; box.appendChild(el('div', 'empty', text)); };
    const numOf = function (id) { const m = /\d+$/.exec(id); return m ? Number(m[0]) : 0; };

    // ---- 左 ----
    function renderLeft(st, o) {
      const T = o.T, ended = !!o.ended;

      // 宣言された数え上げ
      const lb = els.lists;
      const lists = Object.keys(st.lists).map(function (id) { return st.lists[id]; }).sort(function (a, b) { return numOf(a.id) - numOf(b.id); });
      if (!lists.length) empty(lb, 'まだ宣言されていない（「三点あります」のような数え上げが出ると、ここに出る）');
      else {
        lb.innerHTML = '';
        lists.forEach(function (l) {
          const head = el('div', 'soft', l.id + '　' + (l.who ? l.who + ' が ' : '') + fmt(l.t) + ' に ' + l.n + ' 点と宣言' + (l.at_item ? '。いま ' + l.at_item + ' 点目' : ''));
          lb.appendChild(head);
          const ul = el('ul', 'lst');
          for (let k = 1; k <= l.n; k++) {
            const li = el('li', '', k + '. ' + (l.items[k - 1] != null ? l.items[k - 1] : '（まだ分からない）'));
            if (l.at_item === k) li.classList.add('cur');
            else if (l.at_item != null && k < l.at_item) li.classList.add('done');
            ul.appendChild(li);
          }
          lb.appendChild(ul);
        });
      }

      // 開いている問い（gap は別）
      const open = Object.keys(st.holds).map(function (id) { return st.holds[id]; })
        .filter(function (h) { return !h.closed; })
        .sort(function (a, b) { return a.t - b.t || numOf(a.id) - numOf(b.id); });
      const qs = open.filter(function (h) { return h.kind !== 'gap'; });
      const gaps = open.filter(function (h) { return h.kind === 'gap'; });
      els.holdhead.textContent = (ended ? '答えが出ないまま終わった問い' : '答えを待っている問い') + (qs.length ? '（' + qs.length + ' 件）' : '');
      if (!qs.length) empty(els.holds, 'いまは無い');
      else {
        els.holds.innerHTML = '';
        qs.forEach(function (h) {
          const d = el('div', 'q');
          d.appendChild(el('span', '', h.id + '　' + h.q + (h.who ? '（' + h.who + '）' : '')));
          d.appendChild(el('span', 'qt', fmt(h.t) + ' に立ててから ' + fmt(Math.max(0, (T == null ? h.t : T) - h.t)) + ' 開いたまま'));
          els.holds.appendChild(d);
        });
      }
      els.gaphead.textContent = '未確定の窓' + (gaps.length ? '（' + gaps.length + ' 件）' : '');
      if (!gaps.length) empty(els.gaps, '無い');
      else {
        els.gaps.innerHTML = '';
        gaps.forEach(function (h) {
          const d = el('div', 'q gap');
          d.appendChild(el('span', '', h.id + '　' + h.q));
          d.appendChild(el('span', 'qt', 'S' + h.sn + ' で検証に3回落ちた窓。後の窓で閉じられる'));
          els.gaps.appendChild(d);
        });
      }

      // 最上位候補
      if (!st.top) empty(els.topbox, 'まだ立てていない');
      else {
        els.topbox.innerHTML = '';
        const c = st.cards[st.top.id];
        const d = el('div', 'topbox', c ? c.ti : st.top.id);
        d.appendChild(el('span', 'tt', st.top.id + '　' + (st.swaps === 1 ? '最初に立てた候補' : '入替 ' + (st.swaps - 1) + ' 回目') + '（' + fmt(st.top.t) + '）' + (st.top.why ? '　' + st.top.why : '')));
        els.topbox.appendChild(d);
      }

      // 章
      const groups = Object.keys(st.groups).map(function (id) { return st.groups[id]; }).sort(function (a, b) { return a.t - b.t; });
      if (!groups.length) empty(els.chaps, 'まだ無い');
      else {
        els.chaps.innerHTML = '';
        groups.forEach(function (g) {
          const d = el('div', 'chap');
          d.appendChild(el('span', '', '章' + g.id + '　' + g.lb));
          d.appendChild(el('span', 'crange', fmt(g.span[0]) + '〜' + (g.span[1] == null ? '（続いている）' : fmt(g.span[1])) + (g.kind === 'retro' ? '・遡って括った' : '') + (g.echoes.length ? '・補強 ' + g.echoes.length + ' 回' : '')));
          els.chaps.appendChild(d);
        });
      }

      // 答えが出た問い（新しい順に）
      const closed = Object.keys(st.holds).map(function (id) { return st.holds[id]; })
        .filter(function (h) { return h.closed; })
        .sort(function (a, b) { return b.closed.t - a.closed.t || numOf(b.id) - numOf(a.id); });
      if (!closed.length) empty(els.closed, 'まだ無い');
      else {
        els.closed.innerHTML = '';
        closed.forEach(function (h) {
          const d = el('div', 'done');
          d.appendChild(el('b', '', h.id + '　' + h.q));
          d.appendChild(el('span', '', '　' + fmt(h.answers[0].t) + ' に答えが出た（立ててから ' + fmt(h.answers[0].t - h.t) + '）' + (h.kind === 'gap' ? '・未確定の窓' : '')));
          const many = h.answers.length > 1;
          h.answers.forEach(function (a, k) {
            d.appendChild(el('span', 'ans', (many ? (k + 1) + 'つ目の答え（' + fmt(a.t) + '）：' : '答え：') + (a.as || '') + (a.by && a.by.length ? '　← ' + a.by.join('・') : '')));
          });
          els.closed.appendChild(d);
        });
      }
    }

    // ---- 右: 考えたこと ----
    function renderNote(st, o) {
      if (!st.notes.length) { els.notesub.textContent = ''; els.notex.textContent = 'まだ無い'; return; }
      els.notesub.textContent = 'S' + st.n + ' で考えたこと。カードとは別に残してある' + (st.step && st.step.think ? '　（思考の要約も下にある）' : '');
      let txt = st.notes.map(function (n) { return n.x; }).join('\n\n');
      if (st.step && st.step.think) txt += '\n\n— 思考の要約 —\n' + st.step.think;
      if (els.notex._t !== txt) { els.notex._t = txt; els.notex.textContent = txt; els.notex.scrollTop = 0; }
    }

    // ---- 右: 逐語（確定分を足していくだけ。途中結果は末尾の 1 本） ----
    // 発話（i がある）も出来事（認識の切断など。i が無い）も同じ並び shown に登録する。
    // 渡された src と shown の先頭からの一致を見て、一致しなくなった所から先の行を消し、足りない分を足す。
    // ライブでは末尾に足すだけ。追体験で T を戻すと、発話も出来事も T より先の行が消える（R2b）
    const shown = [];       // [{key, node, fc, cards, i}]。画面の並びと同じ順
    let interimNode = null;
    // 出来事の札。英字の符号は括弧の中に添える
    // 音声認識の誤りの種類（ブラウザが返す符号）を日本語に。知らない符号は「そのほか」とだけ言う（英字を画面に出さない）
    const ASR_ERROR = {
      'no-speech': '声が聞こえない', 'aborted': '止められた', 'audio-capture': 'マイクが無い', 'network': '認識の通信が切れた',
      'not-allowed': 'マイクの許可が無い', 'service-not-allowed': '認識の機能が許されていない', 'language-not-supported': '言語が使えない',
      'bad-grammar': '認識の設定の誤り'
    };
    function eventText(l) {
      if (l.ev === 'asr_start') return '（認識を始めた' + (l.local === true ? '。この端末の中で文字にする' : l.local === false ? '。音声は提供元のサーバーへ送る' : '') + '）';
      if (l.ev === 'asr_end') return '（認識が切れた）';
      if (l.ev === 'asr_restart') return '（認識を再開した' + (l.n != null ? '。' + l.n + ' 回目' : '') + '）';
      if (l.ev === 'asr_error') return '（認識の誤り：' + (Object.prototype.hasOwnProperty.call(ASR_ERROR, l.error) ? ASR_ERROR[l.error] : 'そのほか') + '）';
      // 聞き終えるときに、認識の終わりの知らせを上限まで待っても来なかった（この後に認識が返した結果は記録に入れず、出来事 late として残す）
      if (l.ev === 'asr_stop_timeout') return '（認識の終わりを待ちきれずに聞き終えた' + (typeof l.ms === 'number' && isFinite(l.ms) ? '。' + Math.round(l.ms / 100) / 10 + ' 秒待った' : '') + '）';
      // 聞き取りを止めた後（聞き終えた後・記録に書けずに止まった後）に届いた認識の結果。窓にも判断にも入れていないので、
      // そう添えて本文を出す（K29）
      if (l.ev === 'late') return '（聞き取りを止めた後に届いた認識の結果。記録の外：' + (typeof l.text === 'string' ? l.text : '') + '）';
      // 読めない行（素材の時刻が読めなかった行）。中身は出さず、行の番号だけ
      if (l.ev === 'unreadable') return '（読めない行があった。' + (typeof l.line === 'number' ? l.line + ' 行目。' : '') + '発話にしていない）';
      return '（入口の出来事）';
    }
    function keyOf(l) {
      if (l.i != null) return 'i:' + l.i;
      return 'ev:' + String(l.ev) + ':' + (l.at == null ? '' : l.at) + ':' + (l.t == null ? '' : l.t) + ':' + (l.n == null ? '' : l.n);
    }
    function renderFeed(src, interim, cardsBySrc, onJump) {
      if (!interimNode) {
        interimNode = el('div', 'fl interim'); interimNode.hidden = true;
        interimNode.appendChild(el('span', 'ft', '…'));
        interimNode.appendChild(el('span', 'fx', ''));
        els.feed.appendChild(interimNode);
      }
      // 先頭から一致している長さ
      let p = 0;
      while (p < shown.length && p < src.length && shown[p].key === keyOf(src[p])) p++;
      // 一致しなくなった所から先を消す（T を戻した・記録を消したなど）
      while (shown.length > p) {
        const f = shown.pop();
        if (f.node.parentNode) f.node.parentNode.removeChild(f.node);
      }
      // 足りない分を足す
      for (let k = p; k < src.length; k++) {
        const l = src[k];
        if (l.i == null) { // 発話でない出来事（認識の切断など）
          const d = el('div', 'fl soft');
          d.appendChild(el('span', 'ft', fmt(l.t)));
          d.appendChild(el('span', 'fx', eventText(l)));
          els.feed.insertBefore(d, interimNode);
          shown.push({ key: keyOf(l), node: d, fc: null, cards: '', i: null });
          continue;
        }
        const d = el('div', 'fl');
        d.appendChild(el('span', 'ft', fmt(l.t)));
        if (l.who) d.appendChild(el('span', 'fw', l.who));
        d.appendChild(el('span', 'fx', (l.replaces != null ? '（言い直し）' : '') + l.text));
        const fc = el('span', 'fc');
        d.appendChild(fc);
        els.feed.insertBefore(d, interimNode);
        shown.push({ key: keyOf(l), node: d, fc: fc, cards: '', i: l.i });
      }
      // どのカードになったか
      shown.forEach(function (f) {
        if (f.i == null) return;
        const ids = cardsBySrc[f.i] || [];
        const key = ids.join(',');
        if (f.cards === key) return;
        f.cards = key;
        f.fc.innerHTML = '';
        ids.forEach(function (id) {
          const b = el('button', '', '→ ' + id);
          b.title = 'このカードへ';
          b.addEventListener('click', function () { onJump('c', id); });
          f.fc.appendChild(b);
        });
      });
      // いちばん新しい確定分
      Array.prototype.forEach.call(els.feed.querySelectorAll('.fl.newest'), function (n) { n.classList.remove('newest'); });
      for (let k = shown.length - 1; k >= 0; k--) { if (shown[k].i != null) { shown[k].node.classList.add('newest'); break; } }
      // 途中結果
      if (interim) { interimNode.hidden = false; interimNode.lastChild.textContent = interim; }
      else interimNode.hidden = true;
      els.feed.scrollTop = els.feed.scrollHeight;
    }

    // ---- 上: 運転状態の札 ----
    function renderStatus(s) {
      const set = function (key, text, cls) { const e = els.status[key]; if (!e) return; e.textContent = text; e.className = 'v' + (cls ? ' ' + cls : ''); };
      // 追体験（s.replay）では T で畳んだ状態から数える。T より前に判断が無ければ「まだ」、
      // 判断はあるが壁時計と素材時間の対応が無い記録（ファイルから聞いた記録）では出さない
      if (s.replay && s.lastAt == null) set('since', s.noStep ? 'まだ 1 回も判断していない' : '—');
      else if (s.lastAt == null) set('since', s.listening ? 'まだ 1 回も判断していない' : '—');
      else {
        const sec = Math.max(0, Math.floor((s.nowMs - s.lastAt) / 1000));
        set('since', fmt(sec) + (s.busy ? '（返事を待っている' + (s.attempt > 1 ? '・' + s.attempt + ' 回目' : '') + '）' : ''), sec > s.win * 2 ? 'slow' : (s.busy ? 'busy' : ''));
      }
      set('win', s.winEff + ' 秒' + (s.winEff > s.win ? '（追いつくため ' + s.winEff + ' 秒窓で動いている）' : '') + (s.pending ? '・溜まり ' + s.pending + ' 発話' : ''));
      set('route', s.route);
      set('intake', s.intake);
      set('gaps', s.gaps ? s.gaps + ' 件' : '0 件', s.gaps ? 'slow' : '');
      set('clock', fmt(s.T));
      set('listen', s.halted ? '止まった（記録に書けない）' : s.listening ? (s.paused ? '中断中' : '聞いている') : (s.ended ? '聞き終えた' : '止まっている'), s.halted ? 'slow' : '');
    }

    return { renderLeft: renderLeft, renderNote: renderNote, renderFeed: renderFeed, renderStatus: renderStatus };
  }

  const api = { makePanels: makePanels, fmt: fmtDefault };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TSV_PANELS = api;
})();
