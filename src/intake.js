/*
 * intake.js — 文字の入口。確定した発話 {who, text, t} を出す（i と at は受け取る側＝app が押す）
 *
 * 段:
 *   T0 打つ／貼る（textarea）。Enter か、入力が 2 秒止まったら確定。空でない行はどれも 1 つの発話で、読み方は
 *      rt.py のメモ帳と同じ（readTypedLine。1 列目の時刻は落とし、「話者<TAB>本文」の列か先頭の「名前:」を who にする。
 *      決まりは format/FORMAT.md「話者の切り出し」「live のメモ帳」。時刻・比・URL で始まる行は話者にしない）。
 *      Win+H（OS の音声入力）も同じ欄に打つので T1 はここに含まれる
 *   T2 ブラウザ音声認識（webkitSpeechRecognition）。lang ja-JP・continuous。途中結果は画面にだけ出し、
 *      isFinal で確定。onend で再開する。not-allowed / audio-capture / language-not-supported / service-not-allowed の後は
 *      再開しない（終わりの知らせが 500 ミリ秒のうちに来なければ、終わったものとして扱う）。何も聞き取れないまま誤りで
 *      終わる認識が続いたら、始め直しの待ちを 0.3・1・2・4 秒と延ばし、5 回続いたら再開しない誤りと同じに止める。
 *      再開しない誤りで止まったら emit.stopped(理由) で知らせる。切断・再開を素材ログに残す。この PC の中で文字にできるとき（speechLocal が 'available'）は opts.local で
 *      processLocally を立てる（音声は外へ出ない）。立てて始めたら、失敗しても提供元のサーバーへは切り替えない。
 *      聞き終えるときは stopWait(done, limitMs)（K19・K29）で、止めたのに終わりの知らせがまだ来ていない認識をすべて待ってから
 *      次へ進む（上限は合わせて 3 秒）。待ち終えた後に届いた確定の結果は、素材ログに {ev:'late'} として残して捨て、知らせる
 *   T3 ファイル。読み方は format/FORMAT.md「素材ファイルの形」（rt.py と同じ読み方。書き方は 'alone'・'tsv'・'inline'・
 *      'vtt' の 4 つで、見出しの後の最初の時刻のある行（WebVTT は先頭の WEBVTT の行）で決まる。共通の試験素材と期待値は
 *      tests/fixtures/materials.json に並べた素材ごとの *.expect.json）。
 *      1 発話ずつ読み、残りを数えない。試験用に「次の窓を流す」と等倍再生を持つ。
 *      読めない行（読めないバイトを含む行も）は素材ログに {ev:'unreadable', line, raw} を残し、読めない行・読めないバイトを
 *      含む行・時刻が飛んでいる行・時刻で始まる本文の行は知らせる（知らせを付けた発話を渡すときに。最後の発話より後ろの
 *      知らせは、最後の発話を渡す窓で）
 *
 * 受け取る側（emit）:
 *   emit.line({who, text, t})   確定した発話。t が無ければ受け取る側が時計で押す
 *   emit.event({ev, ...})       認識の切断・再開など、発話でない出来事（素材ログに残す）
 *   emit.interim(text)          途中結果（画面にだけ出す。記録しない）
 *   emit.status(text)           入口の状態の一言（画面の札）
 *   emit.notice(lines)          任意。入口の知らせが増えた（lines はいまの窓の知らせの文の並び。札は変えない）。
 *                               無ければ emit.status に文をつないで渡す
 *   emit.stopped(why)           任意（音声認識の入口だけが呼ぶ）。再開しない誤りで止まり、その認識が終わった（why は理由の文）
 *   emit.notes(list)            任意（ファイルの入口だけが呼ぶ）。直前に emit.line で渡した発話に付けた素材の知らせ
 *                               [{kind, line}]（読み切ったときは、最後の発話より後ろの知らせ）。これがあれば emit.notice には
 *                               素材の知らせを渡さない。窓ごとの文は、受け取る側が窓に入れた発話の知らせから noticeSentences で組む
 *
 * 規則: 先を読まない（R2）。ファイルでも「次の1発話」より先は読まない（次の窓の境目を知るための 1 発話の先読みと、
 *   発話の本文の続きの行が終わったと分かるための、次の時刻のある行までの読みだけ）。読んだ行の知らせも、
 *   その行を付けた発話を渡すまでは出さない
 *
 * 時刻は単調にする（どの入口でも同じ）: 確定した発話の t が直前の発話の t より前なら、直前の t に揃える。
 *   ファイルの時刻の巻き戻り・打ち間違い、壁時計の戻りで、窓がまだ聞いていない発話を先に渡さないため。
 *   打つ／音声認識の入口は setFloor(t) で下限を足せる（続きから聞き始めるとき、素材ログの最後の発話の t を渡す）。
 *   ファイルの入口は素材ファイルの中身だけで決める（rt.py が同じファイルを読んだ結果と一致させるため。下限を足さない）
 */
