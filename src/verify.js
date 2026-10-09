/*
 * verify.js — 判断ログへの追記（バッチ）の検査器。tools/rt.py と同じ規則表（format/rules.json）を読む
 *
 * 使い方:
 *   const verify = makeVerifier(rules);                 // rules は format/rules.json の中身（build 時に埋め込む）
 *   const r = verify(log, batch, {now, next_ids, heard_until, window, src});
 *   // log         これまでのログ（イベントの配列。変えない）。各行の欄も見る（F01〜F07）。壊れた行があれば追記しない（rt.py と同じ線）
 *   // batch       追記しようとするイベントの配列（先頭は step。end・pause だけの追記もある）。変えない
 *   // now         道具の壁時計（ISO 8601 UTC）。step / end / pause の at に押す。無ければ現在時刻
 *   // next_ids    道具が分析役に渡した次の id {card, hold, list, group}。無ければ状態から計算する
 *   // heard_until 道具が聞き終えている素材時間（秒）。あれば step.t[1] がこれを超えると P09
 *   // window      道具が渡した窓 {t:[a,b], lines:[i,j]}。あれば step と一致しなければ P07
 *   // src         素材ログの行 [{i,t,who,text}]。あれば P20（話者）を検査する
 *   // → {ok, errors[], warnings[], batch}
 *   //   ok      違反が 1 つも無いとき true（P26: 全か無か）
 *   //   errors  違反文。規則の id で始まる（"P09: …"）
 *   //   warnings 警告文（拒まない）
 *   //   batch   書いてよい形に整えた追記（step.at を押し、fix/rename の was を埋めたもの）。ok でなければ null
 *
 * 版: ログ先頭の open.v を規則表の versions.<版>.open_v に当てて決める（他の手がかりは使わない）。
 *   型も比べる（=== で当てる。true は 1 ではない）。どの版にも無い v は知らない版として拒む（F07）。黙って v1 扱いにしない。
 *   版の判定だけを使いたい側（fold.js・app.js）は TSV_VERIFY.versionOf(open) を呼ぶ:
 *     versionOf(open[, rules]) → 1 か 2（数）。open でない・知らない版なら null
 *     rules を省くと、makeVerifier(rules) に渡した規則表 → globalThis.TSV_RULES（組み立てた画面）
 *     → node なら ../format/rules.json の順に探し、どれも無ければ Error を投げる（黙って既定にしない）
 * 手続き的検査（P01〜P30）は rules.procedural に id だけがあり、実装はここと rt.py の両方が持つ
 *   （P28 の警告は素材の全文を要るので rt.py だけ。P07 の「素材から窓を計算し直す」も rt.py。ここは渡された window と照らす）。
 * ブラウザでは globalThis.makeVerifier と globalThis.TSV_VERIFY、node では module.exports に同じものを出す。
 *
 * 値の扱い（rt.py と揃える）:
 *   - 数は有限のものだけ（NaN・±Infinity は F02）。JSON の -1e999 は読むと -Infinity になるので、写す前に見る
 *   - 欄の値の入れ子は limits.value.max_depth（32）段まで（数・文字列は 0 段、配列とオブジェクトは 1 ＋ 中身のいちばん深いもの）。
 *     超えれば F02。数える側も 33 段目で打ち切るので、何段重ねた値でも落ちない（JSON に写す前に見る）
 *   - 分析役が step・end・pause に書いた at は、値の検査も含めてどの検査よりも前に捨てる（どんな値でも、それを理由に拒まない）
 *   - 数は絶対値が 2^53 − 1（Number.MAX_SAFE_INTEGER）以下のものだけ（超えると JSON を読んだ時点で丸まり、
 *     rt.py と同じ値を比べられないので F02）
 *   - 文字列に対になっていないサロゲート（片割れ）があれば F02（欄の値・配列やオブジェクトの中・鍵のどこでも）
 *   - 壁時計は半角の数字だけの形で、暦にある日時だけ（24 時・2 月 30 日・60 秒・0 年は F02。組み立て直して一致を見る）
 *   - 整数の欄の 2.0 は、JSON を読んだ時点で 2 と区別できないので整数として受ける
 *   - was と現状は JSON の文字列にして比べる（false と 0 は別）
 *   - 正規表現は文字列の末尾まで当てる（JS の $ は末尾の改行の手前では当たらない）
 *   - イベントでない行（文字列・数・配列・null）と、e が文字列でない行は F07 で拒む。落ちない（e の欄の値は、深さや数の
 *     検査より前に種類として見る。rt.py と同じく、e の値が深すぎる行も F07）
 *   - 欄の形の検査（F01・F02・F03・F05・F06。範囲と上限の F04 は除く）に落ちた step 以外のイベントは、ほかの検査をしない
 *     （rt.py と同じ。K17・K23）。card・hold・group・list は id だけを状態に取る（id の欄が壊れていれば、次に来るはずの id と
 *     して）。後ろのイベントがその id を指しても P10・P13 を、次の id に P11 を、その欄から P19・P09・P29 を重ねない。
 *     拒むことは変わらない（違反は欄の検査が出している）
 *   - 状態の表（カード・保留・括り・数え上げ）は原型の無いオブジェクト（Object.create(null)）に持ち、
 *     在るかどうかは自前の欄かどうかで見る。話者は Set。constructor・__proto__ のような id や話者でも誤らない
 */
