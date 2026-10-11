/*
 * app.js — 配線。入口（intake）→ 刻み（cut）→ 分析役（analyst）→ 検査（verify）→ 記録（record）→ 畳み込み（fold）→ 画面（timeline / panels）
 *
 * 経路（分析役）: 未選択／API（Anthropic）／API（OpenAI 互換）／この画面の Claude（枠の中）／手動の輪／人が書く／内蔵の模擬（試験用）
 * 入口: 打つ／貼る（OS の音声入力もここ）／ブラウザ音声認識／ファイル／橋（拡張などから postMessage で受ける）
 *
 * 表（2026-10-10 の作り直し）: 表に出すのは「聞き取りを開始」（聞いている間は「停止」と小さな「一時停止」）と「書き起こしを貼る」だけ。
 *   名前・音の入り方・整理する AI・区切りの長さなどは「設定と記録」の引き出し（#settings）の中で、触らなくても始められる。
 *   - 記録の名前は、欄が空なら押した時刻から付ける（autoName。「:」は名前に使えないので「時・分・秒」）。打てば今までどおり
 *     その名前の記録（同じ名前なら続きから）
 *   - 枠の中では、音の入り方の既定は拡張「橋」。「聞き取りを開始」を押すと、そのクリックの中で拡張に画面共有を始めさせ
 *     （intake.js の makeBridgeLink。枠の中のクリックは親のページにも「操作の直後」の扱いを付ける。Chromium 141 で実測）、
 *     拡張が音を取り始めたと言ってから記録を開く（取り始める前に断られたら、記録に何も書かない）。拡張が見つからない・
 *     この PC の中で文字にできない（外へ送る承知が要る）ときは、押す前から「始める前に」の欄（#ask）にそう出す。
 *     「停止」は拡張に止めさせ、拡張が止め終えた（最後の発話を送り終えた）と言ってから最後の区切りを閉じる。
 *     拡張の側で共有が止まったら（Chrome の「共有を停止」など）、そこで聞き取りを終える
 *   - 「書き起こしを貼る」: 時刻の無い文も受ける（intake.js の timedFromPlain。1 分 300 字として時刻を見積もる）。
 *     入口はファイルと同じで、区切りは 120 秒。区切りを書き終えるたびに次の区切りを自分で流す（先は読まない。残りの長さも出さない）
 *   - 前の記録は「設定と記録」の「前の記録」から開いて見る（振り返り）・書き出す
 *
 * 枠の中（claude.ai のアーティファクト）: 起動時に globalThis.claude（use か complete）があれば「枠の中」とする。
 *   - 分析役の既定を「この画面の Claude」にし、音声の入口を選べなくする（枠ではマイクも画面共有も断られる）
 *   - 「この画面の Claude」は analyst.js の makeAnalyst({kind:'claude'})。鍵の欄は要らない。もう一度呼んでも同じに落ちる誤り
 *     （e.fatal。閲覧者が許していない・口が無い）は、3 回の再試行をせずに聞き取りを止めて知らせる。混んでいる（rate_limited）
 *     ときは 10 秒おいてから同じ窓を出し直す
 *   - 記録の写し: 「枠の保存庫（db）にも写す」の印（既定オフ）が付いていて claude.use('db') が取れたら、record.js の makeDbSink を
 *     記録に結び付け、IndexedDB への追記と同じ所で写す（本体の追記の後。写しの失敗で本体は止めない）。「続きから」で IndexedDB に
 *     無く写しにあるときは、写しから本体へ流し込んでから結び付ける
 *   - 書き出し: claude.use('downloads') が取れれば枠の保存で促す。取れなければ、iframe の中では「保存できない」と言う（a[download] は
 *     枠で効かない）。iframe でなければ（仕組みが自分のページとして出す版）ふつうの書き出しに落とす
 *   - API（Anthropic／OpenAI 互換）は枠の中では選べない（fetch が外へ出ない）。問う能力（use('sample')）が無いと起動後に分かったら、
 *     分析役の欄にそう出して「聞き取りを開始」を断る
 *   - 画面の外の確認（window.confirm）は使わない。「記録を消す」は画面の中の「本当に消す」で確かめる
 *   枠の外（file:// で開いたとき）の振る舞いは、「記録を消す」の確認が画面の中（「本当に消す」）になったことを除いて変えない
 *
 * 組み込まれる部品（無ければ画面に「部品が組み込まれていない（組み立てからやり直す）」と出す）:
 *   makeVerifier(rules) / TSV_VERIFY.versionOf(open)      verify.js（版の判定はこれだけを使う。自前で open.v を読まない）
 *   fold / foldInc           fold.js（TSV_FOLD）
 *   analyze(pack, prefix, cfg) / makePrompt(prefix, pack) / parseReply(text) / toBatch(reply, window) / testConnection(cfg)   analyst.js
 *     （globalThis か globalThis.TSV_ANALYST のどちらかに置かれているものを探す）
 *
 * 規律:
 *   - 分析役に渡るのは状態の最小表現（pack）といまの窓だけ。全文を文脈に入れる口は無い（R2b）
 *   - step.at は道具（検査器）が押す。分析役が書いた at は捨てる
 *   - 検証に落ちたら同じ窓で出し直し 2 回まで。3 回目も落ちたら gap の保留を書いて窓を進める。
 *     返事が機械向けの形として読めない・判断の並びが無い、も同じ 1 回に数える
 *   - 画面に出す文は日本語。検査器や分析役の機械向けの文（規則の id・項目名を含む）は、分析役の欄の畳んだ欄
 *     「分析役に返した文（そのまま）」「検査器の文（そのまま）」の中にだけ出す
 *   - gap の最小バッチすら書けなかった窓は捨てない。発話を溜まりに戻して次の窓に合流させる（行の連番が切れない）。
 *     それが 3 窓続いたら聞き取りを止め、画面に大きく「止まった」と出す（入口の状態を「聞いている」のままにしない）
 *   - ライブでは T は常に「いま」。上へスクロールしたら追従だけ止めて「いまへ」を出す（R11）
 *   - 過去を見るのは「追体験」。シークバーで T を動かす。記録は裏で伸び続ける。
 *     ライブで聞いた記録（open.mode が live）は、T に対応する壁時計（t0 + T 秒）で畳む——返事が遅れて書かれたステップは、
 *     ライブで見えた瞬間にしか出ない（R2b）。ファイルから聞いた記録は素材時間のまま。
 *     右の逐語は、ライブでも追体験でも、窓として分析役に渡した発話だけを出す（ライブはこれまでに渡した窓、追体験は
 *     T で畳んだ最後のステップが渡した lines[1] まで）。入口が受け取っただけでまだ窓に入っていない発話は出さない
 *     （ファイルの入口・人が書く経路で、時刻の打ち間違いのあとの発話が窓より先に画面へ出てしまうため）。発話の時刻では絞らない。
 *     発話でない行のうち、読めない行の知らせはまだ渡していない発話より前にあるものだけ、ほか（認識の切断・再開）は時刻が T 以下なら出す
 *   - 素材の時刻は単調にする（直前の発話より前の時刻は、直前の時刻に揃える）。入口が揃え、続きから聞くときは
 *     素材ログを揃えて読み直し、入口にその時刻を下限として渡す。検査器に渡す素材ログも揃えた写し
 *   - 同じ名前の記録の続きから聞くとき、ファイルの入口は、素材ログにある発話の数だけ素材の頭を読み飛ばす。
 *     読み飛ばす発話が素材ログの発話と（時刻・話者・本文とも、最後の 1 件まで全部）一致しなければ、続きから聞くのを断る。
 *     ファイルから聞いた記録の続きはファイルの入口だけ、ライブで聞いた記録の続きはファイル以外の入口だけで聞く。
 *     読み飛ばす発話のうち、まだ窓として渡していない発話（最後のステップの lines[1] より後ろ）に付いた知らせと、
 *     最後の発話をまだ渡していないときの末尾の知らせは捨てず、その発話を渡す窓で出す（K22。rt.py と同じ窓に同じ文）
 *   - ファイルの入口は、時刻のある行が 1 つも無い（発話が 0 件の）素材では記録を作らずに断り、断りの文を知らせの欄に出す
 *     （K21。rt.py の file の open と同じ文）
 *   - 音声の入口で「停止」を押したら、いま動いている認識の終わりの知らせを待ってから（上限 3 秒）、最後の窓 → end に
 *     進む。待つ間に届いた確定の結果は捨てず、最後の窓に入れる。上限を過ぎたら、そのことを知らせの欄に出して進む（K19）
 *   - ライブの最後の窓の終わりは、聞き終えた時計の整数の秒（刻みには合わせない。幅は open.window × 3 まで。K23。
 *     中断のあと再開せずに聞き終えたときも同じ）。聞き終えたあとは、ふだんの刻みで窓を閉じない
 *   - 窓の幅は 5〜180 の整数の秒（欄に小数や範囲の外を打ったら、聞き始めずに断る）
 *   - 中断の間に届いた発話（打った・貼った・OS の音声入力）も捨てない。届いた時刻で溜まりに入り、再開した後の最初の窓に入る
 *     （rt.py の live と同じ）。打つ欄は中断の間も打てるので、そのことを入口の札に出す。入口の知らせ（1 列目の時刻など）は
 *     下の知らせの欄にだけ出し、この札を上書きしない
 *   - 入口の知らせの欄は、最後に分析役へ渡した窓の発話に付いた知らせを rt.py の next と同じ文で出し（まだ窓に入っていない
 *     発話の知らせは出さない）、前の窓の分は種類と行番号だけを 1 行に残す
 *   - end の t は rt.py の end_t と同じ: ライブは max(直前の窓の終わり, end を書くときの聞き始めからの秒の切り捨て)、
 *     ファイルは直前の窓の終わり（窓が無ければ 0）
 *   - 「聞き取りを開始」を押してから記録を開き終えるまでは、入口・音声の行き先の欄と「聞き取りを開始」を押させない。音声の入口なら、
 *     押した時・記録を開き終えた時・認識を作る直前に、音声の行き先を確かめ直す（承知していない音声を外へ送らない）
 *   - 音声認識が再開しない誤りで止まったら（続けて失敗した・マイクの許可が無いなど。intake.js の emit.stopped）、記録は
 *     閉じずに「止まっている」と出す。入口を選び直して「聞き取りを開始」を押すと、同じ記録の続きを聞く。「停止」もそのまま押せる
 *   - 「書き出す」の一言は、2 つのファイルそれぞれが実際にどうなったか（保存した・落とした・選ばなかった）を言う
 *   - 追体験の間は、運転状態の札も T で畳んだ状態から数える。分析役の欄（手動の輪のプロンプト・人が書くフォーム・
 *     いまの窓の知らせ）は、いまの窓（T より先の発話を含む）を持っているので、中身を画面からも DOM からも外して預かる。
 *     裏で窓が進んでも書き込みは預かった方へ行き、ライブに戻すとそのまま戻る
 */