(function () {
  'use strict';

  // 空白の集まり（JS の String.prototype.trim が除くものと同じ。format/FORMAT.md「返事の読み方」に字を列挙してある）。
  // \s に任せず字で書く（ブラウザの Unicode の版で集まりが変わらないように。rt.py の WS_CHARS と同じ）
  const WS_SET = '\t\n\u000b\u000c\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  const WS_ANY = new RegExp('[' + WS_SET + ']');
  const WS_HEAD = new RegExp('^[' + WS_SET + ']');
  const WS_EDGE = new RegExp('^[' + WS_SET + ']+|[' + WS_SET + ']+$', 'g');
  function trimWs(s) { return String(s).replace(WS_EDGE, ''); }

  // 「名前: 本文」→ {who, text}（format/FORMAT.md「話者の切り出し」。rt.py のメモ帳の「話者: 本文」と同じ決まり）。
  // 行の前後の空白を除き、行頭から最初の「:」か「：」までを候補にする。話者と認めるのは次をすべて満たすときだけ:
  //   1〜20 字（コードポイント）、空白を含まない、数字（半角・全角）で始まらない、
  //   区切りが全角の「：」か、半角の「:」の直後が空白。
  // 認めないときは行の全体が話者無しの本文（「15:00までに」「9:00 から」「16:9 の画面」「https://…」「0:05 司会: …」）。
  // 「結論：A案」は話者「結論」になる（形からは区別できない）
  function splitWho(line) {
    const s = trimWs(line);
    const m = /[:：]/.exec(s);
    if (m) {
      const name = s.slice(0, m.index);
      const after = s.slice(m.index + 1);
      const n = Array.from(name).length;
      if (n >= 1 && n <= 20 && !WS_ANY.test(name) && !/^[0-9０-９]/.test(name) && (m[0] === '：' || WS_HEAD.test(after))) {
        return { who: name, text: trimWs(after) };
      }
    }
    return { who: null, text: s };
  }

  // ---- 素材ファイルの読み方（format/FORMAT.md「素材ファイルの形」。rt.py と同じ決まり） ----

  // 空白は半角スペース・タブ・CR・全角スペースの 4 つだけ（JS の trim は他の文字も落とすので使わない）
  const SP_EDGE = /^[ \t\r　]+|[ \t\r　]+$/g;
  function trimSp(s) { return String(s).replace(SP_EDGE, ''); }

  // 時刻として読む字は、当てる前に全角の数字（０〜９）と全角のコロン（：）だけを半角に直す（本文は直さない）
  const FULLWIDTH = /[０-９：]/g;
  function halfTime(s) {
    return String(s).replace(FULLWIDTH, function (c) { return c === '：' ? ':' : String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 48); });
  }

  // 時刻の書き方:「分:秒」か「時:分:秒」。全角を直したあとの数字は半角だけ。先頭の数は 1〜6 桁、続く数はちょうど 2 桁で 00〜59。
  // 秒の後ろに小数部（. と 1 桁以上の数字）を付けてよい。読めなければ null
  const TIME_RE = /^([0-9]{1,6}):([0-9]{2})(?::([0-9]{2}))?(?:\.([0-9]+))?$/;
  function parseTs(s) {
    const m = TIME_RE.exec(halfTime(trimSp(s)));
    if (!m) return null;
    const a = Number(m[1]), b = Number(m[2]), c = m[3] != null ? Number(m[3]) : null;
    if (b > 59 || (c != null && c > 59)) return null;
    const sec = c != null ? a * 3600 + b * 60 + c : a * 60 + b;
    // 整数の秒に小数部を足す（rt.py と同じ足し方。足す順で最後の桁が変わらないように）
    return m[4] != null ? sec + Number('0.' + m[4]) : sec;
  }

  // 時刻らしい字: 全角を直したあと、数字で始まり、数字と : と . だけでできていて、: を 1 つ以上含む（時刻として読めるかは問わない）
  const TIME_LIKE = /^[0-9][0-9:.]*$/;
  function timeLike(s) { const h = halfTime(s); return TIME_LIKE.test(h) && h.indexOf(':') >= 0; }
  // 行の頭: 前後の空白を除いた行の、最初の半角スペースか全角スペースの手前まで（無ければ行の全体）
  function headOf(s) { const m = /[ 　]/.exec(s); return m ? s.slice(0, m.index) : s; }

  // K30 時刻らしい頭の行（format/FORMAT.md「素材ファイルの形」の 9b。rt.py と同じ決まり）。どちらもタブを含まない行だけに当てる
  //   (a) 時刻に字が続く頭: 行の頭が時刻らしくなく（timeLike でない）、全角を直した頭の先頭から時刻の書き方
  //       （TIME_RE の $ を外したもの）を最も長く取った部分が時刻として読め（続く数が 00〜59）、その後ろに字が残る
  //       （「0:45司会：次の議題です」「1:30甲」「9:00から始めます」「0:45.司会」）。値は返さず、真か偽
  const TIME_PREFIX = /^([0-9]{1,6}):([0-9]{2})(?::([0-9]{2}))?(?:\.([0-9]+))?/;
  function gluedTime(head) {
    const h = halfTime(head);
    if (timeLike(head)) return false;
    const m = TIME_PREFIX.exec(h);
    return !!m && m[0].length < h.length && parseTs(m[0]) !== null;
  }
  //   (b) 括弧で囲んだ時刻: 前後の空白を除いた行の先頭の字が [ ( （ 【 のどれかで、そのあと最初に来る対の閉じ括弧
  //       （] ) ） 】）までの中身が時刻の書き方に合う（中身の前後の空白は除き、全角を直す）。閉じ括弧の後ろは空白でも字でも、
  //       何も無くてもよい。{t, rest}（rest は閉じ括弧より後ろの前後の空白を除いた字）か null
  const BRACKET_CLOSE = { '[': ']', '(': ')', '（': '）', '【': '】' };
  function bracketTime(s) {
    const close = BRACKET_CLOSE[s.charAt(0)];
    if (!close) return null;
    const j = s.indexOf(close, 1);
    if (j < 0) return null;
    const t = parseTs(s.slice(1, j));
    return t === null ? null : { t: t, rest: trimSp(s.slice(j + 1)) };
  }
  //   (c) 読めないバイト: 行の中に置き換えの字（U+FFFD。UTF-8 として読めないバイトを読んだ字）がある
  const BAD_BYTE = '�';

  const JUMP_SEC = 600;      // 時刻が飛んでいる行: 1 つ前の発話から、これより大きく先へ進んだ（か戻った）
  const RAW_MAX = 100;       // 読めない行の中身は先頭 100 字（コードポイント）まで残す

  // ---- WebVTT（format/FORMAT.md「素材ファイルの形」の 'vtt'） ----
  // 時刻: [時:]分:秒.ミリ秒。時は 1〜6 桁、分と秒はちょうど 2 桁で 00〜59、ミリ秒はちょうど 3 桁。全角は直さない。
  // 値はミリ秒を切り捨てた整数の秒。読めなければ null
  const VTT_TS = /^(?:([0-9]{1,6}):)?([0-9]{2}):([0-9]{2})\.([0-9]{3})$/;
  function vttTs(s) {
    const m = VTT_TS.exec(s);
    if (!m) return null;
    const h = m[1] != null ? Number(m[1]) : 0, mi = Number(m[2]), se = Number(m[3]);
    if (mi > 59 || se > 59) return null;
    return h * 3600 + mi * 60 + se;
  }
  // 字幕の時刻の行: 「始まり --> 終わり」と任意の設定（終わりの後ろは空白かタブで区切る）。--> の前後の空白は無くてもよい。
  // この形の行は、先頭に WEBVTT の行が無くても、書き方が決まる前に来れば 'vtt' に決める（K21。時刻として読めるかは問わない）
  const VTT_TIMING = /^([0-9:.]+)[ \t]*-->[ \t]*([0-9:.]+)(?:[ \t].*)?$/;
  function vttTiming(s) {
    const m = VTT_TIMING.exec(s);
    if (!m) return null;
    const a = vttTs(m[1]);
    return a !== null && vttTs(m[2]) !== null ? a : null;
  }
  // 札の中の字を戻す（この 6 つだけ。1 回だけ置き換えるので &amp;lt; は &lt; になる）
  const ENT = { amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"', '#39': "'" };
  function decodeEnt(s) { return String(s).replace(/&(amp|lt|gt|nbsp|quot|#39);/g, function (m, k) { return ENT[k]; }); }
  // 字幕 1 つの本文（行を半角スペース 1 つでつないだもの）→ {who, text}。頭の <v 名前> か <v.クラス 名前> を話者にし、
  // <...> の札をすべて除いてから字を戻し、前後の空白を除く
  const VTT_VOICE = /^<v(?:\.[^\t >]+)*(?:[ \t]([^>]*))?>/;
  function vttCue(joined) {
    const m = VTT_VOICE.exec(joined);
    const who = m ? (trimSp(decodeEnt(m[1] || '')) || null) : null;
    return { who: who, text: trimSp(decodeEnt(joined.replace(/<[^>]*>/g, ''))) };
  }

  // ---- 知らせの文（rt.py と同じ文。1 つの窓の知らせは、種類ごとに 1 文にまとめ、行番号を並べる） ----
  // 行番号は最初の 5 つまで並べ、残りは数だけ（「2・3・4・5・6 行目ほか 15 行」）
  const NOTICE_KINDS = ['unreadable', 'badbyte', 'jump', 'timehead'];
  const NOTICE_TEXT = {
    unreadable: '読めない行があった（{lines}）。発話にしていない。時刻の書き方を確かめる',
    badbyte: '読めないバイトを含む行（{lines}）。発話にしていない。素材の文字コードが UTF-8 かを確かめる',
    jump: '時刻が飛んでいる行（{lines}）。前に戻った時刻は前の発話の時刻に揃え、10 分を超えて進んだ時刻はそのまま読んだ',
    timehead: '時刻で始まる行は本文として読んだ（{lines}）。時刻の行にするなら、時刻だけを1行に書く'
  };
  // 発話が 1 つも無い素材の断り（K21。rt.py の file の open と同じ文）。時刻のある行が 1 つも無ければ NO_TIMED_TEXT（{n} は
  // 見出しとして黙って飛ばした行の数）、時刻のある行はあったがどれも本文が空なら NO_BODY_TEXT（{n} は時刻のある行の数）。
  // そのあとに、読めない行などの知らせの文（noticeSentences）を続ける
  const NO_TIMED_TEXT = '時刻のある行が 1 つもありません（見出しとして飛ばした行 {n} 行）。素材の形は format/FORMAT.md の「素材ファイルの形」を見てください';
  const NO_BODY_TEXT = '本文のある発話が 1 つもありません（時刻のある行 {n} 行は、どれも本文が空でした）。素材の形は format/FORMAT.md の「素材ファイルの形」を見てください';
  // K31 WEBVTT の行が無いまま、字幕の時刻の行の形の行（VTT_TIMING）で 'vtt' に決めた素材を断るときは、断りの文の次に
  // 何行目で字幕と決めたかを添える（{n} はその行の番号。rt.py と同じ文）
  const VTT_DECIDED_TEXT = '{n} 行目を字幕の時刻の行（「-->」を含む行）とみなし、そこから後ろを字幕（WebVTT）として読みました。字幕でなければ、その行の「-->」を書き換えてください';
  function lineList(a) { return a.slice(0, 5).join('・') + ' 行目' + (a.length > 5 ? 'ほか ' + (a.length - 5) + ' 行' : ''); }
  // notices: [{kind, line}]（1 つの窓の知らせ）か、{unreadable:[行…], badbyte:[…], jump:[…], timehead:[…]}。文の並びを返す
  function noticeSentences(notices) {
    const by = { unreadable: [], badbyte: [], jump: [], timehead: [] };
    if (Array.isArray(notices)) notices.forEach(function (x) { if (x && by[x.kind] && by[x.kind].indexOf(x.line) < 0) by[x.kind].push(x.line); });
    else if (notices) NOTICE_KINDS.forEach(function (k) { (notices[k] || []).forEach(function (l) { if (by[k].indexOf(l) < 0) by[k].push(l); }); });
    const out = [];
    NOTICE_KINDS.forEach(function (k) {
      if (!by[k].length) return;
      const ls = by[k].slice().sort(function (a, b) { return a - b; });
      out.push(NOTICE_TEXT[k].replace('{lines}', lineList(ls)));
    });
    return out;
  }

  // 素材ファイルを 1 発話ずつ読む。next() → {i, t, who, text}。無ければ null。先の行数は数えない
  //   行は LF だけで分け、1 から数える（空の行も数える）。前後の空白を除いて空の行は読み飛ばす（WebVTT では区切り）。
  //   書き方（format()）: 先頭の空でない行が WEBVTT で始まれば 'vtt'。そうでなければ、見出しを飛ばしたあとの最初の
  //     時刻のある行で決める。時刻だけの行なら 'alone'、タブで区切った 1 列目が時刻なら 'tsv'、時刻＋空白＋本文の行なら 'inline'。
  //     先頭が WEBVTT でなくても、書き方が決まる前に字幕の時刻の行の形（VTT_TIMING）の行が来たら、その行から 'vtt'（それより
  //     前の行は見出しとして飛ばしたまま。読めない行は読めない行のまま）
  //   時刻のある行（新しい発話を始める。どの書き方でも同じ）:
  //     時刻だけの行（タブを含まず、前後の空白を除いた行の全体が時刻）: 話者無し、本文は空（続く行で埋める）
  //     表の行（タブを含み、1 列目が時刻）: 列 3 つ以上 → 2 列目が話者（前後の空白と終わりの「:」「：」を落とす。空なら無し。
  //       打つ入口の話者の列と同じ whoCol）、3 列目以降をタブでつないだものが本文。
  //       列 2 つ → 話者無し、2 列目が本文
  //   'tsv' と 'inline' だけ: 時刻＋空白（半角・全角）＋本文の行（タブを含まず、行の頭が時刻）も新しい発話。
  //     本文は頭の後ろの字で、話者は話者の切り出し（splitWho）で切る
  //   読めない行（発話にしない。知らせる）:
  //     タブを含むのに 1 列目が時刻として読めない行 / タブを含まず、行の全体が時刻らしいのに時刻として読めない行 /
  //     タブを含まず、行の頭が時刻らしいのに時刻として読めず、空白と本文が続く行（'alone' 以外。'alone' では下の
  //     時刻で始まる本文の行）/ 読めない行のあとに続く、タブを含まない行（次の時刻のある行まで）。
  //     読めない行に来たら、まだ出していない発話はそこで閉じる
  //   'alone' の時刻で始まる本文の行（行の頭が時刻らしく、空白と本文が続く行）: 直前の発話の本文の続きにして知らせる（timehead）
  //   K30 時刻らしい頭の行（タブを含まない行。gluedTime の (a) と bracketTime の (b)）:
  //     (b) 括弧で囲んだ時刻: 'tsv'・'inline' では括弧の中の時刻の新しい発話（本文は閉じ括弧より後ろ、話者は splitWho）。
  //       書き方がまだ決まっていなければ、その行で 'inline' に決める。'alone' では直前の発話の本文の続きにして知らせる（timehead）
  //     (a) 時刻に字が続く頭: どの書き方でも直前の発話の本文の続きにして知らせる（timehead）。書き方がまだ決まっていなければ
  //       読めない行（見出しとして黙って飛ばさない）
  //     読めない行の続きの中では、(a) も 'alone' の (b) も読めない行（'tsv'・'inline' の (b) は時刻のある行なので続きを終える）
  //   K30 (c) 読めないバイト（U+FFFD）を含む行: どの書き方でも、書き方が決まる前でも、読めない行（知らせの種類は badbyte）。
  //     書き方の見分けにも使わない。'alone'・'tsv'・'inline' では、まだ出していない発話をその手前で閉じ、続く行は読めない行の続き。
  //     'vtt' では、まだ出していない字幕をその手前で閉じ、その行から空行（か次の字幕の時刻の行）までを読めない行にする。
  //     先頭の WEBVTT の行だけは、読めないバイトを含んでも見出しの塊の頭として扱う
  //   上のどれでもない行は直前の発話の本文の続き（半角スペース 1 つを挟む）。最初の時刻のある行より前なら見出しとして飛ばす
  //   'vtt': WEBVTT の行から空行まで（見出しの塊）と、NOTE・STYLE・REGION で始まる塊（空行まで）は飛ばす。
  //     --> を含む行は字幕の時刻の行で、どこにあっても新しい字幕を始める（前の字幕はそこで閉じる）。時刻として読めれば
  //     始まりの時刻（ミリ秒は切り捨て）の発話。読めなければ、その行から空行までを読めない行にする。
  //     塊の最初の行の次が時刻の行なら、その最初の行は識別子として黙って捨てる。時刻の行から空行までの行を
  //     半角スペース 1 つでつないで本文にし、vttCue で話者と本文にする。時刻の行の無い塊は読めない行。字幕 1 つが発話 1 つ
  //   本文が空のまま終わった発話は発話にしない（番号を使わない）。番号 i は 1 から。
  //   時刻は単調にする（直前の発話より前なら、直前の発話の時刻に揃える）
  //   時刻が飛んでいる行: 番号を振った発話の揃える前の時刻が、1 つ前に番号を振った発話の揃える前の時刻より小さいか、
  //     600 秒より大きく先。その発話の時刻のある行を知らせる（拒まない）
  //   知らせを付ける発話: 発話の本文の行（時刻で始まる本文の行）の知らせは、その発話に付ける。どの発話にも入らない行
  //     （読めない行と、その続き）の知らせは、後ろの最初の発話に付ける。時刻の飛びは、その発話に付ける。
  //     最後の発話より後ろの知らせは、最後の発話に付ける（読み終えたときに tail() で分かる）
  // ほかの口:
  //   notes()      最後に返した発話に付けた知らせの写し（行の順）。{kind:'unreadable', line, raw} か {kind:'badbyte', line, raw} か
  //                {kind:'jump', line, t, prev}（t は揃える前の時刻、prev は 1 つ前の発話の揃える前の時刻）か {kind:'timehead', line}
  //   tail()       next() が null を返したあとで、最後の発話より後ろの知らせの写し（最後の発話に付ける。発話が無ければどれにも付かない）
  //   refusal()    読み切って発話が 1 つも無かったときだけ、断りの文の並び（NO_TIMED_TEXT か NO_BODY_TEXT と、WEBVTT の行の無いまま
  //                字幕と決めた素材なら VTT_DECIDED_TEXT、そのあとに知らせの文）。発話があるか、まだ読み切っていなければ null
  //   startLine()  最後に返した発話の、時刻のある行の番号
  //   notices()    ここまでに読んだ知らせの写し（行の順）
  //   skipped()    ここまでに黙って読み飛ばした行（見出し・WebVTT の見出しの塊と NOTE などの塊・識別子）の行番号
  //   format()     書き方（'alone'・'tsv'・'inline'・'vtt'。まだ決まっていなければ null）
  function makeMaterialReader(text) {
    let raw = String(text == null ? '' : text);
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);   // 先頭の BOM は捨てる
    let pos = 0, lineNo = 0, lastT = null, n = 0, done = false;
    let format = null, seen = false;
    let pending = null;        // まだ出していない発話 {t, who, text, line, notes, parts}
    let held = [];             // どの発話にも入らない行の知らせ（後ろの最初の発話に付ける）
    let broken = false;        // 読めない行の続きの中にいる（次の時刻のある行まで）
    let prevRawT = null;       // 1 つ前に番号を振った発話の、揃える前の時刻
    let lastStart = 0, lastNotes = [], tailNotes = [];
    let vs = 'none', cand = null; // WebVTT: 塊のどこにいるか（none・skip・cand・cue・bad・stray）と、識別子かもしれない最初の行
    let timed = 0;             // 時刻のある行（発話を始めた行。本文が空で発話にしなかった行も数える）の数
    let vttAt = null;          // WEBVTT の行が無いまま、字幕の時刻の行の形の行で 'vtt' に決めた行の番号（K31）
    const skipped = [], all = [];
    function nextLine() {
      if (pos > raw.length) return null;
      let j = raw.indexOf('\n', pos);
      if (j < 0) j = raw.length;
      const l = raw.slice(pos, j);
      pos = j + 1;
      lineNo++;
      return l;
    }
    function record(x) {
      // 知らせは行の順に持つ（時刻の飛びは発話を閉じたときに分かるので、後ろの行の知らせより後に来ることがある）
      let k = all.length;
      while (k > 0 && all[k - 1].line > x.line) k--;
      all.splice(k, 0, x);
      return x;
    }
    function bad(line, s, kind) { held.push(record({ kind: kind || 'unreadable', line: line, raw: Array.from(s).slice(0, RAW_MAX).join('') })); }
    function finish() {
      const p = pending; pending = null;
      if (!p) return null;
      if (p.parts) { const c = vttCue(p.parts.join(' ')); p.who = c.who; p.text = c.text; }
      if (!p.text) { held = held.concat(p.notes); return null; }
      const mine = held.concat(p.notes);
      held = [];
      if (prevRawT != null && (p.t < prevRawT || p.t - prevRawT > JUMP_SEC)) mine.push(record({ kind: 'jump', line: p.line, t: p.t, prev: prevRawT }));
      mine.sort(function (a, b) { return a.line - b.line; });
      prevRawT = p.t;
      const t = (lastT != null && p.t < lastT) ? lastT : p.t;
      lastT = t;
      n++;
      lastStart = p.line;
      lastNotes = mine;
      return { i: n, t: t, who: p.who, text: p.text };
    }
    function start(t, who, body) { timed++; pending = { t: t, who: who, text: body, line: lineNo, notes: [] }; }
    // WebVTT の 1 行。閉じた発話があれば返す
    function vttLine(s) {
      if (!s) {
        if (vs === 'cand') { bad(cand.line, cand.s); cand = null; }
        const r = vs === 'cue' ? finish() : null;
        vs = 'none';
        return r;
      }
      if (s.indexOf(BAD_BYTE) >= 0) {
        // K30 (c): 読めないバイトを含む行。まだ出していない字幕はその手前で閉じ、空行（か次の時刻の行）までを読めない行にする
        if (vs === 'cand') { bad(cand.line, cand.s); cand = null; }
        const r = vs === 'cue' ? finish() : null;
        bad(lineNo, s, 'badbyte');
        vs = 'bad';
        return r;
      }
      if (s.indexOf('-->') >= 0) {
        if (vs === 'cand') { skipped.push(cand.line); cand = null; }   // 塊の最初の行の次が時刻の行: 識別子として捨てる
        const r = vs === 'cue' ? finish() : null;
        const t = vttTiming(s);
        if (t !== null) { timed++; pending = { t: t, who: null, text: '', line: lineNo, notes: [], parts: [] }; vs = 'cue'; }
        else { bad(lineNo, s); vs = 'bad'; }
        return r;
      }
      if (vs === 'cue') pending.parts.push(s);
      else if (vs === 'skip') skipped.push(lineNo);
      else if (vs === 'bad' || vs === 'stray') bad(lineNo, s);
      else if (vs === 'cand') { bad(cand.line, cand.s); cand = null; bad(lineNo, s); vs = 'stray'; }
      else if (/^(NOTE|STYLE|REGION)/.test(s)) { vs = 'skip'; skipped.push(lineNo); }
      else { cand = { line: lineNo, s: s }; vs = 'cand'; }
      return null;
    }
    function step(line) {
      const s = trimSp(line);
      if (!seen && s) {
        seen = true;
        if (s.indexOf('WEBVTT') === 0) { format = 'vtt'; vs = 'skip'; skipped.push(lineNo); return null; }
      }
      // K30 (c): 読めないバイトを含む行は、書き方の見分けにも使わない（'vtt' の扱いは vttLine）
      const badByte = s.indexOf(BAD_BYTE) >= 0;
      // WEBVTT の行の無い字幕（K21）: 書き方が決まる前（このときは、まだ出していない発話も無い）に字幕の時刻の行の形が来たら、
      // その行から 'vtt' として読む。それより前の行は見出しとして飛ばしたまま
      if (format === null && !badByte && VTT_TIMING.test(s)) { format = 'vtt'; vs = 'none'; cand = null; broken = false; vttAt = lineNo; }
      if (format === 'vtt') return vttLine(s);
      if (!s) return null;
      if (badByte) {
        const r = finish();    // まだ出していない発話は、読めない行の手前で閉じる
        broken = true;
        bad(lineNo, s, 'badbyte');
        return r;
      }
      const cols = line.split('\t');
      const t = parseTs(cols[0]);
      if (t !== null) {
        if (format === null) format = cols.length > 1 ? 'tsv' : 'alone';
        broken = false;
        let who = null, body = '';
        if (cols.length >= 3) { who = whoCol(cols[1]); body = trimSp(cols.slice(2).join('\t')); }
        else if (cols.length === 2) body = trimSp(cols[1]);
        const r = finish();
        start(t, who, body);
        return r;
      }
      const head = headOf(s);
      const timeHead = timeLike(head);
      const inlineT = (cols.length === 1 && head !== s) ? parseTs(head) : null;
      if (inlineT !== null && format !== 'alone') {
        // 'tsv'・'inline'（とまだ決まっていないとき）: 時刻＋空白＋本文の行は、その時刻の新しい発話
        if (format === null) format = 'inline';
        broken = false;
        const r = finish();
        const w = splitWho(s.slice(head.length));
        start(inlineT, w.who, w.text);
        return r;
      }
      // K30 (b) 括弧で囲んだ時刻: 'tsv'・'inline'（とまだ決まっていないとき）は、その時刻の新しい発話
      const br = cols.length === 1 ? bracketTime(s) : null;
      if (br && format !== 'alone') {
        if (format === null) format = 'inline';
        broken = false;
        const r = finish();
        const w = splitWho(br.rest);
        start(br.t, w.who, w.text);
        return r;
      }
      // K30 (a) 時刻に字が続く頭
      const glued = cols.length === 1 && gluedTime(head);
      if (cols.length > 1 || broken || (timeHead && (head === s || format !== 'alone')) || (glued && format === null)) {
        const r = finish();    // まだ出していない発話は、読めない行の手前で閉じる
        broken = true;
        bad(lineNo, s);
        return r;
      }
      if (pending) {
        pending.text = pending.text ? pending.text + ' ' + s : s;
        if (timeHead || glued || br) pending.notes.push(record({ kind: 'timehead', line: lineNo }));
      } else skipped.push(lineNo);
      return null;
    }
    function next() {
      while (!done) {
        const line = nextLine();
        if (line === null) {
          done = true;
          if (cand) { bad(cand.line, cand.s); cand = null; }
          const r = finish();
          tailNotes = held; held = [];
          return r;
        }
        const r = step(line);
        if (r) return r;
      }
      return null;
    }
    const copy = function (a) { return a.map(function (x) { return Object.assign({}, x); }); };
    return {
      next: next,
      notes: function () { return copy(lastNotes); },
      tail: function () { return done ? copy(tailNotes) : []; },
      refusal: function () {
        if (!done || n > 0) return null;
        const first = timed === 0 ? NO_TIMED_TEXT.replace('{n}', String(skipped.length)) : NO_BODY_TEXT.replace('{n}', String(timed));
        const out = [first];
        if (vttAt !== null) out.push(VTT_DECIDED_TEXT.replace('{n}', String(vttAt)));
        return out.concat(noticeSentences(all));
      },
      startLine: function () { return lastStart; },
      notices: function () { return copy(all); },
      skipped: function () { return skipped.slice(); },
      format: function () { return format; }
    };
  }

  // 素材が発話を 1 つも持たなければ、断りの文の並び（refusal()）を返す。発話があれば null（最初の発話を見つけたら、
  // そこで読むのをやめる。読んだ発話は返さない）。ページのファイルの入口は、記録を作る前にこれで断る（K21）
  function materialRefusal(text) {
    const r = makeMaterialReader(text);
    if (r.next()) return null;
    return r.refusal();
  }

  // 打つ／音声認識の入口の時刻を単調にする（直前の発話より前の時刻は、直前の時刻に揃える）。
  // 渡す時刻は整数の秒に切り捨てる（分析役が見る時刻を整数にして、カードの位置を根拠の発話の時刻の間に置きやすくする。
  // 窓の境目は整数の秒なので、切り捨てても発話の入る窓は変わらない）
  function makeMonotone() {
    let floor = null;
    return {
      at: function (t) { if (floor != null && !(t >= floor)) t = floor; floor = t; return t; },
      setFloor: function (t) { if (typeof t === 'number' && isFinite(t) && (floor == null || t > floor)) floor = t; }
    };
  }

  // ---- 打った 1 行の読み方（format/FORMAT.md「live のメモ帳」の行の読み方。rt.py の memo_kind と同じ。
  //      共通の期待値は tests/fixtures/typed_lines.json） ----
  //   空でない行（素材の空白の 4 字を除いて空でない行）は、どれも 1 つの発話になる。発話の時刻はいつも届いた時刻で、
  //   行に打った時刻は使わない。{kind, who, text} を返す（kind は 'timecol' か 'plain'）
  //     タブを含み 1 列目が時刻らしい行（前後の空白を除き、全角を直して、数字で始まり 0〜9・:・. だけで : を含む。
  //       時刻として読めなくてもよい）: 1 列目を落とす（timecol）。残りの列が 2 つ以上なら「話者<TAB>本文」、
  //       1 つなら、その列に話者の切り出し（splitWho）を当てる
  //     タブを含むほかの行: 「話者<TAB>本文」（3 列目以降はタブでつなぐ）
  //     タブを含まない行: splitWho（行の頭の「名前:」）
  //     「話者<TAB>本文」の話者の列は、前後の空白を除き、終わりの「:」「：」の並びを落として、もう一度前後の空白を除く
  //     本文が空になる行（時刻だけ・話者だけ）は、行の全体（列を半角スペース 1 つでつなぐ）を話者無しの本文にする
  function whoCol(s) { return trimSp(trimSp(s).replace(/[:：]+$/, '')) || null; }
  function readTypedLine(line) {
    const all = String(line).split('\t');
    let cols = all, kind = 'plain', who = null, text = '';
    if (cols.length >= 2 && timeLike(trimSp(cols[0]))) { kind = 'timecol'; cols = cols.slice(1); }
    if (cols.length >= 2) { who = whoCol(cols[0]); text = trimSp(cols.slice(1).join('\t')); }
    else { const w = splitWho(cols[0]); who = w.who; text = w.text; }
    if (!text) { who = null; text = all.map(trimSp).filter(function (x) { return x; }).join(' '); }
    return { kind: kind, who: who, text: text };
  }

  const TIMECOL_TEXT = '打った行の 1 列目の時刻は使わない（届いた時刻で押す）';

  // K19 聞き終えるときに、音声認識の終わりの知らせ（onend）を待つ上限（ミリ秒）と、待ちきれなかったときの知らせ
  const STOP_WAIT_MS = 3000;
  function stopWaitText(ms) {
    const sec = Math.round(ms / 100) / 10;
    return '音声認識の終わりの知らせを ' + sec + ' 秒待っても来なかったので、待つのをやめて聞き終えた。この後に認識が返した結果は記録に入れない（届いたら、捨てたことをこの欄に出す）';
  }
  const STOP_WAIT_TEXT = stopWaitText(STOP_WAIT_MS);

  // 入口の知らせを出す（札は変えない。受け取る側に emit.notice が無ければ札に出す）
  function tellNotice(emit, lines) {
    if (typeof emit.notice === 'function') emit.notice(lines.slice());
    else emit.status(lines.join('／'));
  }

  // ---- T0 / T1: textarea ----
  // 確定した欄の中身を行に分け、空でない行をどれも 1 つの発話にする（readTypedLine。rt.py のメモ帳と同じ読み方）。
  // 1 列目の時刻を落とした行が初めて来たら、1 回だけ知らせる（noticed().timecol。入口の札は変えない）
  function makeTextIntake(ta, emit, clock) {
    let timer = null, composing = false, on = false, timecol = false;
    const mono = makeMonotone();
    function confirm() {
      clearTimeout(timer); timer = null;
      if (!on || composing) return;
      const lines = ta.value.split('\n').filter(function (l) { return trimSp(l); });
      if (!lines.length) return;
      ta.value = '';
      emit.interim('');
      lines.forEach(function (l) {
        const r = readTypedLine(l);
        if (r.kind === 'timecol' && !timecol) { timecol = true; tellNotice(emit, [TIMECOL_TEXT]); }
        emit.line({ who: r.who, text: r.text, t: mono.at(Math.floor(clock())) });
      });
    }
    function arm() { clearTimeout(timer); timer = setTimeout(confirm, 2000); }
    ta.addEventListener('compositionstart', function () { composing = true; });
    ta.addEventListener('compositionend', function () { composing = false; arm(); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !composing) { e.preventDefault(); confirm(); }
    });
    ta.addEventListener('input', function () { if (!on) return; emit.interim(ta.value); arm(); });
    return {
      kind: 'text',
      start: function () { on = true; ta.disabled = false; ta.focus(); emit.status('打つ／貼る（Enter か 2 秒で確定）'); return true; },
      stop: function () { confirm(); on = false; ta.disabled = true; emit.status('止めた'); },
      flush: confirm,
      setFloor: mono.setFloor,
      // ここまでに知らせたこと {timecol: 1 列目の時刻を落とした行があったか}
      noticed: function () { return { timecol: timecol }; }
    };
  }

  // ---- T2: ブラウザ音声認識 ----
  // 認識は 1 つだけ動かす。認識を作るたびに世代の数を 1 つ進め、古い世代の認識の終わり・誤りの知らせでは
  // 始め直さない（中断と再開を素早く繰り返したとき、古い認識の遅れた終わりの知らせで 2 つ目を始めないため）。
  // 始め直しの待ち（300 ミリ秒）のあいだに再開されたときも、待ちの側は始め直さない。
  // 聞き終えるときは stopWait（K19・K29）: 止めたのに終わりの知らせ（onend）がまだ来ていない世代を、いまの世代も古い世代も
  // すべて待ってから知らせる。上限は合わせて STOP_WAIT_MS。待ち終えた後（上限を過ぎた後も、end を書いた後も）に届いた
  // 確定の結果は、素材ログに {ev:'late', text, t} を残して捨て、知らせの欄に lateText(n) を出す。待ち終えた後は、
  // 認識の始まり・終わり・誤りの出来事（asr_start・asr_end・asr_error など）を素材ログに足さない
  // 再開しても直らない誤り（再開しない）
  const FATAL_ASR = {
    'not-allowed': 'マイクの許可が無い', 'audio-capture': 'マイクが無い',
    'language-not-supported': 'このブラウザでは日本語を文字にできない',
    'service-not-allowed': 'ブラウザか管理者の設定で、音声認識が許されていない'
  };
  function lateText(n) {
    return n <= 1 ? '聞き終えた後に届いた認識の結果を 1 件捨てました（記録の外）'
      : '聞き終えた後に届いた認識の結果を、もう 1 件捨てました（記録の外。合わせて ' + n + ' 件）';
  }
  // 続けて失敗した認識の始め直し。何も聞き取れないまま誤り（「声が聞こえない」のほか）で終わった認識と、始めて
  // QUICK_END_SEC 秒もたたずに何も聞き取れないまま終わった認識を「失敗」と数える。失敗が続くほど始め直しの待ちを延ばし
  // （RESTART_WAIT_MS の順。失敗していなければいつも最初の 300 ミリ秒）、FAIL_LIMIT 回続いたら再開しない誤りと同じに扱う
  // （止めて、理由を札に出す）。何か 1 つでも聞き取れたら数え直す（職場の PC で認識の通信が止められていると、0.3 秒ごとに
  // 始め直して素材ログに 1 時間で数万行を書いていた）
  const RESTART_WAIT_MS = [300, 1000, 2000, 4000];
  const FAIL_LIMIT = 5;
  const QUICK_END_SEC = 1;
  // 再開しない誤りの後、終わりの知らせ（onend）をこの長さだけ待つ。来なければ終わったものとして扱う（端末内で文字にする
  // 認識に日本語が無いとき、Chromium は誤りだけを知らせて、終わりの知らせを出さない。abort() を呼んでも出さない）
  const FATAL_END_WAIT_MS = 500;
  // 認識の誤りの符号を日本語に（札に出すとき。符号もかっこの中に添える）
  const ASR_ERROR_TEXT = {
    'no-speech': '声が聞こえない', 'aborted': '止められた', 'audio-capture': 'マイクが無い', 'network': '認識の通信が切れた',
    'not-allowed': 'マイクの許可が無い', 'service-not-allowed': '認識の機能が許されていない', 'language-not-supported': '言語が使えない',
    'bad-grammar': '認識の設定の誤り'
  };
  function asrErrorText(code) {
    const ja = Object.prototype.hasOwnProperty.call(ASR_ERROR_TEXT, code) ? ASR_ERROR_TEXT[code] : 'そのほかの誤り';
    return ja + '（' + code + '）';
  }
  // ---- この PC の中で文字にできるか（端末内の認識。Chrome 139 以降の processLocally・available()・install()） ----
  // 調べる口が無いブラウザ・古いブラウザでは 'none'。版の数ではなく、口があるかで決める
  const LOCAL_ASK = { langs: ['ja-JP'], processLocally: true };
  const LOCAL_STATES = ['available', 'downloadable', 'downloading', 'unavailable'];
  function speechCtor() { return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition || null; }
  function canAskLocal(SR) {
    return !!(SR && typeof SR.available === 'function' && SR.prototype && 'processLocally' in SR.prototype);
  }
  // 'available'（この PC の中で文字にできる）／'downloadable'（日本語の部品を入れればできる）／'downloading'（入れている途中）／
  // 'unavailable'（できない）／'none'（音声認識が無い・調べる口が無い）。Promise で返す（Promise の無い環境は考えない）
  function speechLocal() {
    const SR = speechCtor();
    if (!canAskLocal(SR)) return Promise.resolve('none');
    try {
      return Promise.resolve(SR.available(LOCAL_ASK)).then(function (s) { return LOCAL_STATES.indexOf(s) >= 0 ? s : 'unavailable'; },
        function () { return 'unavailable'; });
    } catch (e) { return Promise.resolve('unavailable'); }
  }
  // 日本語の部品を入れる（入れるときに音声は送らない）。入ったら true。limitMs（既定 3 分）を過ぎても終わらなければ false
  // （部品の取得が止められている PC では、いつまでも終わらないことがある）
  function speechInstall(limitMs) {
    const SR = speechCtor();
    if (!SR || typeof SR.install !== 'function') return Promise.resolve(false);
    let p;
    try { p = Promise.resolve(SR.install(LOCAL_ASK)); } catch (e) { return Promise.resolve(false); }
    const lim = typeof limitMs === 'number' && isFinite(limitMs) && limitMs > 0 ? limitMs : 180000;
    return new Promise(function (res) {
      const timer = setTimeout(function () { res(false); }, lim);
      p.then(function (ok) { clearTimeout(timer); res(ok === true); }, function () { clearTimeout(timer); res(false); });
    });
  }

  // opts.local: この PC の中だけで文字にする（認識に processLocally を立てる）。立てて始めた後に失敗しても、
  // 提供元のサーバーへは切り替えない（言語が使えない・認識が許されていない、は再開しない）
  function makeSpeechIntake(emit, clock, opts) {
    const SR = speechCtor();
    const local = !!(opts && opts.local);
    let rec = null, wanted = false, fatal = false, fatalWhy = '', restarts = 0, gen = 0;
    // alive: 作ったのに終わりの知らせがまだ来ていない認識（世代の番号 → 認識）。始められなかった認識は入れない
    // endWaiters: stopWait が待っている、alive が空になること。stopTimedOut: 終わりを待ちきれずに聞き終えたことがある
    // closed: stopWait が待ち終えた（聞き終えた）。lateCount: 待ち終えた後に届いて捨てた確定の結果の数
    const alive = Object.create(null);
    let stopTimedOut = false, closed = false, lateCount = 0;
    // failed: 続けて失敗した認識の数（RESTART_WAIT_MS・FAIL_LIMIT）。failErr: その間の最後の誤りの符号
    let failed = 0, failErr = '';
    const endWaiters = [];
    const mono = makeMonotone();
    function anyAlive() { return Object.keys(alive).length > 0; }
    function wakeEndWaiters() { if (!anyAlive()) endWaiters.splice(0).forEach(function (f) { f(); }); }
    function event(x) { if (!closed) emit.event(x); }
    // 再開しない誤りで止まり、その認識が終わった（終わりの知らせが来たか、待ちきれずに終わったものとした）ことを、
    // 受け取る側に 1 回だけ知らせる（emit.stopped(理由)。任意。受け取る側は、入口を変えて聞き直せるようにする）
    function tellStopped() { if (typeof emit.stopped === 'function') emit.stopped(fatalWhy); }
    function spin() {
      const my = ++gen;
      const r = new SR();
      rec = r;
      alive[my] = r;
      r.lang = 'ja-JP';
      r.continuous = true;
      r.interimResults = true;
      if (local) r.processLocally = true;
      // heard: この認識が何か聞き取った。err: この認識の誤りの符号。began: 始めた時刻（秒）
      let heard = false, err = '';
      const began = clock();
      r.onstart = function () {
        event({ ev: 'asr_start', t: clock(), local: local });
        if (my === gen && !closed) emit.status(local ? '聞いている（この PC の中で文字にしている）' : '聞いている（音声は提供元のサーバーへ送られている）');
      };
      // 確定した結果は、古い世代のもの（止める前に聞いた分）も捨てない。聞き終えた後に届いたものだけは記録の外（K29）
      r.onresult = function (ev) {
        let interim = '';
        for (let k = ev.resultIndex; k < ev.results.length; k++) {
          const x = ev.results[k];
          const tx = (x[0] && x[0].transcript || '').trim();
          // 何か 1 つでも聞き取れたら、続けて失敗した数を数え直す（途中結果でもよい）
          if (tx) { heard = true; failed = 0; failErr = ''; }
          if (x.isFinal) {
            if (!tx) continue;
            if (closed) {
              lateCount++;
              emit.event({ ev: 'late', text: tx, t: clock() });
              tellNotice(emit, [lateText(lateCount)]);
            } else emit.line({ who: null, text: tx, t: mono.at(Math.floor(clock())) });
          } else interim += tx;
        }
        if (my === gen && !closed) emit.interim(interim);
      };
      r.onerror = function (ev) {
        const code = String(ev && ev.error || '不明');
        event({ ev: 'asr_error', error: code, t: clock() });
        if (my !== gen || closed || fatal) return;   // 止めた後の誤りでは、札の理由を書き換えない
        err = code;
        if (code !== 'no-speech') failErr = code;
        if (Object.prototype.hasOwnProperty.call(FATAL_ASR, code)) {
          fatal = true; wanted = false;
          fatalWhy = code === 'language-not-supported' && local ? 'この PC の中では日本語を文字にできない。提供元のサーバーへは切り替えない' : FATAL_ASR[code];
          emit.status('音声認識が使えない（' + fatalWhy + '）。再開しない');
          // 終わりの知らせが来ない認識がある（端末内で日本語が無いとき）。少し待って来なければ、終わったものとして扱う
          setTimeout(function () { if (alive[my]) finished(true); }, FATAL_END_WAIT_MS);
        } else {
          emit.status('認識の誤り: ' + asrErrorText(code) + '（始め直す）');
        }
      };
      // 認識が終わった。synthetic: 再開しない誤りの後に終わりの知らせが来なかったので、終わったものとした（このときは
      // 素材ログに asr_end を足さない。来なかった知らせを来たようには書かない。止め直しも試みる）
      function finished(synthetic) {
        if (!alive[my]) return;            // 同じ認識の 2 度目の終わりの知らせ
        delete alive[my];
        if (synthetic) {
          try { if (typeof r.abort === 'function') r.abort(); else r.stop(); } catch (e) { /* 止め損ねても、終わったものとして扱う */ }
        }
        if (closed) return;                // 聞き終えた後の終わり。素材ログに足さない（K29）
        if (!synthetic) event({ ev: 'asr_end', t: clock() });
        if (my === gen) {                  // 古い世代の終わりでは、いま動いている認識に触らない
          emit.interim('');
          if (wanted && !fatal) {
            // 何も聞き取れないまま誤りで終わった・すぐに終わった認識は失敗と数え、続くほど始め直しを待つ
            const bad = !heard && ((err !== '' && err !== 'no-speech') || clock() - began < QUICK_END_SEC);
            failed = bad ? failed + 1 : 0;
            if (failed >= FAIL_LIMIT) {
              fatal = true; wanted = false;
              fatalWhy = failErr ? '何も聞き取れないまま ' + FAIL_LIMIT + ' 回続けて失敗した。最後の誤りは「' + asrErrorText(failErr) + '」'
                : '何も聞き取れないまま、認識が ' + FAIL_LIMIT + ' 回続けてすぐに終わった';
              emit.status('音声認識を止めた（' + fatalWhy + '）。もう始め直さない');
              tellStopped();
            } else {
              restarts++;
              event({ ev: 'asr_restart', n: restarts, t: clock() });
              const wait = RESTART_WAIT_MS[Math.min(Math.max(failed, 1), RESTART_WAIT_MS.length) - 1];
              setTimeout(function () { if (my === gen && wanted && !fatal) spin(); }, wait);
            }
          } else {
            // 再開しない誤りで止まったときは、その理由を札に残す（終わりの知らせで消さない）
            emit.status(fatal ? '音声認識は止まったまま（' + fatalWhy + '）' : '止めた');
            if (fatal) tellStopped();
          }
        }
        wakeEndWaiters();
      }
      r.onend = function () { finished(false); };
      try { r.start(); } catch (e) { delete alive[my]; emit.status('音声認識を始められない: ' + (e && e.message || e)); wakeEndWaiters(); }
    }

    // K19・K29 聞き終えるときの止め方。認識を止め、止めたのに終わりの知らせ（onend）がまだ来ていない世代を、いまの世代も
    // 古い世代（中断して再開する前に止めた認識）もすべて待ってから done を呼ぶ。
    //   done({timedOut, waitedMs})。戻り値は同じ値で解決する Promise（Promise の無い環境では undefined）。
    //   - 待っているあいだに届いた確定の結果は、今までどおり emit.line で渡す（捨てない。受け取る側が最後の窓に入れる）
    //   - 終わっていない認識が無い（まだ始めていない・中断して終わりの知らせがもう来た・始め直しの待ちの最中）なら、すぐ done
    //   - 上限（limitMs。既定 STOP_WAIT_MS = 3000。待つ世代がいくつあっても合わせて）を過ぎたら timedOut: true で done を
    //     呼ぶ。そのとき素材ログに {ev:'asr_stop_timeout', ms} を残し、知らせの欄に stopWaitText(ms) を出す
    //     （emit.notice。noticed().stopTimeout）
    //   - done は 1 回だけ呼ぶ。done を呼んだ後（待ち終えた後）は聞き終えた扱い: 届いた確定の結果は emit.line で渡さず、
    //     素材ログに {ev:'late', text, t} を残して知らせの欄に lateText(n) を出す（noticed().late）。終わり・誤りなどの
    //     出来事は素材ログに足さない
    function stopWait(done, limitMs) {
      const lim = typeof limitMs === 'number' && isFinite(limitMs) && limitMs >= 0 ? limitMs : STOP_WAIT_MS;
      const began = Date.now();
      let settled = false, resolveP = null, limTimer = null;
      const p = typeof Promise === 'function' ? new Promise(function (res) { resolveP = res; }) : undefined;
      function finish(timedOut) {
        if (settled) return;
        settled = true;
        if (limTimer != null) { clearTimeout(limTimer); limTimer = null; }
        const k = endWaiters.indexOf(onEnd);
        if (k >= 0) endWaiters.splice(k, 1);
        if (timedOut) {
          stopTimedOut = true;
          emit.event({ ev: 'asr_stop_timeout', ms: lim, t: clock() });
          tellNotice(emit, [stopWaitText(lim)]);
        }
        closed = true;
        const r = { timedOut: timedOut, waitedMs: Math.max(0, Date.now() - began) };
        if (typeof done === 'function') done(r);
        if (resolveP) resolveP(r);
      }
      function onEnd() { finish(false); }
      wanted = false;
      // 終わっていない認識をすべて止める（中断で止めた認識をもう一度止めても害はない）
      Object.keys(alive).forEach(function (g) { try { alive[g].stop(); } catch (e) { /* 止め損ねたら、上限で進む */ } });
      if (!anyAlive()) { finish(false); return p; }
      endWaiters.push(onEnd);
      if (!settled) limTimer = setTimeout(function () { limTimer = null; finish(true); }, lim);
      return p;
    }
    return {
      kind: 'speech',
      available: !!SR,
      local: local,
      start: function () {
        if (!SR) { emit.status('この環境ではブラウザ音声認識が使えない'); return false; }
        // 前の認識がまだ終わっていなければ止める（その終わりの知らせは古い世代なので、始め直さない）
        if (rec) { try { rec.stop(); } catch (e) { /* 止め損ねても、古い世代は始め直さない */ } }
        wanted = true; fatal = false; fatalWhy = ''; restarts = 0; failed = 0; failErr = ''; stopTimedOut = false; closed = false; spin(); return true;
      },
      // 中断のときの止め方（終わりの知らせを待たない）。聞き終えるときは stopWait
      stop: function () { wanted = false; if (rec) { try { rec.stop(); } catch (e) { /* 止め損ねても害はない */ } } },
      stopWait: stopWait,
      flush: function () {},
      setFloor: mono.setFloor,
      // ここまでに知らせたこと {stopTimeout: 聞き終えるときに、認識の終わりの知らせを上限まで待っても来なかったか,
      //   late: 聞き終えた後に届いて捨てた確定の結果の数}
      noticed: function () { return { stopTimeout: stopTimedOut, late: lateCount }; },
      // 試験用: 作った認識の数（世代）と、終わりの知らせがまだ来ていない認識の数
      generation: function () { return gen; },
      pending: function () { return Object.keys(alive).length; }
    };
  }

  // ---- T3: ファイル（1発話ずつ読む。残りは数えない） ----
  // cutter: {windowEnd(), setLastT1(t), pendingCount()} を持つもの（次の窓の境目を聞き、発話の無い窓を送るため）
  function makeFileIntake(emit, cutter) {
    let reader = null, peek = null, eof = false;
    let clockT = 0, playing = false, timer = null, lastReal = 0;
    let winKey = null, winNotes = [];   // いまの窓で出した知らせ（窓の終わりの位置で見分ける）
    const badLines = [], byteLines = [], jumpLines = [], headLines = []; // 知らせた行番号（入口の知らせの欄に出す）
    const listeners = { eof: [], clock: [] };
    function fire(k, x) { listeners[k].forEach(function (f) { f(x); }); }

    // 読み込む。素材が発話を 1 つも持たなければ、断りの文の並び（materialRefusal。K21）を返す（発話があれば null）。
    // 断るかどうか（記録を作らないこと）は受け取る側が決める
    function load(text) {
      reader = makeMaterialReader(text);
      peek = null; eof = false; clockT = 0; playing = false; clearInterval(timer);
      winKey = null; winNotes = [];
      badLines.length = 0; byteLines.length = 0; jumpLines.length = 0; headLines.length = 0;
      emit.status('ファイルを読む（タブで区切った表、時刻の行と本文の行、時刻と本文を空白で区切った行、WebVTT の字幕）。残りの長さは数えない');
      return materialRefusal(text);
    }
    // 次の1発話を読む（時刻は単調にしたもの）と、その発話に付けた知らせ。無ければ null。先の行数は数えない
    function readOne() {
      if (!reader) return null;
      const u = reader.next();
      return u ? { line: { t: u.t, who: u.who, text: u.text }, notes: reader.notes() } : null;
    }
    function peekOne() { if (peek == null && !eof) { peek = readOne(); if (peek == null) eof = true; } return peek; }
    function peekLine() { const p = peekOne(); return p ? p.line : null; }
    function take() {
      const p = peekOne(); if (!p) return null;
      peek = null; emit.line(p.line);
      reveal(p.notes, p.line.t);
      return p.line;
    }

    // 知らせ（format/FORMAT.md「読めない行と、時刻の飛びと、時刻で始まる本文の行の知らせ」）。知らせを付けた発話を
    // 渡すときに出す。最後の発話より後ろの知らせは、読み切ったとき（最後の発話を渡したのと同じ窓の中）に出す。
    // 読めない行（読めないバイトを含む行も）は素材ログに {ev:'unreadable', line, raw} を残す。知らせの文は、いまの窓の
    // 知らせを種類ごとに 1 文（noticeSentences。rt.py と同じ文）
    function reveal(list, t) {
      if (!list || !list.length) return;
      const notes = list.map(function (x) { return { kind: x.kind, line: x.line }; });
      list.forEach(function (x) {
        if (x.kind === 'unreadable' || x.kind === 'badbyte') {
          (x.kind === 'badbyte' ? byteLines : badLines).push(x.line);
          emit.event({ ev: 'unreadable', line: x.line, raw: x.raw, t: t });
        } else if (x.kind === 'timehead') headLines.push(x.line);
        else jumpLines.push(x.line);
      });
      // 受け取る側が窓を知っているなら（emit.notes）、この発話に付けた知らせをそのまま渡す（emit.line の直後。最後の発話より
      // 後ろの知らせは、読み切ったときに最後の発話の分として）。窓の文は受け取る側が、分析役に実際に渡した窓の発話から組む。
      // 入口は窓の境目しか知らないので、40 件の上限で切れた窓では、どの発話がどの窓に入るかを入口では決められない
      if (typeof emit.notes === 'function') { emit.notes(notes); return; }
      // 無ければ、窓の境目の位置ごとにまとめた文を渡す（上限で切れない窓では、rt.py の next と同じ文になる）
      const key = cutter.windowEnd();
      if (key !== winKey) { winKey = key; winNotes = []; }
      Array.prototype.push.apply(winNotes, notes);
      tellNotice(emit, noticeSentences(winNotes));
    }

    // 次の窓の境目まで流す（境目より前の発話だけ。境目ちょうどの発話は次の窓）
    // 1 回押すたびに「発話が 1 つ以上入る次の窓」まで進む。次の発話が境目より先（窓幅より長い沈黙）なら、
    // 発話の無い窓は step を書かずに窓を刻みごとに送り、発話が入る窓で止める
    function playWindow() {
      if (!reader) { emit.status('ファイルが無い'); return; }
      let end = cutter.windowEnd();
      const first = peekLine();
      while (first && first.t >= end && cutter.pendingCount() === 0) {
        cutter.setLastT1(end);
        end = cutter.windowEnd();
      }
      while (true) {
        const l = peekLine();
        if (!l) { clockT = Math.max(clockT, end); reveal(reader.tail(), clockT); fire('clock', clockT); fire('eof'); return; }
        if (l.t >= end) break;
        take();
      }
      clockT = end;
      fire('clock', clockT);
    }
    // 等倍再生（発話の時刻を過ぎたら出す。時計ちょうどの発話は、時計が進んでから出す——
    // 「聞いた」のは時計より前の発話だけ、という窓の決まり（終わりちょうどの発話は次の窓）と揃える）
    function tick() {
      const now = Date.now();
      const dt = Math.min(2, (now - lastReal) / 1000); lastReal = now;
      clockT += dt;
      while (true) {
        const l = peekLine();
        if (!l) { stopPlay(); reveal(reader.tail(), clockT); fire('clock', clockT); fire('eof'); return; }
        if (l.t >= clockT) break;
        take();
      }
      fire('clock', clockT);
    }
    function startPlay() { if (!reader || playing) return; playing = true; lastReal = Date.now(); timer = setInterval(tick, 250); emit.status('等倍で再生している'); }
    function stopPlay() { playing = false; clearInterval(timer); timer = null; }

    return {
      kind: 'file',
      load: load,
      playWindow: playWindow,
      startPlay: startPlay,
      stopPlay: stopPlay,
      isPlaying: function () { return playing; },
      clock: function () { return clockT; },
      // ファイルを読み切ったか（次の発話を読もうとして何も無かった）。読み切る前に「聞き終える」を押したら false
      atEof: function () { return eof && peek == null; },
      on: function (k, f) { listeners[k].push(f); },
      // 素材の書き方（'alone'・'tsv'・'inline'・'vtt'。まだ決まっていなければ null）
      format: function () { return reader ? reader.format() : null; },
      // ここまでに知らせた行番号 {unreadable:[…], badbyte:[…], jump:[…], timehead:[…]}
      noticed: function () { return { unreadable: badLines.slice(), badbyte: byteLines.slice(), jump: jumpLines.slice(), timehead: headLines.slice() }; },
      start: function () { if (!reader) { emit.status('先にファイルを読む'); return false; } emit.status('ファイル。「次の窓を流す」か「等倍再生」で進める'); return true; },
      stop: function () { stopPlay(); },
      flush: function () {}
    };
  }

  const api = {
    makeTextIntake: makeTextIntake, makeSpeechIntake: makeSpeechIntake, makeFileIntake: makeFileIntake,
    RESTART_WAIT_MS: RESTART_WAIT_MS, FAIL_LIMIT: FAIL_LIMIT, FATAL_END_WAIT_MS: FATAL_END_WAIT_MS, asrErrorText: asrErrorText,
    speechLocal: speechLocal, speechInstall: speechInstall,
    makeMaterialReader: makeMaterialReader, materialRefusal: materialRefusal, splitWho: splitWho, readTypedLine: readTypedLine, parseTs: parseTs,
    noticeSentences: noticeSentences, NOTICE_TEXT: NOTICE_TEXT, NO_TIMED_TEXT: NO_TIMED_TEXT, NO_BODY_TEXT: NO_BODY_TEXT, VTT_DECIDED_TEXT: VTT_DECIDED_TEXT,
    TIMECOL_TEXT: TIMECOL_TEXT, STOP_WAIT_MS: STOP_WAIT_MS, STOP_WAIT_TEXT: STOP_WAIT_TEXT, stopWaitText: stopWaitText, lateText: lateText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TSV_INTAKE = api;
})();