(function () {
  'use strict';

  // 壁時計の形。JS の \d は半角の 0〜9 だけに当たる（rt.py は re.ASCII で同じにする）
  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/;
  const MAX_NUM = 9007199254740991; // 2^53 − 1。これを超える数は F02
  // 対になっていないサロゲート（上位の片割れの後に下位が無い／下位の片割れの前に上位が無い）
  const LONE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  function loneSurrogate(s) { return typeof s === 'string' && LONE_RE.test(s); }
  // 違反文に値を出すとき、片割れのサロゲートを置換文字（U+FFFD）に直す（違反文は所感などに書き写されることがあるので、
  // 違反文そのものに書けない文字を入れない）
  function safeText(s) {
    s = String(s);
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) {
        const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
        if (d >= 0xDC00 && d <= 0xDFFF) { out += s[i] + s[i + 1]; i++; } else out += '\uFFFD';
      } else if (c >= 0xDC00 && c <= 0xDFFF) out += '\uFFFD';
      else out += s[i];
    }
    return out;
  }

  // 秒を m:ss（1 時間以上は h:mm:ss）に。負の秒は頭に - を付ける（rt.py の fmt と同じ）
  function fmt(s) {
    if (typeof s !== 'number' || !isFinite(s)) return String(s);
    const sign = s < 0 ? '-' : '';
    s = Math.floor(Math.abs(s));
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
    const mm = (h ? String(m).padStart(2, '0') : String(m));
    return sign + (h ? h + ':' : '') + mm + ':' + String(x).padStart(2, '0');
  }

  function len(s) { return Array.from(String(s)).length; } // 文字数（コードポイント。Python の len と同じ）

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function isInt(v) { return Number.isInteger(v); }
  function isPair(v) { return Array.isArray(v) && v.length === 2; }

  // 自前の欄だけを見る（constructor・toString・__proto__ を「在る」と誤らない）
  const HAS = Object.prototype.hasOwnProperty;
  function has(o, k) { return o != null && HAS.call(o, k); }
  function own(o, k) { return has(o, k) ? o[k] : undefined; }
  function table() { return Object.create(null); }
  // 欄を自前の欄として置く（鍵が __proto__ でも原型を書き換えない）
  function put(o, k, v) { Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true }); }

  // イベントとして読める行か（オブジェクトで、e が文字列）。読めなければ null
  function isObj(e) { return e !== null && typeof e === 'object' && !Array.isArray(e); }
  function kindOf(e) { return isObj(e) && typeof e.e === 'string' ? e.e : null; }

  // 値の中に、記録に書けない値があるか。最初に見つけた理由を返す（無ければ null）
  //   'nonfinite' 有限でない数（NaN・±Infinity）
  //   'big'       絶対値が 2^53 − 1 を超える数
  //   'lone'      対になっていないサロゲートを含む文字列（オブジェクトの鍵も見る）
  //   'deep'      入れ子が深すぎる（room は、あと何段の配列・オブジェクトを入れてよいか）
  // 欄の値の深さは、数・文字列が 0 段、配列とオブジェクトが 1 ＋ 中身のいちばん深いもの。
  // badValue(欄の値, 32) は深さ 33 以上で 'deep'。room が 0 の所で止まるので、たどるのは高々 33 段（何段重ねた値でも落ちない）
  function badValue(x, room) {
    if (typeof x === 'number') return !isFinite(x) ? 'nonfinite' : (Math.abs(x) > MAX_NUM ? 'big' : null);
    if (typeof x === 'string') return loneSurrogate(x) ? 'lone' : null;
    if (x === null || typeof x !== 'object') return null;
    if (!(room > 0)) return 'deep';
    if (Array.isArray(x)) {
      for (let i = 0; i < x.length; i++) { const r = badValue(x[i], room - 1); if (r) return r; }
      return null;
    }
    const ks = Object.keys(x);
    for (let i = 0; i < ks.length; i++) {
      if (loneSurrogate(ks[i])) return 'lone';
      const r = badValue(x[ks[i]], room - 1);
      if (r) return r;
    }
    return null;
  }

  // 道具が押す at を持つ種類（分析役が書いた at は、どの検査よりも前に捨てる）
  const TOOL_AT = { step: true, end: true, pause: true };
  // 分析役が step・end・pause に書いた at を捨てた写し（欄の並びはそのまま。元は変えない）。それ以外の行はそのまま返す
  function dropAt(e) {
    const k = kindOf(e);
    if (k === null || !HAS.call(TOOL_AT, k) || !has(e, 'at')) return e;
    const out = {};
    Object.keys(e).forEach(function (key) { if (key !== 'at') put(out, key, e[key]); });
    return out;
  }

  // 壁時計を組み立てる。形が違うか、暦に無い日時（24 時・2 月 30 日・60 秒・0 年など）なら null。
  // Date は 24 時を翌日に、2 月 30 日を 3 月に読み替えるので、組み立てた結果が元の数と同じかで見る（rt.py は datetime が断る）
  function isoParts(s) {
    if (typeof s !== 'string') return null;
    const m = ISO_RE.exec(s);
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]), h = Number(m[4]), mi = Number(m[5]), se = Number(m[6]);
    if (y < 1) return null;
    const dt = new Date(0);
    dt.setUTCFullYear(y, mo - 1, d);   // 0〜99 年を 1900 年代に読み替えない
    dt.setUTCHours(h, mi, se, 0);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d ||
        dt.getUTCHours() !== h || dt.getUTCMinutes() !== mi || dt.getUTCSeconds() !== se) return null;
    return { ms: dt.getTime(), frac: m[7] ? m[7].slice(1) : '' };
  }
  function isoOk(s) { return isoParts(s) !== null; }

  // 壁時計を秒に（小数部も全部読む。rt.py の iso_sec と同じ）。形が違うか暦に無ければ NaN
  function isoSec(s) {
    const p = isoParts(s);
    if (!p) return NaN;
    return p.ms / 1000 + (p.frac ? Number('0.' + p.frac) : 0);
  }

  function colName(k) {
    let s = '';
    while (k > 0) { k--; s = String.fromCharCode(65 + (k % 26)) + s; k = Math.floor(k / 26); }
    return s;
  }

  // 4 文字以上の共通部分（最長共通部分文字列の長さ）
  function commonLen(a, b) {
    const A = Array.from(String(a)), B = Array.from(String(b));
    let best = 0;
    let prev = new Array(B.length + 1).fill(0);
    for (let i = 1; i <= A.length; i++) {
      const cur = new Array(B.length + 1).fill(0);
      for (let j = 1; j <= B.length; j++) {
        if (A[i - 1] === B[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) best = cur[j]; }
      }
      prev = cur;
    }
    return best;
  }

  const LABEL = {
    open: '先頭', step: 'ステップ', card: 'カード', hold: '保留', close: '決着', fix: '訂正', group: '括り',
    rename: '名前の変更', top: '最上位', echo: '補強', note: '所感', list: '数え上げ', end: '終了', pause: '中断'
  };
  // 違反文に添える番号や id。文字列と数だけを出す（配列やオブジェクトを文字にしない。深く重ねた値でも落ちない）
  function tag(v) { return (typeof v === 'string' || typeof v === 'number') ? ' ' + safeText(v) : ''; }
  function label(e) {
    const k = kindOf(e);   // e が文字列でない行は、種類の名前を引かない（["step"] を "step" と読み違えない）
    if (k === null) return 'この行';
    const base = own(LABEL, k) || ('種類 ' + JSON.stringify(safeText(k)));
    if (k === 'step') return base + tag(e.n);
    return base + tag(e.id);
  }

  const TARGET_LABEL = { card: 'カード', group: '括り', list: '数え上げ', hold: '保留' };

  // 道具が埋める欄（fix.was・rename.was）を now の手前に置く（rt.py の _insert_before と同じ並び）
  function insertBefore(e, before, key, value) {
    const out = {};
    Object.keys(e).forEach(function (k) { if (k === before) put(out, key, value); put(out, k, e[k]); });
    if (!has(out, key)) put(out, key, value);
    return out;
  }

  // ---- 版の決定 ----

  // open.v を versions.<版>.open_v に当てる。返り値は規則表の版の鍵（"1"・"2"）。open でない・どの版にも無ければ null。
  // 型も比べる（=== で当てる。true は 1 ではなく、知らない版）
  function detectVersion(R, openEv) {
    if (kindOf(openEv) !== 'open') return null;
    const v = has(openEv, 'v') ? openEv.v : null;
    for (const key of Object.keys(R.versions)) {
      const ov = R.versions[key].open_v;
      if (ov.some(function (x) { return x === v; })) return key;
    }
    return null;
  }

  // 規則表の置き場。makeVerifier(rules) に渡されたものを覚え、versionOf が規則表無しで呼ばれたときに使う
  let knownRules = null;
  function defaultRules() {
    if (knownRules) return knownRules;
    if (typeof globalThis !== 'undefined' && globalThis.TSV_RULES) return globalThis.TSV_RULES;
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { return require('../format/rules.json'); } catch (err) { /* 下で投げる */ }
    }
    throw new Error('規則表（format/rules.json）が無いので版を判定できません。先に makeVerifier(rules) を呼ぶか、versionOf(open, rules) に規則表を渡してください');
  }

  // 版の判定（fold.js・app.js もこれを呼ぶ。自前で open.v を読まない）。1 か 2 の数。知らない版・open でないものは null
  function versionOf(openEv, rules) {
    const key = detectVersion(rules || defaultRules(), openEv);
    return key == null ? null : Number(key);
  }

  // ---- ログを畳んだ検査用の状態 ----

  function buildState(R, log, ver) {
    const st = {
      ver: ver, open: null, lastStep: null, prevShort: false, paused: null, ended: null,
      cards: table(), holds: table(), groups: table(), lists: table(), top: null
    };
    const VER = R.versions[ver];
    for (const e of log) applyToState(st, e, VER);
    return st;
  }

  // 検査済みのイベントを状態に反映する（検査はしない）
  function applyToState(st, e, VER) {
    switch (e.e) {
      case 'open': st.open = e; break;
      case 'step': {
        const chunk = st.open && st.open.chunk;
        st.prevShort = !!(VER.cut === 'chunk' && chunk && isPair(e.lines) && (e.lines[1] - e.lines[0] + 1) < chunk);
        st.lastStep = e; st.paused = null; break;
      }
      case 'card': st.cards[e.id] = { id: e.id, t: e.t, d: e.d, role: e.role, ti: e.ti, b: e.b, li: e.li == null ? null : e.li }; break;
      case 'hold': st.holds[e.id] = { id: e.id, t: e.t, q: e.q, kind: e.kind == null ? null : e.kind, closes: 0 }; break;
      case 'close': if (has(st.holds, e.id)) st.holds[e.id].closes++; break;
      case 'group': st.groups[e.id] = { id: e.id, t: e.t, span: Array.isArray(e.span) ? e.span.slice() : e.span, lb: e.lb }; break;
      case 'list': st.lists[e.id] = { id: e.id, t: e.t, n: e.n, items: Array.isArray(e.items) ? e.items.slice() : [] }; break;
      case 'fix': {
        const f = e.field;
        const t = (f === 'span') ? own(st.groups, e.id) : (f === 'items' || f === 'n') ? own(st.lists, e.id) : own(st.cards, e.id);
        if (t) t[f] = clone(e.now);
        break;
      }
      case 'rename': if (has(st.groups, e.id)) st.groups[e.id].lb = e.now; break;
      case 'top': st.top = e; break;
      case 'end': st.ended = e; break;
      case 'pause': st.paused = e; break;
      default: break;
    }
  }

  function nextIdsOf(st) {
    return {
      card: 'C' + (Object.keys(st.cards).length + 1),
      hold: 'H' + (Object.keys(st.holds).length + 1),
      list: 'L' + (Object.keys(st.lists).length + 1),
      group: colName(Object.keys(st.groups).length + 1)
    };
  }

  function makeVerifier(rules) {
    const R = rules;
    knownRules = rules;

    // ---- 欄の検査（規則表から機械的に導く。F01〜F06） ----

    function typeOk(type, v) {
      switch (type) {
        case 'int': return isInt(v);
        case 'num': case 't': return isNum(v);
        case 'str': return typeof v === 'string';
        case 'bool': return typeof v === 'boolean';
        case 'iso': return isoOk(v);
        case 'span': return isPair(v) && isNum(v[0]) && (v[1] === null || isNum(v[1]));
        case 'li': return isPair(v) && typeof v[0] === 'string' && isInt(v[1]) && v[1] >= 1;
        case 'arr:int': return Array.isArray(v) && v.every(isInt);
        case 'arr:num': return Array.isArray(v) && v.every(isNum);
        case 'arr:str': return Array.isArray(v) && v.every(function (x) { return typeof x === 'string'; });
        case 'any': return true;
        default:
          // id は空でない文字列（rt.py の type_ok と同じ。空文字を通すと v1 で id の無いカードが受かる）
          if (type.indexOf('arr:id:') === 0) return Array.isArray(v) && v.every(function (x) { return typeof x === 'string' && x !== ''; });
          if (type.indexOf('id:') === 0) return typeof v === 'string' && v !== '';
          return true;
      }
    }

    // 文字列の頭から末尾まで当てる（規則表の形は ^…$。JS の $ は末尾の改行の手前では当たらないので、そのまま末尾まで）
    function idPatternOk(kind, v) {
      const p = own(R.id_patterns, kind);
      return !p || (typeof v === 'string' && new RegExp(p).test(v));
    }

    function enumOf(VER, name) {
      return own(VER.enum_overrides, name) || own(R.enums, name);
    }

    // その欄がこの版の定義に入っているか（任意の欄か、req が版の required_levels にある欄）。rt.py の _field_in_version と同じ
    function inVersion(fd, VER) {
      return fd.req === 'opt' || VER.required_levels.indexOf(fd.req) >= 0;
    }

    // inLog が真なら既存のログの行（道具が押す欄・埋める欄も、もう書かれているはずなので欠けとして見る。rt.py の incoming=False と同じ）
    function checkFields(ev, where, VER, errs, inLog) {
      const def = own(R.events, ev.e);
      const fields = def.fields;
      const lab = label(ev);
      if (VER.strict_keys) {
        for (const k of Object.keys(ev)) {
          if (k !== 'e' && !has(fields, k)) errs.push('F05: ' + where + ': ' + lab + ' に知らない欄「' + k + '」があります');
        }
      }
      for (const name of Object.keys(fields)) {
        const fd = fields[name];
        if (!has(ev, name)) {
          // 道具が押す欄（step.at など）は、無くても道具が足すので欠けとしない。
          // 道具が埋める欄（fix.was など）は、版の fill_was が true のときだけ同じ扱い。v1 では分析役が書くので必須（rt.py と同じ）
          const filledByTool = !inLog && (fd.tool_writes || (fd.tool_fills && VER.fill_was));
          if (!filledByTool && VER.required_levels.indexOf(fd.req) >= 0) errs.push('F01: ' + where + ': ' + lab + ' に ' + name + ' がありません');
          continue;
        }
        const v = ev[name];
        if (v === null) {
          if (!fd.null) errs.push('F02: ' + where + ': ' + lab + ' の ' + name + ' は null にできません');
          continue;
        }
        if (!typeOk(fd.type, v)) { errs.push('F02: ' + where + ': ' + lab + ' の ' + name + ' の型が違います（' + fd.type + ' のはず）'); continue; }
        // 配列の長さ（lines / t は必ず 2 つ）は形の一部なので版に依らず見る
        if (Array.isArray(v) && fd.type.indexOf('arr:') === 0) {
          if ((fd.min != null && v.length < fd.min) || (fd.max != null && v.length > fd.max)) {
            errs.push('F02: ' + where + ': ' + lab + ' の ' + name + ' の長さが違います（' + v.length + ' 件）'); continue;
          }
        }
        // 欄の定義にある値の範囲（card.d は 0 以上、open.window は 5〜180 など）も欄の形の一部なので、
        // その版に在る欄なら版に依らず見る。その版に無い欄（v1 の open.window）は見ない（rt.py の _field_in_version と同じ）。
        // 字数・件数の上限（limits）とは別物で、そちらは版の limits が true のときだけ（下）。
        // list.n の下限は P18 が受け持つ（rt.py の PROCEDURAL_MIN と同じ）
        if ((fd.type === 'int' || fd.type === 'num') && inVersion(fd, VER) && !(ev.e === 'list' && name === 'n') && ((fd.min != null && v < fd.min) || (fd.max != null && v > fd.max))) {
          errs.push('F04: ' + where + ': ' + lab + ' の ' + name + ' が ' + v + ' です（' + (fd.min != null ? fd.min + ' 以上' : '') + (fd.max != null ? ' ' + fd.max + ' 以下' : '') + '）');
        }
        if (fd.enum) {
          const list = enumOf(VER, fd.enum);
          if (list.indexOf(v) < 0) errs.push('F03: ' + where + ': ' + lab + ' の ' + name + ' が「' + v + '」です（' + list.join(' / ') + ' のどれか）');
        }
        if (VER.id_patterns) {
          if (fd.type.indexOf('id:') === 0 && !idPatternOk(fd.type.slice(3), v)) errs.push('F06: ' + where + ': ' + lab + ' の ' + name + '「' + v + '」は id の形が違います');
          if (fd.type.indexOf('arr:id:') === 0) {
            v.forEach(function (x) { if (!idPatternOk(fd.type.slice(7), x)) errs.push('F06: ' + where + ': ' + lab + ' の ' + name + ' の「' + x + '」は id の形が違います'); });
          }
          if (fd.type === 'li' && !idPatternOk('list', v[0])) errs.push('F06: ' + where + ': ' + lab + ' の li の「' + v[0] + '」は数え上げの id の形が違います');
        }
        if (VER.limits) {
          const lim = own(R.limits, ev.e + '.' + name);
          if (lim && typeof v === 'string') {
            const n = len(v);
            if (n < lim.min || n > lim.max) errs.push('F04: ' + where + ': ' + lab + ' の ' + name + ' が ' + n + ' 字です（' + lim.min + '〜' + lim.max + ' 字）');
          }
          const each = own(R.limits, ev.e + '.' + name + '[]');
          if (each && Array.isArray(v)) {
            v.forEach(function (x, i) {
              const n = len(x);
              if (n < each.min || n > each.max) errs.push('F04: ' + where + ': ' + lab + ' の ' + name + ' の ' + (i + 1) + ' 件目が ' + n + ' 字です（' + each.min + '〜' + each.max + ' 字）');
            });
          }
        }
      }
    }

    // ---- 本体 ----

    function verify(log, batchIn, opts) {
      opts = opts || {};
      const errs = [], warns = [];
      const result = function (batchOut) {
        return { ok: errs.length === 0, errors: errs, warnings: warns, batch: errs.length === 0 ? batchOut : null };
      };
      if (!Array.isArray(log)) log = [];
      if (!Array.isArray(batchIn) || batchIn.length === 0) { errs.push('P02: 追記が空です'); return result(null); }
      // 分析役が step・end・pause に書いた at は、どの検査よりも前に捨てる（値の検査にもかけない。道具が押し直す）
      const batchWork = batchIn.map(dropAt);
      // 記録に書けない値（有限でない数・2^53 − 1 を超える数・対になっていないサロゲート・深すぎる入れ子）は写す前に見る
      // （JSON に写すと有限でない数は null に化けて、違反の文が実際と合わなくなる。深すぎる入れ子は写すときに落ちる）
      const maxDepth = isInt(own(R.limits, 'value.max_depth')) ? own(R.limits, 'value.max_depth') : 32;
      const BAD_MSG = {
        nonfinite: 'に有限でない数があります（数は有限のものだけ）',
        big: 'に絶対値が 9007199254740991（2^53 − 1）を超える数があります（記録に書ける数はそこまで）',
        lone: 'に、対になっていないサロゲート（文字として読めない片割れ）があります',
        deep: 'の入れ子が ' + maxDepth + ' 段を超えています（配列やオブジェクトを重ねられるのは ' + maxDepth + ' 段まで）'
      };
      function checkValues(ev, where) {
        if (!isObj(ev)) return;
        Object.keys(ev).forEach(function (k) {
          if (k === 'e') return;   // 種類の欄は下で種類として見る（文字列でなければ F07。rt.py と同じ）
          if (loneSurrogate(k)) { errs.push('F02: ' + where + ': ' + label(ev) + ' の欄の名前' + BAD_MSG.lone); return; }
          const r = badValue(ev[k], maxDepth);
          if (r) errs.push('F02: ' + where + ': ' + label(ev) + ' の ' + k + ' ' + BAD_MSG[r]);
        });
      }
      log.forEach(function (e, i) { checkValues(e, 'ログ' + (i + 1) + '行目'); });
      batchWork.forEach(function (e, i) { checkValues(e, '追記' + (i + 1) + '件目'); });
      if (errs.length) return result(null);
      const batch = clone(batchWork);
      const clock = opts.now || new Date().toISOString();

      // 種類として読める行か（オブジェクトで、e が規則表の種類で、この版にある）
      function knownKind(e, VER) { const k = kindOf(e); return k !== null && has(R.events, k) && VER.kinds.indexOf(k) >= 0; }
      function badKind(e, where, verKey) {
        errs.push('F07: ' + where + ': ' + (kindOf(e) !== null ? '「' + e.e + '」' : 'この種類') + ' は版 v' + verKey + ' に無い種類のイベントです');
      }

      // P01: open の置き場と版の決定
      let verKey = null;
      let start = 0;
      if (log.length === 0) {
        if (kindOf(batch[0]) !== 'open') errs.push('P01: 空のログの 1 行目に書けるのは open だけです');
        else { verKey = detectVersion(R, batch[0]); start = 1; }
      } else {
        if (kindOf(log[0]) !== 'open') errs.push('P01: ログの先頭に open がありません');
        else verKey = detectVersion(R, log[0]);
        batch.forEach(function (e, i) { if (kindOf(e) === 'open') errs.push('P01: 追記' + (i + 1) + '件目: open を書けるのは空のログの 1 行目だけです'); });
      }
      if (verKey == null) {
        const ov = (log.length ? log[0] : batch[0]);
        if (kindOf(ov) === 'open') errs.push('F07: open の v「' + JSON.stringify(ov.v) + '」は知らない版です');
        verKey = Object.keys(R.versions).slice(-1)[0]; // 検査を続けるための仮の版（結果はすでに拒否）
      }
      const VER = R.versions[verKey];
      // 既存のログの欄も見る（rt.py の fold と同じ線。欄の壊れた行があれば追記しない）。
      // 手順の規則（P）までは見直さない。画面が作るログは追記のたびに検査済みなので、ここで鳴るのは外から渡された壊れたログ
      const nBefore = errs.length;
      log.forEach(function (e, i) {
        const where = 'ログ' + (i + 1) + '行目';
        if (!knownKind(e, VER)) { badKind(e, where, verKey); return; }
        checkFields(e, where, VER, errs, true);
      });
      if (errs.length > nBefore) return result(null);
      const st = buildState(R, log, verKey);

      if (st.ended) { errs.push('P21: end の後には何も追記できません'); return result(null); }

      if (start === 1) {
        // open は1件だけの追記（次の追記で1ステップ目を書く）。step や他のイベントを同じ追記に混ぜない（rt.py と同じ線）
        checkFields(batch[0], '追記1件目', VER, errs);
        // P30: 素材の名前（上限を当てる版＝v2）。素材ファイルとメモ帳の名前（limits.open.src_ext）だけを受ける。大小文字は問わない
        const exts = own(R.limits, 'open.src_ext');
        if (VER.limits && Array.isArray(exts) && exts.length && typeof batch[0].src === 'string') {
          const low = batch[0].src.toLowerCase();
          if (!exts.some(function (x) { return typeof x === 'string' && x && low.endsWith(x.toLowerCase()); })) {
            // 長い名前は終わりの 59 字だけを出す（頭に「…」）。断る理由は名前の終わり（拡張子）にあるので、終わりを残す（rt.py と同じ）
            const cps = Array.from(batch[0].src);
            const shown = cps.length > 60 ? '…' + cps.slice(-59).join('') : batch[0].src;
            errs.push('P30: 追記1件目: 素材の名前 ' + JSON.stringify(shown) + ' は ' + exts.join('・') + ' で終わっていません（素材にできるのは素材ファイルとメモ帳だけ。判断ログ・素材ログ・印・覚え書きは素材にできません）');
          }
        }
        if (batch.length > 1) { errs.push('P02: 追記2件目: open は1件だけの追記にします（1ステップ目は次の追記で書きます）'); return result(null); }
        return result(batch);
      }
      const rest = batch.slice(start);

      // P02: 追記の形
      const isStandalone = function (e) { const k = kindOf(e); return k !== null && has(R.events, k) && !!R.events[k].standalone; };
      const standalone = rest.length === 1 && isStandalone(rest[0]);
      if (!standalone) {
        rest.forEach(function (e, i) {
          if (isStandalone(e)) errs.push('P02: 追記' + (start + i + 1) + '件目: ' + label(e) + ' は1件だけの追記で書きます');
        });
        if (kindOf(rest[0]) !== 'step') errs.push('P02: 追記の 1 件目は step にします（' + label(rest[0]) + ' になっています）');
        const nSteps = rest.filter(function (e) { return kindOf(e) === 'step'; }).length;
        if (nSteps > 1) errs.push('P02: step は 1 回の追記に 1 つまでです（' + nSteps + ' つあります）');
      }

      // 採番の起点
      const seqIds = VER.sequential_ids ? (opts.next_ids ? clone(opts.next_ids) : nextIdsOf(st)) : null;
      function takeId(kind, id, where, lab) {
        if (!seqIds) return;
        const want = seqIds[kind];
        if (id !== want) errs.push('P11: ' + where + ': ' + lab + 'の id は ' + want + ' のはずです（' + id + ' になっています）');
        if (kind === 'group') seqIds.group = colName(colIndex(want) + 1);
        else seqIds[kind] = want[0] + (Number(want.slice(1)) + 1);
      }
      function colIndex(name) { let k = 0; for (const ch of name) k = k * 26 + (ch.charCodeAt(0) - 64); return k; }
      // 欄の形の検査に落ちた card・hold・group・list の id だけを状態に取る（表示に要る欄は無難な値で埋める。rt.py の
      // _register_broken と同じ）。id の欄が壊れていれば、採番のある版では次に来るはずの id として取る
      function registerBroken(e, where, lab) {
        const k = e.e;
        if (k !== 'card' && k !== 'hold' && k !== 'group' && k !== 'list') return;
        let id = e.id;
        if (typeof id !== 'string' || id === '') {
          if (!seqIds) return;
          id = seqIds[k];
        }
        takeId(k, id, where, lab);
        const t = isNum(e.t) ? e.t : 0;
        if (k === 'card') {
          put(st.cards, id, { id: id, t: t, d: isInt(e.d) ? e.d : 0, role: typeof e.role === 'string' ? e.role : 'claim',
            ti: typeof e.ti === 'string' ? e.ti : '', b: typeof e.b === 'string' ? e.b : '', li: isPair(e.li) ? e.li : null });
        } else if (k === 'hold') {
          put(st.holds, id, { id: id, t: t, q: typeof e.q === 'string' ? e.q : '', kind: typeof e.kind === 'string' ? e.kind : null, closes: 0 });
          batchHoldIds[id] = true;
        } else if (k === 'group') {
          const sp = isPair(e.span) && isNum(e.span[0]) && (e.span[1] === null || isNum(e.span[1])) ? e.span.slice() : [t, null];
          put(st.groups, id, { id: id, t: t, span: sp, lb: typeof e.lb === 'string' ? e.lb : '' });
        } else {
          const items = Array.isArray(e.items) && e.items.every(function (x) { return typeof x === 'string'; }) ? e.items.slice() : [];
          put(st.lists, id, { id: id, t: t, n: isInt(e.n) ? e.n : Math.max(2, items.length), items: items });
        }
      }

      // 素材ログの発話の時刻（P29）。i → t。素材ログが無ければ null（検査しない）。発話でない行（認識の切断など）は入れない
      let srcTime = null;
      if (Array.isArray(opts.src)) {
        srcTime = Object.create(null);
        opts.src.forEach(function (l) { if (isObj(l) && isInt(l.i) && isNum(l.t)) srcTime[l.i] = l.t; });
      }

      // 話者（P20）。値そのもので持つ（Set。constructor・__proto__ という話者名でも誤らない）
      let speakers = null;
      function speakersUpTo(lastLine) {
        if (!Array.isArray(opts.src)) return null;
        const s = new Set();
        // 空の話者名（話者の列が空の行）は話者として数えない（rt.py と同じ）
        opts.src.forEach(function (l) { if (isObj(l) && isInt(l.i) && l.i <= lastLine && l.who != null && l.who !== '') s.add(l.who); });
        return s;
      }
      function checkWho(ev, where, lab) {
        if (!speakers) return;
        if (ev.who != null && !speakers.has(ev.who)) errs.push('P20: ' + where + ': ' + lab + ' の話者「' + ev.who + '」は、聞いた範囲に出てきていません');
      }

      let step = standalone ? st.lastStep : null;          // 検査の文脈になるステップ
      let brokenStep = false;                                // この追記の step の lines・t が壊れている（欄の検査が拒んでいる）
      const srcMin = isInt(VER.card_src_min) ? VER.card_src_min : 0;   // カードの根拠の発話の数の下限（v2 は 1）
      const batchCards = [], batchHoldIds = table(), closedInBatch = table();
      const counts = { card: 0, hold: 0, close: 0, note: 0 };
      const hedge = own(R.limits, 'warn.hedge_words') || [];

      rest.forEach(function (e, idx) {
        const where = '追記' + (start + idx + 1) + '件目';
        if (!knownKind(e, VER)) { badKind(e, where, verKey); return; }
        const lab = label(e);
        // at は道具が押す欄（分析役が書いた値は、上の dropAt がどの検査よりも前に捨ててある）。版に無ければ押さない
        if (e.e === 'step' && VER.step_at) e.at = clock;
        if (e.e === 'end' || e.e === 'pause') e.at = clock;
        const errsBefore = errs.length;
        checkFields(e, where, VER, errs);
        if (has(counts, e.e)) counts[e.e]++;

        if (e.e === 'step') {
          // 欄の形の検査に落ちた step（n・lines・t が無い・型が違う・長さが違う・知らない欄など。範囲と上限の F04 は除く）は、
          // 違反を欄の検査が出している。番号や窓の検査はせず、続くイベントは聞いた範囲・話者・根拠の発話の時刻を使う検査を
          // 飛ばして、ほかの検査だけをする。窓の終わり（P09）は、t が [数, 数] なら使う（rt.py と同じ）
          const shapeBad = errs.slice(errsBefore).some(function (m) { return m.indexOf('F04:') !== 0; });
          if (shapeBad || !isPair(e.lines) || !isPair(e.t) || !e.lines.every(isInt) || !e.t.every(isNum)) { step = e; brokenStep = true; speakers = null; return; }
          const prev = st.lastStep;
          const wantN = prev ? prev.n + 1 : 1;
          if (e.n !== wantN) errs.push('P03: ' + where + ': ステップ番号は ' + wantN + ' のはずです（' + e.n + ' になっています）');
          const wantLine = prev ? prev.lines[1] + 1 : 1;
          if (e.lines[0] !== wantLine) errs.push('P04: ' + where + ': 発話は ' + wantLine + ' 番目から続けて読むはずです（' + e.lines[0] + ' 番目からになっています）');
          if (e.lines[1] < e.lines[0]) errs.push('P04: ' + where + ': 行の範囲が逆です');
          if (VER.cut === 'chunk') {
            const chunk = st.open && st.open.chunk;
            if (chunk && e.lines[1] - e.lines[0] + 1 > chunk) errs.push('P05: ' + where + ': chunk が ' + chunk + ' 行なので、1 つのステップは ' + chunk + ' 行までです（' + (e.lines[1] - e.lines[0] + 1) + ' 行あります）');
            if (st.prevShort) errs.push('P05: ' + where + ': chunk（' + chunk + ' 行）より短いステップは最後の 1 つだけです（前のステップが短かったので、素材はそこで終わっています）');
            if (e.t[1] < e.t[0]) errs.push('P05: ' + where + ': 時刻の範囲が逆です');
            if (prev && e.t[0] < prev.t[0]) errs.push('P06: ' + where + ': 始まり ' + fmt(e.t[0]) + ' が、直前のステップの始まり ' + fmt(prev.t[0]) + ' より前です');
          } else {
            const w = st.open && isNum(st.open.window) ? st.open.window : null;
            const factor = own(R.limits, 'step.width_factor') || 3;
            // 1 つの窓に入る発話の数（limits の版だけ）。超えた分は次の窓に回す決まりなので、超えた窓は書けない
            const maxLines = VER.limits ? own(R.limits, 'step.max_lines') : null;
            const nLines = e.lines[1] - e.lines[0] + 1;
            // 上限ちょうどの窓は、終わりを渡さなかった最初の発話の時刻まで縮めるので、始まりと同じ時刻（幅 0）でもよい
            const capped = isInt(maxLines) && nLines === maxLines;
            if (e.t[1] < e.t[0]) errs.push('P05: ' + where + ': 窓の終わり ' + fmt(e.t[1]) + ' が始まり ' + fmt(e.t[0]) + ' より前です');
            else if (e.t[1] === e.t[0] && !capped) errs.push('P05: ' + where + ': 窓の終わり ' + fmt(e.t[1]) + ' が始まり ' + fmt(e.t[0]) + ' と同じです（幅 0 の窓は、発話がちょうど ' + (isInt(maxLines) ? maxLines : '上限の') + ' 件で、終わりを縮めた窓だけ）');
            else if (w != null && e.t[1] - e.t[0] > w * factor) errs.push('P05: ' + where + ': 窓の幅 ' + (e.t[1] - e.t[0]) + ' 秒が上限 ' + (w * factor) + ' 秒（' + w + '×' + factor + '）を超えています');
            if (isInt(maxLines) && nLines > maxLines) errs.push('P05: ' + where + ': 1 つの窓の発話が ' + nLines + ' 件です（' + maxLines + ' 件まで。超えた分は次の窓）');
            if (prev && e.t[0] < prev.t[1]) errs.push('P06: ' + where + ': 窓の始まり ' + fmt(e.t[0]) + ' が直前のステップの終わり ' + fmt(prev.t[1]) + ' より前です（窓は重ならない）');
          }
          if (e.t[0] < 0) errs.push('P29: ' + where + ': 窓の始まり ' + fmt(e.t[0]) + ' が 0 より前です（時刻は 0 以上）');
          if (st.paused && isNum(st.paused.t) && e.t[0] < st.paused.t) errs.push('P06: ' + where + ': 窓の始まり ' + fmt(e.t[0]) + ' が中断した時刻 ' + fmt(st.paused.t) + ' より前です');
          if (opts.window) {
            const w = opts.window;
            if (w.t && !deepEq(w.t, e.t)) errs.push('P07: ' + where + ': 渡した窓は ' + fmt(w.t[0]) + '〜' + fmt(w.t[1]) + ' ですが、' + fmt(e.t[0]) + '〜' + fmt(e.t[1]) + ' になっています');
            if (w.lines && !deepEq(w.lines, e.lines)) errs.push('P07: ' + where + ': 渡した行は ' + w.lines[0] + '〜' + w.lines[1] + ' ですが、' + e.lines[0] + '〜' + e.lines[1] + ' になっています');
          }
          // P07: 素材ログ（src）を渡されたとき、窓と発話の時刻の関係を照らす（v2 の時間の窓だけ。rt.py の compute_window が作る形）。
          //   幅のある窓 [t0, t1]: 渡した発話はどれも t1 より前。渡さなかった次の発話（lines[1] + 1）は t1 以後
          //     （t1 より前なら、窓はその発話を渡すか、上限で切って終わりをその時刻まで縮めるはずだった）
          //   幅 0 の窓 [T, T]（上限ちょうどの件数。P05）:
          //     始まりが直前の窓の終わり（無ければ 0）より先へ進んだ窓は、同じ時刻 T の塊が窓の最初の発話から始まる形なので、
          //     渡した発話はどれも T ちょうどで、次の発話は T 以後
          //     進んでいない窓は、遅れて届いた発話（時刻が窓の始まり以下）で上限に当たった形なので、渡した発話も次の発話も T 以下
          //   窓の始まりより前の発話（live で遅れて届いた分）は、幅のある窓では拒まない（rt.py と同じ）
          if (VER.cut !== 'chunk' && srcTime) {
            const zero = e.t[1] === e.t[0];
            const base = prev ? prev.t[1] : 0;
            const jumped = zero && e.t[0] > base;
            const why = !zero ? '窓に入るのは、窓の終わりより前の発話だけ。終わりちょうどの発話は次の窓'
              : jumped ? '始まりを進めた幅 0 の窓に入るのは、窓と同じ時刻の発話だけ'
                : '始まりを進めていない幅 0 の窓に入るのは、窓の時刻以下の発話だけ（遅れて届いた発話で上限に当たった形）';
            // 件数の上限（P05）を超える窓でも、見るのは先頭の 1000 件まで（とても大きな lines でも止まらない）
            for (let i = e.lines[0]; i <= e.lines[1] && i - e.lines[0] < 1000; i++) {
              if (!HAS.call(srcTime, i)) continue;
              const ut = srcTime[i];
              if (!zero ? ut >= e.t[1] : jumped ? ut !== e.t[1] : ut > e.t[1]) {
                errs.push('P07: ' + where + ': 発話 ' + i + ' の時刻 ' + fmt(ut) + ' が窓 ' + fmt(e.t[0]) + '〜' + fmt(e.t[1]) + ' に合いません（' + why + '）');
                break;
              }
            }
            const nx = e.lines[1] + 1;
            if (HAS.call(srcTime, nx)) {
              const nt = srcTime[nx];
              if ((!zero || jumped) && nt < e.t[1]) {
                errs.push('P07: ' + where + ': 渡さなかった発話 ' + nx + ' の時刻 ' + fmt(nt) + ' が窓の終わり ' + fmt(e.t[1]) + ' より前です（窓の中の時刻の発話は渡すか、上限で切ったなら終わりをその時刻まで縮める）');
              } else if (zero && !jumped && nt > e.t[1]) {
                errs.push('P07: ' + where + ': 渡さなかった発話 ' + nx + ' の時刻 ' + fmt(nt) + ' が、始まりを進めていない幅 0 の窓 ' + fmt(e.t[0]) + '〜' + fmt(e.t[1]) + ' より後です（その形になるのは、上限を超えた分も窓の時刻以下に遅れて届いたときだけ。ほかは終わりを次の発話の時刻まで縮める）');
              }
            }
          }
          if (opts.heard_until != null && e.t[1] > opts.heard_until) errs.push('P09: ' + where + ': 窓の終わり ' + fmt(e.t[1]) + ' は、まだ聞き終えていない時刻です（聞き終えているのは ' + fmt(opts.heard_until) + ' まで）');
          if (VER.step_at && prev && prev.at && isoSec(clock) < isoSec(prev.at)) errs.push('P08: ' + where + ': 壁時計 ' + clock + ' が直前のステップの ' + prev.at + ' より前です');
          // P27: live の記録では、聞き終える前に判断を押せない（壁時計 − 聞き始め ≧ 窓の終わり）
          if (VER.live_at_after_heard && st.open && st.open.mode === 'live') {
            const heard = isoSec(clock) - isoSec(st.open.t0);
            if (isFinite(heard) && heard < e.t[1]) {
              const since = heard >= 0 ? 'から ' + fmt(heard) + ' しか経っておらず' : 'より ' + fmt(-heard) + ' 前で';
              errs.push('P27: ' + where + ': 壁時計 ' + clock + ' は聞き始め ' + st.open.t0 + ' ' + since + '、窓の終わり ' + fmt(e.t[1]) + ' をまだ聞き終えていません（聞き終える前に判断を押せない）');
            }
          }
          step = e; brokenStep = false;
          speakers = speakersUpTo(e.lines[1]);
          return;
        }

        if (e.e === 'end' || e.e === 'pause') {
          if (isNum(e.t) && e.t < 0) errs.push('P29: ' + where + ': ' + lab + ' の時刻 ' + fmt(e.t) + ' が 0 より前です（時刻は 0 以上）');
          // 比べる相手は直前の step（同じ追記に step があればそれ。混ぜた追記は P02 で拒むが、rt.py と同じ相手で比べる）
          // 同じ追記の step が壊れているときは、その step とは比べない（窓の終わりが分からない）
          const prev = brokenStep ? null : (step || st.lastStep);
          if (isNum(e.t) && prev && e.t < prev.t[1]) {
            errs.push((e.e === 'end' ? 'P21' : 'P22') + ': ' + where + ': ' + lab + ' の時刻 ' + fmt(e.t) + ' が、直前の窓の終わり ' + fmt(prev.t[1]) + ' より前です');
          }
          // P22: 中断は読み終えた所で置く。直前の step の t[1]（step がまだ無ければ 0）より先には置けない
          // （先に置くと、再開した窓がその間の発話をまとめて渡すことになる）
          const heard = prev ? prev.t[1] : 0;
          if (e.e === 'pause' && isNum(e.t) && !brokenStep && e.t > heard) {
            errs.push('P22: ' + where + ': ' + lab + ' の時刻 ' + fmt(e.t) + ' は読み終えた ' + fmt(heard) + ' より先です（中断は読み終えた時刻に置く）');
          }
          return;
        }

        // ここから step の後ろのイベント
        if (!step) { errs.push('P02: ' + where + ': step より前に ' + lab + ' があります'); return; }
        // 欄の形の検査に落ちたイベントは、id だけを取って、ほかの検査をしない（連鎖した文を重ねない。rt.py と同じ）
        if (errs.slice(errsBefore).some(function (m) { return m.indexOf('F04:') !== 0; })) { registerBroken(e, where, lab); return; }
        const end = isPair(step.t) && step.t.every(isNum) ? step.t[1] : null;
        if (isNum(e.t) && end != null && e.t > end) errs.push('P09: ' + where + ': 時刻 ' + fmt(e.t) + ' は、この窓の終わり ' + fmt(end) + ' より後です（まだ聞いていない所には書けない）');
        if (isNum(e.t) && e.t < 0) errs.push('P29: ' + where + ': ' + lab + ' の時刻 ' + fmt(e.t) + ' が 0 より前です（時刻は 0 以上）');

        switch (e.e) {
          case 'card': {
            if (typeof e.id === 'string') {
              if (has(st.cards, e.id)) errs.push('P12: ' + where + ': カード ' + e.id + ' は既にあります');
              takeId('card', e.id, where, 'カード');
            }
            if (Array.isArray(e.src)) {
              // P29: 根拠の発話の無いカードは、並びの位置を確かめられない（先頭などへ置けてしまう）。v2 では書けない
              if (e.src.length < srcMin) errs.push('P29: ' + where + ': カード' + tag(e.id) + ' に根拠の発話（src）がありません（根拠の無いカードは並びの位置を確かめられないので、' + srcMin + ' つ以上要ります）');
              else if (!e.src.length) warns.push('P19: ' + where + ': カード' + tag(e.id) + ' の根拠の発話（src）が空です');
              const last = !brokenStep && isPair(step.lines) && isInt(step.lines[1]) ? step.lines[1] : null;
              if (!brokenStep) e.src.forEach(function (i) { if (!isInt(i) || i < 1 || (last != null && i > last)) errs.push('P19: ' + where + ': カード' + tag(e.id) + ' の根拠の発話 ' + safeText(i) + ' は聞いた範囲（1〜' + last + '）の外です'); });
              // P29: 並びの位置は、根拠の発話の時刻の間（素材ログがあって、その発話の時刻が分かるときだけ）
              const ts = [];
              if (!brokenStep) e.src.forEach(function (i) { if (isInt(i) && srcTime && HAS.call(srcTime, i)) ts.push(srcTime[i]); });
              if (ts.length && isNum(e.t)) {
                const lo = Math.min.apply(null, ts), hi = Math.max.apply(null, ts);
                if (e.t < lo || e.t > hi) errs.push('P29: ' + where + ': カード ' + safeText(e.id) + ' の時刻 ' + fmt(e.t) + ' は、根拠の発話の時刻 ' + fmt(lo) + '〜' + fmt(hi) + ' の外です（並びの位置は根拠の発話の時刻の間に置く）');
              }
            }
            if (e.li != null && isPair(e.li)) {
              const l = own(st.lists, e.li[0]);
              if (!l) errs.push('P10: ' + where + ': カード ' + e.id + ' が指す数え上げ ' + e.li[0] + ' がありません');
              else if (!(e.li[1] >= 1 && e.li[1] <= l.n)) errs.push('P18: ' + where + ': カード ' + e.id + ' の番目 ' + e.li[1] + ' は数え上げ ' + e.li[0] + ' の範囲（1〜' + l.n + '）の外です');
            }
            checkWho(e, where, 'カード ' + e.id);
            hedge.forEach(function (wd) {
              if (typeof e.ti === 'string' && e.ti.indexOf(wd) >= 0) warns.push('P24: ' + where + ': カード ' + e.id + ' の見出しに推量語「' + wd + '」があります');
              if (typeof e.b === 'string' && e.b.indexOf(wd) >= 0) warns.push('P24: ' + where + ': カード ' + e.id + ' の詳細に推量語「' + wd + '」があります');
            });
            batchCards.push(e);
            applyToState(st, e, VER);
            break;
          }
          case 'hold': {
            if (typeof e.id === 'string') {
              if (has(st.holds, e.id)) errs.push('P12: ' + where + ': 保留 ' + e.id + ' は既にあります');
              takeId('hold', e.id, where, '保留');
              batchHoldIds[e.id] = true;
            }
            checkWho(e, where, '保留 ' + e.id);
            applyToState(st, e, VER);
            break;
          }
          case 'close': {
            const h = own(st.holds, e.id);
            if (!h) errs.push('P13: ' + where + ': 保留 ' + e.id + ' は開かれていません');
            else if (isNum(e.t) && isNum(h.t) && e.t < h.t) errs.push('P29: ' + where + ': 決着 ' + safeText(e.id) + ' の時刻 ' + fmt(e.t) + ' が、保留を開いた ' + fmt(h.t) + ' より前です');
            if (Array.isArray(e.by)) e.by.forEach(function (c) { if (!has(st.cards, c)) errs.push('P10: ' + where + ': 決着 ' + e.id + ' の by が指すカード ' + c + ' がありません'); });
            if (h) { closedInBatch[e.id] = true; applyToState(st, e, VER); }
            break;
          }
          case 'fix': {
            const f = e.field;
            const kind = own(R['fix.target'], f);
            if (!kind) break; // field の違反は欄の検査が出している
            const pool = kind === 'card' ? st.cards : kind === 'group' ? st.groups : st.lists;
            const target = own(pool, e.id);
            if (!target) {
              const other = own(st.cards, e.id) || own(st.groups, e.id) || own(st.lists, e.id);
              if (other) errs.push('P14: ' + where + ': 訂正の欄「' + f + '」は' + TARGET_LABEL[kind] + 'の欄ですが、' + e.id + ' は' + TARGET_LABEL[has(st.cards, e.id) ? 'card' : has(st.groups, e.id) ? 'group' : 'list'] + 'です');
              else errs.push('P10: ' + where + ': 訂正の対象 ' + e.id + ' がありません');
              break;
            }
            const now = e.now;
            const lim = function (key) { return VER.limits ? own(R.limits, key) : null; };
            if (f === 'd') { if (!isInt(now) || now < 0) errs.push('P14: ' + where + ': 深さの訂正後の値は 0 以上の整数です（' + JSON.stringify(now) + '）'); }
            else if (f === 'ti' || f === 'b') {
              if (typeof now !== 'string') errs.push('P14: ' + where + ': ' + f + ' の訂正後の値は文字列です');
              else { const L = lim('card.' + f); if (L && (len(now) < L.min || len(now) > L.max)) errs.push('P14: ' + where + ': ' + f + ' の訂正後の値が ' + len(now) + ' 字です（' + L.min + '〜' + L.max + ' 字）'); }
            }
            else if (f === 'role') { const list = enumOf(VER, 'role'); if (list.indexOf(now) < 0) errs.push('P14: ' + where + ': role の訂正後の値「' + now + '」は ' + list.join(' / ') + ' のどれでもありません'); }
            else if (f === 'span') {
              if (!typeOk('span', now)) errs.push('P14: ' + where + ': span の訂正後の値は、始まりと終わり（終わりは null でもよい）の 2 つ組です');
              else {
                if (now[0] > target.t) errs.push('P14: ' + where + ': 括り ' + e.id + ' の始まり ' + fmt(now[0]) + ' が印の位置 ' + fmt(target.t) + ' より後です');
                if (now[1] != null && now[1] < now[0]) errs.push('P14: ' + where + ': 括り ' + e.id + ' の終わり ' + fmt(now[1]) + ' が始まり ' + fmt(now[0]) + ' より前です');
                if (now[1] != null && end != null && now[1] > end) errs.push('P14: ' + where + ': 括り ' + e.id + ' の終わり ' + fmt(now[1]) + ' は、まだ聞いていない所です（聞き終えたのは ' + fmt(end) + '）');
              }
            }
            else if (f === 'items') {
              if (!typeOk('arr:str', now)) errs.push('P14: ' + where + ': items の訂正後の値は文字列の配列です');
              else {
                if (now.length > target.n) errs.push('P14: ' + where + ': 数え上げ ' + e.id + ' の項目が ' + now.length + ' 件で、宣言された数 ' + target.n + ' を超えています');
                const L = lim('list.items[]');
                if (L) now.forEach(function (x, i) { if (len(x) < L.min || len(x) > L.max) errs.push('P14: ' + where + ': 数え上げ ' + e.id + ' の ' + (i + 1) + ' 件目が ' + len(x) + ' 字です（' + L.min + '〜' + L.max + ' 字）'); });
              }
            }
            else if (f === 'n') {
              if (!isInt(now) || now < 2) errs.push('P14: ' + where + ': 数え上げの数は 2 以上の整数です（' + JSON.stringify(now) + '）');
              else if (now < target.items.length) errs.push('P14: ' + where + ': 数え上げ ' + e.id + ' の数 ' + now + ' が、分かっている項目 ' + target.items.length + ' 件より少なくなります');
            }
            if (VER.fill_was) {
              // 道具が埋める was は now の手前に置く（書き出した1行が rt.py と同じ並びになる）
              if (e.was === undefined) { e = insertBefore(e, 'now', 'was', clone(target[f])); batch[start + idx] = e; }
              else if (!deepEq(e.was, target[f])) errs.push('P14: ' + where + ': 訂正の was ' + JSON.stringify(e.was) + ' が現状 ' + JSON.stringify(target[f]) + ' と違います');
            }
            applyToState(st, e, VER);
            break;
          }
          case 'group': {
            if (typeof e.id === 'string') {
              if (has(st.groups, e.id)) errs.push('P12: ' + where + ': 括り ' + e.id + ' は既にあります');
              takeId('group', e.id, where, '括り');
            }
            if (typeOk('span', e.span) && isNum(e.t)) {
              if (e.span[0] > e.t) errs.push('P15: ' + where + ': 括り ' + e.id + ' の始まり ' + fmt(e.span[0]) + ' が印の位置 ' + fmt(e.t) + ' より後です');
              if (e.span[1] != null && e.span[1] < e.span[0]) errs.push('P15: ' + where + ': 括り ' + e.id + ' の終わり ' + fmt(e.span[1]) + ' が始まり ' + fmt(e.span[0]) + ' より前です');
              if (e.span[1] != null && end != null && e.span[1] > end) errs.push('P15: ' + where + ': 括り ' + e.id + ' の終わり ' + fmt(e.span[1]) + ' は、まだ聞いていない所です（聞き終えたのは ' + fmt(end) + '）');
            }
            applyToState(st, e, VER);
            break;
          }
          case 'rename': {
            const g = own(st.groups, e.id);
            if (!g) { errs.push('P10: ' + where + ': 名前を変える括り ' + e.id + ' がありません'); break; }
            if (VER.fill_was) {
              // was と現状は JSON の文字列で比べる（fix と同じ。rt.py とも同じ）
              if (e.was === undefined) { e = insertBefore(e, 'now', 'was', g.lb); batch[start + idx] = e; }
              else if (!deepEq(e.was, g.lb)) errs.push('P14: ' + where + ': 名前の変更の was ' + JSON.stringify(e.was) + ' が現状 ' + JSON.stringify(g.lb) + ' と違います');
            }
            applyToState(st, e, VER);
            break;
          }
          case 'top': {
            if (!has(st.cards, e.id)) { errs.push('P10: ' + where + ': 最上位候補のカード ' + e.id + ' がありません'); break; }
            const cur = st.top ? st.top.id : null;
            const prev = e.prev == null ? null : e.prev;
            if (prev !== cur) warns.push('P16: ' + where + ': top の prev が ' + JSON.stringify(prev) + '、いまの最上位が ' + JSON.stringify(cur) + ' で、食い違っています');
            applyToState(st, e, VER);
            break;
          }
          case 'echo': {
            if (!has(st.groups, e.id)) errs.push('P10: ' + where + ': 補強する括り ' + e.id + ' がありません');
            break;
          }
          case 'note': break;
          case 'list': {
            if (typeof e.id === 'string') {
              if (has(st.lists, e.id)) errs.push('P12: ' + where + ': 数え上げ ' + e.id + ' は既にあります');
              takeId('list', e.id, where, '数え上げ');
            }
            if (isInt(e.n) && e.n < 2) errs.push('P18: ' + where + ': 数え上げ ' + e.id + ' の数は 2 以上です（' + e.n + ' になっています）');
            if (isInt(e.n) && Array.isArray(e.items) && e.items.length > e.n) errs.push('P18: ' + where + ': 数え上げ ' + e.id + ' の項目が ' + e.items.length + ' 件で、宣言された数 ' + e.n + ' を超えています');
            checkWho(e, where, '数え上げ ' + e.id);
            applyToState(st, e, VER);
            break;
          }
          default: break;
        }
      });

      if (!standalone) {
        // P17: note の件数
        const np = VER.note_per_step || [0, null];
        if (counts.note < np[0] || (np[1] != null && counts.note > np[1])) {
          errs.push('P17: 所感（note）は' + (np[0] === np[1] ? 'ちょうど ' + np[0] + ' 件' : np[0] + ' 件以上' + (np[1] != null ? ' ' + np[1] + ' 件以下' : '')) + 'です（' + counts.note + ' 件あります）');
        }
        // P23: 1バッチの件数
        if (VER.limits) {
          ['card', 'hold', 'close'].forEach(function (k) {
            const L = own(R.limits, 'batch.' + k);
            if (L && counts[k] > L.max) errs.push('P23: 1回の追記に ' + LABEL[k] + ' は ' + L.max + ' 件までです（' + counts[k] + ' 件あります）');
          });
        }
        // P25: 閉じ忘れの疑い（このバッチより前から開いていて、このバッチでも閉じていない保留）
        const minLen = own(R.limits, 'warn.common_substring') || 4;
        Object.keys(st.holds).forEach(function (hid) {
          const h = st.holds[hid];
          if (h.closes > 0 || has(batchHoldIds, hid) || has(closedInBatch, hid)) return;
          batchCards.forEach(function (c) {
            if (typeof c.ti !== 'string') return;
            const n = commonLen(h.q, c.ti);
            if (n >= minLen) warns.push('P25: 開いている保留 ' + hid + '「' + h.q + '」と、カード ' + c.id + '「' + c.ti + '」に ' + n + ' 文字の共通部分があります（閉じ忘れではないか）');
          });
        });
      }

      return result(batch);
    }

    verify.version = function (log) { return Array.isArray(log) && log.length && kindOf(log[0]) === 'open' ? detectVersion(R, log[0]) : null; };
    verify.nextIds = function (log) { const v = verify.version(log) || '2'; return nextIdsOf(buildState(R, log, v)); };
    verify.rules = R;
    return verify;
  }

  const api = { makeVerifier: makeVerifier, versionOf: versionOf, commonLen: commonLen, colName: colName, fmt: fmt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { globalThis.makeVerifier = makeVerifier; globalThis.TSV_VERIFY = api; }
})();