(function () {
  'use strict';

  // 画面の部品は起動時に id で引いておく（追体験の間、分析役の欄の中身は DOM から外して預かるので、
  // そのあいだも外した方の部品を指し続けるため。document.getElementById は外した部品を返さない）
  const ELS = Object.create(null);
  Array.prototype.forEach.call(document.querySelectorAll('[id]'), function (e) { ELS[e.id] = e; });
  const $ = function (id) { return ELS[id] || document.getElementById(id); };
  const F = globalThis.TSV_FOLD;
  const CUT = globalThis.TSV_CUT;
  const REC = globalThis.TSV_RECORD;
  const INTAKE = globalThis.TSV_INTAKE;
  const TL = globalThis.TSV_TIMELINE;
  const PN = globalThis.TSV_PANELS;
  const fmt = TL.fmt;
  const RULES = globalThis.TSV_RULES || null;
  const SCHEMA = globalThis.TSV_SCHEMA || null;
  const PREFIX = typeof globalThis.TSV_PROMPT === 'string' ? globalThis.TSV_PROMPT : '';

  // 部品の関数を探す（無ければ null）
  function fn(name) {
    if (typeof globalThis[name] === 'function') return globalThis[name];
    const A = globalThis.TSV_ANALYST;
    if (A && typeof A[name] === 'function') return A[name];
    return null;
  }
  const verify = (typeof globalThis.makeVerifier === 'function' && RULES) ? globalThis.makeVerifier(RULES) : null;
  const VA = (globalThis.TSV_VERIFY && typeof globalThis.TSV_VERIFY.versionOf === 'function') ? globalThis.TSV_VERIFY : null;

  const ROUTE_LABEL = { none: '未選択', anthropic: 'API（Anthropic）', openai: 'API（OpenAI 互換）', claude: 'この画面の Claude', manual: '手動（遅い）', human: '人が書く', mock: '内蔵の模擬' };
  const INTAKE_LABEL = { text: '打つ／貼る', speech: 'ブラウザ音声認識', file: 'ファイル', bridge: '橋' };
  // 枠の中（claude.ai のアーティファクト）か。window.claude に use（いまの形）か complete（チャットで作る古い形）があれば枠の中。
  // 枠の外（file:// で開いたとき）は false で、以下の振る舞いは「記録を消す」の確認（画面の中）を除いて変わらない。
  // 仕組みが自分のページとして（枠の外で）出している版にも window.claude（use）はあるが、能力は全部 null（契約の型定義）。
  // そのときも FRAME は true で、問う能力の有無は起動後に use('sample') が解決してから分かる（下の起動の節。S.sampleAbsent）
  const FRAME = (function () { const c = globalThis.claude; return !!(c && (typeof c.use === 'function' || typeof c.complete === 'function')); })();
  // 音の診断（renderAsk の後ろの「音の診断」の節）: 診断のできる拡張の版・返事を待つ上限
  const PROBE_MIN_VER = '0.2.1';
  const PROBE_WAIT_MS = 4000;      // 押してから拡張の最初の返事（running）を待つ上限
  const PROBE_LIMIT_MS = 180000;   // 終わりの知らせ（done）を待つ上限（画面共有を選ぶ時間を含む）
  // 拡張「橋」の ZIP（枠に貼る形だけ。build_html.py --artifact が @@zip で埋め込む。ZIP の版・file:// の版では null）
  const BRIDGE_ZIP = (function () {
    const z = globalThis.KIKU_BRIDGE_ZIP;
    return z && typeof z.b64 === 'string' && typeof z.file === 'string' && typeof z.version === 'string' ? z : null;
  })();
  // iframe の中か（枠の中は iframe。仕組みが自分のページとして出す版は iframe でない）。cross-origin でも top の同一性は読める
  function inIframe() { try { return globalThis.top !== globalThis; } catch (e) { return true; } }
  // 拡張「橋」を入れて使える画面か（パソコンの Chrome 系のブラウザ）。Claude のアプリ（Electron）・スマートフォン・Chrome でない
  // ブラウザでは、拡張を入れる手順を出さずに「パソコンの Chrome で開く」と言う（そこでは入れられない・入れても枠に届かない）。
  // 見分けは userAgent の文字だけ（Electron／Mobile・Android・iPhone・iPad／Chrome/ の有無。アプリの UA は実物で確かめていない）。
  // 見分けられないもの: パソコン向けのページを求める Android のタブレット（UA が Linux のパソコンと同じ形になる）では手順が出る。
  // 触れる画面の有無で分けると、触れる画面の Linux のパソコンから手順を取り上げてしまうので、見分けを足していない
  function bridgeHostOk() {
    const ua = String((globalThis.navigator && globalThis.navigator.userAgent) || '');
    if (/Electron\/|Claude\//.test(ua)) return false;
    if (/Mobile|Android|iPhone|iPad/.test(ua)) return false;
    return /Chrome\//.test(ua);
  }
  const OPEN_IN_CHROME_TEXT = '会議の音を聞くには、パソコンの Chrome でこのアーティファクトを開きます（この画面では拡張「橋」を入れられません）。拡張が無くても「書き起こしを貼って組み上げる」は使えます。';
  // この画面の Claude が混んでいる（rate_limited）ときに、同じ窓を出し直す前に置く間。試験が短くできるよう、数が置いてあればそれを使う
  const RATE_LIMIT_WAIT_MS = (typeof globalThis.KIKU_RATE_LIMIT_WAIT_MS === 'number' && globalThis.KIKU_RATE_LIMIT_WAIT_MS >= 0) ? globalThis.KIKU_RATE_LIMIT_WAIT_MS : 10000;
  const LIVE_KINDS = { text: true, speech: true, bridge: true };   // ライブの入口（ファイル以外）
  const MISSING = '部品が組み込まれていない（組み立てからやり直す）';
  const CHECK_STOP = '記録の検査で止まった';    // 検査器に落ちたときの画面の文の頭。違反文そのもの（規則の id つき）は畳んだ欄に置く
  const RAW_TO_ANALYST = '分析役に返した文（そのまま）';   // 次の呼び出しの違反文として分析役に渡した、機械向けの文
  const RAW_CHECK = '検査器の文（そのまま）';             // 分析役には渡していない、検査器の文（警告・道具が書く行の違反）
  const HALT_TEXT = '止まった（記録に書けない）。記録を書き出して原因を調べる';
  const UNWRITTEN_LIMIT = 3;                     // 続けてこの数の窓を記録に書けなかったら聞き取りを止める
  const PAUSED_TEXT = '中断中。打った行は捨てない（届いた時刻で溜め、再開した後の最初の窓に入る）';
  const PASTE_WIN = 120;                         // 貼った書き起こしの区切りの長さ（秒）
  const BRIDGE_END_WAIT_MS = 6000;               // 「停止」で拡張に止めさせたあと、止め終えた知らせを待つ上限（拡張は認識の終わりを 3 秒まで待つ）
  const BRIDGE_PLAN_KEEP_MS = 120000;            // 枠のボタンで始められず拡張の操作部で始め直したとき、押した時の段取りを使う長さ
  const START_LABEL = '聞き取りを開始';

  function nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  // 素材ログの発話（i のある行）の時刻を単調にした写し。発話でない行はそのまま。元の配列は変えない
  function monoSrc(src) {
    let prev = null;
    return (src || []).map(function (l) {
      if (!l || l.i == null || typeof l.t !== 'number') return l;
      if (prev != null && l.t < prev) return Object.assign({}, l, { t: prev });
      prev = l.t;
      return l;
    });
  }
  function clip(s, n) { const a = Array.from(String(s || '')); return a.length > n ? a.slice(0, n).join('') : a.join(''); }
  function msg(id, text, bad) { const e = $(id); if (!e) return; e.textContent = text || ''; e.className = bad ? 'warn' : 'soft'; }
  // 入口の欄（intakebox）を隠している間（枠の中で拡張から聞く・貼った書き起こしを流す）は、入口の知らせを見える所にも出す
  function seenNote(text) { if ($('intakebox').hidden) msg('setupmsg', text); }

  // ---- 状態 ----
  const S = {
    takenNames: Object.create(null),   // 使っている記録の名前（自動の名前が重ならないように。鍵は名前なので素の表）
    route: 'none', intakeKind: 'text', name: '', win: 30,
    record: null, state: F.initState(), cutter: null, intake: null,
    listening: false, paused: false, ended: false, eof: false, halted: false,
    finishing: false,    // 「停止」を押して、音声認識の終わりの知らせを待っている（K19）
    starting: false,     // 「聞き取りを開始」を押して、記録を開いている途中（入口と音声の行き先の欄を変えさせない）
    stalled: false,      // 音声認識が再開しない誤りで止まった（記録は開いたまま。「聞き取りを開始」で入口を選び直して続ける）
    installing: false,   // 日本語の部品を入れている途中
    t0ms: null, nextI: 1, interim: '',
    cur: null,           // いまの窓 {w, attempt, violations}
    passedTo: 0,         // これまでに窓として分析役に渡した最後の発話の番号（右の逐語はここまで）
    resume: null,        // 続きから聞くときの、ファイルの読み飛ばし {n, last, E}
    lastAt: null,        // 最後に判断を書いた壁時計（ms）
    unwritten: 0,        // 続けて記録に書けなかった窓の数（gap の最小バッチすら落ちた）。書けたら 0 に戻る
    view: 'live', T: 0, playing: false, speed: 20, lastFrame: 0,
    follow: true, lockScroll: false, lastAutoY: 0,
    human: { events: [] },
    notice: null,        // 入口の知らせ（下の newNotice と renderNotices）
    sink: null,          // 枠の保存庫（db）への写し（record.js の makeDbSink）。無ければ null
    claudeAnalyst: null, // 「この画面の Claude」の分析役（makeAnalyst({kind:'claude'})）。「聞き取りを開始」ごとに作り直す（口の判定を覚えているため）
    stoppedBy: null,     // 分析役の致命の誤りで聞き取りを止めた理由（画面の文）。止めている間だけ
    sampleAbsent: false, // 枠の中（window.claude.use あり）で、起動後に use('sample') が null と分かった（問う能力が無い。枠の外の版など）
    autoNamed: false,    // いまの記録の名前を、押した時刻から付けた
    autoFeed: false,     // 貼った書き起こしを流している（区切りを書き終えるたびに次を流す）
    link: null,          // 拡張「橋」とのつなぎ（intake.js の makeBridgeLink。枠の中だけ）
    linkState: { present: null, where: null, capturing: false },
    bridgeRefusalShown: null,   // 「聞き取りを開始」で出した拡張まわりの断りの文（当てはまらなくなったら消す。clearStaleRefusal）
    awaitCapture: null,  // 「聞き取りを開始」で拡張に画面共有を頼み、取り始めるのを待っている {plan, local, at}
    lastPlan: null,      // 最後に拡張に頼んだときの段取り {plan, at}（枠のボタンで始められず、拡張の操作部で始め直したときに使う）
    bridgeSession: false,// この聞き取りは拡張が音を取っている（拡張が止まったら聞き取りを終える）
    bridgeEnding: false, // 「停止」で拡張に止めさせ、止め終えるのを待っている／拡張の側で止まった
    releaseSent: false,  // 拡張に止めるよう頼んだ（止め終えるまで、拡張が取っていても自分から始め直さない）
    sampleAsked: false,  // この画面から Claude に問う許しを、先に 1 回尋ねた
    probeBusy: false,    // 拡張に音の診断を頼み、終わりの知らせを待っている（その間は「聞き取りを開始」を断る）
    nowNote: ''          // 表の状態の行に添える一言（拡張が止まったので終えた、など）
  };

  function clock() {
    if (S.intake && S.intake.kind === 'file') return S.intake.clock();
    if (S.t0ms == null) return 0;
    return (Date.now() - S.t0ms) / 1000;
  }

  // ---- 追体験の T の渡し方 ----
  // ライブで聞いた記録（open.mode が live で t0 が読める）では、素材時間 T は壁時計 t0 + T 秒に当たる。
  // fold にはその壁時計（ISO）を渡し、「その瞬間に書き終えていたステップ」だけを畳む。ファイルから聞いた記録では
  // 素材時間と壁時計に関係が無いので、数の T（素材時間）のまま渡す
  function liveT0() {
    const o = S.record && S.record.log.length ? S.record.log[0] : null;
    if (!o || o.e !== 'open' || o.mode === 'file' || typeof o.t0 !== 'string') return null;
    const t0 = Date.parse(o.t0);
    return isFinite(t0) ? t0 : null;
  }
  function foldT(T) {
    const t0 = liveT0();
    return t0 == null ? T : new Date(t0 + T * 1000).toISOString();
  }
  // 壁時計 at を、記録の素材時間（秒。切り上げ）に直す。読めなければ null
  function secOfAt(at) {
    const t0 = liveT0();
    if (t0 == null || typeof at !== 'string') return null;
    const ms = Date.parse(at);
    return isFinite(ms) ? Math.ceil((ms - t0) / 1000) : null;
  }
  // 追体験の終わり。ライブの記録では、最後のステップ（と end）を書き終えた壁時計に当たる素材時間まで伸ばす
  // （窓の終わりで止めると、返事が遅れて書かれた最後のステップが追体験の終端でも出ない）
  function endT() {
    const s = S.state.step;
    if (!s) return 0;
    let e = s.t[1];
    const a = secOfAt(s.at); if (a != null && a > e) e = a;
    const z = S.state.ended ? secOfAt(S.state.ended.at) : null; if (z != null && z > e) e = z;
    return e;
  }

  // ---- 画面の部品 ----
  const timeline = TL.makeTimeline($('rows'), { fmt: fmt });
  const panels = PN.makePanels({
    lists: $('lists'), holds: $('holds'), holdhead: $('holdhead'), gaps: $('gaps'), gaphead: $('gaphead'),
    topbox: $('topbox'), chaps: $('chaps'), closed: $('closed'), notex: $('notex'), notesub: $('notesub'), feed: $('feed'),
    status: { since: $('st-since'), win: $('st-win'), route: $('st-route'), intake: $('st-intake'), gaps: $('st-gaps'), clock: $('st-clock'), listen: $('st-listen') }
  }, { fmt: fmt });

  function cardsBySrc(st) {
    const m = Object.create(null);
    Object.keys(st.cards).forEach(function (id) {
      st.cards[id].src.forEach(function (i) { (m[i] = m[i] || []).push(id); });
    });
    return m;
  }

  function viewState() {
    if (S.view === 'live') return S.state;
    return F.fold(S.record ? S.record.log : [], foldT(S.T));
  }

  function refresh(fresh) {
    const st = viewState();
    S.viewSt = st;
    const T = S.view === 'live' ? clock() : S.T;
    const ended = S.view === 'live' ? !!S.state.ended : (S.state.ended && S.T >= endT());
    const added = timeline.sync(st, { T: T, fresh: !!fresh });
    panels.renderLeft(st, { T: T, ended: ended });
    panels.renderNote(st, {});
    renderFeedNow(st);
    $('clock').textContent = fmt(T);
    const e = $('edge');
    // 終わった記録の終わりでは「この先」は無いので言わない。聞いている間と、振り返りの途中だけ言う
    if (st.step) e.textContent = 'いま ' + st.step.lines[0] + '〜' + st.step.lines[1] + ' 発話目まで判断した（S' + st.step.n + '）' + (ended ? '' : S.view === 'live' ? '。この先はまだ聞いていない' : '。この時点では、この先を知らない');
    else e.textContent = 'まだ最初の区切りをまとめていない';
    if (S.view === 'live' && added.length && S.follow) scrollToLast();
    if (S.view === 'replay') { $('scrub').max = endT(); $('scrub').value = S.T; }
    renderPending(st);
    // 見本は、記録が無いあいだだけ。未確定の区切りの欄は、あるときだけ
    $('sample').hidden = !!(S.record || S.listening || S.starting);
    const gp = $('gaps').parentNode;
    if (gp) gp.hidden = !F.openHolds(st).some(function (h) { return h.kind === 'gap'; });
  }

  // 流れの最後の「まとめています」の行（ライブで聞いている間だけ。追体験では出さない＝その時刻に持っていなかった）
  function renderPending(st) {
    const on = S.view === 'live' && S.listening && !S.paused && !S.stalled && !S.halted;
    $('pendrow').hidden = !on;
    if (!on) return;
    const from = st && st.step ? st.step.t[1] : 0;
    const busy = !!(S.cutter && S.cutter.isBusy());
    // 音の入口で、始めてから 15 秒たっても言葉が 1 つも届かなければ、音が来ていないと言う（黙って待たせない）
    const quiet = !!NO_SOUND[S.intakeKind] && !S.heardCount && S.heardSince != null && Date.now() - S.heardSince > 15000;
    $('pendrow').classList.toggle('quiet', quiet);
    $('pendrow-t').textContent = fmt(from) + '〜';
    $('pendrow-text').textContent = busy ? fmt(from) + ' からの話をまとめています' : fmt(from) + ' からの話を聞いています';
    // 届いた言葉があれば、数と最新の言葉を出す（音が来ていることがその場で分かる。右の逐語は、まとめに渡した分だけのまま）
    const waiting = S.nextI != null ? Math.max(0, S.nextI - 1 - S.passedTo) : 0;
    const latest = S.lastHeard ? '最新「' + (S.lastHeard.length > 36 ? '…' + S.lastHeard.slice(-36) : S.lastHeard) + '」' : '';
    const later = busy ? '' : '区切りが閉じたら、まとめてここに出します';
    $('pendrow-sub').textContent = quiet ? NO_SOUND[S.intakeKind]
      : waiting ? 'まだまとめていない言葉 ' + waiting + ' 件' + (latest ? '・' + latest : '') + (later ? '。' + later : '')
      : later;
  }
  const NO_SOUND = {
    bridge: 'まだ言葉が 1 つも届いていません。画面共有で音声も共有したかを確かめます（Windows は「システム音声も共有」、会議がタブなら「タブの音声も共有」に印）',
    speech: 'まだ言葉が 1 つも届いていません。マイクに声が入っているかを確かめます'
  };

  // 右の逐語に出す行。発話は番号が upTo 以下（窓として渡したもの）だけ。発話の時刻では絞らない。
  // 読めない行の知らせ（ev が unreadable）は、まだ渡していない発話より前にあるものだけ（入口はその行より後ろの発話を
  // 受け取ったときに知らせを残すので、後ろの発話がまだ渡っていなければ出さない）。ほかの出来事は時刻が T 以下なら出す
  function feedLines(src, upTo, T) {
    const out = [];
    let blocked = false;
    (src || []).forEach(function (l) {
      if (!l) return;
      if (l.i != null) { if (l.i <= upTo) out.push(l); else blocked = true; return; }
      if (l.ev === 'unreadable') { if (!blocked) out.push(l); return; }
      if (!(typeof l.t === 'number' && l.t > T)) out.push(l);
    });
    return out;
  }
  function renderFeedNow(st) {
    st = st || S.viewSt || viewState();
    const src = S.record ? S.record.src : [];
    const live = S.view === 'live';
    // ライブ: これまでに渡した窓まで。追体験: T で畳んだ最後のステップが渡した発話まで
    const upTo = live ? S.passedTo : (st.step ? st.step.lines[1] : 0);
    const shown = feedLines(src, upTo, live ? clock() : S.T);
    let note = '';
    if (live) {
      note = S.interim || '';
      if (!note) {
        const waiting = src.filter(function (l) { return l && l.i != null && l.i > upTo; }).length;
        if (waiting) note = '（区切りを待っている発話 ' + waiting + ' 件。区切りが閉じてまとめに渡したら、ここに出ます）';
      }
    }
    panels.renderFeed(shown, note, cardsBySrc(st), jumpTo);
  }

  function jumpTo(k, id) {
    const r = timeline.jump(k, id);
    if (r === 'mode') { setMode('all'); timeline.jump(k, id); }
  }
  function setMode(m) {
    timeline.setMode(m);
    Array.prototype.forEach.call($('modes').querySelectorAll('button'), function (b) { b.classList.toggle('on', b.dataset.m === m); });
    refresh(false);
  }

  function scrollToLast() {
    const last = timeline.lastVisible();
    if (!last) return;
    S.lockScroll = true;
    last.scrollIntoView({ block: 'center' });
    S.lastAutoY = window.scrollY;
    setTimeout(function () { S.lockScroll = false; S.lastAutoY = window.scrollY; }, 300);
  }
  window.addEventListener('scroll', function () {
    if (S.view !== 'live' || S.lockScroll) return;
    if (window.scrollY < S.lastAutoY - 60 && S.follow) { S.follow = false; $('tonow').hidden = false; }
  }, { passive: true });
  $('tonow').addEventListener('click', function () { S.follow = true; $('tonow').hidden = true; scrollToLast(); });

  // ---- 運転状態の札（1 秒ごと） ----
  // ライブでは、いまの運転（返事待ち・溜まり・窓幅）と、いまの状態から数える。
  // 追体験では、T で畳んだ状態から数える（左の欄と同じ状態。T より後に起きた未確定の窓や溜まりを数えない）。
  // 「最後の判断から」は、ライブで聞いた記録なら T と最後のステップを書いた壁時計の差、ファイルから聞いた記録では出さない
  function renderStatus() {
    const c = S.cutter;
    // 音声認識が止まった間（S.stalled）は、記録は開いたままでも「止まっている」と出す（聞いていないのに「聞いている」と言わない）
    const on = S.listening && !S.stalled;
    const kind = S.listening && S.intake ? S.intake.kind : S.intakeKind;
    const common = {
      route: ROUTE_LABEL[S.route] || S.route, intake: on ? INTAKE_LABEL[kind] : (INTAKE_LABEL[kind] + '（止まっている）'),
      listening: on, paused: S.paused, ended: S.ended, halted: S.halted
    };
    if (S.view === 'live') {
      panels.renderStatus(Object.assign(common, {
        nowMs: Date.now(), lastAt: S.lastAt, busy: !!(c && c.isBusy()), attempt: S.cur ? S.cur.attempt : 1,
        win: S.win, winEff: S.cur && c && c.isBusy() ? Math.round(S.cur.w.t[1] - S.cur.w.t[0]) : (c ? c.window() : S.win),
        pending: c ? c.pendingCount() : 0,
        gaps: F.openHolds(S.state).filter(function (h) { return h.kind === 'gap'; }).length,
        T: clock()
      }));
      return;
    }
    const st = S.viewSt || viewState();
    const w = st.open && typeof st.open.window === 'number' ? st.open.window : S.win;
    const a = st.step ? secOfAt(st.step.at) : null;
    panels.renderStatus(Object.assign(common, {
      // 追体験の T は素材時間。最後の判断の壁時計を素材時間に直せるとき（ライブで聞いた記録）だけ、その差を「最後の判断から」に出す
      nowMs: a == null ? null : S.T * 1000, lastAt: a == null ? null : a * 1000, busy: false, attempt: 1, replay: true, noStep: !st.step,
      win: w, winEff: w, pending: 0,
      gaps: F.openHolds(st).filter(function (h) { return h.kind === 'gap'; }).length,
      T: S.T
    }));
  }
  setInterval(function () {
    // 聞き終えの待ちの間と聞き終えた後は、ふだんの刻みで窓を閉じない（残りは最後の窓として閉じる。K19・K23）
    if (S.listening && !S.paused && !S.finishing && !S.eof && S.cutter && S.intake && S.intake.kind !== 'file') S.cutter.tick(clock());
    renderStatus();
    if (S.sink) renderDbState();
    if (S.view === 'live' && S.listening) $('clock').textContent = fmt(clock());
    renderNow();
  }, 1000);

  // ---- 記録の受け口（素材ログ） ----
  // 中断の間に届いた発話（打った・貼った・Win+H の音声入力）も捨てない。届いた時刻で溜まりに入れ、再開した後の
  // 最初の窓に入る（中断の間は時計で窓を閉じないので、溜まりに残る。rt.py の live と同じ振る舞い）
  const emit = {
    line: function (l) {
      if (!S.record) return;
      // 聞き取りを止めた後（記録に書けずに止まった後）に入口が返した発話は、記録に入れずに素材ログへ出来事 late として残し、
      // 知らせの欄に出す（黙って捨てない。K29。聞き終えた後の分は音声認識の入口が自分で late にするので、ここには来ない）
      if (!S.listening) { keepLate(S.record, l, true); return; }
      const line = { i: S.nextI++, t: l.t != null ? l.t : Math.floor(clock()), who: l.who == null ? null : l.who, text: l.text, at: nowIso() };
      if (l.replaces != null) line.replaces = l.replaces;
      S.record.appendSrc(line);
      S.cutter.push(line);
      S.heardCount = (S.heardCount || 0) + 1;
      S.lastHeard = String(line.text || '').replace(/\s+/g, ' ').trim();
      S.interim = '';
      refresh(false);
    },
    event: function (ev) {
      if (!S.record) return;
      const x = Object.assign({}, ev, { at: nowIso() });
      if (x.t == null) x.t = clock();
      S.record.appendSrc(x);
      refresh(false);
    },
    interim: function (text) { S.interim = text || ''; if (S.view === 'live') renderFeedNow(S.state); },
    status: function (text) { msg('intakemsg', text); if (S.intakeKind === 'speech') msg('speechmsg', text); if (S.intakeKind === 'bridge') msg('bridgemsg', text); renderNotices(); },
    // 入口の知らせ（打った行の 1 列目の時刻・音声認識の終わりを待ちきれなかったこと）。文を預かって下の知らせの欄に出す
    // （同じ文は 1 回だけ）。入口の札（intakemsg）には書かない——中断中の札「中断中。打った行は捨てない」を、
    // 打った行の 1 列目の時刻の知らせで上書きしない
    notice: function (lines) {
      if (!S.notice) S.notice = newNotice();
      (Array.isArray(lines) ? lines : []).forEach(function (s) { if (typeof s === 'string' && s && S.notice.said.indexOf(s) < 0) S.notice.said.push(s); });
      renderNotices();
    },
    // ファイルの入口が、直前に渡した発話に付けた素材の知らせ [{kind, line}]（読み切ったときは最後の発話より後ろの知らせ）。
    // 発話の番号ごとに預かり、その発話を窓として分析役に渡したときに、その窓の知らせとして出す（onWindow）
    notes: function (list) {
      if (!S.notice || !list || !list.length) return;
      // まだ 1 つも発話を渡していなければ（発話の無い素材）、どの発話にも付けない（0 番に置き、すぐ出す）
      const i = S.nextI > S.notice.firstI ? S.nextI - 1 : 0;
      S.notice.byI[i] = (S.notice.byI[i] || []).concat(list);
      renderNotices();
    }
  };
  function newNotice() { return { byI: Object.create(null), firstI: S.nextI, win: null, said: [] }; }

  // 記録に入れずに残す発話（K29）。素材ログに出来事 {ev:'late', text, t} を書く（発話の番号 i は付けない。窓にも入らない）。
  // tell なら知らせの欄に、止めた後に捨てた数を 1 文で出す（聞き終えた後の分の文は音声認識の入口の lateText。こちらは
  // 記録に書けずに止まった後の分）
  function stoppedLateText(n) {
    return n <= 1 ? '聞き取りを止めた後に届いた認識の結果を 1 件捨てました（記録の外）'
      : '聞き取りを止めた後に届いた認識の結果を、もう 1 件捨てました（記録の外。合わせて ' + n + ' 件）';
  }
  function keepLate(rec, l, tell) {
    if (!rec || !l || typeof l.text !== 'string' || !l.text) return;
    rec.appendSrc({ ev: 'late', text: l.text, t: typeof l.t === 'number' ? l.t : clock(), at: nowIso() });
    if (tell && S.record === rec) {
      S.lateStopped = (S.lateStopped || 0) + 1;
      emit.notice([stoppedLateText(S.lateStopped)]);
    }
    if (S.record === rec) refresh(false);
  }

  // 音声認識の入口への受け口（K29）。入口はこの記録 rec のためのもの。聞き終えた後に入口が遅れて返した出来事（late）は、
  // そのあと別の記録を開いていても（同じ名前で開き直して断られた場合も）、この記録の素材ログに書く。新しく開いた記録には
  // 何も入れず、知らせの欄に「前の記録の素材ログに残した」と出す。札・途中結果に出すのは、この記録がまだ開いているときだけ
  // holder.intake: この受け口を渡した入口（止まった知らせを、入れ替えた後の古い入口から受けないため）
  function speechEmit(rec, holder) {
    const mine = function () { return S.record === rec; };
    let elsewhere = 0;
    function keptElsewhere() {
      elsewhere++;
      emit.notice(['前の記録「' + rec.name + '」で聞き終えた後に届いた認識の結果を' + (elsewhere > 1 ? '、合わせて ' + elsewhere + ' 件' : ' 1 件') + '、その記録の素材ログに残しました（記録の外）']);
    }
    return {
      line: function (l) { if (mine()) emit.line(l); else if (l && typeof l.text === 'string' && l.text) { keepLate(rec, l, false); keptElsewhere(); } },
      event: function (ev) {
        if (mine()) { emit.event(ev); return; }
        if (ev && ev.ev === 'late') { rec.appendSrc(Object.assign({}, ev, { at: nowIso() })); keptElsewhere(); }
      },
      interim: function (text) { if (mine()) emit.interim(text); },
      status: function (text) { if (mine()) emit.status(text); },
      notice: function (lines) { if (mine()) emit.notice(lines); },
      stopped: function (why) { if (mine() && (!holder || S.intake === holder.intake)) speechStopped(why); }
    };
  }

  // 音声認識が再開しない誤りで止まった（続けて失敗した・マイクの許可が無い・言語が使えないなど。intake.js の emit.stopped）。
  // 記録は閉じない（end を書かない）。「聞いている」とは言わず、入口を選び直して「聞き取りを開始」を押せば、同じ記録の続きを
  // 聞けるようにする（restartIntake）。「停止」もそのまま押せる（止まった認識の終わりは待たない）
  const STALLED_GUIDE = '続けるなら、「設定と記録」で音の入り方を「打つ／貼る」にして「もう一度聞く」を押す（同じ記録の続きに書く）。音声でもう一度試すなら、そのまま「もう一度聞く」を押す。終えるなら「停止」';
  function speechStopped(why) {
    if (!S.listening || S.finishing || S.paused || S.ended || S.halted) return;
    S.stalled = true;
    const text = '音声認識が止まった（' + why + '）。' + STALLED_GUIDE;
    msg('intakemsg', text, true);
    msg('speechmsg', text, true);
    setButtons();
    renderStatus();
  }

  // 入口の知らせ（読めない行・時刻が飛んでいる行・時刻で始まる本文の行・打った行の 1 列目の時刻）。入口の札は次の状態の
  // 一言で上書きされるので、別の欄に出す。
  //   ファイル: 最後に分析役へ渡した窓の発話に付いた知らせ（読めないバイトを含む行も）を、種類ごとに 1 文で出す（INTAKE.noticeSentences。rt.py の
  //     next が同じ窓で出す文と一字違わず同じ）。まだ窓に入っていない発話の知らせは出さない（40 件の上限で次の窓に回った
  //     発話の知らせも、その窓を渡すまで出さない）。それより前の窓の知らせは消さず、「前の窓までの知らせ」の 1 行に種類と
  //     行番号だけを残す（説明の文は繰り返さない）。発話の無い素材の知らせ（0 番）は、窓が無いのですぐ出す
  //   打つ／貼る: 1 列目の時刻を落とした行があったら、そのことを 1 回だけ（入口が emit.notice で渡した文）
  //   音声認識: 聞き終えるときに認識の終わりの知らせを上限まで待っても来なかったら、そのこと（同じ。K19）
  // 種類の順は INTAKE.NOTICE_KINDS と同じ（「前の窓までの知らせ」の 1 行で、どの種類も落とさない）
  const NOTICE_KIND_LABEL = { unreadable: '読めない行', badbyte: '読めないバイトを含む行', jump: '時刻が飛んでいる行', timehead: '時刻で始まる本文の行' };
  function noticeLineList(a) { return a.slice(0, 5).join('・') + ' 行目' + (a.length > 5 ? 'ほか ' + (a.length - 5) + ' 行' : ''); }
  // 預かった知らせのうち、番号が lo〜hi の発話に付いたもの
  function notesIn(lo, hi) {
    const out = [];
    if (!S.notice) return out;
    Object.keys(S.notice.byI).forEach(function (k) { const i = Number(k); if (i >= lo && i <= hi) Array.prototype.push.apply(out, S.notice.byI[k]); });
    return out;
  }
  function renderNotices() {
    const e = $('intakenotice');
    if (!e) return;
    const out = [];
    const win = S.notice && S.notice.win;
    const cur = win ? notesIn(win[0], win[1]) : notesIn(0, 0);
    if (cur.length) INTAKE.noticeSentences(cur).forEach(function (l) { out.push(l); });
    const old = {};
    if (win) notesIn(0, win[0] - 1).forEach(function (x) { (old[x.kind] = old[x.kind] || []).push(x.line); });
    const parts = [];
    Object.keys(NOTICE_KIND_LABEL).forEach(function (k) {
      const a = (old[k] || []).filter(function (x, j, all) { return all.indexOf(x) === j; }).sort(function (x, y) { return x - y; });
      if (a.length) parts.push(NOTICE_KIND_LABEL[k] + '（' + noticeLineList(a) + '）');
    });
    if (parts.length) out.push('前の窓までの知らせ：' + parts.join('、'));
    const said = S.notice ? S.notice.said : [];
    said.forEach(function (s) { out.push(s); });
    // 入口が emit.notice を呼ばずに印だけ立てた場合の守り（同じ文を二度は出さない）
    const n = S.intake && typeof S.intake.noticed === 'function' ? S.intake.noticed() : null;
    const tc = INTAKE.TIMECOL_TEXT || '打った行の 1 列目の時刻は使わない（届いた時刻で押す）';
    if (n && n.timecol && said.indexOf(tc) < 0) out.push(tc);
    if (n && n.stopTimeout && typeof INTAKE.STOP_WAIT_TEXT === 'string' && said.indexOf(INTAKE.STOP_WAIT_TEXT) < 0 && !said.some(function (s) { return /待っても来なかった/.test(s); })) out.push(INTAKE.STOP_WAIT_TEXT);
    if (n && n.late > 0 && typeof INTAKE.lateText === 'function' && said.indexOf(INTAKE.lateText(n.late)) < 0) out.push(INTAKE.lateText(n.late));
    e.innerHTML = '';
    out.forEach(function (s) { const d = document.createElement('div'); d.textContent = s; e.appendChild(d); });
    e.hidden = !out.length;
  }

  // ---- 入口の切り替え ----
  function showIntake(kind) {
    S.intakeKind = kind;
    $('in-text').hidden = kind !== 'text';
    $('in-speech').hidden = kind !== 'speech';
    $('in-file').hidden = kind !== 'file';
    $('in-bridge').hidden = kind !== 'bridge';
    renderIntakeBox();
    if (kind === 'speech' && !(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition)) msg('speechmsg', 'このブラウザには音声認識が無い', true);
    else if (kind === 'speech') msg('speechmsg', '「聞き取りを開始」で始まる（マイクの許可を求められる）');
    if (kind === 'speech') probeSpeech();
    renderAsk();
  }
  // 入口の操作の欄を表に出すか。拡張とつながる枠の中で「橋」なら表の欄（#ask）が案内し、貼った書き起こしは
  // ひとりでに流れるので、どちらも出さない
  function renderIntakeBox() {
    $('intakebox').hidden = (S.intakeKind === 'bridge' && !!S.link) || !!S.autoFeed;
  }
  $('intake').addEventListener('change', function () { showIntake(this.value); });

  // ---- 音声をどこで文字にするか（この PC の中か、提供元のサーバーか） ----
  // S.speechWhere: 'checking'・'available'・'downloadable'・'downloading'・'unavailable'・'none'（intake.js の speechLocal）。
  // この PC の中で文字にできないときは、音声を外へ送ることを承知する印（speech-cloud）が無ければ聞き始めない。
  // 端末内で始めた後に失敗しても、提供元のサーバーへは切り替えない（intake.js）
  const SPEECH_WHERE_TEXT = {
    checking: 'この PC の中で文字にできるかを調べている…',
    available: 'この PC の中で文字にする（音声は外へ出ない）',
    downloadable: 'いまは、この PC の中では文字にできない。下の「日本語の部品を入れる」で入れればできる。入れずに使うなら、音声を提供元のサーバーへ送ることになる',
    downloading: '日本語の部品を入れている途中。終わるまでは、この PC の中では文字にできない（終わったかは「日本語の部品を入れる」でもう一度確かめる）。待たずに使うなら、音声を提供元のサーバーへ送ることになる',
    unavailable: 'このブラウザは、この PC の中だけでは文字にできない。使うなら、音声を提供元のサーバーへ送ることになる',
    none: 'このブラウザは、この PC の中だけでは文字にできない。使うなら、音声を提供元のサーバーへ送ることになる'
  };
  function hasSpeech() { return !!(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition); }
  function renderSpeechWhere() {
    const w = S.speechWhere || 'checking';
    const e = $('speechwhere');
    if (!hasSpeech()) { e.textContent = ''; $('speech-cloudrow').hidden = true; $('speech-installrow').hidden = true; return; }
    e.textContent = SPEECH_WHERE_TEXT[w] || SPEECH_WHERE_TEXT.unavailable;
    e.className = w === 'available' ? 'ok' : (w === 'checking' ? 'soft' : 'warn');
    $('speech-cloudrow').hidden = w === 'available' || w === 'checking';
    $('speech-installrow').hidden = w !== 'downloadable' && w !== 'downloading';
  }
  function probeSpeech() {
    if (!hasSpeech() || typeof INTAKE.speechLocal !== 'function') { S.speechWhere = 'none'; renderSpeechWhere(); return Promise.resolve('none'); }
    const my = (S.speechProbe = (S.speechProbe || 0) + 1);
    S.speechWhere = 'checking'; renderSpeechWhere();
    return INTAKE.speechLocal().then(function (w) {
      if (my === S.speechProbe) { S.speechWhere = w; renderSpeechWhere(); }
      return w;
    });
  }
  $('speech-install').addEventListener('click', function () {
    const b = this;
    if (typeof INTAKE.speechInstall !== 'function') return;
    b.disabled = true; S.installing = true;
    S.speechWhere = 'downloading'; renderSpeechWhere();
    msg('speechmsg', '日本語の部品を入れている…（3 分まで待つ。入れるときに音声は送らない）');
    INTAKE.speechInstall().then(function (ok) {
      S.installing = false; setButtons();
      msg('speechmsg', ok ? '日本語の部品が入った' : '日本語の部品が入らなかった（断られたか、3 分待っても終わらなかった。部品の取得が止められている PC かもしれない）', !ok);
      return probeSpeech();
    });
  });
  // 聞き始める前に、音声の行き先を確かめる。聞き始めてよければ空文字
  function speechRefusal() {
    if (!hasSpeech()) return 'このブラウザには音声認識が無い。入口を「打つ／貼る」にする';
    const w = S.speechWhere;
    if (!w || w === 'checking') return 'この PC の中で文字にできるかを調べている途中。少し待ってから始める';
    if (w !== 'available' && !$('speech-cloud').checked) return 'この PC の中では文字にできないので、音声を提供元のサーバーへ送ることを承知する印が要る（入口の欄）。送ってよくなければ、入口を「打つ／貼る」にする';
    return '';
  }
  // 音声の入口で認識を作る直前の確かめ。聞き始めてよければ空文字を返し、この PC の中で文字にするか（S.speechLocalOn）を
  // いまの調べの結果で決め直す。押した時だけでなく、記録を開き終えた後・入口を選び直した後にも通す（押してから記録を
  // 開き終えるまでの間に入口や印が変わっても、承知していない音声を外へ送らない）
  function speechGate() {
    const no = speechRefusal();
    if (no) return no;
    S.speechLocalOn = S.speechWhere === 'available';
    return '';
  }

  function showRoute(r) {
    S.route = r;
    $('analystbox').hidden = !(r === 'manual' || r === 'human');
    $('an-manual').hidden = r !== 'manual';
    $('an-human').hidden = r !== 'human';
    $('apibox').open = (r === 'anthropic' || r === 'openai');
    $('claudenote').hidden = r !== 'claude';
    const notes = [];
    if (!verify) notes.push('検査の' + MISSING + '。記録できない');
    if ((r === 'anthropic' || r === 'openai') && !fn('analyze')) notes.push('API の分析役の' + MISSING);
    if (r === 'claude' && !fn('makeAnalyst')) notes.push('この画面の Claude に問う分析役の' + MISSING);
    if (r === 'claude' && !FRAME) notes.push(CLAUDE_OUTSIDE);
    if (r === 'claude' && FRAME && S.sampleAbsent) notes.push(CLAUDE_NO_SAMPLE);
    if ((r === 'anthropic' || r === 'openai') && FRAME) notes.push(API_IN_FRAME);
    if ((r === 'anthropic' || r === 'openai' || r === 'claude' || r === 'manual') && !PREFIX) notes.push('分析役への指示文が組み込まれていない（組み立てからやり直す）');
    if (r === 'manual' && !fn('makePrompt')) notes.push('手動の輪のプロンプトを作る' + MISSING + '。指示文と状態をそのまま連結して出す');
    if (r === 'manual' && !fn('parseReply')) notes.push('手動の輪の返事を読む' + MISSING + '。返事はそのまま機械向けの形式として読む');
    msg('setupmsg', notes.join('／'), notes.length > 0);
    renderStatus();
  }
  const CLAUDE_OUTSIDE = 'この画面には、画面を開いている相手への口が無い（枠の外で開いている）。分析役を他のものにする';
  const CLAUDE_NO_SAMPLE = 'この画面には、画面を開いている相手に問う能力が与えられていない（枠の外で開いているか、能力が無い）。分析役を他のものにする';
  const API_IN_FRAME = 'この枠からは外の API に送れない（枠の外向きの通信は止められている）。分析役を「この画面の Claude」にする';
  // 分析役を変えたら、前の分析役で「接続を試す」を押した結果を消す（別の分析役の結果に見えないように）
  $('route').addEventListener('change', function () { msg('api-msg', ''); showRoute(this.value); });

  // ---- API の設定（鍵は既定でこのタブだけ。覚えるのは opt-in） ----
  function loadApiCfg() {
    try {
      const saved = JSON.parse(localStorage.getItem('kiku.api') || '{}');
      $('api-url').value = saved.url || ''; $('api-model').value = saved.model || '';
      const k = localStorage.getItem('kiku.key');
      if (k) { $('api-key').value = k; $('api-remember').checked = true; }
      else { const s = sessionStorage.getItem('kiku.key'); if (s) $('api-key').value = s; }
    } catch (e) { /* 保存領域が使えない環境では空のまま */ }
  }
  function saveApiCfg() {
    try {
      localStorage.setItem('kiku.api', JSON.stringify({ url: $('api-url').value.trim(), model: $('api-model').value.trim() }));
      const k = $('api-key').value;
      if ($('api-remember').checked) { localStorage.setItem('kiku.key', k); sessionStorage.removeItem('kiku.key'); }
      else { localStorage.removeItem('kiku.key'); sessionStorage.setItem('kiku.key', k); }
    } catch (e) { /* 同上 */ }
  }
  // analyst.js の cfg の形（kind / key / model / base / schema）に合わせる
  function apiCfg() {
    const cfg = { kind: S.route, key: $('api-key').value, schema: SCHEMA };
    const model = $('api-model').value.trim(); if (model) cfg.model = model;
    const url = $('api-url').value.trim(); if (url) cfg.base = url;
    return cfg;
  }
  // API の設定で、送れない・送り先が食い違うものを先に断る（送れるなら空文字）。
  // Anthropic はいつも api.anthropic.com に送るので、住所の欄に何かあれば断る（打った住所へ送るように見えて、別の所へ送らないため）
  function apiRefusal(cfg) {
    if (FRAME) return API_IN_FRAME;   // 枠の中では fetch が外へ出ない。窓ごとに 3 回落ちて空振りを積むだけなので、先に断る
    if (!String(cfg.key || '').trim()) return 'API の鍵が空。「API の設定」で鍵を貼る（「接続を試す」で通るのを確かめてから始める）';
    if (cfg.kind === 'openai' && !cfg.model) return 'API（OpenAI 互換）はモデル名が要る（「API の設定」の「モデル」に打つ）';
    if (cfg.kind === 'anthropic' && cfg.base) return 'API（Anthropic）は送り先の住所を変えられない（いつも api.anthropic.com に送る）。住所の欄を空にするか、分析役を「API（OpenAI 互換）」にする';
    return '';
  }
  ['api-url', 'api-model', 'api-key', 'api-remember'].forEach(function (id) { $(id).addEventListener('change', saveApiCfg); });
  $('api-forget').addEventListener('click', function () {
    $('api-key').value = ''; $('api-remember').checked = false;
    try { localStorage.removeItem('kiku.key'); sessionStorage.removeItem('kiku.key'); } catch (e) { /* 無視 */ }
    msg('api-msg', '鍵を消した');
  });
  $('api-test').addEventListener('click', function () {
    const t = fn('testConnection');
    if (!t) { msg('api-msg', '接続を試す' + MISSING, true); return; }
    if (S.route === 'claude') {
      if (!FRAME) { msg('api-msg', CLAUDE_OUTSIDE, true); return; }
      msg('api-msg', 'この画面の Claude に短い問いを送っている…（画面を開いている人に、許すかどうかの確認が出る）');
      Promise.resolve().then(function () { return t({ kind: 'claude' }, '', {}); }).then(function (r) {
        if (!r) { msg('api-msg', '返事が無い', true); return; }
        const parts = [r.ok ? '通った' : '通らなかった', '口: ' + (r.reached ? 'ある' : '無い'), '返事: ' + (r.authed ? '来た' : '来ない')];
        if (r.model) parts.push('答えた段 ' + r.model);
        if (r.error) parts.push(String(r.error));
        msg('api-msg', parts.join('／'), !r.ok);
      }, function (e) { msg('api-msg', '失敗：' + (e && e.screen || e && e.message || e), true); });
      return;
    }
    if (S.route !== 'anthropic' && S.route !== 'openai') { msg('api-msg', '分析役で API を選んでから', true); return; }
    const no = apiRefusal(apiCfg());
    if (no) { msg('api-msg', no, true); return; }
    msg('api-msg', '試している…');
    Promise.resolve().then(function () { return t(apiCfg(), PREFIX, { repeat: true }); }).then(function (r) {
      if (typeof r === 'string') { msg('api-msg', r); return; }
      if (!r) { msg('api-msg', '返事が無い', true); return; }
      const parts = [];
      parts.push(r.ok ? '通った' : '通らなかった');
      if (r.reached != null) parts.push('届いた: ' + (r.reached ? 'はい' : 'いいえ'));
      if (r.authed != null) parts.push('鍵: ' + (r.authed ? '通った' : '通らない'));
      if (r.status) parts.push('状態 ' + r.status);
      if (r.cache_read != null) parts.push('キャッシュ読み ' + r.cache_read + ' トークン' + (r.cache_read === 0 ? '（乗っていない）' : ''));
      if (r.error) parts.push(String(r.error));
      msg('api-msg', parts.join('／'), !r.ok);
    }, function (e) { msg('api-msg', '失敗：' + (e && e.message || e), true); });
  });
  loadApiCfg();

  // ---- 始める・中断・終える ----
  // 聞いている間と、「聞き取りを開始」を押して記録を開いている途中（S.starting）・拡張が音を取り始めるのを待っている間
  // （S.awaitCapture）は、聞き取りの設定を変えさせない。音声認識が止まった間（S.stalled）だけは、入口と音声の行き先の欄を
  // 選び直して「もう一度聞く」（#start）を押せる（restartIntake）。
  // 表のボタンは 1 か所で形が変わる: 待っている間は「聞き取りを開始」、聞いている間は「停止」と小さな「一時停止」／「再開」
  function setButtons() {
    const waiting = !!S.awaitCapture;
    const lock = S.listening || S.starting || waiting;
    const retry = S.listening && S.stalled && !S.finishing && !S.paused && !S.halted;
    const st = $('start');
    st.disabled = S.halted || S.starting || waiting || S.probeBusy || (S.listening && !retry);
    st.hidden = S.listening && !retry;
    st.textContent = retry ? 'もう一度聞く' : waiting ? '画面を選んでいます…' : S.starting ? '始めています…' : START_LABEL;
    $('hero').hidden = S.listening && !retry;
    $('pause').disabled = !S.listening || S.paused || S.finishing || S.eof || !!(S.cutter && S.cutter.isBusy());
    $('pause').hidden = !S.listening || S.paused;
    $('resume').hidden = !S.paused; $('resume').disabled = !S.paused || S.finishing;
    $('end').hidden = !S.listening;
    $('end').disabled = !S.listening || S.finishing;
    $('end').textContent = S.finishing ? '止めています…' : '停止';
    ['name', 'route', 'win', 'known', 'db-mirror'].forEach(function (id) { $(id).disabled = lock; });
    ['intake', 'speech-cloud'].forEach(function (id) { $(id).disabled = lock && !retry; });
    $('speech-install').disabled = (lock && !retry) || S.installing;
    $('bridge-cloud').disabled = lock;
    $('bridge-install').disabled = lock;
    $('paste-go').disabled = lock || S.halted;
    $('paste-open').hidden = !!S.halted;   // 記録に書けずに止まった後は、読み込み直すまで新しく始められない
    $('past-open').disabled = lock || !$('past').value;
    const fileOn = S.listening && S.intake && S.intake.kind === 'file' && !S.paused && !S.ended;
    $('file-next').disabled = !fileOn || !!(S.cutter && S.cutter.isBusy()) || S.intake.isPlaying() || S.eof;
    $('file-play').disabled = !fileOn || S.intake.isPlaying() || S.eof;
    $('file-play').hidden = !!(fileOn && S.intake.isPlaying());
    $('file-stop').hidden = !(fileOn && S.intake.isPlaying()); $('file-stop').disabled = !fileOn;
    renderNow();
    renderAsk();
    renderIntakeBox();
  }

  // 記録の名前を、押した時刻から付ける（「:」は名前に使えない＝ファイル名になるので「時・分・秒」で書く）
  function autoName(suffix) {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    const base = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + '時' + p(d.getMinutes()) + '分' + p(d.getSeconds()) + '秒' + (suffix || '');
    // 同じ秒に 2 度始めても、前の記録の名前と重ならないよう番号を足す（このブラウザにある記録とこのページで始めた記録）
    let name = base, k = 2;
    while (S.takenNames[name]) name = base + '（' + (k++) + '）';
    return name;
  }

  // 「聞き取りを開始」・「構造にする」の前の確かめ。始めてよければ {name, win, autoNamed} を、断るなら {error, open, api}
  // （open: 設定の引き出しを開いて見せる）か {material}（発話が 1 つも無い素材。K21・K31）を返す。記録はまだ何も触らない。
  // o.win: 区切りの長さを欄からでなくこの値にする（貼った書き起こし）。o.suffix: 自動の名前の後ろに足す語
  function startPlan(o) {
    o = o || {};
    S.resume = null;
    const typed = $('name').value.trim();
    // 分析役に問えずに止まった記録（end を書いていない）は、名前を打たなくても同じ記録の続きに書く（貼り付けは別の記録）
    const cont = !typed && !o.suffix && S.stoppedBy && S.record && !S.ended && !S.viewOnly ? S.record.name : '';
    const name = typed || cont || autoName(o.suffix);
    if (/[\\/:*?"<>|]/.test(name)) return { error: '名前に使えない文字がある（\\ / : * ? " < > |）', open: true };
    if (S.route === 'none') return { error: '整理する AI を選ぶ（「設定と記録」の中。API が無ければ「手動の輪」か「人が書く」。試すだけなら「内蔵の模擬」）', open: true };
    if (!verify || !VA) return { error: '検査の' + MISSING + 'ので記録できない' };
    if (S.route === 'anthropic' || S.route === 'openai') {
      const no = apiRefusal(apiCfg());
      if (no) return { error: no, open: true, api: true };
    }
    if (S.route === 'claude' && !FRAME) return { error: CLAUDE_OUTSIDE, open: true };
    if (S.route === 'claude' && S.sampleAbsent) return { error: CLAUDE_NO_SAMPLE, open: true };
    if (S.intakeKind === 'speech') {
      const no = speechGate();
      if (no) return { error: no, open: true };
    }
    let win = o.win;
    if (win == null) {
      // 区切りの長さは 5〜180 の整数の秒（記録の先頭の型。小数や範囲の外は、黙って直さずに断る）
      const winRaw = String($('win').value).trim();
      const winBad = !!($('win').validity && $('win').validity.badInput);   // 数として読めない字（欄の値は空になる）
      const winNum = winBad ? NaN : (winRaw === '' ? 30 : Number(winRaw));
      if (!Number.isInteger(winNum) || winNum < 5 || winNum > 180) return { error: '区切りの長さは 5〜180 の整数の秒で打つ（' + (winRaw || '空') + ' は使えない）', open: true };
      win = winNum;
    }
    // ファイルの入口: 発話が 1 つも無い素材（時刻のある行が無い・どれも本文が空）は、記録を作らずに断る（K21。
    // rt.py の file の open と同じ文。続きから聞くときも、記録を開く前に断る）。0 バイトのファイル・空白だけの素材も、
    // 「読み込んでいない」とは言わずに同じ文で断る（K31）
    if (S.intakeKind === 'file' && typeof S.fileText === 'string' && typeof INTAKE.materialRefusal === 'function') {
      const no = INTAKE.materialRefusal(S.fileText);
      if (no && no.length) return { material: no };
    }
    return { name: name, win: win, autoNamed: !typed && !cont };
  }
  function refuse(plan) {
    if (plan.material) { refuseMaterial(plan.material); return; }
    msg('setupmsg', plan.error, true);
    if (plan.open) openSettings(true);
    if (plan.api) $('apibox').open = true;
  }

  $('start').addEventListener('click', function () {
    if (S.starting || S.awaitCapture) return;
    if (S.probeBusy) { msg('setupmsg', '音の診断の途中です。終わってから押します', true); return; }
    // 音声認識が止まった後: 同じ記録のまま、いま選んでいる入口で聞き直す
    if (S.listening) { if (S.stalled) restartIntake(); return; }
    restoreIntake();
    const plan = startPlan({});
    if (plan.error || plan.material) { refuse(plan); renderAsk(); return; }
    // 拡張「橋」から聞く（枠の中）: 画面共有を、押したこの操作の中で拡張に始めさせる（枠の中のクリックは親のページにも
    // 「操作の直後」の扱いを付けるので、親で動く拡張はそのうちに画面共有を始められる）。記録を開くのは、拡張が音を
    // 取り始めたと言ってから（onCaptureStarted。選ぶ画面で断られたら、記録に何も書かない）
    if (S.intakeKind === 'bridge' && S.link) {
      const ls = S.link.state();
      const why = bridgeRefusal(ls);
      if (why) { msg('setupmsg', why, true); S.bridgeRefusalShown = why; renderAsk(); return; }
      const local = ls.where === 'available';
      S.awaitCapture = { plan: plan, local: local, at: Date.now() };
      S.lastPlan = null;
      msg('setupmsg', '');
      S.link.capture(local);
      setButtons();
      // すでに取っている（拡張の操作部から始めていた）: 返事の here は変わらないので、ここで始める
      if (ls.capturing) onCaptureStarted();
      return;
    }
    startSession(plan);
  });

  // 記録を開いて聞き始める（startPlan の段取りで）。開き終えるまで（ブラウザ内の保存が遅いと数秒かかる）、入口・音声の
  // 行き先の欄と「聞き取りを開始」を押させない
  function startSession(plan) {
    S.takenNames[plan.name] = true;
    S.name = plan.name;
    S.win = plan.win;
    S.autoNamed = !!plan.autoNamed;
    S.viewOnly = false;
    S.nowNote = '';
    S.claudeAnalyst = null;   // 口の判定（閲覧者が許したか）を覚えているので、聞き始めるたびに作り直す
    S.stoppedBy = null;
    const rec = REC.makeRecord(plan.name);
    clearScreen();
    if (S.view !== 'live') setView('live');
    msg('setupmsg', '記録を開いている…');
    S.starting = true;
    setButtons();
    rec.load().then(function () { return prepareMirror(rec); }).then(function () {
      try { opened(rec); } finally { S.starting = false; afterOpen(); setButtons(); }
    }, function (e) { S.starting = false; afterOpen(); setButtons(); msg('setupmsg', '記録を開けない：' + (e && e.message || e), true); });
  }
  // 記録を開き終えた後（聞き始めたかどうかにかかわらず）の後始末。聞き始めなかったなら、拡張には止めてもらい、
  // 貼った書き起こしの流しも止める
  function afterOpen() {
    if (S.listening) return;
    S.autoFeed = false;
    if (S.bridgeSession) dropBridge();
  }

  // ---- 拡張「橋」とのつなぎ（枠の中） ----
  // 始められない理由（始めてよければ空文字）
  function bridgeRefusal(ls) {
    if (ls.present === null) return '拡張「橋」を探している途中です。少し待ってから押します';
    if (ls.present === false && BRIDGE_ZIP && !bridgeHostOk()) return OPEN_IN_CHROME_TEXT;
    if (ls.present === false) return '拡張「橋」が見つかりません（入れ方は下）。拡張が無くても「書き起こしを貼って組み上げる」は使えます';
    if (ls.where == null || ls.where === 'checking') return 'この PC の中で文字にできるかを、拡張が調べている途中です。少し待ってから押します';
    if (ls.where !== 'available' && !$('bridge-cloud').checked) {
      if (ls.where === 'downloadable') return 'この PC の中で文字にする部品が、まだ入っていません。下の「日本語の部品を入れる」で入れるか、音声を外へ送ることを承知する印を付けると始められます';
      if (ls.where === 'downloading') return '日本語の部品を入れている途中です。入れ終われば始められます。待たずに始めるなら、音声を外へ送ることを承知する印を付けます（下の欄）';
      return 'この PC の中では文字にできないので、音声を外へ送ることを承知する印が要ります（下の欄）';
    }
    return '';
  }
  // 拡張が音を取り始めた（here の capturing:true）。押した時の段取りで記録を開く。押していないのに始まった（拡張の
  // 操作部で始めた・枠のボタンからは始められず操作部で始め直した）ときは、少し前に押した時の段取りか、いまの設定で始める
  function onCaptureStarted() {
    const kept = S.lastPlan && Date.now() - S.lastPlan.at < BRIDGE_PLAN_KEEP_MS ? S.lastPlan : null;
    const a = S.awaitCapture || kept;
    S.awaitCapture = null; S.lastPlan = null;
    if (S.listening || S.starting || S.releaseSent) { setButtons(); return; }
    let plan = a ? a.plan : null;
    if (!plan) {
      if (S.intakeKind !== 'bridge') { setButtons(); return; }
      const p = startPlan({});
      if (p.error || p.material) {
        msg('setupmsg', '拡張が音を取り始めましたが、こちらは始められません：' + (p.error || p.material[0]), true);
        if (p.open) openSettings(true);
        S.releaseSent = true; S.link.release();
        setButtons(); return;
      }
      plan = p;
    }
    S.bridgeSession = true;
    S.bridgeLocal = S.linkState.where === 'available';
    startSession(plan);
  }
  // 拡張が音を取る前に断った（選ぶ画面で取り消した・音が共有されていない・この PC の中では文字にできないなど）。
  // 記録は開いていないので、何も書かない。拡張の操作部で始め直したときのために、押した時の段取りを少しだけ覚えておく
  function captureFailed(text) {
    const a = S.awaitCapture;
    S.awaitCapture = null;
    if (a) S.lastPlan = { plan: a.plan, at: Date.now() };
    msg('setupmsg', '始められませんでした：' + (text || '拡張が画面共有を始められなかった'), true);
    setButtons();
  }
  // 聞き取りをやめた（始められなかった・終えた）ので、拡張にも音を取るのをやめてもらう
  function dropBridge() {
    S.bridgeSession = false;
    if (S.link && S.linkState.capturing) { S.releaseSent = true; S.link.release(); }
  }
  // 「聞き取りを開始」で出した断り（赤の文）が、つながりの変化（拡張が入った・部品が入ったなど）や承知の印で当てはまらなく
  // なったら消す（断りの文がそのまま残っていると、もう押せるのに押せないように読める）。別の文に書き換わっていれば触らない
  function clearStaleRefusal() {
    const shown = S.bridgeRefusalShown;
    if (!shown || bridgeRefusal(S.linkState) === shown) return;
    S.bridgeRefusalShown = null;
    if ($('setupmsg').textContent === shown) msg('setupmsg', '');
  }
  // 拡張から here が届いた・つながりが変わった
  function onLink(st) {
    const was = S.linkState;
    S.linkState = st;
    clearStaleRefusal();
    if (!st.capturing) S.releaseSent = false;
    if (st.capturing && !was.capturing && !S.releaseSent) onCaptureStarted();
    else if (S.awaitCapture && st.present === false) captureFailed('拡張とのつながりが切れた');
    bridgeWatch();
    setButtons();
  }
  // 拡張が音を取るのをやめた: 「停止」を押した後なら、止め終えたので最後の区切りを閉じる。押していないなら（Chrome の
  // 「共有を停止」・拡張の誤り・つながりが切れた）、そこで聞き取りを終える（拡張は、溜めた発話を送ってから止まったと言う）
  function bridgeWatch() {
    if (!S.bridgeSession || !S.listening || !S.intake || S.intake.kind !== 'bridge' || S.linkState.capturing) return;
    if (!S.bridgeEnding) {
      const b = S.intake.status().bridge;
      S.nowNote = b && b.state === 'error' && b.text ? '拡張が止まったので、聞き取りを終えました（' + b.text + '）'
        : S.linkState.present === false ? '拡張とのつながりが切れたので、聞き取りを終えました' : '画面の共有が止まったので、聞き取りを終えました';
      S.bridgeEnding = true; S.finishing = true;
    }
    finishBridge();
  }
  function finishBridge() {
    if (!S.bridgeEnding) return;
    S.bridgeEnding = false; S.bridgeSession = false;
    clearTimeout(S.bridgeEndTimer);
    S.finishing = false;
    if (S.halted || !S.listening) { setButtons(); return; }
    try { S.intake.stop(); } catch (e) { /* 止め損ねても、終える */ }
    finishListening();
  }
  // この画面から Claude に問う許しを、聞き始めたときに 1 回だけ先に尋ねる（最初の区切りが閉じるまで待たせない。
  // 断られたら、その場で知らせる。断られても聞き取りは続く——区切りが閉じたときに分析役が同じ断りで止める）
  function askSampleOnce() {
    if (S.sampleAsked || S.route !== 'claude' || !FRAME) return;
    S.sampleAsked = true;
    REC.useCapability('permissions').then(function (p) {
      if (!p || typeof p.request !== 'function') return null;
      return p.request(['sample']);
    }).then(function (r) {
      if (r && r.sample === 'denied') msg('setupmsg', 'この画面から Claude に問うことが許されていないので、構造を作れません。画面の右上の許可の欄で、問うことを許してから始め直します', true);
    }).catch(function () { /* 尋ねられなくても、最初の区切りで分析役が尋ねる */ });
  }

  // ---- 表の状態の行・始める前の欄 ----
  function renderNow() {
    const box = $('now');
    if (!box) return;
    let text, cls, where = '';
    if (S.halted || S.stoppedBy) { text = '止まりました'; cls = 'bad'; }
    else if (S.awaitCapture) { text = '共有する画面を選んでいます'; cls = 'wait'; }
    else if (S.starting) { text = '始めています'; cls = 'wait'; }
    else if (S.listening && S.stalled) { text = '音声認識が止まりました'; cls = 'bad'; }
    else if (S.listening && S.finishing) { text = '止めています'; cls = 'wait'; }
    else if (S.listening && S.paused) { text = '一時停止中'; cls = 'pause'; }
    else if (S.listening && S.autoFeed) { text = '書き起こしを読んでいます'; cls = 'on'; }
    else if (S.listening) { text = '聞き取り中'; cls = 'on'; }
    else if (S.viewOnly) { text = '前の記録を見ています'; cls = 'off'; }
    else if (S.ended) { text = '停止しました'; cls = 'off'; }
    else { text = '待機中'; cls = 'idle'; }
    if (S.listening && !S.stalled) {
      const k = S.intake ? S.intake.kind : S.intakeKind;
      if (k === 'bridge' && S.bridgeSession) where = S.bridgeLocal ? 'この PC の中で文字にしています' : '音声は Google のサーバーで文字にしています';
      else if (k === 'speech') where = S.speechLocalOn ? 'この PC の中で文字にしています' : '音声は提供元のサーバーで文字にしています';
      else if (k === 'text') where = '打った文から';
      else if (k === 'bridge') where = '拡張から届いた文から';
    }
    box.className = 'now ' + cls;
    $('now-text').textContent = text;
    $('now-clock').textContent = S.listening ? fmt(clock()) : '';
    $('now-where').textContent = S.nowNote || where;
    $('feedwhere').textContent = where;
    $('recname').textContent = S.record ? S.record.name : '';
    // まとめが追いついている所（最後に書いた区切りの終わり）。聞いている間だけ
    const sv = S.viewSt;
    $('now-lag').textContent = S.listening && !S.stalled ? (sv && sv.step ? 'まとめは ' + fmt(sv.step.t[1]) + ' まで' : '最初のまとめを待っています') : '';
    // 画面の段取り（見た目だけに使う）: idle＝まだ何も無い、live＝聞いている、done＝記録を見ている
    document.body.dataset.mode = S.listening ? 'live' : S.record ? 'done' : 'idle';
    renderPending(S.viewSt);
  }
  function renderAsk() {
    const box = $('ask');
    if (!box) return;
    if (!(S.link && S.intakeKind === 'bridge') || S.listening || S.starting) { box.hidden = true; return; }
    const ls = S.linkState;
    let text = '', cls = 'info', install = false, cloud = false, setup = false;
    if (S.awaitCapture) text = '画面共有の画面で、会議の音が出ている所を選びます。Windows は「画面全体」を選んで「システム音声も共有」に印。会議がブラウザのタブなら、そのタブを選んで「タブの音声も共有」に印。';
    else if (ls.present === null) text = '拡張「橋」を探しています…';
    else if (ls.present === false && BRIDGE_ZIP && !bridgeHostOk()) { text = OPEN_IN_CHROME_TEXT; cls = 'warn'; }
    else if (ls.present === false && BRIDGE_ZIP) { text = '会議の音を聞くには、Chrome に拡張「橋」を入れます。はじめの 1 回だけ、3 つの手順です。'; cls = 'setup'; setup = true; }
    else if (ls.present === false) { text = 'この画面の中では音を取れないため、会議の音を聞くには Chrome の拡張「橋」が要ります。いまは見つかりません（この版の画面には拡張が入っていません。アーティファクトの版で開くと、そこから保存できます）。'; cls = 'warn'; }
    else if (ls.where === 'available') { text = '拡張とつながっています。押すと画面共有の画面が出ます。会議の音は、この PC の中で文字にします（音声は外へ出ません）。'; cls = 'ok'; }
    else if (ls.where == null || ls.where === 'checking') text = '拡張とつながっています。この PC の中で文字にできるかを調べています…';
    else if (ls.where === 'downloadable') { text = '拡張とつながっています。この PC の中で文字にするための日本語の部品が、まだ入っていません。部品を入れるか、音声を外へ送ることを承知すると始められます。'; cls = 'warn'; install = true; cloud = true; }
    else if (ls.where === 'downloading') { text = '拡張とつながっています。日本語の部品を入れています。入れ終われば、この PC の中で文字にします。待たずに始めるなら、音声を外へ送ることを承知します。'; cloud = true; }
    else { text = '拡張とつながっています。このブラウザは、この PC の中だけでは文字にできません。始めるには、音声を外へ送ることを承知します。'; cls = 'warn'; cloud = true; }
    box.hidden = false;
    box.className = 'ask ' + cls;
    $('ask-text').textContent = text;
    $('ask-install-row').hidden = !install;
    $('ask-cloud-row').hidden = !cloud;
    $('ask-setup').hidden = !setup;
    if (setup) renderSetup();
    // 拡張の新しい版がある（つながっている拡張の版が、この画面の持つ版より古い）: 止めずに知らせ、保存の口を出す
    const old = !!(BRIDGE_ZIP && ls.present === true && !S.awaitCapture && typeof INTAKE.versionLess === 'function' && INTAKE.versionLess(ls.ver, BRIDGE_ZIP.version));
    $('ask-update-row').hidden = !old;
    if (old) $('ask-update-text').textContent = '拡張の新しい版（' + BRIDGE_ZIP.version + '）があります（いまは ' + ls.ver + '。このままでも使えます）。保存した ZIP を拡張機能の画面（chrome://extensions）に落とすと置き換わります。';
    // 音の診断: 診断のできる版（PROBE_MIN_VER 以降）の拡張とつながっている間だけ出す（診断の途中と、結果を出した後も出したまま）
    const probeOk = ls.present === true && typeof ls.ver === 'string' && typeof INTAKE.versionLess === 'function' && !INTAKE.versionLess(ls.ver, PROBE_MIN_VER);
    $('ask-probe-row').hidden = !(probeOk || S.probeBusy);
    $('probe-go').disabled = S.probeBusy || !!S.awaitCapture;
  }

  // ---- 音の診断（拡張 0.2.1 から。拡張が画面全体の音を取り、届くか・この PC の中で文字になるか・Google のサーバーなら文字になるかを
  // 1 回で測る。2026-10-10 の私用 PC の初めての実走で、端末内の認識が「aborted」で止まったため）。
  // 結果は画面に出し、枠の保存庫（db）の probe にも残す（Claude が読んで、文字にする所をどうするかを相談するため）
  let probeTimer = null, probeHeard = false;
  function probeReset() { S.probeBusy = false; clearTimeout(probeTimer); probeTimer = null; setButtons(); }
  $('probe-go').addEventListener('click', function () {
    if (!S.link || S.probeBusy || S.awaitCapture || S.listening || S.starting) return;
    S.probeBusy = true; probeHeard = false;
    $('probe-out').textContent = '';
    msg('probe-msg', 'Chrome の画面共有の画面が出ます。');
    S.link.probe();
    setButtons();
    probeTimer = setTimeout(function () {
      if (!S.probeBusy) return;
      if (!probeHeard) { msg('probe-msg', '拡張から返事がありません。拡張の版が古いか、拡張とのつながりが切れています', true); probeReset(); return; }
      probeTimer = setTimeout(function () { if (S.probeBusy) { msg('probe-msg', '診断の終わりの知らせが届きませんでした。右下の拡張の欄に結果が出ていれば、それを読みます', true); probeReset(); } }, PROBE_LIMIT_MS);
    }, PROBE_WAIT_MS);
  });
  function onProbe(n) {
    if (!S.probeBusy) return;   // 頼んでいない知らせ（別の枠が頼んだ診断など）は出さない
    probeHeard = true;
    if (n.state === 'running') { msg('probe-msg', n.text); return; }
    const out = $('probe-out');
    out.textContent = '';
    n.summary.forEach(function (line) { const p = document.createElement('p'); p.textContent = line; out.appendChild(p); });
    msg('probe-msg', '終わりました。結果を保存庫に残しています…');
    probeReset();
    REC.useCapability('db').then(function (db) {
      if (!db) { msg('probe-msg', '終わりました（保存庫が無いので、結果はこの画面だけにあります）'); return; }
      return db.doc('probe/p' + Date.now()).set({ at: new Date().toISOString(), summary: n.summary, report: n.report }).then(function () {
        msg('probe-msg', '終わりました。結果はこのアーティファクトの保存庫にも残しました（Claude が読めます）');
      });
    }).then(null, function (e) { msg('probe-msg', '終わりました（保存庫に残せませんでした：' + (e && e.message || e) + '。この画面の結果を写して送ります）', true); });
  }

  // ---- 拡張「橋」を入れる手順（枠に貼る形だけ。ZIP は build_html.py --artifact が埋め込む） ----
  // 手順は 3 つ: 保存する（枠の保存で ZIP を渡す）・拡張機能の画面を開いてデベロッパーモードをオン・ZIP を落とす。
  // 入ったかは押させずに気づく（つなぎの ping が here を受けると、この手順は消えて「つながっています」になる）。
  // 確かめたこと（Chromium 141 で実測。tests/e2e/e2e_bridge_install.js）: デベロッパーモードがオンの拡張機能の画面に ZIP を落とすと、
  // 確かめの画面なしに入る。入ったときに開いていた claude.ai のタブにも拡張が入り（background.js）、読み込み直さずにつながる
  const SETUP = { saved: null, saving: false, copied: false };
  function bridgeZipBytes() {
    const bin = atob(BRIDGE_ZIP.b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function renderSetup() {
    if (!BRIDGE_ZIP) return;
    const kb = Math.max(1, Math.round(BRIDGE_ZIP.b64.length * 3 / 4 / 1024));
    $('step-save').classList.toggle('done', !!SETUP.saved);
    $('bridge-save').disabled = SETUP.saving;
    $('bridge-save-msg').textContent = BRIDGE_ZIP.file + '（約 ' + kb + ' KB）';
    $('step-open').classList.toggle('done', SETUP.copied);
    $('bridge-zip-name').textContent = SETUP.saved || BRIDGE_ZIP.file;
  }
  // 枠の保存（downloads）で ZIP を渡す。閲覧者が保存の確かめで受けたときだけ保存される。outId は結果を出す所
  function saveBridgeZip(outId) {
    if (!BRIDGE_ZIP || SETUP.saving) return;
    const out = $(outId);
    SETUP.saving = true; out.textContent = '保存の確かめを出しています…'; out.classList.remove('warn');
    renderSetup();
    REC.useCapability('downloads').then(function (dl) {
      if (!dl) return { ok: false, why: 'この画面では保存できない' };
      const x = REC.makeDownloadsExport(dl);
      return x.save(BRIDGE_ZIP.file, bridgeZipBytes()).then(function (ok) { return ok ? { ok: true, name: x.status.lastSaved } : { ok: false, why: x.status.reason, code: x.status.lastError && x.status.lastError.code }; });
    }).then(function (r) {
      SETUP.saving = false;
      if (r.ok) { SETUP.saved = r.name; out.textContent = r.name + ' を保存しました'; }
      // 保存の確かめで取り消した: 誤りではないので赤にしない。もう一度押せば確かめが出る
      else if (r.code === 'declined') out.textContent = '保存を取り消しました。もう一度押すと保存の確かめが出ます';
      else { out.textContent = '保存しませんでした（' + r.why + '）'; out.classList.add('warn'); }
      renderSetup();
    });
  }
  $('bridge-save').addEventListener('click', function () { saveBridgeZip('bridge-save-result'); });
  $('bridge-update').addEventListener('click', function () { saveBridgeZip('bridge-update-msg'); });
  // chrome://extensions はページから開けない（リンクも window.open も Chrome が断る。Chromium 141 で実測）ので、アドレスを写させる。
  // 写せなければ（古いアプリの枠などで clipboard が断られる）、アドレスを選んだ状態にして Ctrl+C を頼む
  $('ext-copy').addEventListener('click', function () {
    const url = $('ext-url').textContent;
    const say = function (t, bad) { $('ext-copy-msg').textContent = t; $('ext-copy-msg').classList.toggle('warn', !!bad); };
    const pick = function () {
      try { const r = document.createRange(); r.selectNodeContents($('ext-url')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); } catch (e) { /* 選べなくても文は出す */ }
      say('写せなかったので、アドレスを選びました。Ctrl+C で写してください', true);
    };
    let p = null;
    try { p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url) : null; } catch (e) { p = null; }
    if (!p) { pick(); return; }
    p.then(function () { SETUP.copied = true; say('写しました'); renderSetup(); }, pick);
  });
  function openSettings(open) {
    const d = $('settings');
    d.open = open;
    if (open) { try { d.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { d.scrollIntoView(); } }
  }
  $('settings').addEventListener('toggle', function () { $('settings-open').setAttribute('aria-expanded', String(this.open)); });
  $('settings-open').addEventListener('click', function () { openSettings(!$('settings').open); });
  $('settings-close').addEventListener('click', function () { openSettings(false); try { $('settings-open').focus(); } catch (e) { /* 戻せなくても困らない */ } });
  $('bridge-install').addEventListener('click', function () { if (S.link) { S.link.install(); msg('setupmsg', '日本語の部品を入れています（入れるときに音声は送りません）'); } });
  $('bridge-cloud').addEventListener('change', function () { if (this.checked) msg('setupmsg', ''); clearStaleRefusal(); renderAsk(); });

  // 前の記録の画面を空にする（別の記録を開く・始める前に）。カードの番号は記録ごとに C1 から振るので、空の状態で
  // 一度描いて、前の記録の行を消してから次を描く
  function clearScreen() {
    if (S.listening) return;
    S.state = F.initState(); S.record = null; S.cur = null; S.cutter = null; S.passedTo = 0; S.lastAt = null;
    S.ended = false; S.eof = false; S.viewOnly = false; S.interim = '';
    refresh(false);
  }

  // ---- 前の記録 ----
  // 表の「前の記録」（新しい順に 5 件まで。押すと開いて振り返る）。名前が自動の日時なら「10月10日 14:05」の形で見せる
  const PAST_SHOWN = 5;
  function pastLabel(name) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})時(\d{2})分\d{2}秒(.*)$/.exec(name);
    return m ? Number(m[2]) + '月' + Number(m[3]) + '日 ' + Number(m[4]) + ':' + m[5] + m[6] : name;
  }
  function renderPastList(list) {
    const ul = $('pastitems');
    ul.innerHTML = '';
    list.slice(0, PAST_SHOWN).forEach(function (r) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'past-item';
      const n = document.createElement('b'); n.textContent = pastLabel(r.name); b.appendChild(n);
      if (!r.ended) { const s = document.createElement('span'); s.className = 'soft'; s.textContent = '途中で止まった記録'; b.appendChild(s); }
      b.addEventListener('click', function () { openPast(r.name, 'setupmsg'); });
      li.appendChild(b); ul.appendChild(li);
    });
    $('pastlist').hidden = !list.length;
    $('pastmore').hidden = list.length <= PAST_SHOWN;
    $('pastmore').textContent = 'ほか ' + (list.length - PAST_SHOWN) + ' 件は「設定と記録」の「前の記録」から開けます';
  }
  // このブラウザに残っている記録の一覧（始めた日時の新しい順。閉じていない記録には「（途中）」を添える）
  function refreshPast() {
    const ask = typeof REC.listRecords === 'function' ? REC.listRecords()
      : REC.listNames().then(function (ns) { return ns.map(function (n) { return { name: n, ended: true }; }); });
    ask.then(function (list) {
      const sel = $('past');
      const was = sel.value;
      sel.innerHTML = '';
      if (!list.length) { const o = document.createElement('option'); o.value = ''; o.textContent = '（まだ無い）'; sel.appendChild(o); }
      list.forEach(function (r) { S.takenNames[r.name] = true; });
      list.forEach(function (r) { const o = document.createElement('option'); o.value = r.name; o.textContent = r.name + (r.ended ? '' : '（途中）'); sel.appendChild(o); });
      if (was && list.some(function (r) { return r.name === was; })) sel.value = was;
      renderPastList(list);
      setButtons();
    }, function () { /* 読めなければ一覧は空のまま */ });
  }
  // 前の記録を開いて、振り返りで見る（書き足さない。続きに書くなら、記録の名前を打って「聞き取りを開始」）
  $('past-open').addEventListener('click', function () { openPast($('past').value, 'recmsg'); });
  // 前の記録を開いて振り返る（聞いていないときだけ）。知らせは box の欄に出す（表の一覧から開いたときは表の欄）
  function openPast(name, box) {
    if (!name || S.listening || S.starting || S.awaitCapture) return;
    const rec = REC.makeRecord(name);
    msg(box, '開いている…');
    rec.load().then(function () {
      if (!rec.log.length) { msg(box, '「' + name + '」は空でした', true); return; }
      if (VA.versionOf(rec.log[0]) !== 2) { msg(box, '「' + name + '」は古い形か知らない版の記録なので、この画面では開けません', true); return; }
      clearScreen();
      S.record = rec; S.state = F.fold(rec.log); S.ended = !!S.state.ended;
      S.viewOnly = true; S.stoppedBy = null; S.nowNote = ''; $('halt').hidden = true;
      setView('replay');
      msg(box, '「' + name + '」を開きました。上の「頭から」「再生」で、話が進んだ順に見られます');
      setButtons();
    }, function (e) { msg(box, '開けない：' + (e && e.message || e), true); });
  }

  // ---- 書き起こしを貼る ----
  // 時刻の無い文も受ける（1 分 300 字として時刻を見積もる）。入口はファイルと同じ。区切りは PASTE_WIN 秒で、区切りを
  // 書き終えるたびに次の区切りを流す（feedNext）。貼った全文は S.fileText に持ち、欄は空にする（先の発話を画面に残さない。R2b）
  $('paste-open').addEventListener('click', function () {
    const p = $('paste');
    p.hidden = !p.hidden;
    if (!p.hidden) { msg('paste-msg', ''); $('paste-text').focus(); }
  });
  $('paste-cancel').addEventListener('click', function () { $('paste').hidden = true; });
  $('paste-go').addEventListener('click', function () {
    if (S.listening || S.starting || S.awaitCapture) { msg('paste-msg', '聞き取りの途中は使えません。先に「停止」を押します', true); return; }
    if (S.halted) { msg('paste-msg', HALT_TEXT + '。新しく始めるには、このページを読み込み直します', true); return; }
    const raw = $('paste-text').value;
    if (!raw.trim()) { msg('paste-msg', '貼った文が空です', true); return; }
    const conv = INTAKE.timedFromPlain(raw);
    const before = S.intakeKind;
    const fileBefore = S.fileText;   // 読み込んであったファイル（無ければ undefined）。貼り付けが終わったら戻す
    $('intake').value = 'file'; showIntake('file');
    S.fileText = conv.text;
    const plan = startPlan({ win: PASTE_WIN, suffix: '（貼り付け）' });
    if (plan.error || plan.material) { S.fileText = fileBefore; $('intake').value = before; showIntake(before); refuse(plan); msg('paste-msg', plan.error || plan.material[0], true); return; }
    S.intakeBeforePaste = before;
    S.fileBeforePaste = fileBefore;
    $('paste-text').value = '';
    $('paste').hidden = true;
    S.autoFeed = true;
    S.pasteEstimated = !!conv.estimated;
    startSession(plan);
  });
  // 貼った書き起こしの次の区切りを流す（分析役が前の区切りを書き終えてから）
  function feedNext() {
    if (!S.autoFeed || !S.listening || S.paused || S.eof || S.halted || !S.intake || S.intake.kind !== 'file') return;
    if (S.cutter && S.cutter.isBusy()) return;
    S.intake.playWindow();
    setButtons();
  }
  // 貼り付けのために入口をファイルにしていたら、元に戻す（次の「聞き取りを開始」が元の入口で始まるように）
  function restoreIntake() {
    if (S.intakeBeforePaste == null) return;
    const k = S.intakeBeforePaste;
    S.intakeBeforePaste = null;
    // 貼った文は、次の「聞き取りを開始」の素材にしない（ファイルの入口で、貼る前に読み込んであった素材に戻す）
    S.fileText = S.fileBeforePaste; S.fileBeforePaste = undefined;
    $('intake').value = k; showIntake(k);
  }
  // ---- 枠の保存庫（db）への写し ----
  // 「枠の保存庫にも写す」の印が付いていれば、claude.use('db') を取り、record.js の makeDbSink をこの記録に結び付ける。
  // 取れなければ（枠の外・能力が無い・断られた）写さない（印の隣にそう出す）。本体は IndexedDB のまま。
  // 続きから: IndexedDB にこの名前の記録が無く、写しにあれば（別のタブ・別の端末で聞いた記録）、写しから本体へ流し込む。
  // 流し込みは結び付ける前に行う（流し込んだ分を写しに二重に書かないため）。IndexedDB にあれば本体を正とし、写しは続きから書く
  // （写しの側が短くても長くても、ここでは揃えない）。写しの失敗は status に残るだけで、本体の追記は止めない（record.js）
  function prepareMirror(rec) {
    S.sink = null;
    renderDbState();
    if (!$('db-mirror').checked) return Promise.resolve();
    return REC.useCapability('db').then(function (db) {
      if (!db) { msg('db-state', '枠の保存庫が無いので写さない（枠の外か、この画面に保存庫の能力が無い）', true); return; }
      const sink = REC.makeDbSink(db, rec.name);
      if (rec.log.length) { rec.attachMirror(sink); S.sink = sink; renderDbState(); return; }
      return sink.loadAll().then(function (all) {
        if (!all || !all.ok) { msg('db-state', '写しを読めなかった（' + (all && all.error || '理由不明') + '）。写さずに続ける', true); return; }
        if (all.log.length) {
          // 写しから本体へ（結び付ける前なので、写しには二重に書かない）
          rec.appendLog(all.log);
          all.src.forEach(function (l) { rec.appendSrc(l); });
        }
        rec.attachMirror(sink); S.sink = sink;
        renderDbState(all.log.length ? '写しから復元した（判断ログ ' + all.log.length + ' 行・素材ログ ' + all.src.length + ' 行）。' : '');
      });
    }).catch(function (e) { msg('db-state', '写しを用意できなかった（' + (e && e.message || e) + '）。写さずに続ける', true); });
  }
  function renderDbState(head) {
    const e = $('db-state');
    if (!e) return;
    if (!S.sink) { if (!head && !$('db-mirror').checked) e.textContent = ''; return; }
    const st = S.sink.status;
    if (st.error) { e.textContent = (head || '') + '写しは止まった：' + st.error + '（本体はこの画面の中に残っている）'; e.className = 'warn'; return; }
    e.textContent = (head || '') + '写している（判断ログ ' + st.written.log + ' 行・素材ログ ' + st.written.src + ' 行' + (st.retried ? '。やり直し ' + st.retried + ' 回' : '') + (st.dropped ? '。落とした ' + st.dropped + ' 件' : '') + '）';
    e.className = 'soft';
  }

  // 記録を開き終えた（「聞き取りを開始」の続き）。押した時に確かめたことのうち、音声の行き先はここでもう一度確かめる
  // （押してから開き終えるまでに入口や印が変わっていても、承知していない音声を外へ送らない。記録はまだ何も書かない）
  function opened(rec) {
    const name = rec.name;
    if (S.intakeKind === 'speech') {
      const no = speechGate();
      if (no) { msg('setupmsg', '聞き始めなかった（記録には何も書いていない）：' + no, true); return; }
    }
    S.record = rec;
    if (rec.log.length) {
      // 版の判定は verify.js（規則表）だけが知っている。知らない版は黙って v1 扱いにしない
      const ver = VA.versionOf(rec.log[0]);
      if (ver !== 2) {
        msg('setupmsg', ver === 1 ? 'この名前の記録は古い形（1 版）なので続きを書けない。別の名前にする' : 'この名前の記録は知らない版（規則表に無い版）なので続きを書けない。別の名前にするか、「記録を消す」', true);
        S.record = null; return;
      }
      const st = F.fold(rec.log);
      if (st.ended) { msg('setupmsg', 'この名前の記録はもう聞き終えている（' + rec.log.length + ' 行）。別の名前にするか、「記録を消す」', true); S.record = null; return; }
      const why = resumeRefusal(st, rec);
      if (why) { msg('setupmsg', '続きから聞けない：' + why, true); S.record = null; S.resume = null; return; }
      S.state = st;
      S.win = st.open.window;
      $('win').value = S.win;
      msg('setupmsg', '続きから（判断ログ ' + rec.log.length + ' 行、素材ログ ' + rec.src.length + ' 行' + (S.resume && S.resume.n ? '。素材の頭の ' + S.resume.n + ' 発話は前に聞いたので読み飛ばす' : '') + '）');
    } else {
      // ファイルの入口で素材をまだ読んでいなければ、記録の先頭を書く前に断る（素材の無い記録を残さない）
      if (S.intakeKind === 'file' && typeof S.fileText !== 'string') {
        msg('setupmsg', '先に素材のファイルを読み込む（「ファイルを選ぶ」→「読み込む」か、下の欄に貼る）。記録はまだ作っていない', true);
        S.record = null; return;
      }
      S.state = F.initState();
      const open = { e: 'open', v: 2, name: name, t0: nowIso(), mode: S.intakeKind === 'file' ? 'file' : 'live', window: S.win, known: $('known').value.trim() };
      const r = verify([], [open], { now: open.t0 });
      if (!r.ok) {
        msg('setupmsg', '記録の先頭を書けない（窓幅は 5〜180 秒、聞き始める前に知っていたことは 2000 字まで。検査器の文は下の欄）', true);
        anMsg([CHECK_STOP + '（記録の先頭を書けなかった）'], true, r.errors, RAW_CHECK);
        S.record = null; return;
      }
      rec.appendLog(r.batch);
      S.state = F.foldInc(S.state, r.batch);
      msg('setupmsg', '');   // 始めたことは上の札（聞き取り中）が言う。ここに重ねて出さない
    }
    beginListening();
  }

  // 発話が 1 つも無い素材の断り（K21）。lines は intake.js の materialRefusal が返す文の並び（1 つ目が断りの文、続きが
  // 読めない行などの知らせの文。rt.py の file の open と同じ文）。記録は作らない。断りの文は入口の知らせの欄に並べ、
  // 上の札にも 1 つ目の文を出す
  function refuseMaterial(lines) {
    msg('setupmsg', '聞き始めなかった（記録は作っていない）：' + lines[0], true);
    S.notice = newNotice();
    S.notice.said = lines.slice();
    renderNotices();
  }

  // 続きから聞けない理由（聞けるなら空文字）。ファイルの入口なら、読み飛ばしの段取り S.resume も作る
  function resumeRefusal(st, rec) {
    S.resume = null;
    const o = st.open || {};
    if (!Number.isInteger(o.window)) return 'この記録の窓幅（' + o.window + '）が整数でない（前の版で作った記録）。別の名前にする';
    const fileRec = o.mode === 'file';
    if (fileRec && S.intakeKind !== 'file') return 'ファイルから聞いた記録なので、入口を「ファイル」にして、前と同じ素材を読み込んでから始める';
    if (!fileRec && S.intakeKind === 'file') return 'ライブで聞いた記録なので、ファイルの入口では続きを聞けない。入口を「打つ／貼る」か「ブラウザ音声認識」にする';
    if (!fileRec) return '';
    // ファイル: 素材ログにある発話の数だけ素材の頭を読み、読んだ発話がどれも素材ログの発話と一致することを確かめる
    const utts = rec.src.filter(function (l) { return l && l.i != null; });
    const n = utts.length;
    if (!n) { S.resume = { n: 0 }; return ''; }
    if (typeof S.fileText !== 'string') return '前と同じ素材ファイルを読み込んでから始める（素材ログにある ' + n + ' 発話を、素材の頭から読み飛ばして続ける）';
    // 読み飛ばす発話は、最後の 1 件に限らず全部を素材ログと照らす（違うファイルで続きを書かないため）
    const rd = INTAKE.makeMaterialReader(S.fileText);
    let u = null;
    for (let k = 0; k < n; k++) {
      u = rd.next();
      if (!u) return '素材の発話が素材ログより少ない（素材ログ ' + n + ' 発話、素材 ' + k + ' 発話）。前と同じファイルか確かめる';
      const a = utts[k];
      const diff = [];
      if (u.t !== a.t) diff.push('時刻');
      if ((u.who == null ? null : u.who) !== (a.who == null ? null : a.who)) diff.push('話者');
      if (u.text !== a.text) diff.push('本文');
      if (diff.length) return '素材の ' + (k + 1) + ' 番目の発話が、素材ログの ' + (k + 1) + ' 番目と合わない（' + diff.join('・') + 'が違う）。前と同じファイルか確かめる';
    }
    const last = utts[n - 1];
    // E: 読み飛ばしの境目。最後に読み飛ばす発話の時刻より少しだけ先（同じ時刻の続きの発話は、新しい発話として受け取る）。
    // ids: 読み飛ばす発話の番号（素材ログの i。読み飛ばしの k 番目の発話に付いた知らせを、その番号の発話に預けるため。K22）
    S.resume = { n: n, last: { t: last.t, who: last.who == null ? null : last.who, text: last.text }, E: u.t + 1e-6, ids: utts.map(function (l) { return l.i; }) };
    return '';
  }

  // ライブの入口（打つ／貼る・音声認識）を作る
  function makeLiveIntake(rec, kind) {
    if (kind === 'text') return INTAKE.makeTextIntake($('ta'), emit, clock);
    // 橋: 届いた発話は打つ入口と同じ emit.line に入る（素材ログの形も src の名前も同じ）。札は emit.status（入口の札）に出る
    if (kind === 'bridge') return INTAKE.makeBridgeIntake(emit, clock);
    // 時計もこの記録の聞き始めから数える（聞き終えた後に別の記録を開いても、遅れた結果の時刻をこの記録の秒で書く）
    const t0ms = S.t0ms;
    const holder = {};
    holder.intake = INTAKE.makeSpeechIntake(speechEmit(rec, holder), function () { return (Date.now() - t0ms) / 1000; }, { local: !!S.speechLocalOn });
    return holder.intake;
  }
  // 素材ログの最後の発話の時刻（単調にした写しで）。無ければ null
  function lastUttT(src) {
    let t = null;
    monoSrc(src).forEach(function (l) { if (l && l.i != null) t = l.t; });
    return t;
  }

  // 音声認識が止まった後（S.stalled）に「聞き取りを開始」を押した: 同じ記録・同じ時計・同じ刻みのまま、いま選んでいる入口で
  // 聞き直す（記録は開き直さない。分析役に渡している窓もそのまま）。ライブの記録なので、ファイルの入口には切り替えない。
  // 音声なら、聞き始めるときと同じに音声の行き先を確かめる
  function restartIntake() {
    const kind = S.intakeKind;
    if (!LIVE_KINDS[kind]) { msg('setupmsg', 'この記録はライブで聞いているので、ファイルの入口には切り替えられない。入口を「打つ／貼る」か「ブラウザ音声認識」か「橋」にする', true); return; }
    if (kind === 'speech') {
      const no = speechGate();
      if (no) { msg('setupmsg', no, true); return; }
    }
    const old = S.intake;
    try { if (old) old.stop(); } catch (e) { /* 止まった認識を止め損ねても害はない */ }
    const next = makeLiveIntake(S.record, kind);
    const lastT = lastUttT(S.record.src);
    if (typeof next.setFloor === 'function' && lastT != null) next.setFloor(lastT);
    S.intake = next;
    S.stalled = false;
    if (!next.start()) { S.intake = old; S.stalled = true; setButtons(); renderStatus(); return; }
    msg('setupmsg', '入口を「' + INTAKE_LABEL[kind] + '」にして、同じ記録の続きを聞いている');
    setButtons();
    renderStatus();
  }

  function beginListening() {
    const rec = S.record;
    // 音声の入口なら、認識を作る直前にもう一度確かめる（押した時と記録を開き終えた時にも確かめている。ここは最後の守り）。
    // 断ったら聞き始めない。記録は開いたまま（記録の先頭を書いた後なら、整えて「聞き取りを開始」を押すと続きから書く）
    if (S.intakeKind === 'speech') {
      const no = speechGate();
      if (no) {
        S.listening = false; S.intake = null; S.stalled = false;
        msg('setupmsg', '聞き始めなかった：' + no, true);
        setButtons(); renderStatus();
        return;
      }
    }
    S.nextI = rec.src.reduce(function (m, l) { return l.i != null && l.i > m ? l.i : m; }, 0) + 1;
    S.t0ms = Date.parse(S.state.open.t0);
    if (!isFinite(S.t0ms)) S.t0ms = Date.now();
    const lim = (RULES && RULES.limits) || {};
    S.cutter = CUT.makeCutter({ window: S.win, baseWindow: S.state.open.window, factor: lim['step.width_factor'] || 3, maxLines: lim['step.max_lines'] || 40, fixed: S.intakeKind === 'file', onWindow: onWindow });
    S.passedTo = S.state.step ? S.state.step.lines[1] : 0;
    if (S.state.step) S.cutter.setLastT1(S.state.step.t[1]);
    if (S.state.paused) S.cutter.setLastT1(S.state.paused.t);
    if (S.route === 'manual') S.cutter.setWindow(Math.max(60, Math.min(180, S.win * 2)));
    // 続きで、まだ窓にしていない発話があれば溜まりに戻す（時刻は単調にした写しで）
    const seen = S.state.step ? S.state.step.lines[1] : 0;
    const mono = monoSrc(rec.src);
    let lastT = null;
    mono.forEach(function (l) { if (l && l.i != null) { lastT = l.t; if (l.i > seen) S.cutter.push(l); } });

    if (LIVE_KINDS[S.intakeKind]) S.intake = makeLiveIntake(rec, S.intakeKind);
    // 打つ／音声認識の入口は、続きなら素材ログの最後の発話の時刻を下限にする（時刻が前に戻らない）
    if (S.intakeKind !== 'file' && S.intake && typeof S.intake.setFloor === 'function' && lastT != null) S.intake.setFloor(lastT);
    // 読み飛ばし（続きから聞くとき）: left は残りの数、ids は読み飛ばす発話の番号、curI はいま読み飛ばした発話の番号
    const skip = { left: 0, E: null, last: null, eof: false, bad: '', ids: [], k: 0, curI: 0 };
    S.notice = newNotice();
    S.lateStopped = 0;
    S.heardCount = 0; S.heardSince = Date.now(); S.lastHeard = '';
    if (S.intakeKind === 'file') {
      // 前に素材ログへ残した読めない行の知らせ（続きから聞くとき、同じ行を二度残さない）
      const logged = Object.create(null);
      rec.src.forEach(function (l) { if (l && l.i == null && l.ev === 'unreadable' && l.line != null) logged[l.line] = true; });
      // 入口への受け口。読み飛ばしの間は発話を記録に入れない（数だけ数え、最後の 1 件を照らす）
      const fileEmit = {
        line: function (l) {
          if (skip.left > 0) {
            skip.curI = skip.ids[skip.k] != null ? skip.ids[skip.k] : skip.k + 1;
            skip.k++;
            skip.left--;
            if (skip.left === 0) {
              const a = skip.last;
              if (!(a && l.t === a.t && (l.who == null ? null : l.who) === a.who && l.text === a.text)) skip.bad = '読み飛ばした最後の発話が、素材ログの最後の発話と合わない';
            }
            return;
          }
          emit.line(l);
        },
        event: function (ev) {
          if (ev && ev.ev === 'unreadable' && logged[ev.line]) return;
          if (ev && ev.ev === 'unreadable') logged[ev.line] = true;
          emit.event(ev);
        },
        notice: function (lines) { if (S.skipping) return; emit.notice(lines); },
        // 読み飛ばしの間の知らせ（K22）: もう窓で渡した発話（番号が最後のステップの lines[1] 以下）に付いたものは、前に
        // 聞いたときに出したので出し直さない。まだ渡していない発話に付いたもの（40 件の上限で次の窓に回った発話・
        // 返事を書く前に読み込み直した窓の発話）は捨てず、その発話に預けて、その発話を渡す窓で出す。
        // 読み飛ばしの最中に素材を読み切ったときの末尾の知らせは、最後に読み飛ばした発話に付く（同じ扱い）
        notes: function (list) {
          if (!S.skipping) { emit.notes(list); return; }
          if (!list || !list.length || !S.notice || !(skip.curI > seen)) return;
          S.notice.byI[skip.curI] = (S.notice.byI[skip.curI] || []).concat(list);
        },
        interim: emit.interim, status: emit.status
      };
      // 刻みへの口。読み飛ばしの間だけ、窓の境目を「読み飛ばす最後の発話の少し先」にして、そこまでを一度に読ませる
      const fileCutter = {
        windowEnd: function () { return skip.left > 0 ? skip.E : S.cutter.windowEnd(); },
        setLastT1: function (t) { if (!(skip.left > 0)) S.cutter.setLastT1(t); },
        pendingCount: function () { return skip.left > 0 ? 1 : S.cutter.pendingCount(); }
      };
      S.intake = INTAKE.makeFileIntake(fileEmit, fileCutter);
      // 読み飛ばしの間は窓を閉じない（読み飛ばしが終わったあとの「次の窓を流す」から、ふだんどおりに進む）
      S.intake.on('clock', function (t) { if (S.skipping) return; if (S.listening && !S.paused) { S.cutter.tick(t); setButtons(); } });
      S.intake.on('eof', function () { if (S.skipping) { skip.eof = true; return; } S.eof = true; tryFinish(); setButtons(); });
      if (typeof S.fileText === 'string') S.intake.load(S.fileText);
      if (S.resume && S.resume.n > 0) { skip.left = S.resume.n; skip.E = S.resume.E; skip.last = S.resume.last; skip.ids = S.resume.ids || []; }
    }
    // 貼った全文は S.fileText に持つ。聞き始めたら欄を空にして、先の発話を画面（DOM）に残さない（R2b）
    $('file-paste').value = '';
    S.listening = true; S.paused = false; S.ended = false; S.eof = false; S.stalled = false; S.unwritten = 0; S.lastAt = S.state.step && S.state.step.at ? Date.parse(S.state.step.at) : null;
    S.stoppedBy = null; $('halt').hidden = true;
    S.lastAt = isFinite(S.lastAt) ? S.lastAt : null;
    if (!S.intake.start()) { S.listening = false; S.intake = null; setButtons(); return; }
    // 続きから: 素材の頭から、素材ログにある発話の数だけ読み飛ばす（記録にも窓にも入れない）
    if (skip.left > 0) {
      const want = skip.left;
      S.skipping = true;
      try { S.intake.playWindow(); } finally { S.skipping = false; }
      if (skip.left !== 0 || skip.bad) {
        const why = skip.bad || ('素材の頭の ' + want + ' 発話を読み飛ばせなかった（読めたのは ' + (want - skip.left) + ' 発話）');
        skip.left = 0;
        S.listening = false;
        try { S.intake.stop(); } catch (e) { /* 止め損ねても、聞いていない印は上で立てた */ }
        S.intake = null; S.record = null; S.state = F.initState(); S.cutter = null; S.passedTo = 0;
        msg('setupmsg', '続きから聞けない：' + why + '。前と同じファイルか確かめる', true);
        setButtons(); refresh(false); renderStatus();
        return;
      }
      msg('intakemsg', '前に聞いた ' + want + ' 発話を読み飛ばした。' + (S.autoFeed ? '続きから流す' : '「次の区切りを流す」で続きから'));
      seenNote('前に聞いた ' + want + ' 発話を読み飛ばして、続きから流します');
      if (skip.eof) { S.eof = true; tryFinish(); }
    }
    S.resume = null;
    S.follow = true; $('tonow').hidden = true;
    setButtons();
    refresh(false);
    renderStatus();
    renderNotices();
    askSampleOnce();
    // 記録を開いている間に、拡張が音を取るのをやめていた（共有を止めた）なら、ここで終える
    bridgeWatch();
    if (S.autoFeed) feedNext();
  }

  $('pause').addEventListener('click', function () {
    if (!S.listening || S.paused || S.finishing || S.eof || S.cutter.isBusy()) return;
    // 中断は読み終えた所（直前のステップの終わり。まだ無ければ 0）に置く（P22）。先に置くと、その間の発話を
    // 判断せずに飛ばしたことになる。まだ窓にしていない発話は溜まりに残り、再開した後の窓に入る。
    // 刻みの「直前の窓の終わり」（cutter.lastT1()）と同じ値。違うのは、書けなかった窓を溜まりに戻した直後だけ
    // （刻みはその窓の始まりへ戻る）で、そのときも記録に書いた最後のステップの終わりに置く
    const t = S.state.step ? S.state.step.t[1] : 0;
    const batch = [{ e: 'pause', t: t, why: '中断した' }];
    const r = verify(S.record.log, batch, { now: nowIso() });
    if (!r.ok) { anMsg([CHECK_STOP + '（中断を記録に書けなかった）'], true, r.errors, RAW_CHECK); return; }
    commit(r.batch);
    S.paused = true;
    S.stalled = false;   // 再開すると入口を始め直す（止まった音声認識も始め直す）
    S.cutter.setLastT1(t);
    if (S.intake.kind === 'speech') S.intake.stop();
    if (S.intake.kind === 'file') S.intake.stopPlay();
    // 打つ欄は中断の間も打てる。打った行は捨てず、再開した後の最初の窓に入ることを札で示す
    if (S.intake.kind === 'text') msg('intakemsg', PAUSED_TEXT);
    if (S.intake.kind === 'bridge') { msg('intakemsg', '中断中。橋から届いた行は捨てない（届いた時刻で溜め、再開した後の最初の窓に入る）'); seenNote('一時停止中です。拡張から届いた言葉は捨てずに取っておき、再開した後の最初の区切りに入れます'); }
    setButtons();
    renderStatus();
  });
  $('resume').addEventListener('click', function () {
    if (!S.paused || S.finishing) return;
    S.paused = false;
    if (S.intake.kind === 'speech') S.intake.start();
    if (S.intake.kind === 'text') msg('intakemsg', '打つ／貼る（Enter か 2 秒で確定）' + (S.cutter && S.cutter.pendingCount() ? '。中断の間に打った行は、次の窓に入る' : ''));
    if (S.intake.kind === 'bridge') { msg('intakemsg', '橋から受けている' + (S.cutter && S.cutter.pendingCount() ? '（中断の間に届いた行は、次の窓に入る）' : '')); seenNote(S.cutter && S.cutter.pendingCount() ? '再開しました。一時停止の間に届いた言葉は、次の区切りに入れます' : ''); }
    setButtons();
    renderStatus();
    feedNext();
  });
  $('end').addEventListener('click', function () {
    if (!S.listening || S.finishing) return;
    S.intake.flush();
    // 拡張から聞いている: 拡張に止めてもらい、止まったと言うのを待つ（拡張は残りの発話を送ってから止まったと言う）。
    // 上限 BRIDGE_END_WAIT_MS で待ち切ったら、届いた分で終える（bridgeWatch → finishBridge）
    if (S.intake.kind === 'bridge' && S.bridgeSession && S.link) {
      S.finishing = true; S.bridgeEnding = true;
      setButtons();
      if (!S.linkState.capturing) { finishBridge(); return; }
      S.releaseSent = true; S.link.release();
      clearTimeout(S.bridgeEndTimer);
      S.bridgeEndTimer = setTimeout(finishBridge, BRIDGE_END_WAIT_MS);
      return;
    }
    // 音声認識（K19・K29）: 止めた後にも確定の結果が届くことがある。止めたのに終わりの知らせがまだ来ていない認識を、
    // いまの認識も中断の前の古い認識もすべて待ってから（上限は合わせて 3 秒）最後の窓へ進む。待つ間に届いた確定の結果は、
    // いつもどおり素材ログと溜まりに入り、最後の窓に入る（中断の道と同じ）。上限を過ぎたら、入口がそのことを知らせの欄に
    // 出し（emit.notice）、ここはそのまま進む。その後に届いた結果は、入口が素材ログの出来事 late にして知らせの欄に出す
    if (S.intake.kind === 'speech' && typeof S.intake.stopWait === 'function') {
      S.finishing = true;
      setButtons();
      msg('intakemsg', '止めている：音声認識の終わりの知らせを待っている（' + Math.round((INTAKE.STOP_WAIT_MS || 3000) / 1000) + ' 秒まで）');
      S.intake.stopWait(function () {
        S.finishing = false;
        if (S.halted || !S.listening) { setButtons(); return; }
        finishListening();
      });
      return;
    }
    S.intake.stop();
    finishListening();
  });
  // 入口を止めたあと: 溜まりを最後の窓として渡し、end を書く（tryFinish）
  function finishListening() {
    S.eof = true;
    S.paused = false;
    tryFinish();
    setButtons();
  }

  // 終わりの手当て: 溜まりがあれば最後の窓として出し、無ければ end を書く。
  // 最後の窓の終わり（cut.js の close の eof）:
  //   ファイルを読み切った  → ふだんの窓と同じ刻みで閉じる（先に何も無いことを窓の幅で知らせない）
  //   ファイルを途中で終えた → 同じ刻みで、ファイルの時計まで
  //   ライブ               → 聞き終えた時計の整数の秒（聞き始めからの秒の切り捨て。刻みには合わせない。K23。
  //                          rt.py の next --last と同じ）。幅は open.window × 3 まで（超える分は次の最後の窓へ）。
  //                          壁時計 − 聞き始め ≧ 窓の終わり（P27）を満たす。その秒ちょうどか後の発話があれば、
  //                          時計が次の秒に進んでから閉じ直す
  function heardLimit() {
    if (S.intake && S.intake.kind === 'file') return S.intake.atEof() ? null : S.intake.clock();
    return Math.floor(clock());
  }
  function tryFinish() {
    if (!S.eof || S.ended || !S.cutter) return;
    if (S.cutter.isBusy()) return;
    if (S.cutter.pendingCount()) {
      const w = S.cutter.close(clock(), { eof: true, heard: heardLimit() });
      if (!w && !(S.intake && S.intake.kind === 'file')) {
        // まだ閉じられない（溜まった発話がどれも、いまの秒ちょうどか後）。少し待って閉じ直す
        clearTimeout(S.finishTimer);
        S.finishTimer = setTimeout(tryFinish, 250);
      }
      return;
    }
    // end の t（rt.py の end_t と同じ）: ライブは「聞き終えた時計の秒（聞き始めからの秒の切り捨て。end を書くときの時計）」と
    // 「直前の窓の終わり」の大きいほう。ファイルは直前の窓の終わり（窓が無ければ 0）。ファイルの時計は素材の時刻なので使わない
    const lastT1 = S.state.step ? S.state.step.t[1] : 0;
    // ファイルかライブかは記録の先頭（open.mode）で決める（音声認識が止まった間に入口の欄を変えても、記録の形は変わらない）
    const t = S.state.open && S.state.open.mode === 'file' ? lastT1 : Math.max(lastT1, Math.floor(clock()));
    const batch = [{ e: 'end', t: t }];
    const r = verify(S.record.log, batch, { now: nowIso() });
    if (!r.ok) { anMsg([CHECK_STOP + '（終わりを記録に書けなかった）'], true, r.errors, RAW_CHECK); return; }
    commit(r.batch);
    clearTimeout(S.finishTimer);
    S.ended = true; S.listening = false; S.stalled = false;
    if (S.sink) S.sink.flush().then(renderDbState, renderDbState);
    msg('setupmsg', '停止しました。記録はこのブラウザに残っています（「設定と記録」の「書き出す」でファイルに落とせます）');
    S.autoFeed = false;
    restoreIntake();
    refreshPast();
    setButtons();
    renderStatus();
  }

  // ---- 窓 → 分析役 ----
  function onWindow(w) {
    S.cur = { w: w, attempt: 1, violations: [] };
    // 入口の知らせは、この窓の発話に付いたものを出す（それより前の窓の分は「前の窓までの知らせ」へ）
    if (S.notice) { S.notice.win = [w.lines[0], w.lines[1]]; renderNotices(); }
    // 窓として渡した発話から、右の逐語に出す
    if (w.lines[1] > S.passedTo) S.passedTo = w.lines[1];
    if (S.view === 'live') renderFeedNow(S.state);
    setButtons();
    ask();
  }

  // 開いている gap の保留が指す窓の発話（rt.py の gap_lines_for と同じ）。gap が続けば積み上がり、閉じられれば消える
  function gapLines() {
    const out = [];
    const log = S.record ? S.record.log : [];
    const src = S.record ? monoSrc(S.record.src) : [];
    F.openHolds(S.state).forEach(function (h) {
      if (h.kind !== 'gap') return;
      let step = null;
      for (let i = 0; i < log.length; i++) { if (log[i].e === 'step' && log[i].n === h.sn) { step = log[i]; break; } }
      if (!step) return;
      src.forEach(function (l) { if (l.i != null && l.i >= step.lines[0] && l.i <= step.lines[1]) out.push(l); });
    });
    return out;
  }

  function currentPack() {
    const c = S.cur;
    return CUT.buildPack(F, S.state, S.record.log, c.w, { now: nowIso(), attempt: c.attempt, violations: c.violations, gap_lines: gapLines() });
  }

  // 分析役の欄の知らせ。lines は画面に出す日本語の文。raw は検査器や分析役の機械向けの文（規則の id・項目名を含む）で、
  // 畳んだ欄（見出し rawLabel）の中にだけ置く。追体験の間は中身を預かっている（下の「追体験の間の分析役の欄」）ので、
  // 書き込みは預かった方へ行き、画面には出ない
  function anMsg(lines, bad, raw, rawLabel) {
    const box = $('an-msgs');
    box.innerHTML = '';
    (Array.isArray(lines) ? lines : [lines]).forEach(function (l) { const d = document.createElement('div'); d.className = bad ? 'err' : ''; d.textContent = l; box.appendChild(d); });
    if (raw && raw.length) {
      const det = document.createElement('details'); det.className = 'raw';
      const sum = document.createElement('summary'); sum.textContent = (rawLabel || RAW_CHECK) + '　' + raw.length + ' 件';
      det.appendChild(sum);
      raw.forEach(function (r) { const d = document.createElement('div'); d.textContent = String(r); det.appendChild(d); });
      box.appendChild(det);
    }
    // 手動の輪・人が書くは、いつも出す（そこで操作する）。ほかの分析役は、うまくいかなかったときだけ表に出す
    $('analystbox').hidden = !(bad || S.route === 'manual' || S.route === 'human');
  }

  // 前の返事で何が起きたかと、違反の文を分析役に返したことを知らせる一行（違反の文そのものは畳んだ欄に）
  function prevViolations(c) {
    if (!c.violations.length) return '';
    return '前の返事：' + (c.lastScreen || '記録の決まりに合わなかった') + '。違反の文はそのまま分析役に返した';
  }

  function ask() {
    const c = S.cur;
    const pack = currentPack();
    c.pack = pack;
    const head = '窓 ' + fmt(c.w.t[0]) + '〜' + fmt(c.w.t[1]) + '（' + c.w.items.length + ' 発話）' + (c.attempt > 1 ? '　出し直し ' + c.attempt + ' 回目' : '');
    const prev = prevViolations(c);
    const withPrev = function (lines) { return prev ? lines.concat([prev]) : lines; };
    if (S.route === 'anthropic' || S.route === 'openai') {
      const a = fn('analyze');
      if (!a) { anMsg([head, 'API の分析役の' + MISSING + '。手動の輪に切り替える'], true); fallbackManual(pack, head); return; }
      anMsg(withPrev([head, '分析役を呼んでいる…']), false, c.violations, RAW_TO_ANALYST);
      Promise.resolve().then(function () { return a(pack, PREFIX, apiCfg()); })
        .then(function (reply) { handleReply(reply); }, function (e) {
          handleFailure(['呼び出しに失敗：' + (e && e.message || e)], (e && e.screen) || '分析役の呼び出しに失敗した');
        });
    } else if (S.route === 'claude') {
      const mk = fn('makeAnalyst');
      if (!mk) { anMsg([head, 'この画面の Claude に問う分析役の' + MISSING + '。手動の輪に切り替える'], true); fallbackManual(pack, head); return; }
      if (!S.claudeAnalyst) S.claudeAnalyst = mk({ kind: 'claude', tier: 'default' });
      anMsg(withPrev([head, 'この画面の Claude に問うている…' + (c.attempt === 1 && S.state.n === 0 ? '（最初の問いでは、画面を開いている人に許すかどうかの確認が出る）' : '')]), false, c.violations, RAW_TO_ANALYST);
      const my = S.claudeAnalyst;
      Promise.resolve().then(function () { return my.analyze(pack, PREFIX); })
        .then(function (reply) { if (S.claudeAnalyst === my) handleReply(reply); }, function (e) {
          if (S.claudeAnalyst !== my || !S.cur || S.cur !== c) return;   // 止めた後・次の記録に移った後の遅れた失敗
          if (e && e.fatal) { stopByAnalyst(e); return; }
          handleFailure(['呼び出しに失敗：' + (e && e.message || e)], (e && e.screen) || '分析役の呼び出しに失敗した', e && e.code === 'rate_limited' ? RATE_LIMIT_WAIT_MS : 0);
        });
    } else if (S.route === 'manual') {
      fallbackManual(pack, head);
    } else if (S.route === 'human') {
      humanWindow(pack, head);
    } else if (S.route === 'mock') {
      anMsg(withPrev([head, '内蔵の模擬が返す…']), false, c.violations, RAW_TO_ANALYST);
      setTimeout(function () { handleReply(mockReply(pack)); }, 300);
    } else {
      anMsg([head, '分析役が未選択'], true);
    }
  }

  // L3: プロンプトを出す
  function fallbackManual(pack, head) {
    const mp = fn('makePrompt');
    let text = null;
    // analyst.js の makePrompt は (prefix, pack) の順。契約の (pack, prefix) で作られたものにも通す
    if (mp) {
      try { text = mp(PREFIX, pack); } catch (e) { text = null; }
      if (typeof text !== 'string') { try { text = mp(pack, PREFIX); } catch (e) { text = null; } }
    }
    if (typeof text !== 'string') text = PREFIX + '\n\n---\n状態といまの窓（JSON）:\n' + JSON.stringify(pack) + '\n\n返事は、指示の形の JSON 1 個だけを返す。step.t は ' + JSON.stringify(pack.new.t) + '。';
    $('an-manual').hidden = false; $('analystbox').hidden = false;
    $('man-prompt').value = text;
    $('man-reply').value = '';
    const prev = prevViolations(S.cur);
    anMsg([head, 'プロンプトを出した。コピーして貼り、返事を取り込む'].concat(prev ? [prev + '（プロンプトにも載せた）'] : []), false, pack.violations, RAW_TO_ANALYST);
  }
  $('man-copy').addEventListener('click', function () {
    const t = $('man-prompt').value;
    if (!t) { msg('man-msg', 'まだプロンプトが無い', true); return; }
    const fallback = function () { $('man-prompt').focus(); $('man-prompt').select(); msg('man-msg', 'クリップボードが使えないので選択した。Ctrl+C で写す'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { msg('man-msg', '写した'); }, fallback);
    else fallback();
  });
  $('man-apply').addEventListener('click', function () {
    if (!S.cur || !S.cutter.isBusy()) { msg('man-msg', 'いま返事を待っている窓が無い', true); return; }
    const t = $('man-reply').value.trim();
    if (!t) { msg('man-msg', '返事が空', true); return; }
    handleReply(t);
  });

  // L0: 人が書く
  function humanWindow(pack, head) {
    S.human.events = [];
    $('an-human').hidden = false; $('analystbox').hidden = false;
    $('h-win').textContent = fmt(pack.new.t[0]) + '〜' + fmt(pack.new.t[1]) + '　' + pack.new.lines.map(function (l) { return (l.who ? l.who + '：' : '') + l.text; }).join('／');
    // 時刻の既定は窓の最初の発話の時刻（カードの位置は根拠の発話の時刻の間に置く。窓の始まりは発話より前のことがある）
    $('h-ct').value = pack.new.lines.length ? pack.new.lines[0].t : pack.new.t[0]; $('h-ct').min = 0; $('h-ct').max = pack.new.t[1];
    const sel = $('h-xid'); sel.innerHTML = '';
    pack.open_holds.forEach(function (h) { const o = document.createElement('option'); o.value = h.id; o.textContent = h.id + '　' + h.q; sel.appendChild(o); });
    renderHuman();
    const prev = prevViolations(S.cur);
    anMsg([head, 'この窓の判断を書いて「この窓を書く」'].concat(prev ? [prev] : []), false, pack.violations, RAW_TO_ANALYST);
  }
  function renderHuman() {
    const ev = S.human.events;
    $('h-list').textContent = ev.length ? ev.map(function (e) { return e.e === 'card' ? 'カード「' + e.ti + '」' : e.e === 'hold' ? '保留「' + e.q + '」' : '決着 ' + e.id; }).join('、') : '（まだ何も足していない）';
  }
  $('h-cadd').addEventListener('click', function () {
    if (!S.cur) return;
    const ti = $('h-cti').value.trim(); if (!ti) { anMsg(['見出しが空'], true); return; }
    S.human.events.push({ e: 'card', id: '', t: Number($('h-ct').value), d: Math.max(0, Number($('h-cd').value) || 0), role: $('h-crole').value, who: $('h-cwho').value.trim() || null, src: S.cur.w.items.map(function (l) { return l.i; }), li: null, ti: ti, b: $('h-cb').value.trim() });
    $('h-cti').value = ''; $('h-cb').value = ''; renderHuman();
  });
  $('h-hadd').addEventListener('click', function () {
    if (!S.cur) return;
    const q = $('h-hq').value.trim(); if (!q) { anMsg(['問いが空'], true); return; }
    S.human.events.push({ e: 'hold', id: '', t: Number($('h-ct').value), who: $('h-hwho').value.trim() || null, q: q });
    $('h-hq').value = ''; renderHuman();
  });
  $('h-xadd').addEventListener('click', function () {
    if (!S.cur) return;
    const id = $('h-xid').value; const as = $('h-xas').value.trim();
    if (!id) { anMsg(['閉じる保留が無い'], true); return; }
    if (!as) { anMsg(['答えが空'], true); return; }
    S.human.events.push({ e: 'close', id: id, t: Number($('h-ct').value), as: as, by: [] });
    $('h-xas').value = ''; renderHuman();
  });
  $('h-reset').addEventListener('click', function () { S.human.events = []; renderHuman(); });
  $('h-write').addEventListener('click', function () {
    if (!S.cur || !S.cutter.isBusy()) { anMsg(['いま書く窓が無い'], true); return; }
    const ids = Object.assign({}, S.cur.pack.next_ids);
    const events = S.human.events.map(function (e) {
      const x = Object.assign({}, e);
      if (e.e === 'card') { x.id = ids.card; ids.card = 'C' + (Number(ids.card.slice(1)) + 1); }
      if (e.e === 'hold') { x.id = ids.hold; ids.hold = 'H' + (Number(ids.hold.slice(1)) + 1); }
      return x;
    });
    // 所感は人が書く。空のまま道具が埋めると「その時刻に考えたこと」が嘘になるので、書くまで送れない
    const x = $('h-note').value.trim();
    if (!x) { anMsg(['所感を一行書く'], true); $('h-note').focus(); return; }
    handleReply({ step: { t: S.cur.w.t.slice() }, events: events, note: { x: x } });
  });

  // 内蔵の模擬（試験用）。構造の判断はしない。経路の配線を確かめるためだけのもの。
  // 台本（窓の番号 n で決まる）: n=1 に数え上げ（L1、3 点）と最上位、奇数の n に保留、60 秒以上開いた保留を決着、
  // n%4==2 に括り（開いている括りが無ければ）、n%4==0 に開いている括りを閉じる訂正（fix の span）。
  // カードは数え上げがあれば「いま何点目か」（li）を順に指す
  function mockReply(pack) {
    const L = pack.new.lines;
    const first = L[0];
    const ids = pack.next_ids;
    const n = pack.now.n;
    const events = [];
    const ti = clip(first.text, 50) || '（空の発話）';
    if (n === 1 && !pack.lists.length) events.push({ e: 'list', id: ids.list, t: first.t, who: first.who == null ? null : first.who, n: 3, items: [] });
    const list = (pack.lists.length ? pack.lists[0] : null) || (n === 1 ? { id: ids.list, n: 3 } : null);
    const li = list ? [list.id, ((n - 1) % list.n) + 1] : null;
    events.push({ e: 'card', id: ids.card, t: first.t, d: n % 3 === 0 ? 1 : 0, role: n % 4 === 0 ? 'land' : 'case', who: first.who == null ? null : first.who, src: L.map(function (l) { return l.i; }), li: li, ti: ti, b: clip(L.map(function (l) { return l.text; }).join(' '), 120) });
    // 開いている保留のうち、60 秒より古いものを 1 つ閉じる（gap も含む）
    const old = pack.open_holds.filter(function (h) { return h.age >= 60; })[0];
    if (old) events.push({ e: 'close', id: old.id, t: pack.new.t[1], as: clip('試験用の答え：' + ti, 120), by: [ids.card] });
    else if (n % 2 === 1) events.push({ e: 'hold', id: ids.hold, t: first.t, who: null, q: clip('この話はどこへ向かうのか：' + ti, 120) });
    if (n === 1) events.push({ e: 'top', id: ids.card, t: first.t, prev: null, why: '試験用。最初のカードを仮に最上位にした' });
    const openGroup = pack.open_groups.length ? pack.open_groups[0] : null;
    if (n % 4 === 2 && !openGroup) events.push({ e: 'group', id: ids.group, t: first.t, span: [first.t, null], lb: clip('試験用の括り：' + ti, 50), kind: 'start' });
    if (n % 4 === 0 && openGroup) events.push({ e: 'fix', id: openGroup.id, t: pack.new.t[1], field: 'span', now: [openGroup.span[0], pack.new.t[1]], why: '試験用。開いていた括りをこの窓の終わりで閉じた' });
    return { step: { t: pack.new.t.slice() }, events: events, note: { x: clip('試験用の分析役。窓 ' + fmt(pack.new.t[0]) + '〜' + fmt(pack.new.t[1]) + ' の ' + L.length + ' 発話を 1 枚にまとめただけで、構造の判断はしていない。', 400) } };
  }

  // ---- 返事 → 追記（analyst.js の toBatch。rt.py の reply_to_batch と同じ直し方） ----
  function toBatch(reply, w) {
    const tb = fn('toBatch');
    if (!tb) throw new Error('返事を追記に直す' + MISSING);
    return tb(reply, { n: S.state.n + 1, lines: w.lines.slice(), t: w.t.slice() });
  }

  // ---- 返事 → 検査 → 記録 ----
  // 返事が機械向けの形として読めない・判断の並びが無い・所感が無い、も検査に落ちたのと同じ 1 回に数える（rt.py と同じ）
  function handleReply(reply) {
    const c = S.cur;
    if (!c || !S.cutter.isBusy()) return;
    const shape = fn('shapeReply');
    if (typeof reply === 'string') {
      const p = fn('parseReply');
      let got;
      try { got = p ? p(reply) : JSON.parse(reply); }
      catch (e) { handleFailure(['返事を JSON として読めません: ' + (e && e.message || e)], '返事を読めなかった（機械向けの形になっていない）'); return; }
      // analyst.js の parseReply は {ok, step, events, note} か {ok:false, error, msg} を返す
      if (got && typeof got === 'object' && 'ok' in got) {
        if (!got.ok) { handleFailure([got.error || '返事の形が違います'], got.msg || '返事の形が違う'); return; }
        got = { step: got.step, events: got.events, note: got.note };
      }
      reply = got;
    } else if (reply && typeof reply === 'object' && shape) {
      // 文字でなく形で来た返事（API・内蔵の模擬・人が書く）も、同じ形の検査に通す
      const g = shape({ step: reply.step, events: reply.events, note: reply.note });
      if (!g.ok) { handleFailure([g.error], g.msg); return; }
    }
    if (!reply || typeof reply !== 'object') { handleFailure(['返事が空か、形が違います'], '返事が空か、形が違う'); return; }
    let batch;
    try { batch = toBatch(reply, c.w); } catch (e) { anMsg([String(e && e.message || e)], true); return; }
    const r = verify(S.record.log, batch, { now: nowIso(), next_ids: c.pack.next_ids, heard_until: c.w.t[1], window: { t: c.w.t, lines: c.w.lines }, src: monoSrc(S.record.src) });
    if (r.ok) {
      commit(r.batch);
      const u = reply.usage;
      const nEv = batch.filter(function (e) { return e.e !== 'step' && e.e !== 'note'; }).length;
      anMsg(['S' + S.state.n + ' を書いた（' + nEv + ' 件）' + (r.warnings.length ? '。警告 ' + r.warnings.length + ' 件（書いたが、確かめるとよい）' : '') +
        (u ? '　使用量: 入力 ' + (u.input_tokens == null ? '—' : u.input_tokens) + '・出力 ' + (u.output_tokens == null ? '—' : u.output_tokens) + '・キャッシュ読み ' + (u.cache_read_input_tokens == null ? '—' : u.cache_read_input_tokens) : '')],
        false, r.warnings, RAW_CHECK);
      afterStep();
    } else handleFailure(r.errors, '返事が記録の決まりに合わなかった（違反 ' + r.errors.length + ' 件）');
  }

  // errors: 分析役に返す機械向けの文（次の呼び出しの違反文になる）。screen: 画面に出す日本語の一行。
  // waitMs: 出し直す前に置く間（この画面の Claude が混んでいるとき。待つ間に止まったら出し直さない）
  function handleFailure(errors, screen, waitMs) {
    const c = S.cur;
    c.violations = errors.slice();
    c.lastScreen = screen || CHECK_STOP;
    c.attempt++;
    if (c.attempt <= 3) {
      if (waitMs > 0) {
        anMsg([(screen || CHECK_STOP) + '（' + (c.attempt - 1) + ' 回目）', Math.round(waitMs / 1000) + ' 秒おいてから、同じ窓で出し直す'], true, errors, RAW_TO_ANALYST);
        setTimeout(function () { if (S.cur === c && S.listening && !S.halted) ask(); }, waitMs);
        return;
      }
      anMsg([(screen || CHECK_STOP) + '（' + (c.attempt - 1) + ' 回目）', '同じ窓で出し直す'], true, errors, RAW_TO_ANALYST);
      ask();
      return;
    }
    writeGap();
  }

  // この画面の Claude に問えないと分かった（e.fatal: 閲覧者が許していない・口が無い・能力が止められている）。同じ窓を出し直しても
  // 同じに落ちるので、3 回の再試行をせずに聞き取りを止めて知らせる。記録は閉じない（end は書かない）。いまの窓の発話は素材ログに
  // あるので、分析役を変えて「聞き取りを開始」を押すと、同じ名前の記録の続きから（この窓の発話を含めて）聞ける。
  // 記録に書けない halt と違い、ページを読み込み直さなくてよい
  function stopByAnalyst(e) {
    const why = (e && e.screen) || '分析役に問えない';
    S.stoppedBy = why;
    S.listening = false; S.paused = false; S.finishing = false; S.stalled = false; S.cur = null;
    clearTimeout(S.finishTimer);
    try { if (S.intake) S.intake.stop(); } catch (x) { /* 止め損ねても、聞いている印は下で消す */ }
    const h = $('halt'); h.textContent = '止まった（' + why + '）'; h.hidden = false;
    anMsg(['聞き取りを止めた：' + why, 'もう一度問うても同じ答えになるので、同じ区切りは出し直さない。整理する AI を変えて（または許してから）「聞き取りを開始」を押すと、同じ記録の続き（この区切りの発話を含む）を聞ける'], true, [String(e && e.message || e)], RAW_TO_ANALYST);
    msg('setupmsg', '聞き取りを止めた：' + why + '。直してから「聞き取りを開始」を押すと、同じ記録の続きを聞ける', true);
    S.autoFeed = false;
    if (S.bridgeSession) dropBridge();
    msg('intakemsg', '止めた（分析役に問えない）', true);
    setButtons();
    renderStatus();
    refresh(false);
  }

  // 3 回落ちた窓: 嘘のカードを作らず、空振りを記録に残して進める
  function writeGap() {
    const c = S.cur;
    const ids = F.nextIds(S.state);
    const batch = [
      { e: 'step', n: S.state.n + 1, lines: c.w.lines.slice(), t: c.w.t.slice() },
      { e: 'hold', id: ids.hold, t: c.w.t[0], who: null, kind: 'gap', q: clip('この窓（' + fmt(c.w.t[0]) + '〜' + fmt(c.w.t[1]) + '）の構造は未確定（検証に3回落ちた）', 120) },
      { e: 'note', t: c.w.t[1], x: clip(c.violations.join('／') || '検証に3回落ちた', 400) }
    ];
    const r = verify(S.record.log, batch, { now: nowIso(), next_ids: ids, heard_until: c.w.t[1], window: { t: c.w.t, lines: c.w.lines }, src: monoSrc(S.record.src) });
    if (!r.ok) {
      // 未確定の窓すら書けない。発話を捨てると行の連番が切れて以後の窓が全部落ちる（P04）ので、
      // 溜まりに戻して次の窓に合流させる。それが続くなら、聞き取りを止めて大きく知らせる
      S.unwritten++;
      if (S.unwritten >= UNWRITTEN_LIMIT) { halt(r.errors); return; }
      anMsg([CHECK_STOP + '（未確定の窓すら書けなかった。続けて ' + S.unwritten + ' 窓目）', 'この窓の発話は捨てず、次の窓に合流させる。' + UNWRITTEN_LIMIT + ' 窓続いたら聞き取りを止める'], true, r.errors, RAW_CHECK);
      S.cutter.requeue(c.w);
      afterStep();
      return;
    }
    commit(r.batch);
    anMsg(['検証に 3 回落ちたので、未確定の窓として記録して進んだ（3 回目の返事：' + c.lastScreen + '）'], true, c.violations, RAW_CHECK);
    afterStep();
  }

  // 記録に書けない状態が続いた。聞き取りを止め、入口の状態を「聞いている」のままにしない。記録は消さない（書き出せる）
  function halt(errors) {
    S.halted = true; S.listening = false; S.paused = false; S.finishing = false; S.stalled = false; S.cur = null;
    clearTimeout(S.finishTimer);
    try { if (S.intake) S.intake.stop(); } catch (e) { /* 止め損ねても、聞いている印は下で消す */ }
    const h = $('halt'); h.textContent = HALT_TEXT; h.hidden = false;
    S.autoFeed = false;
    if (S.bridgeSession) dropBridge();
    anMsg([CHECK_STOP, '続けて ' + UNWRITTEN_LIMIT + ' 窓を記録に書けなかったので、聞き取りを止めた。「書き出す」で記録を落とし、原因を調べる。続きはこのページを読み込み直してから'], true, errors || [], RAW_CHECK);
    msg('setupmsg', HALT_TEXT, true);
    msg('intakemsg', '止めた（記録に書けない）', true);
    setButtons();
    renderStatus();
    refresh(false);
  }

  function commit(batch) {
    S.record.appendLog(batch);
    S.state = F.foldInc(S.state, batch);
    S.lastAt = Date.now();
    S.unwritten = 0;
    refresh(true);
    renderStatus();
  }

  function afterStep() {
    S.cur = null;
    $('man-prompt').value = ''; $('man-reply').value = ''; $('h-note').value = '';
    const live = !(S.intake && S.intake.kind === 'file');
    if (live && S.finishing) {
      // 聞き終えの待ちの間（K19）: 窓は閉じない（時計を −∞ として渡すので、ふだんの刻みでも閉じない）。
      // 終わりの知らせの後に、待つ間に届いた発話も含めて最後の窓として閉じる
      S.cutter.ready(-Infinity);
    } else if (live && S.eof) {
      // 聞き終えた後（K23）: ふだんの刻みの窓を先に出さず、溜まりを最後の窓（終わりは聞き終えた時計の秒）として閉じる
      S.cutter.ready(clock(), { eof: true, heard: heardLimit() });
    } else S.cutter.ready(clock());
    if (S.eof && !S.cutter.isBusy()) tryFinish();
    setButtons();
    // 貼った書き起こし: 前の区切りを書き終えたので、次の区切りを流す（同じ呼び出しの中で次を問わない）
    if (S.autoFeed) setTimeout(feedNext, 0);
  }

  // ---- ファイル入口の操作 ----
  // ファイルを選ぶ欄の拡張子は、規則表の素材の名前（limits.open.src_ext。P30）に揃える
  (function () {
    const x = RULES && RULES.limits && RULES.limits['open.src_ext'];
    if (Array.isArray(x) && x.length && x.every(function (v) { return typeof v === 'string' && v; })) $('file').accept = x.join(',');
  })();
  $('file-pick').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', function () { $('file-load').disabled = !this.files.length; $('file-name').textContent = this.files.length ? this.files[0].name : '（まだ選んでいない）'; });
  $('file-load').addEventListener('click', function () {
    const f = $('file').files[0];
    if (!f) return;
    f.text().then(function (t) { S.fileText = t; if (S.intake && S.intake.kind === 'file') S.intake.load(t); msg('intakemsg', 'ファイルを読んだ（' + f.name + '）。' + materialHint(t), !!noUtterance(t)); }, function (e) { msg('intakemsg', '読めない：' + e, true); });
  });
  // 空白だけを貼っても素材として受け、聞き始めるときに 0 バイトの素材と同じ文で断る（K31）。欄を空にしただけなら何もしない
  $('file-paste').addEventListener('change', function () { if (this.value !== '') { S.fileText = this.value; if (S.intake && S.intake.kind === 'file') S.intake.load(this.value); msg('intakemsg', '貼った文字をファイルとして使う。' + materialHint(this.value), !!noUtterance(this.value)); } });
  // 読んだ素材に発話が 1 つも無ければ、聞き始める前にそう言う（聞き始めると、記録を作らずに断る。K21）
  function noUtterance(text) {
    const no = typeof INTAKE.materialRefusal === 'function' ? INTAKE.materialRefusal(text) : null;
    return no && no.length ? no : null;
  }
  function materialHint(text) {
    const no = noUtterance(text);
    return no ? 'ただし発話が 1 つも無いので、始められない（' + no[0] + '）' : '「聞き取りを開始」で始める';
  }
  $('file-next').addEventListener('click', function () { if (S.intake && S.intake.kind === 'file') { S.intake.playWindow(); setButtons(); } });
  $('file-play').addEventListener('click', function () { if (S.intake && S.intake.kind === 'file') { S.intake.startPlay(); setButtons(); } });
  $('file-stop').addEventListener('click', function () { if (S.intake && S.intake.kind === 'file') { S.intake.stopPlay(); setButtons(); } });

  // ---- 書き出し・結び付け・消す ----
  $('export').addEventListener('click', function () {
    if (!S.record) { msg('recmsg', 'まだ記録が無い', true); return; }
    const rec = S.record;
    if (FRAME) { exportInFrame(rec); return; }
    exportPlain(rec);
  });
  // 枠の外の書き出し: 保存の画面（showSaveFilePicker）か a[download]。ファイルごとに実際にどうなったかを言う
  function exportPlain(rec) {
    rec.exportLog().then(function (a) { return rec.exportSrc().then(function (b) { return [a, b]; }); }).then(function (how) {
      msg('recmsg', exportText(rec.name, how), how.some(function (h) { return h === 'cancelled' || h === 'fallback'; }));
    });
  }
  // 枠の中の書き出し: 保存の画面も a[download] も枠では効かないので、枠の保存（claude.use('downloads')）で閲覧者に保存を促す。
  // 取れなければ: iframe の中なら保存できないと言う（落としたと言わない）。iframe でなければ（仕組みが自分のページとして出す版。
  // window.claude はあるが能力は全部 null）ふつうの書き出しが効くので、そちらに落とす——でないと記録を 1 つも持ち出せない。
  // .jsonl は枠で保存できる拡張子に無いので、.txt を足した名前で出る
  function exportInFrame(rec) {
    const names = [rec.name + '.jsonl', rec.name + '.src.jsonl'];
    const texts = [rec.log, rec.src].map(function (evs) { return evs.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n'; });
    msg('recmsg', '保存を促している…');
    REC.useCapability('downloads').then(function (dl) {
      if (!dl) {
        if (!inIframe()) { exportPlain(rec); return; }
        msg('recmsg', 'この枠では保存できない（保存の能力が無い）。記録はこの画面の中にある', true); return;
      }
      const x = REC.makeDownloadsExport(dl);
      const outs = [];
      return x.save(names[0], texts[0]).then(function (ok) { outs.push({ ok: ok, name: ok ? x.status.lastSaved : names[0], why: ok ? '' : x.status.reason }); })
        .then(function () { return x.save(names[1], texts[1]); }).then(function (ok) { outs.push({ ok: ok, name: ok ? x.status.lastSaved : names[1], why: ok ? '' : x.status.reason }); })
        .then(function () {
          const parts = outs.map(function (o) { return o.name + (o.ok ? ' を保存した' : ' は保存しなかった（' + o.why + '）'); });
          const bad = outs.some(function (o) { return !o.ok; });
          msg('recmsg', parts.join('。') + (bad ? '。保存しなかった記録はこの画面の中にだけある' : '。同僚に渡すなら素材ログは渡さず、話者を役割名に置き換える'), bad);
        });
    });
  }
  // 書き出した結果の一言。how[0] が判断ログ、how[1] が素材ログで、どちらも record.js の exportVia の値
  // （'picker'・'cancelled'・'download'・'fallback'）。ファイルごとに、実際にどうなったかを言う（1 つ目の結果だけで決めない）
  function exportText(name, how) {
    const names = [name + '.jsonl', name + '.src.jsonl'];
    const SHARE = '同僚に渡すなら素材ログは渡さず、話者を役割名に置き換える';
    const WHERE = { picker: '選んだ保存先に保存した', download: 'ダウンロードのフォルダに落とした', fallback: '保存の画面を開けなかったので、ダウンロードのフォルダに落とした' };
    const kept = [0, 1].filter(function (i) { return how[i] !== 'cancelled'; });
    if (!kept.length) return '保存先を選ばなかった。記録はこの画面の中にだけある';
    // ダウンロードのフォルダへ落としたファイルは、名前が「download」などになる環境がある（付け直す名前を言う）
    const fix = kept.filter(function (i) { return how[i] !== 'picker'; }).map(function (i) { return names[i]; });
    const rename = fix.length ? 'ファイルの名前が違っていたら（「download」など）、' + fix.join(' と ') + ' に付け直す。' : '';
    if (kept.length === 1) {
      const i = kept[0];
      return names[i] + ' だけ保存した（' + WHERE[how[i]] + '）。' + rename + 'もう一方は保存先を選ばなかったので、その記録はこの画面の中にだけある';
    }
    const both = names[0] + ' と ' + names[1];
    if (how[0] === 'picker' && how[1] === 'picker') return '2 つのファイルを、選んだ保存先に保存した（' + both + '）。' + SHARE;
    if (how[0] === how[1]) return '2 つのファイルを落とした（' + both + '。' + (how[0] === 'fallback' ? '保存の画面を開けなかったので、' : '') + 'ダウンロードのフォルダに入る）。' + rename + SHARE;
    return names[0] + ' は、' + WHERE[how[0]] + '。' + names[1] + ' は、' + WHERE[how[1]] + '。' + rename + SHARE;
  }
  $('bindlog').addEventListener('click', function () {
    if (!S.record) { msg('recmsg', 'まだ記録が無い', true); return; }
    S.record.bindFile('log').then(function () { msg('recmsg', '判断ログ：' + S.record.status.fs.log); });
  });
  $('bindsrc').addEventListener('click', function () {
    if (!S.record) { msg('recmsg', 'まだ記録が無い', true); return; }
    S.record.bindFile('src').then(function () { msg('recmsg', '素材ログ：' + S.record.status.fs.src); });
  });
  const CLEARED_KEY = 'kiku.cleared';
  $('clear').addEventListener('click', function () {
    const name = S.record ? S.record.name : $('name').value.trim();
    if (!name) { msg('recmsg', '消す記録の名前が無い', true); return; }
    if (S.listening) { msg('recmsg', '聞いている間は消せない。先に「停止」', true); return; }
    // 画面の外の確認（window.confirm）は使わない（枠の中では出ない）。「本当に消す」を押すまで消さない
    msg('recmsg', '「' + name + '」の記録（判断ログと素材ログ）をこのブラウザから消す。書き出していなければ戻らない。消すなら「本当に消す」', true);
    $('clearconfirm').hidden = false;
  });
  $('clear-no').addEventListener('click', function () { $('clearconfirm').hidden = true; msg('recmsg', '消さなかった'); });
  $('clear-yes').addEventListener('click', function () {
    $('clearconfirm').hidden = true;
    const name = S.record ? S.record.name : $('name').value.trim();
    if (!name) { msg('recmsg', '消す記録の名前が無い', true); return; }
    if (S.listening) { msg('recmsg', '聞いている間は消せない。先に「停止」', true); return; }
    const rec = S.record || REC.makeRecord(name);
    rec.clear().then(function () {
      S.record = null; S.state = F.initState(); S.cur = null; S.cutter = null; S.lastAt = null; S.ended = false; S.eof = false;
      $('rows').innerHTML = '';
      msg('recmsg', '消した');
      // 読み込み直した後に、消したことを 1 回だけ言う（このタブの中だけの印。読んだら消す）
      try { sessionStorage.setItem(CLEARED_KEY, name); } catch (e) { /* 保存領域が使えなければ言わない */ }
      location.reload();
    });
  });
  window.addEventListener('beforeunload', function (e) {
    if (S.listening) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---- 追体験の間の分析役の欄 ----
  // 分析役の欄（手動の輪のプロンプトと返事、人が書くフォーム、いまの窓の知らせ）は、いまの窓——T より先の発話——を
  // 持っている。追体験の間は、欄の中身を DOM から外して預かり、代わりに中身を空にした写しを置く（id は写しが持つので、
  // 外から引いても空の欄しか見えない）。app.js の中は起動時に引いた本物（$）を指し続けるので、裏で窓が進んでも
  // 書き込みは預かった本物の方へ行く。ライブに戻すと、写しを外して本物を戻す（貼りかけの返事も書きかけのフォームもそのまま）
  const HELD_NOTE = '追体験の間は、分析役の欄（いまの窓）をしまってある。ライブに戻すと戻る';
  function blankCopy(node) {
    const c = node.cloneNode(true);
    if (c.nodeType !== 1) return c;
    const all = [c].concat(Array.prototype.slice.call(c.querySelectorAll('*')));
    all.forEach(function (el) {
      const tag = el.tagName;
      if (tag === 'TEXTAREA') { el.value = ''; el.textContent = ''; el.disabled = true; }
      else if (tag === 'INPUT') { el.value = ''; el.removeAttribute('value'); el.disabled = true; }
      else if (tag === 'SELECT') { el.innerHTML = ''; el.disabled = true; }
      else if (tag === 'BUTTON') el.disabled = true;
    });
    // 中身が窓ごとに変わる所（窓の発話・足したもの・知らせ）は空に。手順の説明（静かな見出しと文）は残す
    ['h-win', 'h-list', 'man-msg'].forEach(function (id) { const e = c.id === id ? c : c.querySelector('#' + id); if (e) e.textContent = ''; });
    const msgs = c.id === 'an-msgs' ? c : c.querySelector('#an-msgs');
    if (msgs) { msgs.innerHTML = ''; const d = document.createElement('div'); d.className = 'soft'; d.textContent = HELD_NOTE; msgs.appendChild(d); }
    ['an-manual', 'an-human'].forEach(function (id) { const e = c.id === id ? c : c.querySelector('#' + id); if (e) e.hidden = true; });
    return c;
  }
  function holdAnalyst() {
    if (S.held) return;
    const box = $('analystbox');
    const real = Array.prototype.slice.call(box.childNodes);
    const copies = real.map(blankCopy);
    const keep = document.createDocumentFragment();
    real.forEach(function (n) { keep.appendChild(n); });
    copies.forEach(function (n) { box.appendChild(n); });
    S.held = { keep: keep, real: real, copies: copies };
  }
  function releaseAnalyst() {
    if (!S.held) return;
    const box = $('analystbox');
    S.held.copies.forEach(function (n) { if (n.parentNode === box) box.removeChild(n); });
    S.held.real.forEach(function (n) { box.appendChild(n); });
    S.held = null;
  }

  // ---- ライブ／追体験 ----
  function setView(v) {
    S.view = v;
    Array.prototype.forEach.call($('views').querySelectorAll('button'), function (b) { b.classList.toggle('on', b.dataset.v === v); });
    $('replayctl').hidden = v !== 'replay';
    $('scrub').hidden = v !== 'replay';
    if (v === 'replay') { holdAnalyst(); S.T = endT(); S.playing = false; $('play').textContent = '再生'; $('scrub').max = endT(); $('scrub').value = S.T; }
    else { releaseAnalyst(); S.follow = true; $('tonow').hidden = true; }
    refresh(false);
    renderStatus();
  }
  $('views').addEventListener('click', function (e) { const b = e.target.closest('button[data-v]'); if (b) setView(b.dataset.v); });
  $('modes').addEventListener('click', function (e) { const b = e.target.closest('button[data-m]'); if (b) setMode(b.dataset.m); });
  $('speeds').addEventListener('click', function (e) {
    const b = e.target.closest('button[data-s]'); if (!b) return;
    S.speed = Number(b.dataset.s);
    Array.prototype.forEach.call($('speeds').querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
  });
  $('play').addEventListener('click', function () {
    if (S.view !== 'replay') return;
    if (S.T >= endT()) S.T = 0;
    S.playing = !S.playing; S.lastFrame = 0;
    $('play').textContent = S.playing ? '停止' : '再生';
  });
  $('restart').addEventListener('click', function () { if (S.view !== 'replay') return; S.playing = false; $('play').textContent = '再生'; S.T = 0; refresh(false); });
  $('scrub').addEventListener('input', function () { if (S.view !== 'replay') return; S.playing = false; $('play').textContent = '再生'; S.T = Math.min(Number(this.value), endT()); refresh(false); });
  function tick(now) {
    if (S.view === 'replay' && S.playing) {
      if (!S.lastFrame) S.lastFrame = now;
      const dt = Math.min(0.25, (now - S.lastFrame) / 1000); S.lastFrame = now;
      S.T = Math.min(endT(), S.T + dt * S.speed);
      refresh(false);
      if (S.T >= endT()) { S.playing = false; $('play').textContent = '再生'; }
    } else S.lastFrame = 0;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- 起動 ----
  if (FRAME) {
    // 枠の中: 分析役の既定は「この画面の Claude」、音声の入口は選べない（枠ではマイクも画面共有も断られる）、
    // 写しの印を見せる、ファイルに直接結び付けるボタン（保存の画面が要る）は出さない
    $('route').value = 'claude';
    const sp = $('intake').querySelector('option[value="speech"]');
    if (sp) { sp.disabled = true; sp.textContent = 'ブラウザ音声認識（この枠では使えない）'; }
    // 音の入り方の既定は拡張「橋」（会議の音を聞く本線）。拡張とのつなぎを始める（居るか・この PC の中で文字にできるかを知る）。
    // ただし枠（iframe）の中だけ: 拡張は claude.ai のページの中の枠にしか届かないので、仕組みが自分のページとして出す版
    // （iframe でない）では「橋」を選べなくし、既定は「打つ／貼る」にする（拡張を入れる手順を出しても、入れた後につながらない）
    if (inIframe()) {
      $('intake').value = 'bridge';
      if (INTAKE && typeof INTAKE.makeBridgeLink === 'function') { S.link = INTAKE.makeBridgeLink({ onChange: onLink, onProbe: onProbe }); S.link.start(); }
    } else {
      const br = $('intake').querySelector('option[value="bridge"]');
      if (br) { br.disabled = true; br.textContent = '拡張「橋」（claude.ai の中で開いたときだけ）'; }
      $('intake').value = 'text';
    }
    // 枠の中では fetch が外へ出ないので、API の経路は選べない（選べると、窓ごとに 3 回落ちて空振りを積むだけ）
    ['anthropic', 'openai'].forEach(function (v) {
      const o = $('route').querySelector('option[value="' + v + '"]');
      if (o) { o.disabled = true; o.textContent = o.textContent + '（この枠では使えない）'; }
    });
    $('db-row').hidden = false;
    $('bindlog').hidden = true; $('bindsrc').hidden = true;
    msg('speechmsg', 'この枠（アーティファクト）の中では、マイクも画面共有も断られるので使えない。外で文字にして「橋」か「打つ／貼る」で入れる', true);
    // 問う能力は起動後に決まる（契約: 能力は後から promise で届く。仕組みが自分のページとして出す版では全部 null）。
    // 無いと分かったら、分析役の欄にそう出し、「聞き取りを開始」は断る（分析役を他のものにする）。古い形（complete だけ）には use が無いので見ない
    const c0 = globalThis.claude;
    if (c0 && typeof c0.use === 'function') {
      REC.useCapability('sample').then(function (s) { if (typeof s !== 'function') { S.sampleAbsent = true; showRoute(S.route); } });
    }
  }
  // 橋の hello には、聞いていないときもページが答える（送り手が、ページが居るかを知るため）。聞いている間は橋の入口が答える
  window.addEventListener('message', function (ev) {
    let m = null;
    try { m = INTAKE.bridgeMessage(ev && ev.data); } catch (e) { m = null; }
    // 拡張に画面共有を頼んで待っている間の誤り（選ぶ画面で取り消した・音が共有されていない など）。記録はまだ開いていない
    if (m && m.kind === 'status' && m.state === 'error' && S.awaitCapture) { captureFailed(m.text); return; }
    if (!m || m.kind !== 'hello') return;
    if (S.listening && S.intake && S.intake.kind === 'bridge' && S.intake.status().state === 'listening') return;
    const to = ev.source && typeof ev.source.postMessage === 'function' ? ev.source : window;
    try { to.postMessage({ source: INTAKE.BRIDGE_REPLY_SOURCE, v: INTAKE.BRIDGE_VERSION, kind: 'hello', listening: false, received: 0 }, '*'); } catch (e) { /* 返せなくても困らない */ }
  });
  // 表の一言。枠の中では何も選ばずに始められる。ファイルとして開いたときは、初めに整理する AI と音の入り方を選ぶ
  $('hero-lead').textContent = FRAME
    ? 'PC で流れている会議の音を聞き取り、話の構造を時刻の順に組み上げます。名前も設定も要りません（記録は始めた日時の名前で残ります）。'
    : '会議の発言を受け取り、話の構造を時刻の順に組み上げます。初めてのときは「設定と記録」で、整理する AI と音の入り方を選びます。';
  showIntake($('intake').value);
  showRoute($('route').value);
  setButtons();
  refresh(false);
  renderStatus();
  // 「記録を消す」で読み込み直したときは、消したことを 1 行で言う（印は読んだら消す。もう一度読み込んでも出さない）
  let cleared = '';
  try { cleared = sessionStorage.getItem(CLEARED_KEY) || ''; sessionStorage.removeItem(CLEARED_KEY); } catch (e) { cleared = ''; }
  const clearedText = cleared ? '「' + cleared + '」の記録を消した。' : '';
  if (clearedText) msg('recmsg', clearedText);
  refreshPast();
})();
