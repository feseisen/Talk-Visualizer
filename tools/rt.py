#!/usr/bin/env python3
"""判断ログの追記スクリプト v2。読むのも書くのも、必ずこれを通す。

規則の正本は format/rules.json（同じ規則表をページの verify.js も読む）。
ログの先頭 open の v で版を決め（無ければ v1、規則表の versions.<版>.open_v に無い v は F07 で拒む。
v は型も比べる。true は 1 ではない）、規則表の版の列で検査する。欄の型はどの版でも見る。欄の定義の
min/max は、その版に在る欄だけ見る（v1 の open.window のように、その版に無い欄の値の範囲は見ない）。
文字数・件数の上限（limits）は版の列の limits が true のときだけ見る。違反が一つでも見つかれば、その追記は丸ごと捨てる（全か無か）。
書くときは全行を先に組み立て、1 回で書く（途中で落ちて半端な行を残さない）。

値の型の厳しさはページの verify.js と揃える。
  - 数は有限で、絶対値が 2^53−1 以下のものだけ（NaN・Infinity・1e999・310 桁の整数は F02。落ちない）
  - 整数の欄に 2.0 と書かれたら整数として受け、書くときに 2 に直す（ページは 2.0 と 2 を区別できないため）
  - 文字列に対になっていないサロゲート（JSON の \\ud800 など）があれば F02（欄の名前も中身も見る。1 つの欄につき 1 件）
  - 壁時計は ASCII の数字だけの ISO 8601 の UTC で、暦に在る日時だけ（24:00・2/30・秒の 60・0 年は F02）
  - JSONL の行がオブジェクトでないとき、e が文字列でないときは F07（落ちない）

使い方（すべて道具の根（kiku.html のあるフォルダ）から。ログの場所は自由だが、例のとおり live/ の下に置く。.gitignore は会議の中身
（*.jsonl・*.txt など）をどこに置いても止めるが、tests/ と format/ の下は架空の素材のために通すので、そこには置かない）
  新しいログを始める（live か、素材ファイル）。新しい記録は open でだけ始まり、open は v2 だけを書く
    python tools/rt.py open live/会議.jsonl --live --name 会議 --transcript live/会議.txt
    python tools/rt.py open live/会議.jsonl --src live/素材.txt --name 会議

  live: 会議のあいだ裏で回し、メモ帳の新しい行を届いた時刻で素材ログに足す（記録が end で閉じると止まる）
    python tools/rt.py watch live/会議.jsonl

  次の窓の発話を見せる（記録済みの最後の窓の直後だけ。飛ばして先は見せない）
    python tools/rt.py next live/会議.jsonl
    python tools/rt.py next live/会議.jsonl --wait 40      （live: 窓が閉じるまで最大 40 秒待つ）
    python tools/rt.py next live/会議.jsonl --json         （pack.md の形で出す）
    python tools/rt.py next live/会議.jsonl --last         （live: 聞き終えるとき。残りを最後の窓として出す）

  その窓での判断を書き足す（バッチはファイルで渡す。標準入力も v1 互換で残す）
    python tools/rt.py append live/会議.jsonl live/会議.batch.jsonl
    python tools/rt.py append live/会議.jsonl < step.jsonl

  現在の状態を表示する（書き足さない。--upto を付けると途中の時点に戻して見る）
    python tools/rt.py status live/会議.jsonl --upto 12

  次回への引き継ぎ（章・深さ1までの見出し・開いている保留・最上位。--full でも 2000 字以内）
    python tools/rt.py digest live/会議.jsonl --full

  聞き終える／聞くのを止める（道具が壁時計を押して書く。live で聞き終えるときは、先に next --last → append）
    python tools/rt.py end live/会議.jsonl
    python tools/rt.py pause live/会議.jsonl --why 休憩

規則表の場所は変えられない（format/rules.json だけを読む。命令文で別の規則表を渡す口は持たない）。

バッチの形は2つ受ける。
  1. JSONL（1行1イベント。先頭は step。v1 と同じ）
  2. 分析役の返事そのもの（schema.json の {"step":{"t":[a,b]},"events":[...],"note":{"x":"..."}}）。
     n・lines・at・note.t は道具が埋める。返事に think があっても捨てる（think は道具が埋める欄）。
1回の追記は「step とその窓のイベント」か「end だけ」「pause だけ」のどれか。
step の追記に end・pause を混ぜると P02 で拒む。append は open を受けない（P01。新しい記録は open で始める）。
end だけの追記も、rt.py end と同じ断り（end_refusal。live でまだ窓にしていない発話があれば、何も書かずに
終了コード 1）を通る。end を書く道はどれもそこを通る。
v1 の形のログは、元からあるログに書き足すことしかできない（v1 で新しく始める口は無い）。

判断ログの名前は、ちょうど小文字の .jsonl で終わる名前だけ（check_log_path。open・watch・next・append・
end・pause・status・digest が照らす。「/」「/.」で終わる名前も断る）。在る判断ログを読む・書く命令は、加えて
リンク（名前の実体が、フォルダだけを解いた場所と違う）・フォルダ・無いログを断る（check_log_target。K28）。道具は素材ログ <語幹>.src.jsonl・覚え書き <語幹>.next.json・watch の印 <語幹>.watch.json
の名前を、判断ログの名前から .jsonl を除いた語幹で作るので、.peek・拡張子の無い名前・.JSONL を受けると、
同じ語幹の別の判断ログと派生ファイルが重なる。.src.jsonl（大小文字を問わない）と、返事のバッチの名前
（*.batch.jsonl。分析役が書き換えてよい場所なので、そこに置いたログは先を読んだあとで書き直せてしまう）も断る。
open は、そのログか派生ファイルがもうあるときと、同じフォルダに語幹が大小文字を無視して同じになる判断ログか
派生ファイルがあるときは断る（stem_conflicts）。watch の印には判断ログの名前を書き、名前が違う印（名前の無い
印も）があれば watch・next・append・end・pause は P07 で断る（watch_mark_foreign）。

1 つの素材に開けるログは 1 つ（v2）。open は素材の隣に持ち主の印 <素材>.owner（ログの場所。素材のフォルダ
からの相対）を書く。別のログで同じ素材を open・next・append しようとすると P07 で断る（印が指すログが
もう無ければ、新しいログが引き継ぐ）。v1 の記録も、--transcript の素材に別のログの印があれば断る（印は書かない）。
素材（open.src）の名前は .txt・.tsv・.vtt のどれかで終わる（大小文字は問わない。P30。規則表の
limits.open.src_ext）。判断ログ・素材ログ・印・覚え書きを素材に名指すと、別のログの先を読めてしまうため。
open はこれに加えて、記録の形の名前と、同じフォルダの持ち主の印が指す別のログの記録を名指すのを P07 で断る
（named_record。v1 の記録の --transcript も同じ）。
素材のある file の記録では、next・append に渡す --transcript は open.src と同じファイル（解決したパスで
比べる）でなければ P07（live の記録でも、--transcript を渡すなら open.src と同じでなければ P07）。

素材のある記録では、next を打たないと append できない。素材があるかどうかは open の時点で決まる
（open の src。live の open には --transcript <メモ帳> が要るので、live の記録には必ず src がある）。
open で素材を名指しした記録は、append の時点でその素材が見つからなくても免除しない（P07）。
next は窓が閉じたときだけ窓の覚え書き（<ログ名>.next.json）を書く。append はその覚え書きを
信じきらず、素材から窓を計算し直して照らす（P07）:
  - 窓の始まりは、直前の step の t[1]（無ければ 0）。発話の無い窓を丸ごと飛ばしたときだけ、
    その窓の幅の分だけ先へ進む（next と同じ計算）
  - 窓の幅は open.window の 1〜3 倍（file の記録では 1 倍ちょうど。live では遅れた分だけ広がる）
  - lines は、素材（live は素材ログ <ログ名>.src.jsonl、file は素材ファイル）の、まだ読んでいない
    発話を順に見て、時刻が窓の終わりより前のものを先頭から最大 step.max_lines 件（規則表。既定 40）
  - 上限の件数で切った窓は、窓の終わりを「渡さなかった最初の発話の時刻 T」まで縮める（そこまでしか
    聞いていないことにする。P09・P15・監査の「聞いた所」が、実際に渡した発話と一致する）。窓の中に T と同じ
    時刻の発話があれば、その同じ時刻のまとまりの手前で切る（渡した発話はどれも終わりより前）。まとまりが窓の
    最初の発話から始まるときだけ、幅 0 の窓 [T, T]（始まりも T まで進む）に上限ちょうどの件数を入れる
step はその窓と一致しなければならない（P07）。v2 の step の発話の件数は step.max_lines 以下（P05）。
next が「まだ閉じていません」と言う間は覚え書きが無いので、append は P07 で拒む。
素材の無い記録（試験・手書き）では覚え書きを求めない。v1 の記録は next を経ずに追記できる
（append が文字起こしの行で直に確かめる）。
道具が照らせないのは、同じ PC の上で覚え書き・素材ログ・持ち主の印・素材そのものを書き換えることだけ。
それは audit_r2b.py と会話記録で後から見る。

壁時計（at）は道具が押す。分析役が step・end・pause に書いた at は、どんな値でも検査の前に捨てる。
--now は試験のために壁時計を固定する口。live の記録では、環境変数 KIKU_TEST_CLOCK=1 があるときだけ
受ける（無ければ open --live・next・append・end・pause・watch のどれも --now を断る。聞き始めを過去に
ずらして、聞き終える前に判断を押す道を作らせない）。試験のときも、実時計から 120 秒以上進んだ --now は
受けない。file の記録は --now を受ける（過去の記録を作り直す試験のため）。live の記録では step の at が
「聞き始め（open.t0）＋ 窓の終わり」より前なら P27 で拒む（聞き終える前に判断を押せない）。

pause の t は直前の step の t[1] と同じ（step が無ければ 0）。先の時刻に中断を置いて窓を
飛ばすことはできない（P22）。open.window の値の範囲は規則表の欄の定義（min/max）が決める。

並びの位置（R1）は P29 で縛る（版に依らない。下の 1 つごとに 1 件。ページの検査器と同じ数）:
  - t（step は t[0]）は 0 以上
  - card.t は、src の発話（聞いた範囲 1〜step.lines[1] の中で素材から引けたもの）の時刻の最小以上・最大以下
    （素材があるときだけ。まだ読んでいない発話の時刻は違反文にも出さない）
  - close.t は、閉じる保留の hold.t 以上
  （group.t ≧ span の始まりは P15 が見る）

書き足せたら、毎回これを表示する:
  今回の窓のカード／まだ閉じていない保留（今回のカードで決着した保留が無いか、ここで見直す）／
  決着の統計／最上位候補／数え上げの現在地／次の id（next_ids）
検証に落ちた返事が同じ窓で3回続いたら、道具が「未確定の窓」の最小バッチを書いて窓を進める。
返事が JSON として読めない・UTF-8 として読めない・step が無いかオブジェクトでない・events が配列でない・
events に note がある（所感は上の段の note に 1 つ）、も同じ窓の1回に数える。

返事の読み方（ページの読み方と同じ）:
  - 入力の前後の空白を除いて ``` で始まり ``` で終わるなら、1 回だけ外して読む（開きの直後の json は捨てる）
  - 全体が 1 つの JSON オブジェクトで、e の欄が無ければ分析役の返事。そうでなければ JSONL
  - 前後の空白は、JS の String.prototype.trim と同じ集まり（WS_CHARS）だけを除く（U+0085 などは除かない）
  - 文字列の外の [ と { の入れ子が 500 段を超える入力は、JSON として読む前に F02 で断る（数える）
  - 返事に events の欄が無ければ events:[] として読む（発話はあったが書くことの無い窓）。null なら読めない返事
  - 値の入れ子は 32 段まで（欄の値の深さ。数・文字列は 0 段、[] と {} は 1 段＋中身）。超えたら F02（落ちない）
  - JSONL の step の欄が壊れていても落ちない（F01・F02 で拒み、同じ窓の 1 回に数える）

素材ファイルの読み方（file の記録。format/FORMAT.md「素材ファイルの形」の決まりで、ページのファイルの入口と
同じ発話の列・同じ知らせになる。MaterialReader・iter_material。共通の試験素材と期待値は tests/fixtures/materials.json）:
  - 字の決まり: UTF-8（先頭の BOM は捨てる。読めないバイトは置換文字 U+FFFD）。行は LF だけで分ける。空白は
    半角スペース・タブ・CR・全角スペースの 4 つだけ
  - 書き方は 4 つで、読み始めたところで 1 つに決まり、途中で変わらない。先頭の空でない行が WEBVTT で始まれば
    'vtt'（字幕）。そうでなければ、見出しの後の最初の時刻のある行で決まる: 時刻だけの行 'alone'、タブで区切った
    1 列目が時刻 'tsv'、時刻＋空白＋本文の行 'inline'。それより先に字幕の時刻の行の形（「-->」を含む行。VTT_TIMING_RE）
    が来たら、WEBVTT の行が無くても、その行から 'vtt'（K21）。拡張子では決めない
  - 表の行の話者の列は、終わりの「:」「：」を落とす（speaker_col。打つ入口・メモ帳と同じ。K23）
  - 発話が 1 つも無い素材は、file の open が記録を作らずに断る（material_refusal。文は NO_TIMED_TEXT か
    NO_BODY_TEXT と、WEBVTT の行の無いまま字幕と決めた素材なら VTT_DECIDED_TEXT、素材の知らせの文。ページと同じ。K21・K31）
  - 時刻の書き方（alone・tsv・inline）は 分:秒 か 時:分:秒。先頭の数は 1〜6 桁、続く数はちょうど 2 桁で 00〜59。
    秒の後ろに小数部を付けてよい。時刻として読む字だけ、全角の数字とコロンを半角に直す
  - 読めない行（時刻を書いたつもりらしいのに読めない行と、その続き）は発話にしない。黙って捨てず、行番号を知らせる
  - alone の素材で、行の頭が時刻らしく空白と本文が続く行は、前の発話の本文の続きとして読み、知らせる（timehead）
  - 時刻に字が続く頭（「0:45司会：…」）は、どの書き方でも前の発話の続きとして知らせる（書き方が決まる前なら読めない行）。
    括弧で囲んだ時刻（「[0:45] 司会：…」）は、tsv・inline では括弧の中の時刻の新しい発話、alone では続き（K30）
  - 読めないバイト（U+FFFD）を含む行は、どの書き方でも読めない行（badbyte。書き方の見分けにも使わない。K30）
  - 本文が空のまま終わった発話は数えない（i を取らない）。時刻は単調にする（前の発話より前なら前の時刻に揃える）
  - 時刻が飛んでいる行（揃える前の時刻が前の発話より前か、600 秒より先）は、拒まずに読んで知らせる（jump）
  - 知らせは、その行を含む発話（どの発話にも入らない行は後ろの最初の発話、最後の発話より後ろの行は最後の発話）を
    渡す窓で next が出す。1 つの窓では種類ごとに 1 文にまとめて行番号を並べる（MATERIAL_TEXT。ページと同じ文）
live では、メモ帳の行を素材ログ（<ログ名>.src.jsonl）に足すのは watch だけ（会議のあいだ裏で回す）。
watch は 1 秒ごとにメモ帳を見て、新しく確定した行を 1 行 1 発話として足し、その行が届いた時刻（watch が見た時刻
− 聞き始め。整数の秒に切り捨て）を押す。メモ帳に打った時刻は使わない（打ち間違えた時刻 1 つで、そのあとの発話の
位置がすべて狂うため）。時計が戻ったときだけ、前の発話の時刻に揃える。行の読み方（memo_kind）:
  - タブを含み 1 列目が時刻らしい行（正しくない時刻も）は、1 列目を落として残りを読む。残りにタブがあれば
    「話者<TAB>本文」、無ければ「話者: 本文」の形（素材ログの raw には打ったまま残す）。初めてのときだけ
    「メモ帳の時刻は使いません（届いた時刻で押します）」と知らせる
  - タブを含むほかの行は「話者<TAB>本文」。話者の列の終わりの「:」「：」は落とす（speaker_col）。タブを含まない
    行は「話者: 本文」の形（split_who。ページの splitWho と同じ決まり）で、話者と認めなければ行の全体が本文
  - 読めない行は無い（空でない行はすべて発話）。時刻の飛びも知らせない
確定する行: 改行で終わった行と、改行の無い最後の行で同じ中身のまま 2 秒変わらなかったもの（ページの打つ入口の
「Enter か 2 秒で確定」と同じ）。確定した後にその行へ字が足されたら、読み終えた行の書き換えとして扱う。
next は素材ログだけを読む（素材ログに書かない）。watch が回っていない（印 <ログ名>.watch.json が無いか、
5 秒より古い）のに、メモ帳に素材ログへまだ入っていない変化（新しい行と、読み終えた行の変化の出来事。memo_pending。
K25）があれば、next は窓を出さずに「watch を回してください」と言う（next の時刻で行を押すことはしない）。
メモ帳が見つからない・フォルダのあいだ、watch はメモ帳を突き合わせず（空のメモ帳とみなさない）、様子が変わったときに
知らせる。next と next --last も、その知らせを窓に出す（memo_problem。K27）。
watch はメモ帳の読み終えた行を中身で突き合わせる（K18。plan_memo。原則は「黙って欠かさない・黙って二重にしない。
拾わなかった行は必ず名指して知らせる」）。行の中身は、時刻の列を落とした鍵（memo_key。K24）で比べる（並べる・
寄せる・消えた行の覚え・spent のすべて）。前に見たメモ帳の確定した行の並びを C、いまの確定した行を M とする:
  - M の頭が C とちょうど同じなら、新しい発話は M の残り（知らせは無い）
  - そうでなければ、共通の頭と尻を外し、真ん中を最長共通部分列（動的計画法。並べ方が複数あれば C の後ろのほうの行を
    残す並べ方）で並べる。並ばなかった C の行は消えた行（読み終えた行なら覚えの溜まりに入れる）。並ばなかった M の行は、
    最後に並んだ行より後ろなら末尾の新しい行の候補、前なら読み終えた行の間の行
  - 並ばなかった M の行を前から見て、溜まりに同じ中身の消えた行があれば、その 1 つと組にして戻した行（拾わない。
    RESTORED_TEXT）。無ければ、末尾の候補は新しい発話、間の行は拾わない（INSERTED_TEXT）。戻した行と知らせた行が
    メモ帳に残っている間、同じ中身を末尾に打った行は、消えた行の覚えより先にそれと組にして新しい発話にする（K26。
    知らせのとおり打ち直せば、ほかに同じ中身の消えた行が残っていても拾う）。組にした行と同じ保存で消えた同じ中身の
    行は溜まりから片付ける（forget。片付けた行は spent に移す）。spent（か溜まり）と同じ中身の末尾の候補を新しい発話に
    したときは「打ち直した行とみなして足した」と名指し、その保存で同じ中身の覚えをすべて除く（RETYPED_TEXT。消して
    戻しただけなら二重なので、黙って二重にしない。同じ保存で同じ中身の末尾の候補が何行もあれば、覚えを 1 つずつ配って
    どの行も名指す。次の保存からは知らせない）
  - 読み終えた行の半分以上が一度に消え、消えた読み終えた行が 3 行以上（KEPT_MIN）の保存では、並んだ M の行をすべて
    名指す（KEPT_TEXT。拾っていなかった間の行と並んだ行も。K26。メモ帳を空にするのと同じ保存で打った行が、前の行と
    同じ中身で前の行とみなされたとき、黙って欠かさないため）。消えた行が 2 行以下なら名指さない（2 行のメモ帳の
    書き換えで、書き換えていない行まで名指さないため。このときは見分けられない）
  - 消えた行は「読み終えた行が消えた（いまの N 行目の手前）」。時刻の列だけの直しは kind "retimed" で、記録に
    効かないと知らせる（RETIMED_HINT）
知らせは素材ログに {"ev":"changed","kind":…} として 1 回だけ残し（メモ帳が変わらない限り書き足さない）、next と
next --last の窓に出す（最後の発話より後ろで起きた出来事は、最後の窓に出す）。
素材ログは open では作らず、watch が最初の行を足したときに初めてできる。
live の窓は、壁時計が窓の終わりを過ぎたときにだけ閉じる。
聞き終えるときは next --last → append → end。next --last は、watch がメモ帳の変化（新しい行・出来事・改行の無い
最後の行）をすべて素材ログに入れ終えるのを待ってから（K25）、まだ窓にしていない発話を最後の窓として出す。渡す発話が
残っていないときも、--json なら JSON で返す（{"last":true,"window":null,"notices":[…]}。K31）。終わり t[1] は、聞き終えた時計の秒と
「始まり＋window × 3」の早いほう（窓の幅の刻みには合わせない。中断の後に再開せずに聞き終えたときも同じ。K23）。
end は、まだ窓にしていない発話か、メモ帳にまだ素材ログへ入っていない変化があれば、何も書かずに断る
（end_refusal。append の end だけの追記も同じ）。end の t は、live は聞き終えた時計（整数の秒）と直前の窓の終わりの
大きいほう、file は直前の窓の終わり（end_t）。live では、--t でも聞き終えた時計の秒より先には置けない（試験の時計の
ときを除く。end_t_ahead。K23）。
判断ログのパスに「..」を挟んだ名前はどの命令も断る。判断ログの名前がリンクなら open も断る（check_log_link。K28）。
open は絶対パスに直して（フォルダの部分のリンクも解いて）から照らし、置き場の
フォルダが無ければそのフォルダ 1 つだけを作る（K20）。素材（メモ帳・素材ファイル）の名前の「..」も、open と、
--transcript を受ける命令が断る（K27）。open は素材を実体の場所で照らし、持ち主の印を実体の隣に書く（印のフォルダが
無ければ 1 つだけ作る）。live のメモ帳が無ければ、そのフォルダが既にあるときだけ空のファイルとして作る。
live で next が遅れて窓の終わりをいくつも過ぎていたら、窓は window × 3 まで広がり、終わりは窓の幅の目盛り
（始まり＋幅の 1〜3 倍）のうち過ぎた所のいちばん後ろに揃える。

窓に入るのは、まだ読んでいない発話のうち時刻が窓の終わりより前のもの（終わりの時刻ちょうどの発話は、それが
素材の最後の発話でも次の窓）を、先頭から最大 step.max_lines 件。入りきらない分は次の窓に回る。
素材の長さ（時間・行数）は表示しない。終わったことは、次の発話を読みに行って空だったときに初めて伝える。

file の記録で open の known が素材の本文と 30 字以上一致したら、警告（P28）を出す（拒まない）。
比べるときは両方から空白と句読点・記号（Unicode の分類が Z・P・S の文字）を除く。

終了コード: 0 成功 / 1 使い方・入出力の誤り（未来の --now、live の --now、watch が回っていない、もここ） /
            2 違反で拒否（1行も書いていない） /
            3 同じ窓で3回落ちたので未確定の窓として記録し、窓を進めた
"""
import argparse
import bisect
import json
import math
import os
import re
import secrets
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RULES_PATH = HERE.parent / "format" / "rules.json"

LABEL = {
    "open": "開始", "step": "ステップ", "card": "カード", "hold": "保留", "close": "決着",
    "fix": "訂正", "group": "括り", "rename": "改名", "top": "最上位", "echo": "補強",
    "note": "所感", "list": "数え上げ", "end": "終了", "pause": "中断",
}
ROLE_JA = {"claim": "主張", "counter": "揺り戻し", "case": "実例", "land": "着地", "top": "最上位"}
KIND_JA = {"start": "その場で", "retro": "遡って"}

# 数字は ASCII だけ（Python の \d は全角などの数字にも当たるので使わない）
ISO_RE = re.compile(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?Z$")
# 素材の時刻: 分:秒 か 時:分:秒（先頭の数は 1〜6 桁、続く数はちょうど 2 桁）。小数部は秒の後ろだけ
TIME_RE = re.compile(r"([0-9]{1,6}):([0-9]{2})(?::([0-9]{2}))?(?:\.([0-9]+))?")
# 時刻の列を読む前に、全角の数字と全角のコロンだけを半角に直す（本文は直さない）
FW_TIME = str.maketrans("０１２３４５６７８９：", "0123456789:")
# 「時刻らしい」字: 数字で始まり、数字と : と . だけでできていて、: を 1 つ以上含む（全角の数字とコロンを半角に直してから当てる）
TIME_LIKE_RE = re.compile(r"[0-9][0-9:.]*")
# 素材の空白（半角スペース・タブ・CR・全角スペースの 4 つだけ。ページの素材の読みと同じ）
SP_CHARS = " \t\r\u3000"
# 空白の集合（JS の String.prototype.trim が除くものと同じ。素材以外の文字列の前後に使う）
WS_CHARS = "\t\n\x0b\x0c\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
MAX_SAFE = 2 ** 53 - 1  # 数の絶対値の上限（JS が整数を正確に持てる最大）

EXIT_USAGE, EXIT_REJECT, EXIT_GAP = 1, 2, 3
PROCEDURAL_MIN = {("list", "n")}  # 下限を手続き的検査（P18）が受け持つ欄
FUTURE_SLACK_SEC = 120  # live の記録で --now が実時計より先にあってよい限度（秒）
MAX_LINES = 40          # 1 つの窓に入る発話の上限（規則表に limits.step.max_lines があればそちら）
KNOWN_OVERLAP_MIN = 30  # file の記録で known と素材の本文がこの字数以上一致したら警告（規則表に limits.warn.known_overlap があればそちら）
DIGEST_MAX = 2000       # digest --full の上限（規則表に limits.open.known があればそちら。次の open --known にそのまま渡せる長さ）
VALUE_DEPTH_MAX = 32    # 欄の値の入れ子の上限（数・文字列は 0 段、[] と {} は 1 段＋中身）。超えたら F02
PARSE_DEPTH_MAX = 500   # 入力の文字の入れ子がこれを超えたら、JSON として読む前に F02（読む道具が落ちないように）
RAW_MAX = 100           # 読めない行の raw に残す字数
JUMP_SEC = 600          # 時刻の飛びとして知らせる進み（10 分を超える）
WATCH_POLL_SEC = 1      # watch がメモ帳を見る間隔（秒）
WATCH_STALE_SEC = 5     # watch の印がこれより古ければ、watch は回っていない
TEST_CLOCK_ENV = "KIKU_TEST_CLOCK"  # live の記録で --now を受けるのは、この環境変数が 1 のときだけ（試験）

# 規則表（format/rules.json の procedural）の id のうち、この道具が名指しで出すもの
RULE_HEARD = "P27"   # live: step.at − open.t0 ≧ step.t[1]
RULE_KNOWN = "P28"   # 警告: file の記録で open.known が素材の本文と一致する
RULE_POS = "P29"     # 並びの位置（R1）: t ≧ 0、card.t は src の発話の時刻の間、close.t ≧ hold.t
RULE_SRC = "P30"     # 素材の名前: v2 の open.src は .txt・.tsv・.vtt で終わる（大小文字を問わない）
SRC_EXTS = (".txt", ".tsv", ".vtt")   # 規則表に limits.open.src_ext があればそちら
# 素材にできない名前（判断ログ・素材ログ・持ち主の印・watch の印・覚え書き）。open が断る（素材の名前の規則より先に、わけを言う）
RECORD_SUFFIXES = (".jsonl", ".owner", ".watch.json", ".next.json")


class Fail(Exception):
    """使い方・入出力の誤り（違反ではない）。"""


def src_exts(rules):
    """素材にできる名前の終わり（小文字）。"""
    v = rules.limit("open.src_ext") if rules is not None else None
    if isinstance(v, list) and v and all(isinstance(x, str) and x for x in v):
        return tuple(x.lower() for x in v)
    return SRC_EXTS


def src_name_ok(name, exts=SRC_EXTS):
    """素材の名前が素材ファイル・メモ帳の形か（.txt・.tsv・.vtt で終わる。大小文字を問わない）。"""
    return isinstance(name, str) and name.lower().endswith(tuple(exts))


# ---------------------------------------------------------------- 小道具

def fmt(s):
    """秒を m:ss（1時間以上は h:mm:ss）に。負の秒は頭に - を付ける。数でない・範囲の外の値は repr。"""
    if not _is_num(s):
        return repr(s)
    sign = "-" if s < 0 else ""
    s = int(abs(s))
    h, m, x = s // 3600, s % 3600 // 60, s % 60
    return sign + (f"{h}:{m:02d}:{x:02d}" if h else f"{m}:{x:02d}")


def fmt_sec(s):
    """壁時計の差（0 以上の秒）の言い方。1分未満は秒、それ以上は m:ss / h:mm:ss。"""
    if s < 60:
        return f"{s:.3g} 秒"
    return fmt(s)


def now_iso(fixed=None):
    if fixed:
        if not iso_ok(fixed):
            raise Fail(f"--now は ISO 8601 の UTC で、半角の数字の、暦に在る日時で書きます（例 2026-10-07T09:00:30Z）: {fixed!r}")
        return fixed
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_clock_on():
    """試験の時計が許されているか（環境変数 KIKU_TEST_CLOCK が 1）。"""
    return os.environ.get(TEST_CLOCK_ENV) == "1"


def wall_clock(fixed, live):
    """道具が押す壁時計。live の記録では、--now は試験のときだけ（KIKU_TEST_CLOCK=1）受け、
    そのときも実時計より FUTURE_SLACK_SEC 以上先の --now は受けない。"""
    if fixed and live and not test_clock_on():
        raise Fail("live の記録では --now を受けません（壁時計は道具が実時計で押します。"
                   f"--now は試験のときだけ、環境変数 {TEST_CLOCK_ENV}=1 を付けて使います）")
    at = now_iso(fixed)
    if fixed and live:
        ahead = iso_sec(at) - time.time()
        if ahead >= FUTURE_SLACK_SEC:
            raise Fail(f"--now {at} は実時計より {int(ahead)} 秒先です（live の記録では、壁時計を {FUTURE_SLACK_SEC} 秒以上未来に進められません）")
    return at


def _iso_dt(s):
    """壁時計の文字列を datetime に。形が違う（半角の数字でない・末尾に余り）か暦に無い日時なら None。

    暦に無い: 24 時・60 分・60 秒・2 月 30 日・4 月 31 日・0 年など（datetime が組み立てられないもの）。
    """
    if not isinstance(s, str):
        return None
    m = ISO_RE.fullmatch(s)
    if not m:
        return None
    y, mo, d, h, mi, sec = (int(x) for x in m.groups()[:6])
    try:
        return datetime(y, mo, d, h, mi, sec, tzinfo=timezone.utc)
    except ValueError:
        return None


def iso_ok(s):
    """壁時計として読めるか（形も暦も）。欄の型 iso の検査と --now の検査に使う。"""
    return _iso_dt(s) is not None


def iso_sec(s):
    """壁時計の文字列を秒（float）に。小数部も全部読む。比較にだけ使う。読めなければ Fail。"""
    dt = _iso_dt(s)
    if dt is None:
        raise Fail(f"壁時計の形が違います（半角の数字の ISO 8601 の UTC で、暦に在る日時）: {s!r}")
    frac = ISO_RE.fullmatch(s).group(7)
    return dt.timestamp() + (float("0" + frac) if frac else 0.0)


def iso_sec_or_none(s):
    """iso_sec の、読めなければ None を返す版（検査の中で使う。形の違反は欄の検査が出す）。"""
    try:
        return iso_sec(s)
    except Fail:
        return None


def trim(s):
    """前後の空白（WS_CHARS。JS の trim と同じ集合）を除く。"""
    return s.strip(WS_CHARS)


def trim_sp(s):
    """素材の行・列の前後の空白（SP_CHARS の 4 つだけ）を除く。"""
    return s.strip(SP_CHARS)


def parse_time(s):
    """素材の時刻（分:秒 か 時:分:秒。秒の後ろに小数部）を秒に。読めなければ None。前後の空白は捨てる。
    全角の数字と全角のコロンは半角に直してから読む。

    続く数（分・秒）は 00〜59。値は整数の秒（時×3600 ＋ 分×60 ＋ 秒）に小数部（0.xxx）を足したもの
    （ページと同じ足し方なので、最後の桁まで同じ値になる）。整数になる値は int で返す。
    """
    m = TIME_RE.fullmatch(trim_sp(s).translate(FW_TIME))
    if not m:
        return None
    a, b, c, frac = m.groups()
    a, b = int(a), int(b)
    if b > 59 or (c is not None and int(c) > 59):
        return None
    sec = a * 3600 + b * 60 + int(c) if c is not None else a * 60 + b
    if frac is not None:
        sec = sec + float("0." + frac)
        if sec.is_integer():
            sec = int(sec)
    return sec


def time_like(s):
    """時刻らしいか（format/FORMAT.md「素材ファイルの形」7）。全角の数字とコロンは半角に直してから当てる。
    前後の空白は除かない（行の頭に CR が残っていれば時刻らしくない。ページの読み方と同じ）。"""
    x = s.translate(FW_TIME)
    return bool(TIME_LIKE_RE.fullmatch(x)) and ":" in x


def line_head(s):
    """行の頭: 前後の空白を除いた行の、最初の半角スペースか全角スペースの手前まで（無ければ行の全体）。"""
    x = trim_sp(s)
    for k, ch in enumerate(x):
        if ch in " \u3000":
            return x[:k]
    return x


# K30 時刻らしい頭の行（format/FORMAT.md「素材ファイルの形」。ページの intake.js の gluedTime・bracketTime と同じ決まり）。
# どちらもタブを含まない行だけに当てる
BRACKET_CLOSE = {"[": "]", "(": ")", "（": "）", "【": "】"}
BAD_BYTE = "\ufffd"   # 読めないバイトを読んだ字（K30 の (c)。どの書き方でも読めない行）


def glued_time(head):
    """(a) 時刻に字が続く頭: 行の頭が時刻らしくなく、全角を直した頭の先頭から時刻の書き方（TIME_RE）を最も長く取った
    部分が時刻として読め（続く数が 00〜59）、その後ろに字が残る（「0:45司会：次の議題です」「1:30甲」「9:00から始めます」）。"""
    if time_like(head):
        return False
    h = head.translate(FW_TIME)
    m = TIME_RE.match(h)
    return bool(m) and len(m.group(0)) < len(h) and parse_time(m.group(0)) is not None


def bracket_time(s):
    """(b) 括弧で囲んだ時刻: 前後の空白を除いた行 s の先頭の字が [ ( （ 【 のどれかで、そのあと最初に来る対の閉じ括弧までの
    中身が時刻の書き方に合う（中身の前後の空白は除き、全角を直す）。(秒, 閉じ括弧より後ろの前後の空白を除いた字) か None。"""
    close = BRACKET_CLOSE.get(s[:1])
    if not close:
        return None
    j = s.find(close, 1)
    if j < 0:
        return None
    t = parse_time(s[1:j])
    return None if t is None else (t, trim_sp(s[j + 1:]))


def col_name(k):
    """1→A, 26→Z, 27→AA（表計算の列名）。"""
    s = ""
    while k > 0:
        k, r = divmod(k - 1, 26)
        s = chr(65 + r) + s
    return s


def dumps(e):
    # 有限でない数は書かない（検査が先に F02 で拒む。ここは最後の守り）
    return json.dumps(e, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _reject_constant(name):
    raise ValueError(f"{name} は数として使えません（数は有限のものだけ）")


def _parse_int(s):
    """JSON の整数。桁がとても多い整数（Python が整数にしない長さ）は無限として読む（ページの JSON.parse と
    同じく、使えない数として F02 で拒む。読めない行にはしない）。"""
    digits = s.lstrip("-")
    if len(digits) > 1000:
        return float("-inf") if s.startswith("-") else float("inf")
    return int(s)


def loads(text):
    """JSON を読む。NaN・Infinity・-Infinity の字句は読めないものとして扱う（ページの JSON.parse と同じ）。
    入れ子が深すぎて読む道具が持たないときも、落ちずに読めないものとして扱う（ValueError）。"""
    try:
        return json.loads(text, parse_constant=_reject_constant, parse_int=_parse_int)
    except RecursionError:
        raise ValueError("値の入れ子が深すぎて読めません")


def text_depth(text):
    """JSON の文字の入れ子の深さ（文字列の中の括弧は数えない）。読む前に、読む道具が持たない深さを断るために使う。"""
    d = mx = 0
    in_str = esc = False
    for ch in text:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "[" or ch == "{":
            d += 1
            if d > mx:
                mx = d
        elif ch == "]" or ch == "}":
            d -= 1
    return mx


def value_depth(v, limit=VALUE_DEPTH_MAX):
    """値の入れ子の深さ（数・文字列は 0、[] と {} は 1 ＋ 中身の最大）。再帰しない。limit を超えたら、そこで打ち切って返す。"""
    mx = 0
    stack = [(v, 0)]
    while stack:
        x, d = stack.pop()
        if isinstance(x, (list, dict)):
            d += 1
            if d > mx:
                mx = d
                if mx > limit:
                    return mx
            stack.extend((c, d) for c in (x.values() if isinstance(x, dict) else x))
    return mx


def brief(v, n=60):
    """違反文に出す値の字面（長ければ n 字で切る）。"""
    r = repr(v)
    return r if len(r) <= n else r[: n - 1] + "…"


def name_tail(name, n=60):
    """違反文に出す名前の字面（JSON の文字列）。長い名前は終わりの n−1 字だけを出し、頭に「…」を付ける
    （断る理由は名前の終わり＝拡張子にあるので、終わりを残す。K17。ページの verify.js と同じ切り方）。"""
    shown = name if len(name) <= n else "…" + name[-(n - 1):]
    return json.dumps(shown, ensure_ascii=False)


def show(v, n=60):
    """違反文に出す値の字面。入れ子の深い値は字面にしない（字面にする道具が落ちないように）。"""
    return brief(v, n) if value_depth(v) <= VALUE_DEPTH_MAX else "（入れ子の深い値）"


def split_lines(text):
    """改行（LF か CR LF）だけで行に分ける。str.splitlines は U+2028 などでも切るので使わない（JSON の文字列の中に入りうる）。"""
    return [l[:-1] if l.endswith("\r") else l for l in text.split("\n")]


def read_utf8(path, what):
    """ファイルを UTF-8 として読む（先頭の BOM は捨てる）。読めなければ Fail（落ちない）。"""
    try:
        return Path(path).read_bytes().decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise Fail(f"{what} {path} が UTF-8 として読めません（{e.start + 1} バイト目）")


def load_jsonl(path):
    p = Path(path)
    if not p.exists():
        return []
    out = []
    for i, line in enumerate(split_lines(read_utf8(p, "ファイル")), 1):
        if line.strip():
            try:
                out.append(loads(line))
            except ValueError as e:
                raise Fail(f"{p} の {i} 行目が JSON として読み取れません: {e}")
    return out


def load_rules(path=None):
    p = Path(path) if path else RULES_PATH
    if not p.exists():
        raise Fail(f"規則表がありません: {p}")
    return Rules(json.loads(p.read_text(encoding="utf-8")))


def _is_num(v):
    """使える数か。有限で、絶対値が 2^53−1 以下（NaN・Infinity・1e999・310 桁の整数は数ではない。落ちない）。"""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    if isinstance(v, float) and not math.isfinite(v):
        return False
    return abs(v) <= MAX_SAFE


def _is_int(v):
    """整数か。2.0 のような小数点つきの整数も整数として受ける（ページの JSON.parse は 2.0 と 2 を区別できない）。"""
    if not _is_num(v):
        return False
    return isinstance(v, int) or v.is_integer()


def _to_int(v):
    """整数の欄に入れる値を、書く形（int）に直す。整数でなければそのまま返す。"""
    if isinstance(v, float) and _is_int(v):
        return int(v)
    return v


def _canon(v):
    """JSON の文字列にして比べるための形。小数点つきの整数は整数に直す（ページの JSON.stringify と同じ書き方になる）。"""
    if isinstance(v, float) and math.isfinite(v) and v.is_integer() and abs(v) < 1e21:
        return int(v)
    if isinstance(v, list):
        return [_canon(x) for x in v]
    if isinstance(v, dict):
        return {k: _canon(x) for k, x in v.items()}
    return v


def dumps_safe(v):
    """違反文に値を出すための JSON の形（書けない値なら repr）。"""
    try:
        return dumps(v)
    except (ValueError, TypeError):
        return repr(v)


def same_json(a, b):
    """JSON の文字列として同じか（false と 0、true と 1 は別。2.0 と 2 は同じ）。"""
    try:
        return dumps(_canon(a)) == dumps(_canon(b))
    except ValueError:
        return False


def _walk(v):
    """値の中の葉と、オブジェクトの鍵を順に返す（再帰しない。深い入れ子でも落ちない）。"""
    stack = [v]
    while stack:
        x = stack.pop()
        if isinstance(x, list):
            stack.extend(x)
        elif isinstance(x, dict):
            for k, c in x.items():
                yield k
                stack.append(c)
        else:
            yield x


def has_nonfinite(v):
    """使えない数（NaN・±Infinity と、絶対値が 2^53−1 を超える数）を含むか。"""
    return any(isinstance(x, (int, float)) and not isinstance(x, bool) and not _is_num(x) for x in _walk(v))


def _lone_surrogate(s):
    """文字列に対になっていないサロゲートがあるか（JSON の \\ud800 は読むと片割れのまま残る。対は読む時点で1字になる）。"""
    return any("\ud800" <= ch <= "\udfff" for ch in s)


def has_lone_surrogate(v):
    """値の中（配列・オブジェクトの中、オブジェクトの鍵も）に、対になっていないサロゲートを持つ文字列があるか。"""
    return any(isinstance(x, str) and _lone_surrogate(x) for x in _walk(v))


def clean_text(s):
    """違反文・警告文に入れる文字列から片割れのサロゲートを除く（\\ud800 の字面に直す。表示と書き込みで落ちない）。"""
    if not isinstance(s, str) or not _lone_surrogate(s):
        return s
    return "".join(f"\\u{ord(ch):04x}" if "\ud800" <= ch <= "\udfff" else ch for ch in s)


def _uniq(xs):
    """並びを保ったまま、同じ文を 2 回目からは落とす。"""
    seen, out = set(), []
    for x in xs:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def is_event(e):
    """イベントとして読める行か（JSON のオブジェクトで、e が文字列）。"""
    return isinstance(e, dict) and isinstance(e.get("e"), str)


def same_value(a, b):
    """版の判定に使う比べ方。型も比べる（true は 1 ではない。2.0 は 2 と同じ。null は欄が無いのと同じ）。"""
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if _is_num(a) and _is_num(b):
        return a == b
    return type(a) is type(b) and a == b


# 判断ログの名前と、道具が名前から作る派生ファイル（K9）。判断ログは <語幹>.jsonl（小文字の .jsonl で終わり、
# .src.jsonl では終わらない）。派生ファイルは同じフォルダの <語幹>.src.jsonl（素材ログ）・<語幹>.next.json（覚え書き）・
# <語幹>.watch.json（watch の印）
LOG_SUFFIX = ".jsonl"
SRCLOG_SUFFIX = ".src.jsonl"
SIDE_SUFFIX = ".next.json"
WATCH_SUFFIX = ".watch.json"
DERIVED_SUFFIXES = (SRCLOG_SUFFIX, SIDE_SUFFIX, WATCH_SUFFIX)


def log_stem(log):
    """判断ログの語幹（名前から .jsonl を除いたもの）。.jsonl で終わらない名前（open が断る名前）は、最後の拡張子を除く。"""
    name = Path(log).name
    return name[:-len(LOG_SUFFIX)] if name.endswith(LOG_SUFFIX) and len(name) > len(LOG_SUFFIX) else Path(log).stem


def srclog_path(log):
    p = Path(log)
    return p.with_name(log_stem(p) + SRCLOG_SUFFIX)


def sidecar_path(log):
    p = Path(log)
    return p.with_name(log_stem(p) + SIDE_SUFFIX)


# ---------------------------------------------------------------- 素材を読む

class FormatError(Fail):
    pass


def _material_lines(path):
    """素材ファイルを1行ずつ返す（行番号, 文字列）。先の行数は数えない。

    UTF-8 として読み、読めないバイトは置換文字（U+FFFD）にする。行は LF だけで分ける（CR は残し、
    前後の空白として除く）。先頭の BOM は捨てる（ページはファイルを読むときに 1 つ、素材を読むときに
    もう 1 つ捨てるので、ここも 2 つまで捨てる）。LF は多バイト文字の中に現れないので、1行ずつ読んでも
    ファイル全体を読むのと同じ字になる。
    """
    with open(path, "rb") as f:
        for lineno, raw in enumerate(f, 1):
            if raw.endswith(b"\n"):
                raw = raw[:-1]
            if lineno == 1 and raw.startswith(b"\xef\xbb\xbf"):
                raw = raw[3:]
            line = raw.decode("utf-8", "replace")
            if lineno == 1 and line.startswith("\ufeff"):
                line = line[1:]
            yield lineno, line


def _monotone_t(t, prev):
    """前の発話より前の時刻は、前の発話の時刻に揃える（読むときに単調にする）。"""
    return t if prev is None or t >= prev else prev


def _notice(kind, line, **kw):
    """知らせ（素材を読んでいて分かったこと）。読めない行は {"ev":"unreadable","line":N,"raw":…}、
    時刻の飛びは {"ev":"jump","line":N,"from":前の時刻,"to":この時刻}、時刻で始まる本文の行は {"ev":"timehead","line":N}。"""
    d = {"ev": kind, "line": line}
    d.update(kw)
    return d


# WebVTT（format/FORMAT.md「素材ファイルの形」の 'vtt'。ページの intake.js と同じ決まり）
VTT_TS_RE = re.compile(r"(?:([0-9]{1,6}):)?([0-9]{2}):([0-9]{2})\.([0-9]{3})")
# 字幕の時刻の行: 「始まり --> 終わり」と任意の設定。. は JS と同じく行の区切りの字（CR・LF・U+2028・U+2029）に当たらない
VTT_TIMING_RE = re.compile("([0-9:.]+)[ \t]*-->[ \t]*([0-9:.]+)(?:[ \t][^\r\n  ]*)?")
VTT_VOICE_RE = re.compile(r"<v(?:\.[^\t >]+)*(?:[ \t]([^>]*))?>")
VTT_TAG_RE = re.compile(r"<[^>]*>")
VTT_ENT_RE = re.compile(r"&(amp|lt|gt|nbsp|quot|#39);")
VTT_ENT = {"amp": "&", "lt": "<", "gt": ">", "nbsp": " ", "quot": '"', "#39": "'"}
VTT_SKIP_RE = re.compile(r"NOTE|STYLE|REGION")


def vtt_ts(s):
    """字幕の時刻（[時:]分:秒.ミリ秒。時は 1〜6 桁、分と秒は 2 桁で 00〜59、ミリ秒は 3 桁。全角は直さない）を、
    ミリ秒を切り捨てた整数の秒に。読めなければ None。"""
    m = VTT_TS_RE.fullmatch(s)
    if not m:
        return None
    h = int(m.group(1)) if m.group(1) is not None else 0
    mi, se = int(m.group(2)), int(m.group(3))
    if mi > 59 or se > 59:
        return None
    return h * 3600 + mi * 60 + se


def vtt_timing(s):
    """字幕の時刻の行なら始まりの秒、読めなければ None（終わりの時刻も読めること）。"""
    m = VTT_TIMING_RE.fullmatch(s)
    if not m:
        return None
    a = vtt_ts(m.group(1))
    return a if a is not None and vtt_ts(m.group(2)) is not None else None


def vtt_cue(joined):
    """字幕 1 つの本文（行を半角スペース 1 つでつないだもの）→ (話者, 本文)。頭の <v 名前> か <v.クラス 名前> を
    話者にし、<...> の札をすべて除いてから &amp; &lt; &gt; &nbsp; &quot; &#39; を字に戻す（1 回だけ）。"""
    dec = lambda x: VTT_ENT_RE.sub(lambda m: VTT_ENT[m.group(1)], x)
    m = VTT_VOICE_RE.match(joined)
    who = (trim_sp(dec(m.group(1) or "")) or None) if m else None
    return who, trim_sp(dec(VTT_TAG_RE.sub("", joined)))


class MaterialReader:
    """素材ファイルを先頭から 1 発話ずつ読む（format/FORMAT.md「素材ファイルの形」。ページの makeMaterialReader と
    同じ手順・同じ結果）。先の行数は数えない。

    next() → (発話 {i, t, who, text}, その発話に付けた知らせ) か None（読み終えた）。読み終えたあとは
    tail（最後の発話より後ろの知らせ。最後の発話に付ける）・last（最後の発話か None）・format・skipped を見る。

    書き方（format）: 先頭の空でない行が WEBVTT で始まれば 'vtt'。そうでなければ、見出しを飛ばしたあとの最初の
    時刻のある行で決める（時刻だけの行 'alone'、タブで区切った 1 列目が時刻 'tsv'、時刻＋空白＋本文の行 'inline'）。
    書き方が決まる前に字幕の時刻の行の形（VTT_TIMING_RE）の行が来たら、その行から 'vtt'（K21。前の行は見出しのまま）。
      - 時刻だけの行・表の行（1 列目が時刻）は、どの書き方でも新しい発話を始める（列 3 つ以上: 2 列目が話者（speaker_col）、
        3 列目以降をタブでつないだものが本文 / 2 つ: 2 列目が本文 / 1 つ: 本文は空で始め、続く行で埋める）
      - 'tsv'・'inline'（とまだ決まっていないとき）: 時刻＋空白（半角・全角）＋本文の行（タブを含まず、行の頭が
        正しい時刻）も、その時刻の新しい発話。本文は頭の後ろの字で、話者は split_who で切る
      - 読めない行: タブを含むのに 1 列目が時刻でない行 / タブを含まず行の全体が時刻らしいのに時刻として読めない行 /
        'alone' 以外で、行の頭が時刻らしいのに時刻として読めず、空白と本文が続く行 / 読めない行に続くタブを含まない行
        （次の時刻のある行まで）。読めない行に来たら、まだ出していない発話はそこで閉じる
      - 'alone' の時刻で始まる本文の行（行の頭が時刻らしく、空白と本文が続く）: 直前の発話の本文の続き（timehead）
      - K30 タブを含まない時刻らしい頭の行: (b) 括弧で囲んだ時刻（bracket_time）は、'tsv'・'inline' では括弧の中の時刻の
        新しい発話（本文は閉じ括弧より後ろ、話者は split_who。書き方がまだ決まっていなければ 'inline' に決める）、'alone'
        では直前の発話の続き（timehead）。(a) 時刻に字が続く頭（glued_time）は、どの書き方でも直前の発話の続き
        （timehead）で、書き方がまだ決まっていなければ読めない行
      - K30 (c) 読めないバイト（U+FFFD）を含む行: どの書き方でも、書き方が決まる前でも読めない行（知らせの種類 badbyte）。
        書き方の見分けにも使わない。まだ出していない発話（字幕）はその手前で閉じ、続く行は読めない行の続き（'vtt' では
        空行か次の時刻の行まで）。先頭の WEBVTT の行だけは、読めないバイトを含んでも見出しの塊の頭
      - ほかの行は直前の発話の本文の続き（半角スペース 1 つ）。最初の発話より前なら見出しとして黙って飛ばす
      - 'vtt': WEBVTT の行から空行まで、NOTE・STYLE・REGION で始まる塊（空行まで）は飛ばす。--> を含む行は字幕の
        時刻の行で、前の字幕をそこで閉じる。読めれば始まりの時刻（ミリ秒は切り捨て）の字幕を始め、読めなければ
        その行から空行までを読めない行にする。塊の最初の行の次が時刻の行なら、最初の行は識別子として捨てる。
        時刻の行から空行までの行を半角スペース 1 つでつなぎ、vtt_cue で話者と本文にする。時刻の行の無い塊は読めない行
    本文が空のまま終わった発話は発話にしない（i を取らない）。時刻は単調にする（前の発話より前なら前の時刻に揃える）。
    時刻が飛んでいる行: 揃える前の時刻が、1 つ前に i を取った発話の揃える前の時刻より前か、600 秒より先。
    知らせを付ける発話: 本文の行（時刻で始まる本文の行）と時刻の飛びは、その行を含む発話。どの発話にも入らない行
    （読めない行とその続き）は、後ろの最初の発話。最後の発話より後ろの知らせは最後の発話（tail。発話が無ければどれにも付かない）。
    """

    def __init__(self, path):
        self._lines = _material_lines(path)
        self.format = None
        self.skipped = []      # 黙って読み飛ばした行（見出し・WebVTT の見出しの塊と NOTE などの塊・識別子）
        self.tail = []         # 最後の発話より後ろの知らせ（読み終えてから）
        self.last = None       # 最後に返した発話
        self.done = False
        self._seen = False
        self._lineno = 0
        self._n = 0
        self._last_t = None    # 揃えたあとの直前の時刻
        self._prev_raw = None  # 1 つ前に i を取った発話の、揃える前の時刻
        self._pending = None   # まだ出していない発話 {t, who, text, line, notes, parts}
        self._held = []        # どの発話にも入らない行の知らせ（後ろの最初の発話に付ける）
        self._broken = False   # 読めない行の続きの中にいる
        self._vs = "none"      # WebVTT: 塊のどこにいるか（none・skip・cand・cue・bad・stray）
        self._cand = None      # WebVTT: 識別子かもしれない塊の最初の行 (行番号, 字)
        self.timed = 0         # 時刻のある行（発話を始めた行。本文が空で発話にしなかった行も数える）の数
        self.vtt_at = None     # WEBVTT の行が無いまま、字幕の時刻の行の形の行で 'vtt' に決めた行の番号（K31）

    def _bad(self, line, s, kind="unreadable"):
        self._held.append(_notice(kind, line, raw=s[:RAW_MAX]))

    def _start(self, t, who, body, parts=None):
        self.timed += 1
        self._pending = {"t": t, "who": who, "text": body, "line": self._lineno, "notes": [], "parts": parts}

    def _finish(self):
        p, self._pending = self._pending, None
        if p is None:
            return None
        if p["parts"] is not None:
            p["who"], p["text"] = vtt_cue(" ".join(p["parts"]))
        if not p["text"]:
            self._held += p["notes"]
            return None
        mine, self._held = self._held + p["notes"], []
        raw_t = p["t"]
        if self._prev_raw is not None and (raw_t < self._prev_raw or raw_t - self._prev_raw > JUMP_SEC):
            mine.append(_notice("jump", p["line"], **{"from": self._prev_raw, "to": raw_t}))
        mine.sort(key=lambda n: n["line"])
        self._prev_raw = raw_t
        t = self._last_t if (self._last_t is not None and raw_t < self._last_t) else raw_t
        self._last_t = t
        self._n += 1
        u = {"i": self._n, "t": t, "who": p["who"], "text": p["text"]}
        self.last = u
        return u, mine

    def _vtt_line(self, s):
        if not s:
            if self._vs == "cand":
                self._bad(*self._cand)
                self._cand = None
            r = self._finish() if self._vs == "cue" else None
            self._vs = "none"
            return r
        if BAD_BYTE in s:
            # K30 (c): 読めないバイトを含む行。まだ出していない字幕はその手前で閉じ、空行（か次の時刻の行）までを読めない行にする
            if self._vs == "cand":
                self._bad(*self._cand)
                self._cand = None
            r = self._finish() if self._vs == "cue" else None
            self._bad(self._lineno, s, "badbyte")
            self._vs = "bad"
            return r
        if "-->" in s:
            if self._vs == "cand":
                self.skipped.append(self._cand[0])   # 塊の最初の行の次が時刻の行: 識別子として捨てる
                self._cand = None
            r = self._finish() if self._vs == "cue" else None
            t = vtt_timing(s)
            if t is not None:
                self._start(t, None, "", parts=[])
                self._vs = "cue"
            else:
                self._bad(self._lineno, s)
                self._vs = "bad"
            return r
        if self._vs == "cue":
            self._pending["parts"].append(s)
        elif self._vs == "skip":
            self.skipped.append(self._lineno)
        elif self._vs in ("bad", "stray"):
            self._bad(self._lineno, s)
        elif self._vs == "cand":
            self._bad(*self._cand)
            self._cand = None
            self._bad(self._lineno, s)
            self._vs = "stray"
        elif VTT_SKIP_RE.match(s):
            self._vs = "skip"
            self.skipped.append(self._lineno)
        else:
            self._cand = (self._lineno, s)
            self._vs = "cand"
        return None

    def _step(self, line):
        s = trim_sp(line)
        if not self._seen and s:
            self._seen = True
            if s.startswith("WEBVTT"):
                self.format, self._vs = "vtt", "skip"
                self.skipped.append(self._lineno)
                return None
        bad_byte = BAD_BYTE in s   # K30 (c): 読めないバイトを含む行は、書き方の見分けにも使わない
        if self.format is None and not bad_byte and VTT_TIMING_RE.fullmatch(s):
            # WEBVTT の行の無い字幕（K21）: 書き方が決まる前（まだ出していない発話も無い）に字幕の時刻の行の形が来たら、
            # その行から 'vtt' として読む（時刻として読めるかは問わない）。それより前の行は見出しとして飛ばしたまま
            self.format, self._vs, self._cand, self._broken = "vtt", "none", None, False
            self.vtt_at = self._lineno
        if self.format == "vtt":
            return self._vtt_line(s)
        if not s:
            return None
        if bad_byte:
            r = self._finish()          # まだ出していない発話は、読めない行の手前で閉じる
            self._broken = True
            self._bad(self._lineno, s, "badbyte")
            return r
        cols = line.split("\t")
        t = parse_time(cols[0])
        if t is not None:
            if self.format is None:
                self.format = "tsv" if len(cols) > 1 else "alone"
            self._broken = False
            who, body = None, ""
            if len(cols) >= 3:
                who, body = speaker_col(cols[1]), trim_sp("\t".join(cols[2:]))
            elif len(cols) == 2:
                body = trim_sp(cols[1])
            r = self._finish()
            self._start(t, who, body)
            return r
        head = line_head(s)
        timehead = time_like(head)
        inline_t = parse_time(head) if (len(cols) == 1 and head != s) else None
        if inline_t is not None and self.format != "alone":
            # 'tsv'・'inline'（とまだ決まっていないとき）: 時刻＋空白＋本文の行は、その時刻の新しい発話
            if self.format is None:
                self.format = "inline"
            self._broken = False
            who, body = split_who(s[len(head):])
            r = self._finish()
            self._start(inline_t, who, body)
            return r
        # K30 (b) 括弧で囲んだ時刻: 'tsv'・'inline'（とまだ決まっていないとき）は、その時刻の新しい発話
        br = bracket_time(s) if len(cols) == 1 else None
        if br is not None and self.format != "alone":
            if self.format is None:
                self.format = "inline"
            self._broken = False
            r = self._finish()
            who, body = split_who(br[1])
            self._start(br[0], who, body)
            return r
        # K30 (a) 時刻に字が続く頭: 続きにして知らせる。書き方がまだ決まっていなければ読めない行（黙って飛ばさない）
        glued = len(cols) == 1 and glued_time(head)
        if (len(cols) > 1 or self._broken or (timehead and (head == s or self.format != "alone"))
                or (glued and self.format is None)):
            r = self._finish()          # まだ出していない発話は、読めない行の手前で閉じる
            self._broken = True
            self._bad(self._lineno, s)
            return r
        if self._pending is not None:
            p = self._pending
            p["text"] = p["text"] + " " + s if p["text"] else s
            if timehead or glued or br is not None:
                p["notes"].append(_notice("timehead", self._lineno))
        else:
            self.skipped.append(self._lineno)
        return None

    def refusal(self):
        """読み切って発話が 1 つも無かったときだけ、断りの文の並び（K21。ページの refusal と同じ）。時刻のある行が 1 つも
        無ければ NO_TIMED_TEXT（見出しとして黙って飛ばした行の数）、あれば NO_BODY_TEXT（時刻のある行の数）。そのあとに
        素材の知らせの文（読めない行など）を並べる。発話があるか、まだ読み切っていなければ None。"""
        if not self.done or self._n:
            return None
        first = NO_TIMED_TEXT.format(n=len(self.skipped)) if not self.timed else NO_BODY_TEXT.format(n=self.timed)
        vtt = [VTT_DECIDED_TEXT.format(n=self.vtt_at)] if self.vtt_at is not None else []
        return [first] + vtt + notice_lines(sorted(self.tail, key=lambda n: n["line"]))

    def next(self):
        while not self.done:
            got = next(self._lines, None)
            if got is None:
                self.done = True
                if self._cand is not None:
                    self._bad(*self._cand)
                    self._cand = None
                r = self._finish()
                self.tail, self._held = self._held, []
                return r
            self._lineno = got[0]
            r = self._step(got[1])
            if r is not None:
                return r
        return None


# 発話が 1 つも無い素材の断り（K21。ページの intake.js の NO_TIMED_TEXT・NO_BODY_TEXT と同じ文）
NO_TIMED_TEXT = "時刻のある行が 1 つもありません（見出しとして飛ばした行 {n} 行）。素材の形は format/FORMAT.md の「素材ファイルの形」を見てください"
NO_BODY_TEXT = "本文のある発話が 1 つもありません（時刻のある行 {n} 行は、どれも本文が空でした）。素材の形は format/FORMAT.md の「素材ファイルの形」を見てください"
# WEBVTT の行が無いまま字幕の時刻の行の形の行で 'vtt' に決めた素材を断るときに、断りの文の次に添える（K31。ページと同じ文）
VTT_DECIDED_TEXT = "{n} 行目を字幕の時刻の行（「-->」を含む行）とみなし、そこから後ろを字幕（WebVTT）として読みました。字幕でなければ、その行の「-->」を書き換えてください"


def material_refusal(path):
    """素材が発話を 1 つも持たなければ断りの文の並び（MaterialReader.refusal）、あれば None（最初の発話を見つけたら
    そこで読むのをやめる）。file の open は、記録を作る前にこれで断る（K21）。"""
    rd = MaterialReader(path)
    if rd.next() is not None:
        return None
    return rd.refusal()


def iter_material(path):
    """素材ファイルを先頭から読み、("u", 発話, 知らせの一覧) を 1 発話ずつ返す。最後に ("end", 最後の発話か None,
    最後の発話より後ろの知らせ)（MaterialReader。最後の発話より後ろの知らせは、最後の発話に付ける）。"""
    rd = MaterialReader(path)
    while True:
        r = rd.next()
        if r is None:
            break
        yield ("u",) + r
    yield ("end", rd.last, rd.tail)


def iter_utterances(path):
    """素材ファイルを先頭から1発話ずつ返す（{i, t, who, text}）。先の行数は数えない（iter_material の発話だけ）。"""
    for kind, u, _ in iter_material(path):
        if kind == "u":
            yield u


def file_notices(path, lo, hi, tail=False):
    """素材ファイルの、発話 lo〜hi に付いた知らせ。hi が最後の発話なら、最後の発話より後ろの知らせも（最後の発話を
    渡す窓で出す。ページと同じ）。hi の次の発話までしか読まない（窓の境目を知るために読む 1 発話と同じ所まで。
    hi が最後なら素材の終わりまで）。tail が真なら、発話が 1 つも無い素材の知らせも返す（終わりを告げるとき）。"""
    out = []
    for kind, u, notes in iter_material(path):
        if kind == "u":
            if u["i"] > hi:
                break
            if lo <= u["i"]:
                out.extend(notes)
        elif (u is not None and lo <= u["i"] <= hi) or (u is None and tail):
            out.extend(notes)
    return out


def read_raw_lines(path, start, count):
    """v1 用。start 行目から最大 count 行を返す（それより後ろは読まない）。"""
    got = []
    try:
        with open(path, encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                if i < start:
                    continue
                if i >= start + count:
                    break
                got.append((i, line.rstrip("\r\n")))
    except UnicodeDecodeError:
        raise Fail(f"文字起こし {path} が UTF-8 として読めません")
    return got


def monotone_list(utts, where="素材ログ"):
    """素材ログの行（dict の並び）のうち発話を、時刻を単調にした写しにして返す。出来事の行（ev を持つ行）は除く。
    壊れた行があれば Fail（落ちない）。"""
    return read_srclog_records(utts, where).utts


# ---------------------------------------------------------------- live: 素材ログとメモ帳

class Pool:
    """消えた行の溜まり（K18・K24）。項目は (組, もとの行)。突き合わせは、もとの行から時刻の列を落とした鍵（memo_key）で
    行い、同じ鍵の項目は新しいほうから取る。鍵ごとの索引を持つので、取る手間は同じ鍵の項目の数で済む（覚えを読み直す
    たびに素材ログの全行を当て直しても、行数の 2 乗にならない）。"""

    def __init__(self):
        self._items = []   # [組, もとの行, 鍵]（足した順。取った項目は None に置き換える）
        self._by = {}      # 鍵 -> まだ取っていない項目の位置（古い順）

    def __len__(self):
        return sum(len(v) for v in self._by.values())

    def add(self, g, raw):
        k = memo_key(raw)
        self._by.setdefault(k, []).append(len(self._items))
        self._items.append([g, raw, k])

    def take(self, key, g=None):
        """鍵が key の項目を新しいほうから 1 つ取り除き、(組, もとの行) を返す（g を渡せば、その組の項目だけ）。無ければ None。"""
        lst = self._by.get(key)
        if not lst:
            return None
        for p in range(len(lst) - 1, -1, -1):
            x = self._items[lst[p]]
            if g is None or x[0] == g:
                self._items[lst.pop(p)] = None
                return x[0], x[1]
        return None

    def has(self, key):
        return bool(self._by.get(key))

    def items(self, key, g=None):
        """鍵が key の項目（g を渡せば、その組の項目だけ）を古い順に [(組, もとの行)]。"""
        return [(self._items[q][0], self._items[q][1]) for q in self._by.get(key, ())
                if g is None or self._items[q][0] == g]

    def copy(self):
        c = Pool()
        c._items = [None if x is None else list(x) for x in self._items]
        c._by = {k: list(v) for k, v in self._by.items() if v}
        return c


class SrcLog:
    """素材ログ（live）を頭から当てたもの（K18）。

    entries は、watch が前に見たメモ帳の確定した行の並び [もとの行, 発話を持つか, 戻した行と知らせたか]（もとの行は前後の
    空白を除いた行。中身を持たない古い行は None）。発話を持つ行は読み終えた行（素材ログの発話になった行と、戻した行と
    みなした行）。読み終えた行の間に足されて拾わなかった行は、発話を持たない行として並びに入る（次の保存と突き合わせるため）。
    3 つ目の「戻した行と知らせたか」は、戻した行とみなして知らせ、まだ末尾への打ち直しを受けていない行で真（K26。その行が
    メモ帳に残っている間、同じ中身を末尾に打った行は、消えた行の覚えより先にこれと組にして新しい発話にする）。
    pool は、消えた読み終えた行の溜まり（Pool。組は、その行が消えた保存の番号）。あとで末尾や間に同じ中身の行が現れたら、
    新しいほうから 1 つずつ組にして、戻した行とみなす（K18 の 5）。中身は時刻の列を落とした鍵で比べる（K24）。
    spent は、溜まりから外した行（Pool。戻した行の知らせ・残った行の知らせで「末尾にもう一度打てば新しい発話」と言ったので、
    もう組にしない行）。末尾に同じ中身の新しい発話が来たら、打ち直した行として知らせ、その保存で同じ中身の項目をすべて除く
    （K26。消した行を戻しただけなら二重になったことを、黙らずに言う。同じ保存の同じ中身の行には 1 つずつ配って、どれも
    名指す）。
    """

    def __init__(self):
        self.utts = []        # 発話（時刻は単調に揃えたもの）
        self.entries = []     # 前に見たメモ帳の確定した行 [もとの行, 発話を持つか, 戻した行と知らせたか]
        self.pool = Pool()    # 消えた読み終えた行
        self.spent = Pool()   # 溜まりから外した行（もう組にしない。末尾の同じ中身の新しい発話で、打ち直しを知らせて除く）
        self.notes = {}       # 発話の番号 i -> その発話の前に残った知らせ
        self.tail = []        # 最後の発話より後の知らせ
        self.timecol = False  # 「メモ帳の時刻は使いません」をもう知らせたか

    @property
    def keys(self):
        """前に見たメモ帳の確定した行（もとの行）の並び。"""
        return [e[0] for e in self.entries]


def apply_changed(sl, rec, k):
    """読み終えた行の変化（{"ev":"changed",…}）を sl に当てる。当てられなければ偽。sync_memo が書く出来事と、
    read_srclog_records が読む出来事で同じ（K18）。k は素材ログの行の番号（組の番号を持たない前の版の行に使う）。

      deleted   pos から was の行数を除く。発話を持つ行なら、溜まりに [組 g, もとの行] で足す
      inserted  pos に now の行を、発話を持たない行として入れる（読み終えた行の間の行。拾っていない）
      restored  pos に now の行を、発話を持つ行・戻した行と知らせた行として入れ、溜まりから同じ中身の行を 1 つずつ取る
                （from に組があれば、その組の行）
      retimed   pos の行を now の行に置き換える（発話を持つか・戻した行と知らせたかは前のまま。時刻の列だけの直し）
      kept      何もしない（読み終えた行の半分以上が一度に消えたとき、残った行を名指した知らせ）
      forget    溜まりから drop の [組, もとの行] を 1 つずつ spent へ移す（もう組にしない）
      retyped   drop の [組, もとの行] を 1 つずつ、spent から（無ければ溜まりから）除く（末尾の同じ中身の行を新しい発話に
                したときの知らせ。K26）。paid があれば、その位置の行の「戻した行と知らせた」を外す（知らせのとおり打ち直しを
                受けた）。drop が空なら知らせにしない（印を外すだけ）
      前の版の rewritten・split・merged・moved: pos の was の行を now の行に置き換える
    """
    kind = rec.get("kind")
    pos, was, now = rec.get("pos"), rec.get("was"), rec.get("now")
    if not (_is_int(pos) and isinstance(was, list) and isinstance(now, list)):
        return False
    pos = int(pos)
    ent = sl.entries
    now = [x if isinstance(x, str) else None for x in now]
    if kind == "deleted":
        if now or not was or not (0 <= pos and pos + len(was) <= len(ent)):
            return False
        g = int(rec["g"]) if _is_int(rec.get("g")) else k
        for _ in was:
            key, u, _ = ent.pop(pos)
            if u:
                sl.pool.add(g, key)
        return True
    if kind in ("inserted", "restored"):
        if was or not now or not (0 <= pos <= len(ent)):
            return False
        u = kind == "restored"
        ent[pos:pos] = [[x, u, u] for x in now]
        if u:
            frm = rec.get("from")
            for idx, x in enumerate(now):
                g = frm[idx] if isinstance(frm, list) and idx < len(frm) and _is_int(frm[idx]) else None
                key = memo_key(x)
                if sl.pool.take(key, None if g is None else int(g)) is None and g is not None:
                    sl.pool.take(key)
        return True
    if kind == "kept":
        return True
    if kind in ("forget", "retyped"):
        drop = rec.get("drop")
        if not isinstance(drop, list):
            return False
        for d in drop:
            if isinstance(d, list) and len(d) == 2 and _is_int(d[0]):
                raw = d[1] if isinstance(d[1], str) else None
                if kind == "forget":
                    got = sl.pool.take(memo_key(raw), int(d[0]))
                    if got is not None:
                        sl.spent.add(*got)
                elif sl.spent.take(memo_key(raw), int(d[0])) is None:
                    sl.pool.take(memo_key(raw), int(d[0]))
        paid = rec.get("paid")
        if kind == "retyped" and _is_int(paid) and 0 <= int(paid) < len(ent):
            ent[int(paid)][2] = False
        return True
    # retimed と、前の版の rewritten・split・merged・moved: 置き換える
    if not was or not (0 <= pos and pos + len(was) <= len(ent)):
        return False
    u = any(e[1] for e in ent[pos:pos + len(was)])
    named = len(was) == 1 and len(now) == 1 and ent[pos][2]
    ent[pos:pos + len(was)] = [[x, u, named] for x in now]
    return True


def read_srclog_records(records, where="素材ログ"):
    """素材ログの行を順に当てて SrcLog にする。壊れた行があれば Fail（落ちない）。

    発話の行は、前に見たメモ帳の行の並び（entries）の末尾に、発話を持つ行として足す。出来事の行（ev を持つ行）:
    changed は並びと溜まりに当てる（apply_changed）。知らせになる changed と timecol（メモ帳の時刻を使わないことの
    知らせ）は、次の発話の前の知らせにする（最後の発話より後なら tail）。前の版の素材ログにある unreadable と empty は
    読み終えた行に数える（unreadable は知らせにもする）。ほかの出来事（ページの音声認識の切断・再開など）は、発話にも
    知らせにもしない。live の素材ログでは時刻の飛びを見ない（発話の時刻は、watch が押した届いた時刻だけ）。
    """
    sl = SrcLog()
    prev = None
    for k, rec in enumerate(records, 1):
        if isinstance(rec, dict) and isinstance(rec.get("ev"), str):
            ev = rec["ev"]
            if ev in ("unreadable", "empty"):
                sl.entries.append([rec.get("raw") if isinstance(rec.get("raw"), str) else None, True, False])
                if ev == "unreadable":
                    sl.tail.append(rec)
            elif ev == "changed":
                if not apply_changed(sl, rec, k):
                    raise Fail(f"{where}の {k} 行目（読み終えた行の変化）が読めません")
                if notice_text(rec):
                    sl.tail.append(rec)
            elif ev == "timecol":
                sl.timecol = True
                sl.tail.append(rec)
            continue
        if not isinstance(rec, dict) or not _is_int(rec.get("i")) or not _is_num(rec.get("t")):
            raise Fail(f"{where}の {k} 行目が発話として読めません（i と t を持つ JSON オブジェクトではない）")
        prev = _monotone_t(rec["t"], prev)
        u = dict(rec, t=prev) if prev != rec["t"] else rec
        sl.utts.append(u)
        sl.entries.append([rec.get("raw") if isinstance(rec.get("raw"), str) else None, True, False])
        if sl.tail:
            sl.notes[u["i"]] = sl.tail
            sl.tail = []
    return sl


def read_srclog(path):
    return read_srclog_records(load_jsonl(path))


def read_memo_bytes(path):
    """メモ帳の中身（バイト列）。無ければ空。"""
    if not path or not Path(path).is_file():
        return b""
    return Path(path).read_bytes()


def parse_memo(raw, with_tail=False):
    """メモ帳の確定した行（改行で終わった行）を [(行番号, 前後の空白を除いた行, もとの行)] で返す。空の行は除く。

    行番号は LF で分けた 1 始まり（空の行も数える）。読めないバイトは置換文字（素材ファイルと同じ）。
    with_tail が真なら (確定した行, 改行で終わっていない最後の行か None) を返す。最後の行は、多バイト文字の
    途中で切れていれば置換文字が入る（書き足されれば中身が変わるので、2 秒の確定を待つうちに読み直される）。
    """
    cut = raw.rfind(b"\n") + 1
    body, rest = raw[:cut], raw[cut:]
    data = body.decode("utf-8", "replace")
    if data.startswith("﻿"):
        data = data[1:]
    out = []
    parts = data.split("\n")[:-1]
    for n, line in enumerate(parts, 1):
        if line.endswith("\r"):
            line = line[:-1]
        s = trim_sp(line)
        if s:
            out.append((n, s, line))
    if not with_tail:
        return out
    tail = None
    if rest:
        x = rest.decode("utf-8", "replace")
        if not body and x.startswith("﻿"):
            x = x[1:]
        s = trim_sp(x)
        if s:
            tail = (len(parts) + 1, s, x[:-1] if x.endswith("\r") else x)
    return out, tail


def read_memo(path):
    return parse_memo(read_memo_bytes(path))


def split_who(line):
    """「話者: 本文」の形（format/FORMAT.md「話者の切り出し」。ページの splitWho と同じ決まり）。(話者か None, 本文)。

    行の前後の空白（WS_CHARS）を除き、行頭から最初の「:」か「：」までを候補にする。話者と認めるのは、
    1〜20 字（コードポイント）・空白を含まない・数字（半角・全角）で始まらない・区切りが全角の「：」か、
    半角の「:」の直後が空白、をすべて満たすときだけ。認めないときは行の全体が話者無しの本文
    （「15:00までに」「9:00 から」「16:9 の画面」「https://…」「0:05 司会: …」）。「結論：A案」は話者「結論」になる。
    """
    s = trim(line)
    m = re.search("[:：]", s)
    if m:
        name, after = s[:m.start()], s[m.end():]
        if (1 <= len(name) <= 20 and not any(ch in WS_CHARS for ch in name)
                and not ("0" <= name[0] <= "9" or "０" <= name[0] <= "９")
                and (m.group() == "：" or after[:1] in tuple(WS_CHARS))):
            return name, trim(after)
    return None, s


def speaker_col(x):
    """表の話者の列: 前後の空白を除き、終わりの「:」「：」の並びを落として、もう一度前後の空白を除く
    （K13。「司会:<TAB>始めます」の話者は「司会」。ページの whoCol と同じ）。空なら None。"""
    return trim_sp(re.sub("[:：]+\\Z", "", trim_sp(x))) or None


def memo_kind(line):
    """メモ帳の 1 行の読み方。(種類, 話者, 本文)。種類は timecol（1 列目の時刻を落とした行）か plain。

    発話の時刻は、いつも watch がその行を見つけた時刻（届いた時刻）。メモ帳に打った時刻は使わない
    （打ち間違えた時刻 1 つで、そのあとの発話の位置がすべて狂うため）。
      - タブを含み 1 列目が時刻らしい行（数字で始まり、数字と : と . だけで、: を含む。全角の数字とコロンは半角に直して
        見る。0:5・1:2:3 のような正しくない時刻も）: 1 列目を落とす（K13）。残りにタブがあれば「話者<TAB>本文」、
        無ければ「話者: 本文」の形（split_who。「0:20<TAB>司会: 始めます」の話者は「司会」）
      - タブを含むほかの行: 「話者<TAB>本文」（列が 1 つなら本文だけ）
      - タブを含まない行: 「話者: 本文」の形（split_who）。時刻らしい頭で始まる行（0:45 甲 反対です）は、
        話者と認めないので、行の全体が話者無しの本文になる
      - 表の話者の列の終わりの「:」「：」は落とす（speaker_col）
    読めない行は無い（空でない行はすべて発話）。本文が空になる行（時刻だけ・話者だけ）は、行の全体を
    話者無しの本文にする（列の間はスペース 1 つ）。
    """
    cols = line.split("\t")
    kind = "plain"
    if len(cols) >= 2 and time_like(trim_sp(cols[0])):
        kind, cols = "timecol", cols[1:]
    if len(cols) >= 2:
        who, text = speaker_col(cols[0]), trim_sp("\t".join(cols[1:]))
    else:
        who, text = split_who(cols[0])
    if not text:
        who, text = None, " ".join(x for x in (trim_sp(c) for c in line.split("\t")) if x)
    return kind, who, text


def memo_key(s, line=None):
    """突き合わせに使う行の鍵（K24）: 前後の空白を除いた行から、K13 で落とす時刻の列（タブを含む行の 1 列目が時刻らしいもの。
    memo_kind と同じ見分け）を落とし、残りの前後の空白を除いたもの。時刻の列だけが違う行（「12:30<TAB>乙<TAB>はい」と
    「12:31<TAB>乙<TAB>はい」と「乙<TAB>はい」）は同じ鍵になる。中身を持たない古い行（None）は None。"""
    if s is None:
        return None
    cols = s.split("\t")
    if len(cols) >= 2 and time_like(trim_sp(cols[0])):
        return trim_sp("\t".join(cols[1:]))
    return s


DP_MAX_CELLS = 250000   # 真ん中をこの数の升目まで動的計画法で並べる（K18 の 9。300 行 × 300 行で 0.2 秒以内）


def _lcs_pairs(a, b):
    """a と b の最長共通部分列の並べ方 [(i, j)]（動的計画法。difflib は使わない。K18 の 3）。

    並べ方が複数あるときは、a の後ろのほうの行を残す（a の行を飛ばしても長さが変わらなければ飛ばす）。a の行を
    並べるときは、b のいちばん前の同じ中身の行に並べる（b の後ろの行を、末尾の新しい行として残す）。"""
    n, m = len(a), len(b)
    L = [[0] * (m + 1) for _ in range(n + 1)]   # L[i][j] = a[i:] と b[j:] の最長共通部分列の長さ
    for i in range(n - 1, -1, -1):
        row, below, ai = L[i], L[i + 1], a[i]
        for j in range(m - 1, -1, -1):
            if ai == b[j]:
                row[j] = below[j + 1] + 1
            else:
                x, y = below[j], row[j + 1]
                row[j] = x if x >= y else y
    out, i, j = [], 0, 0
    while i < n and j < m:
        if L[i + 1][j] == L[i][j]:
            i += 1
        elif a[i] == b[j]:
            out.append((i, j))
            i += 1
            j += 1
        else:
            j += 1
    return out


def _unique_anchors(a, b):
    """a と b のどちらにも 1 回だけ現れる行の組 (i, j) のうち、i と j がどちらも増える最も長い並び（大きな真ん中の目印）。"""
    ca, cb = {}, {}
    for i, x in enumerate(a):
        ca[x] = -1 if x in ca else i
    for j, x in enumerate(b):
        cb[x] = -1 if x in cb else j
    cand = sorted((i, cb[x]) for x, i in ca.items() if i >= 0 and cb.get(x, -1) >= 0)
    tails, tails_idx, prev = [], [], [None] * len(cand)
    for idx, (_, j) in enumerate(cand):
        p = bisect.bisect_left(tails, j)
        if p == len(tails):
            tails.append(j)
            tails_idx.append(idx)
        else:
            tails[p], tails_idx[p] = j, idx
        prev[idx] = tails_idx[p - 1] if p else None
    out, idx = [], (tails_idx[-1] if tails_idx else None)
    while idx is not None:
        out.append(cand[idx])
        idx = prev[idx]
    return out[::-1]


def _align(a, b, ao=0, bo=0, out=None):
    """a と b を並べる（K18 の 3）。共通の頭と共通の尻を外し、真ん中を最長共通部分列で並べる。真ん中が
    DP_MAX_CELLS より大きいときは、どちらにも 1 回だけ現れる行を目印に分けてから並べる（目印の無い大きな真ん中は
    並べない。どの行も消えた行・足された行として扱い、溜まりとの組で戻した行を見分ける）。戻り値 [(i, j)]（増える順）。"""
    if out is None:
        out = []
    h = 0
    while h < len(a) and h < len(b) and a[h] == b[h]:
        h += 1
    t = 0
    while t < len(a) - h and t < len(b) - h and a[len(a) - 1 - t] == b[len(b) - 1 - t]:
        t += 1
    out.extend((ao + x, bo + x) for x in range(h))
    a2, b2 = a[h:len(a) - t], b[h:len(b) - t]
    if a2 and b2:
        if len(a2) * len(b2) <= DP_MAX_CELLS:
            out.extend((ao + h + i, bo + h + j) for i, j in _lcs_pairs(a2, b2))
        else:
            pi = pj = 0
            for i, j in _unique_anchors(a2, b2):
                _align(a2[pi:i], b2[pj:j], ao + h + pi, bo + h + pj, out)
                out.append((ao + h + i, bo + h + j))
                pi, pj = i + 1, j + 1
            if pi or pj:
                _align(a2[pi:], b2[pj:], ao + h + pi, bo + h + pj, out)
    out.extend((ao + len(a) - t + x, bo + len(b) - t + x) for x in range(t))
    return out


def _normalize(pairs, keys, mk):
    """並べ方が複数あるときの決め（K18 の 3。試験で縛る）: 同じ中身（鍵）の行が並んだ行の隣の隙間にもあれば、
    M（いまのメモ帳）はいちばん前の行に、C（前のメモ帳）はいちばん後ろの行に並べ直す。末尾の行を新しい行に残し、
    新しく足した行が古い消えた行に吸われないため。"""
    for idx in range(len(pairs)):
        i, j = pairs[idx]
        lo = pairs[idx - 1][1] + 1 if idx else 0
        for j2 in range(lo, j):
            if mk[j2] == mk[j]:
                pairs[idx] = (i, j2)
                break
    for idx in range(len(pairs) - 1, -1, -1):
        i, j = pairs[idx]
        hi = pairs[idx + 1][0] if idx + 1 < len(pairs) else len(keys)
        for i2 in range(hi - 1, i, -1):
            if keys[i2] == keys[i]:
                pairs[idx] = (i2, j)
                break
    return pairs


def _prefer_same_raw(pairs, raws, mraw, n):
    """K24: 時刻の列を落とした鍵で並べたあと、組にした C の行と M の行のもとの行が違う（時刻の列が違う）とき、前後の組の
    間にある並ばなかった C の行に、M の行ともとの行まで同じ行があれば、そちらと組にし直す（いちばん後ろのもの）。
    同じように、末尾の隙間より前の並ばなかった M の行に、C の行ともとの行まで同じ行があれば、そちらと組にし直す。
    どちらも順は崩れず、並んだ行の数も変わらない（消えた行・間の行の知らせを、時刻の列まで違う行のほうに付ける）。"""
    pc = {i for i, _ in pairs}
    pm = {j for _, j in pairs}
    for idx, (i, j) in enumerate(pairs):
        if raws[i] == mraw[j]:
            continue
        lo = pairs[idx - 1][0] + 1 if idx else 0
        hi = pairs[idx + 1][0] if idx + 1 < len(pairs) else n
        for c in range(hi - 1, lo - 1, -1):
            if c not in pc and raws[c] == mraw[j]:
                pc.discard(i)
                pc.add(c)
                pairs[idx] = i, j = (c, j)
                break
        if raws[i] == mraw[j]:
            continue
        lo = pairs[idx - 1][1] + 1 if idx else 0
        hi = pairs[idx + 1][1] if idx + 1 < len(pairs) else j + 1   # 最後の組の後ろ（末尾の隙間）とは組にし直さない
        for c in range(lo, hi):
            if c not in pm and mraw[c] == raws[i]:
                pm.discard(j)
                pm.add(c)
                pairs[idx] = (i, c)
                break
    return pairs


KEPT_MIN = 3   # 「残った行」を名指すのは、消えた読み終えた行がこの数以上のときだけ（K26。2 行のメモ帳の書き換えで名指さない）


def plan_memo(sl, memo, g_now):
    """K18: いまのメモ帳の確定した行 memo（[(行番号, 前後の空白を除いた行, もとの行)]。これが M）を、前に見たメモ帳の行
    sl.entries（これが C）と消えた行の溜まり sl.pool に突き合わせ、書くものの並びを返す。各要素は、読み終えた行の変化の
    出来事（{"ev":"changed",…}。at は sync_memo が足す）か、新しい発話 {"new": j}（memo の添字）。g_now はこの保存の組の番号。
    行の中身は、時刻の列を落とした鍵（memo_key）で比べる（K24。並べる・寄せる・溜まり・spent のすべて）。

      1. 速い道: M の頭が C と鍵でちょうど同じなら、C の行はどれも同じ位置に並ぶ（残りは末尾の新しい行の候補）
      2. そうでなければ _align（共通の頭と尻を外し、真ん中を最長共通部分列で並べる）と _normalize、_prefer_same_raw
      3. 並ばなかった C の行は消えた行（発話を持つ行は溜まりへ。組は g_now）。並ばなかった M の行は、最後に並んだ行より
         後ろなら末尾の新しい行の候補、前なら読み終えた行の間の行
      4. 並んだ行のもとの行が違えば（時刻の列だけの直し）retimed（記録に効かない。K13・K24）
      5. ほかの並ばなかった M の行は、前から順に:
         - 末尾の候補で、並んだ C の行に、同じ中身で「戻した行と知らせた」行が残っていれば、知らせのとおり打ち直した行
           （新しい発話。K26。消えた行の覚えに同じ中身が残っていても組にしない）。その知らせた行の印を外し（retyped の
           paid）、溜まりと spent の同じ中身の行をすべて除く。除いた行があったときだけ、打ち直した行として知らせる。
           ただし同じ保存の末尾の候補に同じ中身の行がまだ続くなら、spent の 1 つだけを除き、残りはその行たちに回す
         - 溜まりに同じ中身の行があれば、新しいほうの 1 つと組にして戻した行（restored。拾わない）
         - 無ければ、末尾の候補は新しい発話、間の行は拾わない（inserted）。新しい発話の行の中身が spent にあれば、打ち直した
           行として知らせ、spent から除く（K26）。同じ保存の末尾の候補に同じ中身の行がまだ続くなら 1 つだけ、最後の行なら
           残りをすべて除く。だから同じ保存で同じ中身を何行打っても（消した行をまとめて元に戻しても）、spent に覚えが
           あった数まではどの行も名指し、この保存のあとは spent に同じ中身を残さない（次の保存からは知らせない）
      6. 組にした行と同じ組・同じ中身で溜まりに残った行は、もう組にしない（forget。spent へ移す）
      7. 発話を持つ行の半分以上が一度に消え（消えた読み終えた行の数 ≧ 並んだ読み終えた行の数）、消えた読み終えた行が
         KEPT_MIN 行以上の保存では、並んだ M の行をすべて名指す（kept。拾っていなかった間の行と並んだ行も。K26）。
         メモ帳を空にするのと同じ保存で打った行が、前の行と同じ中身で前の行とみなされたとき、黙って欠かさないため。
         名指した行と同じ中身でこの保存に消えた行も、もう組にしない（知らせのとおり末尾に打てば新しい発話になる）
    """
    ent = sl.entries
    raws = [e[0] for e in ent]
    mraw = [s for _, s, _ in memo]
    n, m = len(raws), len(mraw)
    if any(k is None for k in raws):
        # 中身を持たない古い素材ログ: 行の数で合わせる（前の版と同じ）
        return [{"new": j} for j in range(min(n, m), m)]
    keys = [memo_key(x) for x in raws]
    mk = [memo_key(x) for x in mraw]
    if mk[:n] == keys:
        pairs = [(i, i) for i in range(n)]
    else:
        pairs = _prefer_same_raw(_normalize(_align(keys, mk), keys, mk), raws, mraw, n)
    gaps = []
    pi = pj = 0
    for i, j in pairs + [(n, m)]:
        gaps.append((list(range(pi, i)), list(range(pj, j))))
        pi, pj = i + 1, j + 1
    last = len(gaps) - 1

    def line_of(j):
        return memo[j][0] if j < m else (memo[-1][0] + 1 if memo else 1)

    gone = [i for D, _ in gaps for i in D]
    pool = sl.pool.copy()
    for i in gone:
        if ent[i][1]:
            pool.add(g_now, raws[i])
    spent = sl.spent.copy()
    # 戻した行と知らせた行のうち、この保存でも並んで残っている行（鍵ごとに、M の位置の並び。K26）
    owed = {}
    for i, j in pairs:
        if ent[i][2]:
            owed.setdefault(keys[i], []).append(j)
    # 並ばなかった M の行を前から順に分ける。tail_left は、末尾の候補のうち、まだ分けていない行の数（鍵ごと）
    tail_left = {}
    for j in gaps[last][1]:
        tail_left[mk[j]] = tail_left.get(mk[j], 0) + 1
    cls, used = {}, []
    for q, (_, A) in enumerate(gaps):
        for j in A:
            x = mk[j]
            if q == last:
                tail_left[x] -= 1
            if q == last and owed.get(x):
                # 知らせのとおり打ち直した行: 新しい発話。同じ中身の消えた行の覚え（溜まりと spent）はすべて除く
                # （残すと、次に同じ中身を打ったときにまた戻した行とみなしてしまう）。除いた覚えがあったときだけ知らせる。
                # ただし、この保存の末尾に同じ鍵の行がまだ続くなら、spent の 1 つだけを除き、残りはその行たちに回す
                # （溜まりの覚えと組になれば戻した行、spent の覚えに当たれば打ち直した行として、どれも名指す）
                drop = spent.items(x)[-1:] if tail_left[x] > 0 else spent.items(x) + pool.items(x)
                for g, r in drop:
                    if spent.take(x, g) is None:
                        pool.take(x, g)
                cls[j] = ("new", drop, owed[x].pop())
                continue
            got = pool.take(x)
            if got is not None:
                cls[j] = ("restored", got[0])
                used.append((got[0], x))
            elif q == last:
                # spent の覚えは、この保存の同じ鍵の末尾の行に 1 つずつ配り、最後の行に残りをすべて渡す（どの行も名指し、
                # この保存のあとは spent に残さない。消した行をまとめて元に戻したとき、2 行目からが黙って二重にならないため）
                drop = spent.items(x)
                if tail_left[x] > 0:
                    drop = drop[-1:]
                for g, r in drop:
                    spent.take(x, g)
                cls[j] = ("new", drop, None)
            else:
                cls[j] = ("inserted",)
    ops = []
    # 消えた行（C の順。位置は、前の消去を当てたあとの位置）。続いて消えた行は、発話を持つかが同じあいだ 1 つの出来事
    removed = 0
    for q, (D, _) in enumerate(gaps):
        at_line = line_of(pairs[q - 1][1] + 1 if q else 0)
        run = None
        for i in D:
            u = bool(ent[i][1])
            if run is not None and run["_u"] == u and run["_next"] == i:
                run["was"].append(raws[i])
                run["_next"] = i + 1
            else:
                run = {"ev": "changed", "kind": "deleted", "line": at_line, "pos": i - removed, "was": [raws[i]], "now": [],
                       "g": g_now, "_u": u, "_next": i + 1}
                if not u:
                    run["u"] = False   # 拾っていなかった行（知らせない）
                ops.append(run)
            removed += 1
    # 書き直したメモ帳: 発話を持つ行の半分以上が一度に消え、消えた読み終えた行が KEPT_MIN 行以上なら、並んだ M の行を
    # すべて名指す（この保存の新しい発話より前に書き、その発話を渡す窓で知らせる）
    vanish = sum(1 for i in gone if ent[i][1])
    remain = sum(1 for i, _ in pairs if ent[i][1])
    kept = [j for _, j in pairs]
    kept_named = bool(kept) and vanish >= KEPT_MIN and vanish >= remain
    if kept_named:
        ops.append({"ev": "changed", "kind": "kept", "line": memo[kept[0]][0], "lines": [memo[j][0] for j in kept],
                    "pos": 0, "was": [], "now": []})
    # 組にした行と同じ組・同じ中身で、溜まりに残った行は忘れる（溜まりから取るのは組にした行の数だけなので、
    # 戻した行の出来事より前に書いてよい）
    drop = []
    for g, key in dict.fromkeys(used + ([(g_now, keys[i]) for i, _ in pairs] if kept_named else [])):
        drop.extend([g, r] for g, r in pool.items(key, g))
    if drop:
        ops.append({"ev": "changed", "kind": "forget", "pos": 0, "was": [], "now": [], "drop": drop})
    # 戻した行・間の行・新しい発話・時刻の列の直し（M の順。位置は、消去を当てたあとの並びの中。M の行 j を当てる時点の
    # 位置はちょうど j）
    p = 0
    for q, (_, A) in enumerate(gaps):
        run = None
        for j in A:
            c = cls[j]
            if c[0] == "new":
                run = None
                if c[1] or c[2] is not None:
                    # 打ち直した行の知らせ（除いた覚えがあるときだけ知らせになる）。paid は、知らせのとおり打ち直しを
                    # 受けた「戻した行」の位置（その行の印を外す。M の行 k を当てる時点の位置はちょうど k）
                    op = {"ev": "changed", "kind": "retyped", "line": memo[j][0], "lines": [memo[j][0]],
                          "pos": 0, "was": [], "now": [], "drop": [[g, r] for g, r in c[1]]}
                    if c[2] is not None:
                        op["paid"] = c[2]
                    ops.append(op)
                ops.append({"new": j})
            elif run is not None and run["kind"] == c[0] and run["_next"] == j:
                run["now"].append(mraw[j])
                run["lines"].append(memo[j][0])
                if c[0] == "restored":
                    run["from"].append(c[1])
                run["_next"] = j + 1
            else:
                run = {"ev": "changed", "kind": c[0], "line": memo[j][0], "lines": [memo[j][0]], "pos": p,
                       "was": [], "now": [mraw[j]], "_next": j + 1}
                if c[0] == "restored":
                    run["from"] = [c[1]]
                ops.append(run)
            p += 1
        if q < last:
            i, j = pairs[q]
            if raws[i] != mraw[j]:
                ops.append({"ev": "changed", "kind": "retimed", "line": memo[j][0], "pos": p,
                            "was": [raws[i]], "now": [mraw[j]]})
            p += 1   # 並んだ行
    for o in ops:
        o.pop("_next", None)
        o.pop("_u", None)
    return ops


CHANGE_JA = {"rewritten": "書き換わった", "deleted": "消えた", "split": "分かれた", "merged": "まとめられた",
             "retimed": "の時刻の列だけが書き換わった"}

# K18 の知らせの文（行番号だけを出す。行の中身は出さない）
RESTORED_TEXT = "消えた行と同じ中身なので、戻した行とみなして足していません（{line} 行目）。新しい発話なら、末尾にもう一度打ってください"
INSERTED_TEXT = "読み終えた行の間の行は拾いません（{line} 行目）。新しい発話なら、末尾に打ってください"
KEPT_TEXT = ("読み終えた行の半分以上が一度に消えました。残った行（{line} 行目）は読み終えた行と同じ中身なので、"
             "前からある行とみなして足していません。新しい発話なら、末尾にもう一度打ってください")
RETYPED_TEXT = ("消えた行と同じ中身ですが、末尾にもう一度打った行とみなして足しました（{line} 行目）。"
                "消した行を戻しただけなら、同じ発話が二重に入っています")
MEMO_TIME_TEXT = "メモ帳の時刻は使いません（届いた時刻で押します）"
RETIMED_HINT = "時刻の列だけの直しは記録に効きません（時刻は届いた時刻で押します）"

# 素材ファイルの知らせの文（ページの intake.js の NOTICE_TEXT と一字違わず同じ。K12）。1 つの窓の知らせは、
# 種類ごとに 1 文にまとめて行番号を並べる（この順に出す）
MATERIAL_KINDS = ("unreadable", "badbyte", "jump", "timehead")
MATERIAL_TEXT = {
    "unreadable": "読めない行があった（{lines}）。発話にしていない。時刻の書き方を確かめる",
    "badbyte": "読めないバイトを含む行（{lines}）。発話にしていない。素材の文字コードが UTF-8 かを確かめる",
    "jump": "時刻が飛んでいる行（{lines}）。前に戻った時刻は前の発話の時刻に揃え、10 分を超えて進んだ時刻はそのまま読んだ",
    "timehead": "時刻で始まる行は本文として読んだ（{lines}）。時刻の行にするなら、時刻だけを1行に書く",
}
MATERIAL_NOLINE = {"unreadable": "読めない行があった", "badbyte": "読めないバイトを含む行があった", "jump": "時刻が飛んでいる行があった",
                   "timehead": "時刻で始まる行は本文として読んだ"}


def line_list(xs):
    """行番号の並べ方（「2・3 行目」の 2・3 の所）。"""
    return "・".join(str(x) for x in xs)


def material_line_list(xs):
    """素材の知らせの行番号の並べ方（ページの lineList と同じ）: 最初の 5 つまで並べ、残りは数だけ
    （「2・3・4・5・6 行目ほか 15 行」）。"""
    return "・".join(str(x) for x in xs[:5]) + " 行目" + (f"ほか {len(xs) - 5} 行" if len(xs) > 5 else "")


def _lines_of(n):
    lines = n.get("lines")
    ok = isinstance(lines, list) and lines and all(_is_int(x) for x in lines)
    return line_list(lines) if ok else n.get("line")


def notice_text(n):
    """知らせの一言（行番号だけを出す。行の中身は出さない）。知らせにしない出来事は None。"""
    ev, line = n.get("ev"), n.get("line")
    if ev == "timecol":
        return MEMO_TIME_TEXT
    if ev == "changed":
        kind = n.get("kind")
        if (kind == "forget" or (kind == "deleted" and n.get("u") is False)
                or (kind == "retyped" and isinstance(n.get("drop"), list) and not n["drop"])):
            return None   # 溜まりを片付けただけ・拾っていなかった行が消えただけ・除いた覚えの無い打ち直し（印を外すだけ）
    if not _is_int(line):
        if ev in MATERIAL_KINDS:
            return MATERIAL_NOLINE[ev]
        return "読み終えた行が変わった" if ev == "changed" else None
    if ev in MATERIAL_KINDS:
        return MATERIAL_TEXT[ev].format(lines=material_line_list([line]))
    if ev == "changed":
        kind = n.get("kind")
        if kind == "restored":
            return RESTORED_TEXT.format(line=_lines_of(n))
        if kind == "inserted":
            return INSERTED_TEXT.format(line=_lines_of(n))
        if kind == "kept":
            return KEPT_TEXT.format(line=_lines_of(n))
        if kind == "retyped":
            return RETYPED_TEXT.format(line=_lines_of(n))
        if kind == "deleted":
            k = len(n["was"]) if isinstance(n.get("was"), list) else 1
            return f"読み終えた行が{f' {k} 行' if k > 1 else ''}消えた（いまの {line} 行目の手前）"
        if kind == "moved":   # 前の版の素材ログの出来事
            return f"読み終えた行が末尾へ動いた（{line} 行目）"
        return f"読み終えた行{'' if kind == 'retimed' else 'が'}{CHANGE_JA.get(kind, '書き換わった')}（{line} 行目）"
    return None


CHANGED_HINT = "読み終えた行は直せません。直した行や新しい行は、メモ帳の末尾に足してください"


def notice_hint(n):
    """読み終えた行が変わった知らせに添える説明の文（同じ文は 1 回だけ出す）。戻した行・間の行・残った行の文は、
    その文の中で何をすればよいかを言うので添えない。時刻の列だけの直しは、記録に効かないと言う（K13）。"""
    if n.get("ev") != "changed" or not notice_text(n):
        return None
    kind = n.get("kind")
    if kind in ("restored", "inserted", "kept", "retyped"):
        return None
    return RETIMED_HINT if kind == "retimed" else CHANGED_HINT


def notice_lines(notes):
    """知らせを人に見せる行にする。素材の知らせ（読めない行・時刻の飛び・時刻で始まる本文の行）は、種類ごとに
    1 文にまとめて行番号を並べる（ページの noticeSentences と同じ文。K12）。読み終えた行が変わった知らせは
    出来事ごとに 1 文で、同じ説明の文は 1 回だけ添える。同じ位置で続けて消えた行は 1 文にまとめて行数を言い
    （「読み終えた行が 3 行消えた（いまの 1 行目の手前）」）、ほかの一字違わず同じ文も 1 回だけ出す。"""
    by = {k: [] for k in MATERIAL_KINDS}
    noline = set()
    out, hints = [], []
    gone = {}
    for n in notes:
        if n.get("ev") == "changed" and n.get("kind") == "deleted" and n.get("u") is not False and _is_int(n.get("line")):
            gone[n["line"]] = gone.get(n["line"], 0) + (len(n["was"]) if isinstance(n.get("was"), list) and n["was"] else 1)
    for n in notes:
        ev = n.get("ev")
        if ev in by:
            line = n.get("line")
            if not _is_int(line):
                noline.add(ev)
            elif line not in by[ev]:
                by[ev].append(line)
            continue
        t = notice_text(n)
        if t and ev == "changed" and n.get("kind") == "deleted" and gone.get(n.get("line"), 0) > 1:
            t = f"読み終えた行が {gone[n['line']]} 行消えた（いまの {n['line']} 行目の手前）"
        if t and t not in out:
            out.append(t)
            h = notice_hint(n)
            if h and h not in hints:
                hints.append(h)
    head = []
    for k in MATERIAL_KINDS:
        if by[k]:
            head.append(MATERIAL_TEXT[k].format(lines=material_line_list(sorted(by[k]))))
        elif k in noline:
            head.append(MATERIAL_NOLINE[k])
    return head + out + hints


MEMO_READ_FAILS = 5    # watch がメモ帳を続けてこの回数読めなかったら知らせる（1 回だけ。K27）
MEMO_SETTLE_SEC = 0.3  # 読み終えた行が変わって見えたとき、もう一度読むまでの間（書き込みの途中を見ていないか確かめる）
TAIL_SETTLE_SEC = 2    # 改行の無い最後の行が同じ中身のままこの秒数続いたら、発話として確定する（ページの打つ入口と同じ）


def _memo_now(sl, raw, tail_state=None, now_sec=None, with_tail=False):
    """メモ帳の中身 raw から、突き合わせる確定した行を返す。書き込みの途中に見えたら None。

    改行で終わっていない最後の行: tail_state（watch が持つ {"key","since"}）で、同じ中身が続いた時間を見て、
    now_sec − since が TAIL_SETTLE_SEC 以上なら確定した行に入れる。前に見たメモ帳の同じ位置の行と同じ中身なら
    （エディタが最後の改行を消しただけ）入れる。前に見たメモ帳より行が少なく、その位置の行と違う中身なら、書き換えの
    途中なので None（落ち着くまで何もしない）。with_tail が真なら、確定していなくても入れる（memo_pending の数え方）。
    """
    memo, tail = parse_memo(raw, with_tail=True)
    keys = sl.keys
    if tail is not None:
        key = tail[1]
        p = len(memo)
        stable = with_tail
        if tail_state is not None and now_sec is not None:
            if tail_state.get("key") != key:
                tail_state["key"], tail_state["since"] = key, now_sec
            stable = stable or now_sec - tail_state["since"] >= TAIL_SETTLE_SEC
        if stable or (p < len(keys) and keys[p] == key):
            memo = memo + [tail]
        elif p < len(keys):
            return None
    elif tail_state is not None:
        tail_state["key"] = None
    return memo


def sync_memo(memo_path, srclog, t0_sec, at, settle=MEMO_SETTLE_SEC, tail_state=None, now_sec=None):
    """watch の 1 回分: メモ帳を素材ログと突き合わせ（plan_memo。K18）、新しい行を発話として、読み終えた行の変化を
    出来事として素材ログに足す。足した行（出来事を含む）を返す。メモ帳が書き込みの途中に見えたときは何もせずに
    None を返す（次の回に読み直す）。メモ帳が前に見たときと同じなら何も書かない（同じ出来事は二度書かない）。

    発話の時刻は、届いた時刻（at − 聞き始め。整数の秒に切り捨て）。メモ帳に打った時刻は使わない（memo_kind）。
    時計が戻ったときだけ、前の発話の時刻に揃える。発話の行には、メモ帳の行番号 line ともとの行 raw も残す
    （raw は突き合わせに使う）。1 列目の時刻を落とした行が初めて来たときは、その発話の前に {"ev":"timecol"} を残す
    （「メモ帳の時刻は使いません」の知らせ。1 回だけ）。

    読み終えた行が変わって見えたとき（消去など）は、settle 秒おいてもう一度読み、同じ中身のときだけ当てる。
    エディタが保存の途中でファイルを短くしている所を読むと、末尾の行が消えたように見えるため。後ろに行が足された
    だけなら待たない。メモ帳が見つからない・フォルダのときも None（K27。watch が memo_problem で知らせる）。
    """
    if memo_problem(memo_path):
        return None   # 見つからない・フォルダ（K27）: 空のメモ帳とみなさない（読み終えた行がすべて消えたことにしない）
    records = load_jsonl(srclog)
    sl = read_srclog_records(records)
    raw = read_memo_bytes(memo_path)
    memo = _memo_now(sl, raw, tail_state, now_sec)
    if memo is None:
        return None
    ops = plan_memo(sl, memo, len(records) + 1)
    if settle and any("ev" in o for o in ops):
        time.sleep(settle)
        if read_memo_bytes(memo_path) != raw:
            return None
    now_t = max(0, int(math.floor(iso_sec(at) - t0_sec)))
    prev = sl.utts[-1]["t"] if sl.utts else None
    i = sl.utts[-1]["i"] if sl.utts else 0
    said = sl.timecol
    out = []
    for o in ops:
        if "ev" in o:
            out.append(dict(o, at=at))
            continue
        lineno, s, line = memo[o["new"]]
        kind, who, text = memo_kind(line)
        if kind == "timecol" and not said:
            out.append({"ev": "timecol", "line": lineno, "at": at})
            said = True
        prev = _monotone_t(now_t, prev)
        i += 1
        out.append({"i": i, "t": prev, "who": who, "text": text, "at": at, "line": lineno, "raw": s})
    if out:
        data = "".join(dumps(u) + "\n" for u in out).encode("utf-8", "backslashreplace")
        with open(srclog, "ab") as f:
            f.write(data)
    return out


def memo_problem(memo_path, memo_name=None):
    """メモ帳が読めないわけ（K27。見つからない・フォルダ）か None（ファイルとして在る）。watch はこのあいだメモ帳を
    突き合わせない（無いメモ帳を空のメモ帳とみなすと、読み終えた行がすべて消えたことになるため）。next・next --last は
    この文を窓に知らせる。"""
    name = memo_name or memo_path
    try:
        if os.path.isdir(memo_path):
            return f"メモ帳 {name} はフォルダです（メモ帳はファイルの名前で渡します。watch はファイルになるまでメモ帳を読みません）"
        if not os.path.isfile(memo_path):
            return (f"メモ帳 {name} が見つかりません（watch はメモ帳が見つかるまで待ち、そのあいだメモ帳の行を素材ログに足しません。"
                    "名前と場所を確かめてください）")
    except (OSError, ValueError):
        return f"メモ帳 {name} が見つかりません（名前と場所を確かめてください）"
    return None


def memo_unreadable(memo_path, memo_name=None):
    """メモ帳がファイルとして在るのに開けないわけ（ほかのアプリが掴んでいる・権限が無い）か None（8 回目の確かめ）。
    next・next --last はこの文を窓に知らせ、next --last と end は開けるようになるまで断る（開けない間に打った行が、
    知らせ無しに記録から欠けないように）。watch は今までどおり、続けて読めないときだけ知らせて読み直す。"""
    name = memo_name or memo_path
    try:
        if not os.path.isfile(memo_path):
            return None
        with open(memo_path, "rb"):
            pass
    except (OSError, ValueError):
        return (f"メモ帳 {name} を開けません（ほかのアプリが掴んでいる・権限が無い、など）。"
                "開けない間に打った行は、まだ素材ログに入っていません")
    return None


PENDING_KINDS = ("restored", "inserted", "kept", "deleted", "retimed", "rewritten", "split", "merged")


def memo_pending(log, memo_name, tail=False, only_new=False):
    """メモ帳に、素材ログへまだ入っていない変化がいくつあるか（K25。読むだけ。書かない）。

    plan_memo の結果のうち、新しい発話と、読み終えた行の変化の出来事（戻した行・間の行・残った行・消えた行・時刻の列の
    直し）を数える（溜まりの片付け forget と打ち直しの知らせ retyped は、ほかの出来事に付くので数えない）。watch が
    書き終えれば 0 になる。tail が真なら、改行で終わっていない最後の行も、確定していなくても確定した行として突き合わせる
    （まだ素材ログに入っていなければ数に入る）。only_new が真なら新しい発話だけを数える（watch の始めの知らせ）。
    メモ帳が見つからない・読めないときは 0（memo_problem で知らせる）。
    """
    memo_path = find_src(log, memo_name) or memo_name
    if memo_problem(memo_path):
        return 0
    try:
        raw = read_memo_bytes(memo_path)
    except OSError:
        return 0
    sl = read_srclog(srclog_path(log))
    memo = _memo_now(sl, raw, with_tail=tail)
    if memo is None:
        memo = parse_memo(raw)
    return sum(1 for o in plan_memo(sl, memo, 0) if "new" in o or (not only_new and o.get("kind") in PENDING_KINDS))


# ---------------------------------------------------------------- live: watch の印

def watch_mark_path(log):
    p = Path(log)
    return p.with_name(log_stem(p) + WATCH_SUFFIX)


MARK_TRIES = 5          # watch の印の読み書きが OSError で落ちたときに試す回数（K23。Windows で置き換えの最中に掴まれる）
MARK_RETRY_SEC = 0.05


def read_watch_mark(log):
    """印の中身（辞書）か None（無い・読めない）。OSError と読みかけ（JSON として読めない）は、少し待って数回読み直す。"""
    p = watch_mark_path(log)
    for k in range(MARK_TRIES):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            return d if isinstance(d, dict) else None
        except FileNotFoundError:
            return None
        except RecursionError:
            return None
        except (OSError, ValueError):
            if k + 1 < MARK_TRIES:
                time.sleep(MARK_RETRY_SEC)
    return None


def watch_mark_foreign(log):
    """watch の印があり、印に書かれた判断ログの名前がこのログの名前と違えば、断るわけを返す（無ければ None）。

    印は <語幹>.watch.json に置き、中身に判断ログの名前（log。フォルダを除いた名前）を書く（K9）。名前の無い印
    （前の版の道具が書いた印など）も、このログの印とはみなさない。watch・next・append・end・pause が照らす。
    """
    p = watch_mark_path(log)
    if not os.path.lexists(p):
        return None
    d = read_watch_mark(log)
    mine = Path(log).name
    theirs = d.get("log") if isinstance(d, dict) else None
    if theirs == mine:
        return None
    if not isinstance(theirs, str):
        return (f"watch の印 {p.name} に判断ログの名前が書かれていないので、このログ {mine} の印とはみなしません"
                "（語幹が同じ別の判断ログの印かもしれません）。前の版の道具が残した印なら、その watch が止まっているのを"
                "確かめてから印を消し、watch を回し直してください")
    return (f"watch の印 {p.name} は別の判断ログ {theirs!r} のものです（このログ {mine} の印ではありません）。"
            "語幹が同じ別の判断ログの素材ログ・覚え書き・印は使えません")


def watch_alive(log, clock):
    """watch が回っているか: 印があり、その鼓動（beat）が clock から WATCH_STALE_SEC 秒以内。"""
    d = read_watch_mark(log)
    b = iso_sec_or_none(d.get("beat")) if d else None
    return b is not None and abs(iso_sec(clock) - b) < WATCH_STALE_SEC


def write_watch_mark(log, d):
    """印を書く（一時ファイル <印>.<番号>.tmp に書いて置き換える。読む側が書きかけを見ない）。書けたら真。
    OSError は少し待って数回やり直し、それでも書けなければ一時ファイルを消して偽を返す（落ちない。K23）。"""
    p = watch_mark_path(log)
    tmp = p.with_name(p.name + "." + d["token"] + ".tmp")
    for k in range(MARK_TRIES):
        try:
            tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, p)
            return True
        except OSError:
            if k + 1 < MARK_TRIES:
                time.sleep(MARK_RETRY_SEC)
    try:
        tmp.unlink()
    except OSError:
        pass
    return False


def drop_watch_mark(log, token):
    d = read_watch_mark(log)
    if d and d.get("token") == token:
        try:
            watch_mark_path(log).unlink()
        except OSError:
            pass


def log_ended(log):
    """判断ログの最後の行が end か（watch が自分で止まるため）。ログが無くなっていても真。"""
    p = Path(log)
    if not p.is_file():
        return True
    try:
        lines = [l for l in split_lines(p.read_bytes().decode("utf-8", "replace")) if l.strip()]
        return bool(lines) and loads(lines[-1]).get("e") == "end"
    except (ValueError, AttributeError, OSError):
        return False


def claim_watch_mark(log, mark, clock):
    """watch の印を取る。取れたら真。別の watch の印が新しい（clock から WATCH_STALE_SEC 秒以内）なら偽。

    印が無ければ、作るだけの開き方（既にあれば失敗する）で書く（2 つの watch が同時に始まっても片方だけが取る）。
    古い印（止まった watch が残したもの）は、印に書かれた判断ログの名前が自分と同じときだけ置き換え（K9）、
    置き換えたあとで読み直して自分の印かを確かめる。
    """
    p = watch_mark_path(log)
    data = json.dumps(mark, ensure_ascii=False).encode("utf-8", "backslashreplace")
    try:
        fd = os.open(str(p), os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    except FileExistsError:
        d = read_watch_mark(log)
        if d is None or d.get("log") != mark["log"]:
            return False
        if d.get("token") != mark["token"] and watch_alive(log, clock):
            return False
        if not write_watch_mark(log, mark):
            raise Fail(f"watch の印 {p.name} を書けません（ほかのアプリが掴んでいるか、書けない場所です）。少し待ってから watch を回し直してください")
        d = read_watch_mark(log)
        return bool(d) and d.get("token") == mark["token"]
    except OSError as ex:
        raise Fail(f"watch の印 {p.name} を作れません（{ex.strerror or type(ex).__name__}）。少し待ってから watch を回し直してください")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
    except OSError as ex:
        raise Fail(f"watch の印 {p.name} を書けません（{ex.strerror or type(ex).__name__}）。少し待ってから watch を回し直してください")
    return True


# ---------------------------------------------------------------- 規則表

class Rules:
    def __init__(self, d):
        self.d = d

    def version_of(self, open_ev):
        """open の v から版の鍵（"1"・"2"）を決める。規則表の versions.<版>.open_v に無い v は None。

        型も比べる（ページの verify.js の === と同じ）: true は 1 ではなく、"2" は 2 ではない。2.0 は 2。
        """
        v = open_ev.get("v") if isinstance(open_ev, dict) else None
        for key, col in self.d["versions"].items():
            if any(same_value(v, x) for x in col["open_v"]):
                return key
        return None

    def latest(self):
        """規則表の最後の版の鍵（知らない版を F07 で拒んだあと、検査を続けるための仮の版）。"""
        return list(self.d["versions"])[-1]

    def known_versions(self):
        return [v for col in self.d["versions"].values() for v in col["open_v"]]

    def col(self, ver):
        return self.d["versions"][ver]

    def enum(self, name, ver):
        ov = self.col(ver).get("enum_overrides", {})
        return ov.get(name) or self.d["enums"][name]

    def limit(self, key):
        return self.d["limits"].get(key)

    def spec(self, kind):
        return self.d["events"][kind]["fields"]


def type_ok(ty, v, rules, ver):
    """型だけを見る（null は呼び出し側が先に除く）。"""
    if ty == "int":
        return _is_int(v)
    if ty in ("num", "t"):
        return _is_num(v)
    if ty == "str":
        return isinstance(v, str)
    if ty == "bool":
        return isinstance(v, bool)
    if ty == "iso":
        return iso_ok(v)
    if ty.startswith("id:"):
        return isinstance(v, str) and v != ""
    if ty == "span":
        return (isinstance(v, list) and len(v) == 2 and _is_num(v[0])
                and (v[1] is None or _is_num(v[1])))
    if ty == "li":
        return isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and _is_int(v[1]) and v[1] >= 1
    if ty.startswith("arr:"):
        if not isinstance(v, list):
            return False
        return all(type_ok(ty[4:], x, rules, ver) for x in v)
    if ty == "any":
        return True
    return True


def id_pattern_ok(ty, v, rules):
    """id の形。文字列の頭から末尾まで当てる（re.match の $ は末尾の改行の手前でも当たるので fullmatch）。"""
    pat = rules.d["id_patterns"].get(ty[3:])
    return pat is None or (isinstance(v, str) and bool(re.fullmatch(pat, v)))


def normalize_ints(e, rules):
    """整数の欄（int・arr:int・li の番目）に小数点つきの整数で書かれた値を int に直した写しを返す。

    fix の now・was は、直す欄（field）の型で直す。整数でない値は直さない（型の検査が落とす）。
    """
    k = e.get("e")
    spec = rules.d["events"].get(k, {}).get("fields", {}) if isinstance(k, str) else {}
    out = dict(e)

    def conv(ty, v):
        if ty == "int":
            return _to_int(v)
        if ty == "arr:int" and isinstance(v, list):
            return [_to_int(x) for x in v]
        if ty == "li" and isinstance(v, list) and len(v) == 2:
            return [v[0], _to_int(v[1])]
        return v

    for f, fs in spec.items():
        if f in out and out[f] is not None:
            out[f] = conv(fs["type"], out[f])
    if e.get("e") == "fix" and isinstance(e.get("field"), str):
        target = rules.d.get("fix.target", {}).get(e["field"])
        fs = rules.d["events"].get(target, {}).get("fields", {}).get(e["field"]) if target else None
        if fs:
            for k in ("now", "was"):
                if k in out and out[k] is not None:
                    out[k] = conv(fs["type"], out[k])
    return out


# ---------------------------------------------------------------- 状態

class State:
    """ログの頭から順に当てて作る状態（検査・表示・pack に使う）。"""

    def __init__(self, rules):
        self.rules = rules
        self.ver = "1"
        self.col = rules.col("1")
        self.open_ev = None
        self.chunk = None
        self.window = None
        self.steps = []
        self.last_step = None
        self.last_pause = None
        self.ended = False
        self.cards = {}      # id -> カード（訂正を反映した現状）
        self.card_step = {}  # id -> 書いたステップ番号
        self.groups = {}
        self.holds = {}
        self.hold_step = {}
        self.closes = {}     # id -> [close]
        self.lists = {}
        self.list_at_item = {}
        self.top = None
        self.notes = []      # (n, x)
        self.errors = []     # (where, code, msg)
        self.warnings = []
        self.material = None  # callable(j) -> 発話 1〜j の一覧（素材があるときだけ）
        self._batch = None
        self._seq = None     # 欄の壊れた step の後: (読めた番号か None, 読めた範囲の終わりか None)。次の step はここから照らす

    # ---- 記録
    def err(self, where, code, msg):
        self.errors.append((where, code, clean_text(msg)))

    def warn(self, where, code, msg):
        self.warnings.append((where, code, clean_text(msg)))

    @staticmethod
    def lines(items):
        return _uniq([f"{w}: {c}: {m}" if w else f"{c}: {m}" for w, c, m in items])

    @staticmethod
    def short(items):
        # 同じ文は 1 回だけ出す（ログの行と追記の行が同じ理由で落ちると、場所を除いた文が同じになる）
        return _uniq([f"{c}: {m}" for _, c, m in items])

    # ---- 版
    def _set_version(self, open_ev, where):
        """open の v で版を決める。知らない v は F07（検査を続けるために規則表の最後の版を仮に当てる）。"""
        self.open_ev = open_ev
        ver = self.rules.version_of(open_ev)
        if ver is None:
            known = "・".join("無し" if v is None else str(v) for v in self.rules.known_versions())
            self.err(where, "F07", f"open の v {open_ev.get('v')!r} は知らない版です（受けるのは {known}）")
            ver = self.rules.latest()
        self.ver = ver
        self.col = self.rules.col(self.ver)
        # 窓の幅・行数は、型と値の範囲（欄の定義の min/max）に合うときだけ使う。合わない値は欄の検査が F02・F04 で
        # 拒むので、その値で窓の上限の文を作らない（「窓の幅は 0:03 まで」のような意味の無い文を出さない。落ちない）
        self.chunk = self._usable_int(open_ev, "chunk")
        self.window = self._usable_int(open_ev, "window")

    def _usable_int(self, open_ev, key):
        v = open_ev.get(key)
        fs = self.rules.spec("open").get(key, {})
        if not _is_int(v) or ("min" in fs and v < fs["min"]) or ("max" in fs and v > fs["max"]):
            return None
        return _to_int(v)

    def _src_name(self, e, where):
        """素材の名前（v2 の open.src）: 素材ファイルかメモ帳の名前（.txt・.tsv・.vtt。大小文字を問わない）だけを受ける。
        判断ログ・素材ログ・印・覚え書き（.jsonl・.json・.owner）や拡張子の無い名前を素材にすると、別のログの記録を
        素材として読めてしまう（捨てるログで本番の素材ログを読む道）。"""
        src = e.get("src")
        if not self.v2 or not isinstance(src, str):
            return
        exts = src_exts(self.rules)
        if not src_name_ok(src, exts):
            self.err(where, RULE_SRC, f"素材の名前 {name_tail(src)} は {'・'.join(exts)} で終わっていません"
                                      "（素材にできるのは素材ファイルとメモ帳だけ。判断ログ・素材ログ・印・覚え書きは素材にできません）")

    def _field_in_version(self, fs):
        """その欄がこの版の定義に入っているか（req が版の required_levels にあるか、任意の欄）。"""
        return fs["req"] == "opt" or fs["req"] in self.col["required_levels"]

    @property
    def v2(self):
        return self.col.get("sequential_ids", False)

    # ---- 採番
    def next_ids(self):
        return {"card": f"C{len(self.cards) + 1}", "hold": f"H{len(self.holds) + 1}",
                "group": col_name(len(self.groups) + 1), "list": f"L{len(self.lists) + 1}"}

    def open_holds(self):
        return [h for i, h in self.holds.items() if i not in self.closes]

    def settled(self):
        """決着までの秒（gap を除く）。"""
        return sorted(cs[0]["t"] - self.holds[i]["t"] for i, cs in self.closes.items()
                      if self.holds[i].get("kind") != "gap")

    # ---- バッチの区切り
    def begin_batch(self, where):
        self.end_batch()
        self._batch = {"where": where, "step": None, "counts": {}, "cards": [],
                       "open_before": {i for i in self.holds if i not in self.closes}}

    def end_batch(self):
        b = self._batch
        self._batch = None
        if not b or b["step"] is None:
            return
        where = b["where"]
        lo, hi = self.col["note_per_step"]
        n = b["counts"].get("note", 0)
        if (lo is not None and n < lo) or (hi is not None and n > hi):
            want = "ちょうど 1 件" if lo == hi == 1 else f"{lo} 件以上" + (f" {hi} 件以下" if hi is not None else "")
            self.err(where, "P17", f"note は1ステップに{want}です（{n} 件になっています）")
        if self.col["limits"]:
            for k in ("card", "hold", "close"):
                lim = self.rules.limit(f"batch.{k}")
                c = b["counts"].get(k, 0)
                if lim and c > lim["max"]:
                    self.err(where, "P23", f"1バッチの {LABEL[k]} は {lim['max']} 件までです（{c} 件になっています）")
        # P25: 前から開いている保留と、このバッチのカードの見出しの共通部分（保留×カードの組ごとに1件）
        k = self.rules.limit("warn.common_substring") or 4
        for hid in sorted(b["open_before"], key=lambda i: self.holds[i]["t"]):
            if hid in self.closes:
                continue
            q = self.holds[hid].get("q", "")
            for cid in b["cards"]:
                ti = self.cards[cid].get("ti", "")
                common = _common_substring(q, ti, k)
                if common:
                    self.warn(where, "P25", f"保留 {hid} の問いと カード {cid} の見出しに「{common}」が共通しています（閉じ忘れの疑い）")

    # ---- 1イベント
    def apply(self, e, where, incoming=False):
        """1イベントを検査して状態に反映する。戻り値は書き込む形（at を押した後など）。"""
        if not is_event(e):
            self.err(where, "F07", "イベントとして読めません（e が文字列の JSON オブジェクトではない）")
            return e
        # 整数の欄の 2.0 は 2 に直してから検査する（書くのも直した形）
        e = normalize_ints(e, self.rules)
        k = e["e"]
        if incoming and k in ("step", "end", "pause"):
            # 壁時計は道具が押す。分析役が書いた at は、欄の検査より前に捨てる（版に無ければ欄ごと落とす）
            e = {kk: vv for kk, vv in e.items() if kk != "at"}
            if k != "step" or (self.open_ev is not None and self.col["step_at"]):
                e["at"] = self._batch_clock
        if k == "open":
            if self.open_ev is not None or self.steps or self._batch is not None:
                self.err(where, "P01", "open を置けるのはログの 1 行目だけです")
                return e
            self._set_version(e, where)
            if self._fields_ok(e, where, incoming):
                self._limits(e, where)
                self._src_name(e, where)
            return e
        if self.open_ev is None:
            self.err(where, "P01", "ログの先頭は open です")
            return e
        if self.ended:
            self.err(where, "P21", "end の後には何も追記できません")
            return e
        if k not in self.col["kinds"]:
            self.err(where, "F07", f"{k!r} はこの版（v{self.ver}）に無い種類のイベントです")
            return e
        if k == "step":
            return self._step(e, where, incoming)
        if k in ("end", "pause"):
            return self._standalone(e, where, incoming)
        b = self._batch
        if b is None or b["step"] is None:
            if b is None or not b.get("bad_step"):
                self.err(where, "P02", "step の前に別のイベントが来ています（追記は step から始める）")
            return e
        # 件数（P17 の所感・P23 の上限）は欄の検査より前に数える（verify.js と同じ。欄の壊れた所感も 1 件。
        # 在るのに「0 件」と言わない。K17）
        b["counts"][k] = b["counts"].get(k, 0) + 1
        if not self._fields_ok(e, where, incoming):
            # 欄が壊れていても id は取る（verify.js と同じ）。後ろのイベントがこの id を指しても
            # P10 を重ねず、採番も先へ進める。違反は欄の検査が出している
            self._register_broken(e, where)
            return e
        step = b["step"]
        end = step["t"][1] if step.get("t") else None
        t = e.get("t")
        if _is_num(t) and end is not None and t > end:
            self.err(where, "P09", f"時刻 {fmt(t)} は、この窓の終わり {fmt(end)} を越えています（まだ聞いていない所）")
        self._position(e, where, step)
        self._limits(e, where)
        i = e.get("id")
        handler = getattr(self, "_ev_" + k)
        return handler(e, where, step, i)

    def _register_broken(self, e, where):
        """欄の検査に落ちた card/hold/group/list を、id だけ状態に取る（表示に要る欄は無難な値で埋める）。"""
        k, i = e["e"], e.get("id")
        if k not in ("card", "hold", "group", "list"):
            return
        if not isinstance(i, str) or not i:
            # id の欄そのものが壊れている（型・深さ・null）。採番のある版では、次に来るはずの id として取る
            # （後ろのイベントがその id を指しても P10・P13 を、次の id に P11 を重ねない。K17）。採番の無い版では取らない
            if not self.v2:
                return
            i = self.next_ids()[k]
        else:
            self._new_id(k, i, where)
        t = e.get("t") if _is_num(e.get("t")) else 0
        if k == "card":
            rec = {"t": t, "d": e.get("d") if _is_int(e.get("d")) else 0, "role": e.get("role") if isinstance(e.get("role"), str) else "claim",
                   "ti": e.get("ti") if isinstance(e.get("ti"), str) else "", "b": e.get("b") if isinstance(e.get("b"), str) else ""}
            self.cards[i] = {**e, **rec, "id": i}
            self.card_step[i] = self._batch["step"].get("n", 0) if self._batch and self._batch["step"] else 0
        elif k == "hold":
            self.holds[i] = {**e, "id": i, "t": t, "q": e.get("q") if isinstance(e.get("q"), str) else ""}
            self.hold_step[i] = self._batch["step"].get("n", 0) if self._batch and self._batch["step"] else 0
        elif k == "group":
            sp = e.get("span") if type_ok("span", e.get("span"), self.rules, self.ver) else [t, None]
            self.groups[i] = {**e, "id": i, "t": t, "span": sp, "lb": e.get("lb") if isinstance(e.get("lb"), str) else "",
                              "kind": e.get("kind") if isinstance(e.get("kind"), str) else "start"}
        else:
            items = e.get("items") if type_ok("arr:str", e.get("items"), self.rules, self.ver) else []
            self.lists[i] = {**e, "id": i, "t": t, "n": e.get("n") if _is_int(e.get("n")) else max(2, len(items)), "items": items}

    # ---- 欄の検査（F01〜F03・F05〜F07）
    def _fields_ok(self, e, where, incoming):
        k = e["e"]
        spec = self.rules.spec(k)
        ok = True
        label = LABEL[k] + (f" {e['id']}" if isinstance(e.get("id"), str) else "")
        # 値の入れ子は VALUE_DEPTH_MAX 段まで。超えた欄は F02 にして、その欄はほかの検査に回さない（落ちないため）
        deep = {key for key, v in e.items() if key != "e" and value_depth(v) > VALUE_DEPTH_MAX}
        for key in deep:
            self.err(where, "F02", f"{label} の {key} の値の入れ子が {VALUE_DEPTH_MAX} 段を超えています")
            ok = False
        if deep:
            e = {key: v for key, v in e.items() if key not in deep}
        if self.col["strict_keys"]:
            for key in e:
                if key != "e" and key not in spec:
                    self.err(where, "F05", f"{label} に知らない欄 {key!r} があります")
                    ok = False
        # 型の検査が数を見ない欄（any・知らない欄）にも、使えない数（有限でない・絶対値が 2^53−1 を超える）は置けない
        for key, v in e.items():
            if key != "e" and (key not in spec or spec[key]["type"] == "any") and has_nonfinite(v):
                self.err(where, "F02", f"{label} の {key} に使えない数があります（数は有限で、絶対値が 2^53−1 以下）")
                ok = False
        # 対になっていないサロゲート（欄の名前と中身。1 つの欄につき 1 件）。型は合っているので、
        # ほかの検査（型・形・上限・手続き）は続ける（ページの検査器と同じ。書かないことは違反があることで決まる）
        for key, v in e.items():
            if key != "e" and (_lone_surrogate(key) or has_lone_surrogate(v)):
                self.err(where, "F02", f"{label} の {key} に壊れた文字（対になっていないサロゲート）があります")
        for f, fs in spec.items():
            required = fs["req"] in self.col["required_levels"]
            if f in deep:
                continue   # 欄は在る（深すぎて F02 にした）。「〜がありません」とは言わない
            if f not in e:
                filled_by_tool = fs.get("tool_writes") or (fs.get("tool_fills") and self.col["fill_was"])
                if required and not (incoming and filled_by_tool):
                    self.err(where, "F01", f"{label} に {f} がありません")
                    ok = False
                continue
            v = e[f]
            if v is None:
                if not fs.get("null"):
                    self.err(where, "F02", f"{label} の {f} は null にできません")
                    ok = False
                continue
            if not type_ok(fs["type"], v, self.rules, self.ver):
                self.err(where, "F02", f"{label} の {f} の型が違います: {brief(v)}")
                ok = False
                continue
            # 配列の長さ（lines / t は必ず 2 つ）は形の一部なので、版に依らず見る
            if fs["type"].startswith("arr:") and isinstance(v, list) and (
                    ("min" in fs and len(v) < fs["min"]) or ("max" in fs and len(v) > fs["max"])):
                self.err(where, "F02", f"{label} の {f} の長さが違います（{len(v)} 件）")
                ok = False
                continue
            if "enum" in fs and v not in self.rules.enum(fs["enum"], self.ver):
                self.err(where, "F03", f"{label} の {f} が不正です: {brief(v)}")
                ok = False
            if self.col["id_patterns"]:
                ty = fs["type"]
                if ty.startswith("id:") and not id_pattern_ok(ty, v, self.rules):
                    self.err(where, "F06", f"{label} の {f} の id の形が違います: {brief(v)}")
                    ok = False
                if ty.startswith("arr:id:") and any(not id_pattern_ok(ty[4:], x, self.rules) for x in v):
                    self.err(where, "F06", f"{label} の {f} に形の違う id があります")
                    ok = False
                if ty == "li" and not id_pattern_ok("id:list", v[0], self.rules):
                    self.err(where, "F06", f"{label} の li の数え上げの id の形が違います: {v[0]!r}")
                    ok = False
        return ok

    # ---- 範囲と上限（F04）
    def _limits(self, e, where):
        """欄の定義の min/max（数）はどの版でも見る。文字数・件数の上限（limits）は版の列の limits が true のときだけ。"""
        k = e["e"]
        label = LABEL[k] + (f" {e['id']}" if isinstance(e.get("id"), str) else "")
        for f, fs in self.rules.spec(k).items():
            if f not in e or e[f] is None:
                continue
            v = e[f]
            if (_is_num(v) and (k, f) not in PROCEDURAL_MIN and self._field_in_version(fs)):
                if "min" in fs and v < fs["min"]:
                    self.err(where, "F04", f"{label} の {f} は {fs['min']} 以上です（{v} になっています）")
                if "max" in fs and v > fs["max"]:
                    self.err(where, "F04", f"{label} の {f} は {fs['max']} 以下です（{v} になっています）")
            if not self.col["limits"]:
                continue
            lim = self.rules.limit(f"{k}.{f}")
            if lim and isinstance(v, str):
                if len(v) > lim["max"]:
                    self.err(where, "F04", f"{label} の {f} が {lim['max']} 字を超えています")
                elif len(v) < lim["min"]:
                    self.err(where, "F04", f"{label} の {f} が空です")
            lim2 = self.rules.limit(f"{k}.{f}[]")
            if lim2 and isinstance(v, list):
                for x in v:
                    if isinstance(x, str) and (len(x) > lim2["max"] or len(x) < lim2["min"]):
                        self.err(where, "F04", f"{label} の {f} の項目は {lim2['min']}〜{lim2['max']} 字です: {x!r}")

    # ---- step
    def _step(self, e, where, incoming):
        self.begin_batch(where)
        if not self._fields_ok(e, where, incoming):
            self._batch["bad_step"] = True
            # 欄の壊れた step（違反は欄の検査が出している）。続くイベントは、読める所だけを文脈にして検査し
            # （id を取り、t が読めなければ P09 などを、lines が読めなければ src の範囲・話者・位置を飛ばす）、
            # 次の step の番号・範囲は、読めた所から照らす。読めなかった所は照らさない（K17。F02 に、
            # 「ステップ番号は 1 のはず」「発話は 1 番目から」「id は C1 のはず」の連鎖した文を重ねない。拒むことは変わらない）
            t_ok = _pair_of(e.get("t"), _is_num)
            n_ok = _is_int(e.get("n"))
            lines_ok = _pair_of(e.get("lines"), _is_int)
            part = {"e": "step", "n": _to_int(e["n"]) if n_ok else 0,
                    "lines": [_to_int(x) for x in e["lines"]] if lines_ok else None,
                    "t": list(e["t"]) if t_ok else None}
            self._batch["step"] = part
            self._seq = (part["n"] if n_ok else None, part["lines"][1] if lines_ok else None)
            if n_ok and lines_ok and t_ok:
                self.last_step = dict(part, at=e.get("at") if iso_ok(e.get("at")) else None)
            return e
        n, lines, t = e["n"], e["lines"], e["t"]
        prev = self.last_step
        # 番号と範囲は、直前の step（欄の壊れた step も、読めた所は数える）の続き。読めなかった所は照らさない
        seq_n, seq_end = self._seq if self._seq is not None else ((prev["n"], prev["lines"][1]) if prev else (0, 0))
        want_n = None if seq_n is None else seq_n + 1
        if want_n is not None and n != want_n:
            self.err(where, "P03", f"ステップ番号は {want_n} のはずです（{n} になっています）")
        want_start = None if seq_end is None else seq_end + 1
        if want_start is not None and lines[0] != want_start:
            self.err(where, "P04", f"発話は {want_start} 番目から続けて読みます（{lines[0]} 番目からになっています）")
        if lines[1] < lines[0]:
            self.err(where, "P04", "発話の範囲が逆です")
        if self.col["cut"] == "chunk":
            if self.chunk and lines[1] - lines[0] + 1 > self.chunk:
                self.err(where, "P05", f"一つの窓で読める行は chunk の {self.chunk} 行までです（{lines[1] - lines[0] + 1} 行あります）")
            if prev is not None and self.chunk and prev["lines"][1] - prev["lines"][0] + 1 < self.chunk:
                self.err(where, "P05", f"chunk（{self.chunk} 行）より少なく読めるのは、素材の最後の窓だけです（前の窓が短い）")
            if t[1] < t[0]:
                self.err(where, "P05", "t の終わりが始まりより前です")
            if prev is not None and t[0] < prev["t"][0]:
                self.err(where, "P06", "窓の始まりが、一つ前の窓の始まりより手前です")
        else:
            cap = self.rules.limit("step.max_lines") or MAX_LINES
            if t[1] < t[0] or (t[1] == t[0] and not (self.col["limits"] and lines[1] - lines[0] + 1 == cap)):
                # 幅 0 の窓は、上限の件数で切って窓の終わりを縮めたときだけ（同じ時刻の発話が上限より多く続く）
                self.err(where, "P05", "窓の終わりは始まりより後です（同じにできるのは、発話が上限の件数ちょうどで切った窓だけ）")
            factor = self.rules.limit("step.width_factor") or 3
            if self.window and t[1] - t[0] > self.window * factor:
                self.err(where, "P05", f"窓の幅は {fmt(self.window * factor)} までです（{fmt(t[1] - t[0])} になっています）")
            if prev is not None and t[0] < prev["t"][1]:
                self.err(where, "P06", f"窓の始まり {fmt(t[0])} が直前の窓の終わり {fmt(prev['t'][1])} より前です（窓は重なりません）")
            if self.last_pause is not None and t[0] < self.last_pause["t"]:
                self.err(where, "P06", f"窓の始まり {fmt(t[0])} が中断した {fmt(self.last_pause['t'])} より前です")
            # 1 つの窓に入る発話の数（limits の版）。時刻の巻き戻り・飛びで、窓が素材の残りを丸ごと渡さないため
            if self.col["limits"] and lines[1] - lines[0] + 1 > cap:
                self.err(where, "P05", f"1つの窓に入る発話は {cap} 件までです（{lines[1] - lines[0] + 1} 件になっています）")
        if t[0] < 0:
            self.err(where, RULE_POS, f"窓の始まり {fmt(t[0])} が会議の始まり（0:00）より前です")
        if self.col["step_at"]:
            at = e.get("at")
            at_s = iso_sec_or_none(at)
            prev_s = iso_sec_or_none(prev.get("at")) if prev is not None else None
            if at_s is not None and prev_s is not None and at_s < prev_s:
                self.err(where, "P08", f"壁時計 {at} が直前のステップ {prev['at']} より前です")
            # P27: live の記録では、聞き終える前（聞き始め＋窓の終わりより前）に判断を押せない
            if self.col.get("live_at_after_heard", self.col["step_at"]) and self.open_ev.get("mode") == "live":
                t0_s = iso_sec_or_none(self.open_ev.get("t0"))
                if at_s is not None and t0_s is not None and at_s - t0_s < t[1]:
                    since = (f"聞き始め {self.open_ev['t0']} より前で" if at_s < t0_s
                             else f"聞き始め {self.open_ev['t0']} から {fmt_sec(at_s - t0_s)} で")
                    self.err(where, RULE_HEARD,
                             f"壁時計 {at} は{since}、窓の終わり {fmt(t[1])} をまだ聞き終えていません（聞き終える前に判断は押せません）")
        self._limits(e, where)
        self._batch["step"] = e
        self.last_step = e
        self._seq = None
        self.last_pause = None
        self.steps.append(e)
        return e

    _batch_clock = None

    def _standalone(self, e, where, incoming):
        k = e["e"]
        self.end_batch()
        if not self._fields_ok(e, where, incoming):
            return e
        self._limits(e, where)
        t = e["t"]
        if t < 0:
            self.err(where, RULE_POS, f"{LABEL[k]}の時刻 {fmt(t)} が会議の始まり（0:00）より前です")
        if self.last_step is not None and t < self.last_step["t"][1]:
            self.err(where, "P21" if k == "end" else "P22", f"{LABEL[k]}の時刻 {fmt(t)} が直前のステップの終わり {fmt(self.last_step['t'][1])} より前です")
        if k == "pause":
            # 中断は読み終えた所に置く。先に置くと、再開した窓がその間の発話をまとめて渡すことになる
            hi = self.last_step["t"][1] if self.last_step is not None else 0
            if t > hi:
                where_hi = f"直前のステップの終わり {fmt(hi)} " if self.last_step is not None else "聞き始め 0:00（まだステップが無い）"
                self.err(where, "P22", f"中断の時刻 {fmt(t)} が{where_hi}より後です（中断は読み終えた所にしか置けません）")
        if k == "end":
            self.ended = True
        else:
            self.last_pause = e
        return e

    # ---- 並びの位置（R1）
    def _position(self, e, where, step):
        """P29: 位置は後から動かせないので、置ける範囲を縛る。見ることごとに 1 件（ページの検査器と同じ数）。

        t ≧ 0（会議の始まりより上に置かない）。card.t は src の発話（聞いた範囲 1〜step.lines[1] の中で、
        素材から時刻を引けたもの）の時刻の最小以上・最大以下。close.t は閉じる保留の hold.t 以上
        （2つ目以降の答えも）。group.t ≧ span の始まりは P15 が見る。
        """
        k, t = e["e"], e.get("t")
        if not _is_num(t):
            return
        label = LABEL[k] + (f" {e['id']}" if isinstance(e.get("id"), str) else "")
        if t < 0:
            self.err(where, RULE_POS, f"{label} の時刻 {fmt(t)} が会議の始まり（0:00）より前です（並びの位置は上へ動かせません）")
        if k == "card" and self.v2 and isinstance(e.get("src"), list) and not e["src"]:
            # 位置は根拠の発話の時刻で決まる。根拠の無いカードは、どこにでも（先頭にも）置けてしまう
            self.err(where, RULE_POS, f"{label} の src が空です（根拠の発話を 1 つ以上指します。カードの位置は根拠の発話の時刻の間）")
        elif k == "card" and self.material is not None and isinstance(e.get("src"), list) and step.get("lines"):
            last = step["lines"][1]
            want = {x for x in e["src"] if _is_int(x) and 1 <= x <= last}
            ts = [u["t"] for u in self.material(last) if u.get("i") in want and _is_num(u.get("t"))] if want else []
            if ts and not (min(ts) <= t <= max(ts)):
                rng = fmt(min(ts)) + ("" if min(ts) == max(ts) else f"〜{fmt(max(ts))}")
                self.err(where, RULE_POS, f"{label} の時刻 {fmt(t)} が根拠の発話の時刻（{rng}）の外です（語られた位置に置きます）")
        elif k == "close":
            h = self.holds.get(e.get("id")) if isinstance(e.get("id"), str) else None
            if h is not None and _is_num(h.get("t")) and t < h["t"]:
                self.err(where, RULE_POS, f"{label} の時刻 {fmt(t)} が保留を開いた {fmt(h['t'])} より前です")

    # ---- 各イベント
    def _new_id(self, kind, i, where):
        if self.v2:
            want = self.next_ids()[kind]
            if i != want:
                self.err(where, "P11", f"{LABEL[kind]}の id は {want} のはずです（{i} になっています）")

    def _ev_card(self, e, where, step, i):
        self._new_id("card", i, where)
        if i in self.cards:
            self.err(where, "P12", f"カード {i} は既にあります")
        if "src" in e:
            if not e["src"] and not self.v2:
                # v2 は P29 で拒む（_position）。v1 は警告だけ
                self.warn(where, "P19", f"カード {i} の src が空です（根拠の発話を指してください）")
            for x in (e["src"] if step.get("lines") else []):
                if not (1 <= x <= step["lines"][1]):
                    self.err(where, "P19", f"カード {i} の src {x} は聞いた範囲（1〜{step['lines'][1]}）の外です")
        li = e.get("li")
        if li:
            lid, k = li
            if lid not in self.lists:
                self.err(where, "P10", f"カード {i} の li が指す数え上げ {lid} がありません")
            elif not (1 <= k <= self.lists[lid]["n"]):
                self.err(where, "P18", f"カード {i} の li の番目 {k} は数え上げ {lid} の範囲（1〜{self.lists[lid]['n']}）の外です")
            else:
                self.list_at_item[lid] = k
        self._who(e, where, step, f"カード {i}")
        self._hedge(e, where, i)
        self.cards[i] = dict(e)
        self.card_step[i] = step.get("n", 0)
        if self._batch:
            self._batch["cards"].append(i)
        return e

    def _ev_hold(self, e, where, step, i):
        self._new_id("hold", i, where)
        if i in self.holds:
            self.err(where, "P12", f"保留 {i} は既にあります")
        self._who(e, where, step, f"保留 {i}")
        self.holds[i] = dict(e)
        self.hold_step[i] = step.get("n", 0)
        return e

    def _ev_close(self, e, where, step, i):
        if i not in self.holds:
            self.err(where, "P13", f"保留 {i} はまだ開いていません（閉じる相手がありません）")
            return e
        for c in e.get("by", []):
            if c not in self.cards:
                self.err(where, "P10", f"決着 {i} の by が指すカード {c} がありません")
        self.closes.setdefault(i, []).append(dict(e))
        return e

    def _ev_fix(self, e, where, step, i):
        field = e["field"]
        target = self.rules.d["fix.target"][field]
        store = {"card": self.cards, "group": self.groups, "list": self.lists}[target]
        if i not in store:
            if i in self.cards or i in self.groups or i in self.lists:
                self.err(where, "P14", f"訂正の field {field} は{LABEL[target]}の欄ですが、{i} は{LABEL[target]}ではありません")
            else:
                self.err(where, "P10", f"訂正の対象 {i} がありません")
            return e
        cur = store[i]
        now = e["now"]
        fs = self.rules.spec(target)[field]
        if not type_ok(fs["type"], now, self.rules, self.ver):
            self.err(where, "P14", f"訂正 {i} の now の型が {field} の欄に合いません: {brief(now)}")
            return e
        if "enum" in fs and now not in self.rules.enum(fs["enum"], self.ver):
            self.err(where, "P14", f"訂正 {i} の now が {field} の enum にありません: {brief(now)}")
        # 欄の定義の範囲（min/max）は、その版に在る欄なら版に依らず見る。v1 でも fix(d) に負は書けない
        if _is_num(now) and self._field_in_version(fs):
            if "min" in fs and now < fs["min"]:
                self.err(where, "P14", f"訂正 {i} の {field} は {fs['min']} 以上です（{now} になっています）")
            if "max" in fs and now > fs["max"]:
                self.err(where, "P14", f"訂正 {i} の {field} は {fs['max']} 以下です（{now} になっています）")
        if field == "span":
            if now[0] > cur["t"]:
                self.err(where, "P14", f"括り {i} の始まり {fmt(now[0])} が印の時刻 {fmt(cur['t'])} より後です")
            if now[1] is not None and now[1] < now[0]:
                self.err(where, "P14", f"括り {i} の span が逆です")
            if now[1] is not None and step.get("t") and now[1] > step["t"][1]:
                self.err(where, "P14", f"括り {i} の終わり {fmt(now[1])} は、まだ聞いていない所を指しています")
        if field == "items":
            if len(now) > cur["n"]:
                self.err(where, "P14", f"数え上げ {i} の items は n（{cur['n']}）件以下です")
            lim2 = self.rules.limit("list.items[]") if self.col["limits"] else None
            if lim2:
                for j, x in enumerate(now, 1):
                    if not (lim2["min"] <= len(x) <= lim2["max"]):
                        self.err(where, "P14", f"数え上げ {i} の {j} 件目は {lim2['min']}〜{lim2['max']} 字です（{len(x)} 字になっています）")
        if field == "n" and now < len(cur.get("items", [])):
            self.err(where, "P14", f"数え上げ {i} の n は items の件数（{len(cur['items'])}）以上です")
        if self.col["limits"]:
            lim = self.rules.limit(f"{target}.{field}")
            if lim and isinstance(now, str) and not (lim["min"] <= len(now) <= lim["max"]):
                self.err(where, "P14", f"訂正 {i} の now は {lim['min']}〜{lim['max']} 字です")
        if self.col["fill_was"]:
            if "was" in e:
                # JSON の文字列にして比べる（ページと同じ。false と 0 は別）
                if not same_json(e["was"], cur.get(field)):
                    self.err(where, "P14", f"訂正 {i} の was {dumps_safe(e['was'])} が現状 {dumps_safe(cur.get(field))} と違います")
            else:
                e = _insert_before(e, "now", "was", cur.get(field))
        store[i] = {**cur, field: now}
        return e

    def _ev_group(self, e, where, step, i):
        self._new_id("group", i, where)
        if i in self.groups:
            self.err(where, "P12", f"括り {i} は既にあります")
        sp = e["span"]
        if sp[0] > e["t"]:
            self.err(where, "P15", f"括り {i} の始まり {fmt(sp[0])} が印の時刻 {fmt(e['t'])} より後です")
        if sp[1] is not None:
            if step.get("t") and sp[1] > step["t"][1]:
                self.err(where, "P15", f"括り {i} の終わり {fmt(sp[1])} は、まだ聞いていない所を指しています")
            if sp[1] < sp[0]:
                self.err(where, "P15", f"括り {i} の span が逆です")
        self.groups[i] = dict(e)
        return e

    def _ev_rename(self, e, where, step, i):
        if i not in self.groups:
            self.err(where, "P10", f"括り {i} がありません")
            return e
        cur = self.groups[i]
        if self.col["fill_was"]:
            if "was" in e:
                if not same_json(e["was"], cur.get("lb")):
                    self.err(where, "P14", f"改名 {i} の was {dumps_safe(e['was'])} が現状 {dumps_safe(cur.get('lb'))} と違います")
            else:
                e = _insert_before(e, "now", "was", cur.get("lb"))
        self.groups[i] = {**cur, "lb": e["now"]}
        return e

    def _ev_echo(self, e, where, step, i):
        if i not in self.groups:
            self.err(where, "P10", f"括り {i} がありません")
        return e

    def _ev_top(self, e, where, step, i):
        if i not in self.cards:
            self.err(where, "P10", f"top が指すカード {i} は、まだ書かれていません")
        prev = self.top["id"] if self.top else None
        if e.get("prev") != prev:
            self.warn(where, "P16", f"top の prev が {e.get('prev')!r} で、いまの最上位候補 {prev!r} と合いません")
        self.top = dict(e)
        return e

    def _ev_note(self, e, where, step, i):
        self.notes.append((step.get("n", 0), e["x"]))
        return e

    def _ev_list(self, e, where, step, i):
        self._new_id("list", i, where)
        if i in self.lists:
            self.err(where, "P12", f"数え上げ {i} は既にあります")
        if e["n"] < 2:
            self.err(where, "P18", f"数え上げ {i} の n は 2 以上です（{e['n']} になっています）")
        if len(e["items"]) > e["n"]:
            self.err(where, "P18", f"数え上げ {i} の items は n（{e['n']}）件以下です")
        self._who(e, where, step, f"数え上げ {i}")
        self.lists[i] = dict(e)
        return e

    # ---- 補助の検査
    def _who(self, e, where, step, label):
        who = e.get("who")
        if who is None or self.material is None or not step.get("lines"):
            return
        seen = {u.get("who") for u in self.material(step["lines"][1]) if u.get("who")}
        if who not in seen:
            self.err(where, "P20", f"{label} の who {who!r} は聞いた範囲に出てきた話者ではありません")

    def _hedge(self, e, where, i):
        """P24: 推量語は欄ごと・語ごとに1件ずつ出す（verify.js と同じ数になる）。"""
        words = self.rules.limit("warn.hedge_words") or []
        for f in ("ti", "b"):
            v = e.get(f) or ""
            for w in words:
                if w in v:
                    self.warn(where, "P24", f"カード {i} の {f} に推量語「{w}」があります（予測は note に）")


def _insert_before(e, before, key, value):
    out = {}
    for k, v in e.items():
        if k == before:
            out[key] = value
        out[k] = v
    if key not in out:
        out[key] = value
    return out


def _common_substring(a, b, k):
    """a と b に共通する k 文字以上の部分（最長のもの）。無ければ None。"""
    best = ""
    for i in range(len(a)):
        for j in range(i + k, len(a) + 1):
            s = a[i:j]
            if s in b:
                if len(s) > len(best):
                    best = s
            else:
                break
    return best or None


# ---------------------------------------------------------------- 畳み込み

def fold(events, rules, upto=None, material=None):
    st = State(rules)
    st.material = material
    for idx, e in enumerate(events, 1):
        if (is_event(e) and e.get("e") == "step" and upto is not None
                and _is_num(e.get("n")) and e["n"] > upto):
            break
        st.apply(e, f"ログ{idx}行目")
    st.end_batch()
    return st


def check_batch(st, batch, clock, window=None):
    """バッチを状態に当てる（状態は変わる）。書き込む形のイベント列を返す。"""
    old_errors = len(st.errors)
    st._batch_clock = clock
    if not batch:
        st.err("入力", "P02", "入力が空です")
        return []
    # オブジェクトでない行（文字列・数・配列・null）と、e が文字列でない行は、落ちずに F07 で拒む
    bad = [idx for idx, e in enumerate(batch, 1) if not is_event(e)]
    if bad:
        for idx in bad:
            st.err(f"入力{idx}行目", "F07", "イベントとして読めません（e が文字列の JSON オブジェクトではない）")
        return batch
    first = batch[0].get("e")
    if st.ended:
        st.err("入力", "P21", "end の後には何も追記できません")
        return batch
    if st.open_ev is None:
        if first != "open":
            st.err("入力1行目", "P01", "空のログの 1 行目は open です（新しい記録は rt.py open で始めます）")
    elif first == "open":
        st.err("入力1行目", "P01", "open を置けるのはログの 1 行目だけです")
    elif first in ("end", "pause"):
        if len(batch) > 1:
            st.err("入力1行目", "P02", f"{LABEL[first]}（{first}）は1件だけの追記にします")
    elif first != "step":
        st.err("入力1行目", "P02", "追記の先頭は step です")
    else:
        # step の追記に end・pause を混ぜない（end・pause はそれ 1 件だけで追記する）
        for idx, e in enumerate(batch[1:], 2):
            if isinstance(e, dict) and e.get("e") in ("end", "pause"):
                st.err(f"入力{idx}行目", "P02", f"{LABEL[e['e']]}（{e['e']}）は1件だけの追記で書きます（step と同じ追記に混ぜられません）")
    if first == "open" and len(batch) > 1:
        st.err("入力2行目", "P02", "open は1件だけの追記にします（次に next で1ステップ目を出します）")
    if sum(1 for e in batch if e.get("e") == "step") > 1:
        st.err("入力", "P02", "一度に書き足せる窓は一つだけです（次の窓を見る前に、いまの窓を書き終える）")
    if len(st.errors) > old_errors:
        return batch
    out = []
    for idx, e in enumerate(batch, 1):
        where = f"入力{idx}行目"
        if e.get("e") == "step" and window is not None and _pair_of(e.get("t"), _is_num) and _pair_of(e.get("lines"), _is_int):
            if list(e["t"]) != list(window["t"]) or list(e["lines"]) != list(window["lines"]):
                st.err(where, "P07", f"道具が渡した窓は {fmt(window['t'][0])}〜{fmt(window['t'][1])}（発話 {window['lines'][0]}〜{window['lines'][1]}）ですが、"
                                     f"step は {show(e['t'])} / {show(e['lines'])} になっています")
        out.append(st.apply(e, where, incoming=True))
    st.end_batch()
    return out


# ---------------------------------------------------------------- 窓

def material_from_file(path):
    """素材ファイルから「発話 1〜j」を返す関数を作る（j までしか読まない）。"""
    def get(j):
        got = []
        for u in iter_utterances(path):
            if u["i"] > j:
                break
            got.append(u)
        return got
    return get


def material_from_list(utts):
    def get(j):
        return [u for u in utts if u["i"] <= j]
    return get


def _first_unread(st, it):
    """反復子 it から、まだ読んでいない最初の発話を取り出す（無ければ None）。"""
    first_i = st.last_step["lines"][1] + 1 if st.last_step else 1
    for u in it:
        if u["i"] >= first_i:
            return u
    return None


def _window_ends(start, w, factor):
    """窓の終わりとしてありうる値（start + w、start + 2w、… start + factor·w）。next と同じ足し算で作る。"""
    ends = [start + w]
    while len(ends) < factor:
        ends.append(ends[-1] + w)
    return ends


def compute_window(st, utts, now_t=None, live=False, end=None):
    """次に渡す窓を決める。戻り値 (t0, t1, lines, 発話, 閉じているか)。発話が無ければ None。

    utts は発話を順に返す反復子（先頭から）。必要なところまでしか読まない。
    窓の始まりは直前の step の t[1]（無ければ 0）。まだ読んでいない最初の発話がその窓より先にあるとき
    だけ、発話の無い窓を丸ごと飛ばす（窓の幅の倍数だけ進む）。
    窓に入るのは、まだ読んでいない発話を順に見て、時刻が窓の終わり以上の発話に当たる手前まで
    （終わりの時刻ちょうどの発話は、それが素材の最後の発話でも次の窓）。live で遅れて届いた、
    時刻が窓の始まりより前の発話も、届いた次の窓に入る。上限の件数で切ったときは、窓の終わりを
    渡さなかった最初の発話の時刻まで縮め、その時刻と同じ時刻の発話は窓に入れない（下の本文の注）。
    live で追いつかなければ最大 window×3 まで広げる。live の窓は、壁時計（now_t）が窓の終わりを
    過ぎたときにだけ閉じる。file の窓はいつも閉じている。
    end を渡すと、窓の終わりをその値に固定して計算する（append が覚え書きの窓を照らすとき）。
    """
    w = st.window or 30
    factor = st.rules.limit("step.width_factor") or 3
    it = iter(utts)
    u = _first_unread(st, it)
    if u is None:
        return None
    # pause.t は直前の step の t[1] を越えられない（P22）ので、中断は窓の始まりを動かさない
    start = st.last_step["t"][1] if st.last_step else 0
    if u["t"] >= start + w:
        start = start + w * int((u["t"] - start) // w)
    if end is None:
        ends = _window_ends(start, w, factor)
        end = ends[0]
        if now_t is not None:
            for e2 in ends[1:]:
                if now_t >= e2:
                    end = e2
    # 1 つの窓の発話は limits.step.max_lines 件まで（超えた分は次の窓）
    cap = st.rules.limit("step.max_lines") or MAX_LINES
    got = []
    while u is not None and u["t"] < end and len(got) < cap:
        got.append(u)
        u = next(it, None)
    closed = (now_t is not None and now_t >= end) if live else True
    if not got:
        return None
    if st.col["limits"] and len(got) == cap and u is not None and u["t"] < end:
        # 上限で切った窓は、窓の終わりを「渡さなかった最初の発話の時刻」T まで縮める（そこまでしか聞いていない）。
        # 渡さなかった最初の発話と同じ時刻の発話が窓の中にあれば、その同じ時刻の塊の手前で切る（窓は上限より
        # 少なくなる）。こうして t[0] ≦ 発話.t ＜ t[1] を道具が自分で破らない。塊が窓の最初の発話から始まる
        # （上限を超える発話がすべて同じ時刻）ときだけ、幅 0 の窓 [T, T] に上限ちょうど（P05 の例外。次の窓は
        # T から始まり、同じ時刻の残りを含む）。遅れて届いた発話（時刻が窓の始まりより前）で T が始まり以下のときも、
        # 幅 0 の窓 [始まり, 始まり] に上限ちょうど
        T = u["t"]
        k = next((x for x, g in enumerate(got) if g["t"] >= T), len(got))
        if k == 0:
            start = max(start, T)
            end = start
        elif T > start:
            got = got[:k]
            end = T
        else:
            end = start
    return start, end, [got[0]["i"], got[-1]["i"]], got, closed


def _pair_of(v, pred):
    return isinstance(v, list) and len(v) == 2 and all(pred(x) for x in v)


def check_window(st, source, live, side):
    """next が書いた覚え書きの窓を、素材から計算し直して照らす。戻り値 (窓, 違反文の一覧)。

    覚え書きは信じきらない。手で書いた覚え書きで窓を自分で決めることができないよう、
    窓の始まり・幅・発話の範囲を、素材（live は素材ログ、file は素材ファイル）から計算し直す。
    """
    if not isinstance(side, dict) or not _pair_of(side.get("t"), _is_num) or not _pair_of(side.get("lines"), _is_int):
        return None, ["道具が渡した窓がありません（素材のある記録では、先に next で窓を出してから append します。"
                      "next が「まだ閉じていません」と言う間は追記できません）"]
    t0, t1 = side["t"]
    l0, l1 = (_to_int(x) for x in side["lines"])
    shown = f"{fmt(t0)}〜{fmt(t1)}（発話 {l0}〜{l1}）"
    w = st.window or 30
    factor = st.rules.limit("step.width_factor") or 3
    last = side.get("last")
    if live and _is_num(last):
        # next --last が出した最後の窓: 終わりは窓の幅に依らない（そのときの時計）。その終わりで素材ログから
        # 計算し直して、始まり・終わり・発話の範囲がそのとおりのときだけ受ける（幅は window × 3 まで）
        r = compute_window(st, utts_iter(source), live=True, end=last)
        if r is not None and r[0] == t0 and r[1] == t1 and r[2] == [l0, l1] and t1 <= last <= t0 + w * factor:
            return {"t": [t0, t1], "lines": [l0, l1]}, []
        got = f"{fmt(r[0])}〜{fmt(r[1])}（発話 {r[2][0]}〜{r[2][1]}）" if r is not None else "無し"
        return None, [f"覚え書き（next --last が書いた最後の窓）が素材と合いません: 覚え書きの窓 {shown} は、"
                      f"素材ログから計算すると {got} です（next --last を打ち直してください）"]
    base = compute_window(st, utts_iter(source), live=live)
    if base is None:
        where = "素材ログ" if live else "素材"
        return None, [f"覚え書き（next が書いた窓）が素材と合いません: 覚え書きの窓 {shown} に当たる発話が{where}にありません"
                      f"（{where}に、まだ読んでいない発話が無い。窓は next だけが決めます）"]
    start = base[0]
    msgs = []
    if t0 != start:
        msgs.append(f"覚え書きの窓の始まり {fmt(t0)} は、素材から計算すると {fmt(start)} です"
                    f"（直前のステップの終わりから始まり、発話の無い窓だけを飛ばす）")
    ends = _window_ends(start, w, factor) if live else [start + w]
    # 窓の終わりの候補ごとに、素材から窓を計算し直す（上限の件数で切った窓は、終わりが縮む）
    cands = []
    for e in ends:
        r = compute_window(st, utts_iter(source), live=live, end=e)
        if r is not None:
            cands.append((r[1], r[2]))
    if not msgs:
        if t1 not in ends and all(c[0] != t1 for c in cands):
            if live:
                msgs.append(f"覚え書きの窓の終わり {fmt(t1)} は、窓の幅 {fmt(w)} の 1〜{factor} 倍（"
                            + "・".join(fmt(x) for x in ends) + "）のどれでもなく、上限の件数で切って縮めた終わりでもありません")
            else:
                msgs.append(f"覚え書きの窓の終わり {fmt(t1)} は、素材から計算すると {fmt(cands[0][0] if cands else ends[0])} です（素材ファイルの窓の幅は {fmt(w)}）")
        elif (t1, [l0, l1]) not in cands:
            want = next((c[1] for c in cands if c[0] == t1), None)
            got = f"{want[0]}〜{want[1]}" if want else "無し"
            msgs.append(f"覚え書きの窓 {shown} の発話は、素材では {got} です（まだ読んでいない発話のうち、窓の終わりより前のものを先頭から上限の件数まで）")
    if msgs:
        return None, ["覚え書き（next が書いた窓）が素材と合いません: " + m for m in msgs]
    return {"t": [t0, t1], "lines": [l0, l1]}, []


# ---------------------------------------------------------------- pack

def build_pack(st, at, new=None, attempt=1, violations=None, gap_lines=None):
    s = st.last_step
    now_t = new["t"][1] if new else (s["t"][1] if s else 0)
    holds = []
    for h in sorted(st.open_holds(), key=lambda h: h["t"]):
        d = {"id": h["id"], "t": h["t"], "age": now_t - h["t"], "who": h.get("who"), "q": h.get("q")}
        if h.get("kind") == "gap":
            d["kind"] = "gap"
        holds.append(d)
    top = None
    if st.top:
        top = {"id": st.top["id"], "ti": st.cards.get(st.top["id"], {}).get("ti", "")}
    open_groups = [{"id": g["id"], "lb": g["lb"], "span": g["span"], "kind": g["kind"]}
                   for g in st.groups.values() if g["span"][1] is None]
    closed_groups = [{"id": g["id"], "lb": g["lb"], "span": g["span"]}
                     for g in reversed(list(st.groups.values())) if g["span"][1] is not None][:8]
    lists = [{"id": l["id"], "n": l["n"], "items": l["items"], "at_item": st.list_at_item.get(l["id"])}
             for l in st.lists.values()]
    recent = [{"id": c["id"], "t": c["t"], "d": c["d"], "role": c["role"], "who": c.get("who"), "ti": c["ti"]}
              for c in reversed(list(st.cards.values()))][:8]
    notes = [x for _, x in reversed(st.notes)][:3]
    durs = st.settled()
    settled = {"count": len(durs),
               "median": durs[(len(durs) - 1) // 2] if durs else None,
               "longest": durs[-1] if durs else None}
    pack = {
        "now": {"n": (s["n"] + 1) if s else 1, "t": now_t, "at": at},
        "known": (st.open_ev or {}).get("known", ""),
        "open_holds": holds,
        "top": top,
        "open_groups": open_groups,
        "closed_groups": closed_groups,
        "lists": lists,
        "recent_cards": recent,
        "recent_notes": notes,
        "settled": settled,
        "next_ids": st.next_ids() if st.v2 else None,
        "attempt": attempt,
        "violations": violations or [],
        "gap_lines": gap_lines or [],
        "new": new,
    }
    return pack


def gap_lines_for(st, material):
    """開いている gap の保留が指す窓の発話。"""
    if material is None:
        return []
    out = []
    for h in st.open_holds():
        if h.get("kind") != "gap":
            continue
        n = st.hold_step.get(h["id"])
        step = next((s for s in st.steps if s["n"] == n), None)
        if step:
            utts = material(step["lines"][1])
            out.extend({"i": u["i"], "t": u["t"], "who": u.get("who"), "text": u.get("text", "")}
                       for u in utts if step["lines"][0] <= u["i"] <= step["lines"][1])
    return out


# ---------------------------------------------------------------- 表示

def print_status(st, batch=None):
    s = st.last_step
    if s is None:
        print("まだ窓を一つも書いていません。")
        return
    rng = f"{s['lines'][0]}〜{s['lines'][1]}行" if st.col["cut"] == "chunk" else f"発話 {s['lines'][0]}〜{s['lines'][1]}"
    print(f"=== S{s['n']}（{rng} / {fmt(s['t'][0])}〜{fmt(s['t'][1])}）の時点 ===")
    if batch is not None:
        cards = [e for e in batch if e.get("e") == "card"]
        print(f"\n今回の窓のカード（{len(cards)}枚）")
        for c in cards:
            who = f" {c['who']}" if c.get("who") else ""
            print(f"  {c['id']} {fmt(c['t'])} d{c['d']} [{ROLE_JA.get(c['role'], c['role'])}]{who} {c['ti']}")
        for c in [e for e in batch if e.get("e") == "close"]:
            n = len(st.closes.get(c["id"], []))
            print(f"  → {c['id']} を閉じた" + (f"（{n}つ目の答え）" if n > 1 else ""))
        for g in [e for e in batch if e.get("e") == "group"]:
            print(f"  ◆ {g['id']} {KIND_JA.get(g['kind'], g['kind'])}括った: {g['lb']}")

    now = s["t"][1]
    durs = st.settled()
    med = durs[(len(durs) - 1) // 2] if durs else None
    longest = durs[-1] if durs else None
    opened = sorted(st.open_holds(), key=lambda h: h["t"])
    gaps = [h for h in opened if h.get("kind") == "gap"]
    opened = [h for h in opened if h.get("kind") != "gap"]
    print(f"\n開いている保留（{len(opened)}件）" + ("──今回のカードで決着した保留は無いか" if batch is not None and opened else ""))
    for h in opened:
        age = now - h["t"]
        mark = ""
        if len(durs) >= 3:
            if age > longest:
                mark = f"  ★これまでに閉じたどの保留より長く開いている（最長 {fmt(longest)}）"
            elif age > med:
                mark = f"  ・閉じるまでの中央値（{fmt(med)}）を越えた"
        who = f"（{h['who']}）" if h.get("who") else ""
        print(f"  {h['id']:<4} {fmt(h['t'])}から {fmt(age)}{mark}\n       {h['q']}{who}")
    if gaps:
        print(f"\n未確定の窓（{len(gaps)}件）──次の窓で gap_lines を読み直して閉じられる")
        for h in gaps:
            print(f"  {h['id']:<4} {h['q']}")
    if durs:
        print(f"\n閉じた保留 {len(durs)}件（閉じるまでの中央値 {fmt(med)}・最長 {fmt(longest)}）")
    if st.top:
        c = st.cards.get(st.top["id"], {})
        print(f"最上位候補: {st.top['id']} {c.get('ti', '')}")
    for l in st.lists.values():
        k = st.list_at_item.get(l["id"])
        items = "／".join(l["items"]) if l["items"] else "（項目は未定）"
        where = f"いま {k} 番目" if k else "まだどれにも入っていない"
        print(f"数え上げ {l['id']}: {l['n']} 点のうち {where}（{items}）")
    og = [g for g in st.groups.values() if g["span"][1] is None]
    if og:
        print("開いている章: " + " / ".join(f"{g['id']} {g['lb']}（{fmt(g['span'][0])}〜）" for g in og))
    if st.v2:
        n = st.next_ids()
        print(f"次の id: カード {n['card']} / 保留 {n['hold']} / 括り {n['group']} / 数え上げ {n['list']}")


def print_warnings(st):
    for w in State.lines(st.warnings):
        print("注意:", w)


def fail_errors(st, head, code=EXIT_REJECT):
    print(head, file=sys.stderr)
    for x in State.lines(st.errors):
        print("  " + x, file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------- 入出力

class BadReply(Fail):
    """返事（バッチ）が読めない・形が違う。道具が渡した窓があるときは、同じ窓の1回に数える。
    code があれば違反の番号として出す（入れ子が深すぎる F02 など）。"""

    def __init__(self, msg, code=None):
        super().__init__(msg)
        self.code = code


def decode_reply(data):
    """返事のバイト列を UTF-8 として読む（先頭の BOM は捨てる）。読めなければ BadReply（同じ窓の1回に数える）。"""
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise BadReply(f"入力が UTF-8 として読めません（{e.start + 1} バイト目）")


def read_batch_file(path):
    return parse_batch(decode_reply(Path(path).read_bytes()))


FENCE = "```"


def unwrap_fence(raw):
    """入力の前後の空白を除いて ``` で始まり ``` で終わるなら、1 回だけ外す（開きの直後の json は捨てる）。
    外したものをもう一度は外さない（ページの読み方と同じ）。"""
    s = raw.strip(WS_CHARS)
    if len(s) >= 2 * len(FENCE) and s.startswith(FENCE) and s.endswith(FENCE):
        inner = s[len(FENCE):-len(FENCE)]
        return inner[4:] if inner.startswith("json") else inner
    return raw


def parse_batch(raw):
    """JSONL か、分析役の返事（1つの JSON オブジェクト）。返事は ('reply', obj) で返す。読めなければ BadReply。

    全体を ``` で 1 回包んであれば外す。外したあとの全体が 1 つの JSON オブジェクトで、e の欄が無ければ返事。
    そうでなければ 1 行 1 イベントの JSONL として読む。入れ子が PARSE_DEPTH_MAX を超える入力は、
    読む前に F02 で断る（読む道具が落ちないように）。
    """
    raw = unwrap_fence(raw)
    # 前後の空白は、JS の String.prototype.trim と同じ集まり（WS_CHARS）で除く（ページの読み方と同じ。囲みの内側も）
    stripped = trim(raw)
    if not stripped:
        raise BadReply("入力が空です")
    if text_depth(stripped) > PARSE_DEPTH_MAX:
        # JSON として読む前に、文字列の外の [ と { の入れ子を数えて断る（ページも同じ。読む道具が落ちないように）
        raise BadReply(f"入力: 文字の入れ子（文字列の外の [ と {{）が {PARSE_DEPTH_MAX} 段を超えています（JSON として読む前に断ります）",
                       code="F02")
    try:
        obj = loads(stripped)
    except ValueError:
        obj = None
    if isinstance(obj, dict) and "e" not in obj:
        return "reply", obj
    batch = []
    for i, line in enumerate(split_lines(raw), 1):
        if trim(line):
            try:
                batch.append(loads(line))
            except ValueError as e:
                raise BadReply(f"入力の {i} 行目が JSON として読み取れません: {e}")
    return "jsonl", batch


def reply_to_batch(obj, st, window):
    """分析役の返事を JSONL のバッチに直す。n・lines・note.t は道具が埋める。形が違えば BadReply。"""
    if window is None:
        raise Fail("道具が渡した窓が分からないので lines を埋められません（先に next を呼ぶか、JSONL で渡してください）")
    stp = obj.get("step")
    if not isinstance(stp, dict):
        raise BadReply("返事の step がありません（{\"t\":[始まり, 終わり]} のオブジェクトで書きます）" if "step" not in obj
                       else "返事の step がオブジェクトではありません（{\"t\":[始まり, 終わり]} のオブジェクトで書きます）")
    # events の欄が無い返事は、書くことの無い窓（events:[]）として読む。欄があって null なら読めない返事（ページと同じ）
    events = obj.get("events", [])
    if not isinstance(events, list):
        raise BadReply("返事の events が配列ではありません")
    if any(isinstance(x, dict) and x.get("e") == "note" for x in events):
        raise BadReply("返事の events に note があります（所感は events の外の note に 1 つだけ書きます）")
    note = obj.get("note")
    if note is not None and not isinstance(note, dict):
        raise BadReply("返事の note がオブジェクトではありません")
    # think は道具が埋める欄なので、返事に書かれていても捨てる（ページの読み方と同じ）
    step = {"e": "step", "n": (st.last_step["n"] + 1) if st.last_step else 1,
            "lines": list(window["lines"]), "t": stp.get("t")}
    # 返事の形（schema.json）では li が必須なので null で来る。記録では「無い」と同じなので欄ごと落とす
    events = [{k: v for k, v in e.items() if not (k == "li" and v is None)} if isinstance(e, dict) and e.get("e") == "card" else e
              for e in events]
    note = note or {}
    t_end = step["t"][1] if isinstance(step["t"], list) and len(step["t"]) == 2 else None
    batch = [step] + list(events)
    if "x" in note:
        batch.append({"e": "note", "t": t_end, "x": note["x"]})
    return batch


def write_events(log, events):
    """追記する行を全部組み立て、UTF-8 のバイト列にしてから 1 回で書く（途中で落ちて半端な行を残さない）。

    小数点つきの整数（30.0）は整数（30）で書く。ページの JSON.stringify と同じ形になる。
    書けない値（有限でない数・片割れのサロゲート）があれば、ファイルを開く前にここで落ちる
    （検査が先に F02 で拒むので、ここは最後の守り）。
    """
    data = "".join(dumps(_canon(e)) + "\n" for e in events).encode("utf-8")
    with open(log, "ab") as f:
        f.write(data)


def load_sidecar(log):
    p = sidecar_path(log)
    if not p.exists():
        return None
    try:
        d = loads(p.read_text(encoding="utf-8"))
    except ValueError:
        return None
    return d if isinstance(d, dict) else None


def save_sidecar(log, d):
    text = json.dumps(d, ensure_ascii=False, allow_nan=False)
    try:
        data = text.encode("utf-8")
    except UnicodeEncodeError:  # 片割れのサロゲートが紛れていても落ちない（\\u の字面で書く）
        data = json.dumps(d, ensure_ascii=True, allow_nan=False).encode("utf-8")
    sidecar_path(log).write_bytes(data)


def drop_sidecar(log):
    p = sidecar_path(log)
    if p.exists():
        p.unlink()


def resolve_material(st, a):
    """素材を探す。戻り値 (material, source, named, where)。

    named:  素材のある記録か。open で素材を名指ししている（open.src）か、呼び出しで --transcript を
            渡したか、live で素材ログが既にあるか。素材があるかどうかは open の時点で決まる。
            名指しした素材が見つからなくても、素材の無い記録にはならない（免除しない）。
    source: 窓の計算に使う発話。live は素材ログの行（list）、file は素材ファイルのパス。
            file で素材ファイルが見つからなければ None。
    material: P19・P20 と gap_lines に使う「発話 1〜j を返す関数」。source が無ければ None。
    where:  見つからなかったときに違反文に出す名前。
    live の素材ログに行を足すのは watch だけ（ここは読むだけ）。
    """
    if not st.v2:
        return None, None, False, None
    # --transcript は open.src と同じファイルのときだけ受ける（guard_material が先に照らす）。読むのは open.src
    name = (st.open_ev or {}).get("src") or a.transcript
    mode = (st.open_ev or {}).get("mode")
    if mode == "live":
        srclog = srclog_path(a.log)
        named = bool(name) or srclog.exists()
        if not named:
            return None, None, False, None
        utts = read_srclog(srclog).utts
        return material_from_list(utts), utts, True, str(srclog)
    named = bool(name)
    if not named:
        return None, None, False, None
    path = find_src(a.log, name)
    if path:
        return material_from_file(path), path, True, name
    return None, None, True, name


def find_src(log, path):
    """素材の場所。そのままで無ければログと同じフォルダから探す。"""
    if not path or not isinstance(path, str):
        return None
    if Path(path).exists():
        return path
    alt = Path(log).resolve().parent / path
    return str(alt) if alt.exists() else None


# ---------------------------------------------------------------- 1 つの素材に 1 つのログ（持ち主の印）

def material_path(log, name):
    """素材の場所。見つからなければ渡された名前のまま（live のメモ帳は会議の前には無い）。"""
    return find_src(log, name) or name


def _real(p):
    return os.path.normcase(os.path.realpath(p))


def same_file(a, b):
    """同じファイルか（解決したパスで比べる。両方あればリンクも同じファイルとみなす）。"""
    try:
        if os.path.exists(a) and os.path.exists(b):
            return os.path.samefile(a, b)
    except OSError:
        pass
    return _real(a) == _real(b)


def owner_path(material):
    """持ち主の印の場所: 素材の隣の <素材>.owner（素材を解決した場所の隣）。"""
    return Path(os.path.realpath(material) + ".owner")


def read_mark(p):
    """持ち主の印 p が指すログの場所。印が無い・空・読めなければ None。"""
    p = Path(p)
    if not p.is_file():
        return None
    try:
        text = trim(p.read_bytes().decode("utf-8-sig"))
    except (OSError, UnicodeDecodeError):
        text = ""
    if not text:
        return None
    return text if os.path.isabs(text) else os.path.join(str(p.parent), text)


def owner_record(material):
    """(印の場所, 印が指すログの場所)。印が無い・空・読めなければ、ログの場所は None。"""
    p = owner_path(material)
    return p, read_mark(p)


def named_record(log, name):
    """素材に名指したファイルが、記録のファイルなら、断るわけを返す（素材にしてよければ None）。

    - 名前が判断ログ・素材ログ・持ち主の印・watch の印・覚え書きの形（.jsonl・.owner・.watch.json・.next.json）
    - 同じフォルダにある持ち主の印（*.owner）が指す別のログの、判断ログそのもの・素材ログ・覚え書き・watch の印
      （本番の素材ログには持ち主の印が無いので、それを素材にした捨てるログで、本番の窓より先を読めてしまうため）
    """
    if not isinstance(name, str) or not name:
        return None
    path = material_path(log, name)
    try:
        real = os.path.basename(os.path.realpath(path))   # リンクなら実体の名前も見る（K27）
    except (OSError, ValueError):
        real = ""
    for low in dict.fromkeys((name.lower(), real.lower())):
        for suf in RECORD_SUFFIXES:
            if low.endswith(suf):
                return (f"{name} は判断ログ・素材ログ・持ち主の印・watch の印・覚え書きの名前（{suf}）です"
                        f"{'' if low == name.lower() else '（リンクの実体の名前）'}"
                        "（素材にできるのは素材ファイルとメモ帳だけ。記録を素材にすると、別のログの先を読めてしまう）")
    try:
        folder = Path(os.path.realpath(path)).parent
        marks = sorted(folder.glob("*.owner")) if folder.is_dir() else []
    except OSError:
        marks = []
    for m in marks:
        rec = read_mark(m)
        if rec is None or same_file(rec, log):
            continue
        for x in (rec, srclog_path(rec), sidecar_path(rec), watch_mark_path(rec)):
            if same_file(path, x):
                return (f"{name} は、別のログ {rec} の記録です（持ち主の印 {m.name} が指すログの判断ログ・素材ログ・"
                        "覚え書き・watch の印は、素材にできません）")
    return None


def owner_conflict(log, material):
    """別のログがこの素材の持ち主なら、そのログの場所を返す。

    印が無い・このログを指す・指すログがもう無い（消した・動かした）なら None（このログが引き継げる）。
    """
    _, rec = owner_record(material)
    if rec is None or same_file(rec, log) or not os.path.exists(rec):
        return None
    return rec


def write_owner(log, material):
    """持ち主の印にこのログを書く（素材のフォルダからの相対。別のドライブなら絶対）。既にこのログなら書かない。
    印を置くフォルダ（素材の実体のフォルダ）が無ければ、そのフォルダ 1 つだけを作る（K27）。"""
    p, rec = owner_record(material)
    if rec is not None and same_file(rec, log):
        return
    try:
        rel = os.path.relpath(os.path.realpath(log), str(p.parent))
    except ValueError:
        rel = os.path.realpath(log)
    p.parent.mkdir(exist_ok=True)   # 作るのは印のすぐ上のフォルダ 1 つだけ（K27。その上が無ければ OSError）
    p.write_bytes((rel + "\n").encode("utf-8", "backslashreplace"))


def owner_message(material, other):
    return (f"素材 {material} は、別のログ {other} が使っています。1 つの素材に開けるログは 1 つです"
            f"（同じ素材を別のログで読むと、そのログの窓で先を読めてしまう。持ち主の印 {owner_path(material).name}）")


def guard_material(st, a, claim=False):
    """読む素材を照らす。違反文（P07 の文）か None を返す。

    - v2: 読む素材は open.src（無ければ --transcript）。--transcript を渡すなら open.src と同じファイル
      （解決したパスで比べる。live でも file でも）
    - 1 つの素材に開けるログは 1 つ: 素材の持ち主の印が別のログ（まだ在るもの）を指していれば断る
      （v1 の記録も --transcript の素材で照らす）
    - claim が真で、v2 で、印が無い（か、もう無いログを指す）なら、このログを書く（書けなくても止めない）
    """
    for nm in ((st.open_ev or {}).get("src") if st.v2 else None, a.transcript):
        why = dotdot_material(nm)
        if why:
            return why
    if st.v2:
        open_src = (st.open_ev or {}).get("src")
        if open_src and a.transcript and not same_file(material_path(a.log, a.transcript), material_path(a.log, open_src)):
            return (f"--transcript {a.transcript} は、open で名指しした素材 {open_src} と別のファイルです"
                    "（素材は open で決まる。別の素材で窓を計算できない）")
        name = open_src or a.transcript
    else:
        name = a.transcript
    if not name or not isinstance(name, str):
        return None
    why = named_record(a.log, name)
    if why:
        return why
    if not st.v2 and not src_name_ok(name, src_exts(st.rules)):
        # v1 の --transcript も素材ファイルの名前だけ（v2 の open.src は検査器が P30 で拒む）
        return f"素材の名前 {name} は {'・'.join(src_exts(st.rules))} で終わっていません（素材にできるのは素材ファイルだけです）"
    material = material_path(a.log, name)
    other = owner_conflict(a.log, material)
    if other:
        return owner_message(name, other)
    if claim and st.v2:
        try:
            write_owner(a.log, material)
        except OSError:
            pass
    return None


def utts_iter(source):
    if source is None:
        return []
    if isinstance(source, list):
        return source
    return iter_utterances(source)


def _plain(x):
    """比べるための形: 空白と、Unicode の分類が Z（区切り）・P（句読点）・S（記号）の文字を除く。"""
    return "".join(ch for ch in (x or "") if not (ch.isspace() or ch in WS_CHARS or unicodedata.category(ch)[0] in "ZPS"))


def known_overlap(known, source, k):
    """known と素材の本文に共通する k 字以上の部分（最初に見つかったもの）。無ければ None。

    両方から空白・句読点・記号を除いて比べる（読点を挟む・空白を詰めるだけでかわせないように）。
    """
    strip = _plain
    kn = strip(known)
    if len(kn) < k:
        return None
    text = "".join(strip(u.get("text")) for u in utts_iter(source))
    for i in range(len(kn) - k + 1):
        piece = kn[i:i + k]
        if piece in text:
            j = i + k
            while j < len(kn) and kn[i:j + 1] in text:
                j += 1
            return kn[i:j]
    return None


# ---------------------------------------------------------------- コマンド

def warn_known_overlap(st, log):
    """file の記録で、open の known が素材の本文と一致していれば警告（P28）を足す。拒まない。

    素材の持ち主の印を照らしたあと（cmd_open）にだけ呼ぶ（別のログの素材で、本文の有り無しを試せないように）。
    """
    if not st.v2 or (st.open_ev or {}).get("mode") != "file":
        return
    known = st.open_ev.get("known")
    if not isinstance(known, str) or not known:
        return
    path = find_src(log, st.open_ev.get("src"))
    if not path:
        return
    k = st.rules.limit("warn.known_overlap") or KNOWN_OVERLAP_MIN
    try:
        common = known_overlap(known, path, k)
    except FormatError:
        return
    if common:
        head = common[:20] + ("…" if len(common) > 20 else "")
        st.warn("開始", RULE_KNOWN, f"known に、素材の本文と同じ {len(common)} 字があります（「{head}」）。"
                                    "聞き始める前に知っていたことに、これから読む素材を入れていないか確かめてください")


BATCH_SUFFIX = ".batch.jsonl"


def has_dotdot(name):
    """パスの区切り（/ か \\）の間に「..」（一つ上のフォルダ）があるか。"""
    return ".." in re.split(r"[\\/]", str(name))


def dotdot_material(name):
    """素材（メモ帳・素材ファイル）の名前に「..」があれば断る文（K27）。無ければ None。

    POSIX では、無いフォルダを挟んだ名前（live/無い/../会議.txt）を、道具は字面で縮めて印を書き、OS は読めずに
    メモ帳を 1 行も読まない（会議の発話が黙って欠ける）。判断ログの名前と同じく、たどらずに名指すようにする。"""
    if isinstance(name, str) and has_dotdot(name):
        return (f"素材（メモ帳・素材ファイル）のパスに「..」（一つ上のフォルダ）を挟めません: {name}"
                "（フォルダをたどらずに、判断ログを置くフォルダからの名前か、絶対パスで渡してください）")
    return None


def check_log_path(log):
    """判断ログの名前の決め（K9。open・watch・next・append・end・pause・status・digest と audit_r2b.py が照らす）。

    - 名前の終わりが「/」「/.」なら断る（K28。書く命令がフォルダとして開こうとして落ちないように）
    - パスの区切り（/ か \\）の間に「..」（一つ上のフォルダ）があれば断る（K20。会議/x/../会議.jsonl などは、
      無いフォルダを挟んだ書き方で、同じフォルダにある判断ログや派生ファイルの照らしをすり抜けるため）
    - 名前はちょうど小文字の .jsonl で終わる（.JSONL・.peek・.tsv・拡張子の無い名前は断る）。道具は素材ログ・覚え書き・
      watch の印の名前を判断ログの名前から作るので、.jsonl で終わらない名前を受けると、語幹の同じ別のログ（例 会議.jsonl）と
      同じ派生ファイル（会議.src.jsonl など）を指してしまう
    - .src.jsonl で終わる名前は断る（素材ログの名前。大小文字を問わない。Windows では 会議.SRC.jsonl も 会議.src.jsonl と同じファイル）
    - 返事のバッチと同じ名前（*.batch.jsonl）には置かない。バッチの場所は分析役が書き換えてよい場所なので、そこに置いた
      ログは、先を読んだあとで書き直せてしまう
    """
    if re.search(r"[\\/]\.?\Z", str(log)):
        raise Fail(f"判断ログの名前が「/」か「/.」で終わっています: {log}（判断ログはファイルの名前で渡します。例 live/会議.jsonl）")
    if has_dotdot(log):
        raise Fail(f"判断ログのパスに「..」（一つ上のフォルダ）を挟めません: {log}"
                   "（フォルダをたどらずに、判断ログを置くフォルダからの名前か、絶対パスで渡してください）")
    name = Path(log).name
    low = name.lower()
    if low.endswith(BATCH_SUFFIX):
        raise Fail(f"判断ログを {BATCH_SUFFIX} の名前に置けません（返事のバッチの名前。分析役が書き換えられる場所なので）: {log}")
    if low.endswith(SRCLOG_SUFFIX):
        raise Fail(f"判断ログを {SRCLOG_SUFFIX} の名前に置けません（素材ログの名前。大小文字は問いません）: {log}")
    if not name.endswith(LOG_SUFFIX) or len(name) <= len(LOG_SUFFIX):
        raise Fail(f"判断ログの名前は、小文字の {LOG_SUFFIX} で終わる名前にします（例 live/会議.jsonl）: {log}"
                   "（道具は素材ログ・覚え書き・watch の印の名前を、判断ログの名前から .jsonl を除いた語幹で作ります）")


def _stem_folds(s):
    """語幹を大小文字を無視して比べるための形の集まり（Windows は大小文字を区別しない。広めに同じとみなす）。"""
    return {s.casefold(), s.lower(), s.upper()}


def _entry_stems(name):
    """フォルダの中のファイルの名前が、判断ログか派生ファイルの名前なら、その語幹の候補（大小文字を問わずに見る）。"""
    low = name.lower()
    out = []
    if low.endswith(LOG_SUFFIX):
        out.append(name[:-len(LOG_SUFFIX)])        # 判断ログ <語幹>.jsonl（会議.src.jsonl も、語幹 会議.src のログとして見る）
    for suf in DERIVED_SUFFIXES:
        if low.endswith(suf):
            out.append(name[:-len(suf)])
    return out


def stem_conflicts(log):
    """open の前に: このログ自身・派生ファイルがもうあるか、同じフォルダに語幹が大小文字を無視して同じになる
    別の判断ログか派生ファイルがあれば、そのファイルの名前の一覧を返す（無ければ空）。"""
    p = Path(log)
    stem = log_stem(p)
    found = [x.name for x in (p, srclog_path(p), sidecar_path(p), watch_mark_path(p)) if os.path.lexists(x)]
    folder = p.parent if str(p.parent) else Path(".")
    try:
        names = sorted(os.listdir(folder)) if folder.is_dir() else []
    except OSError:
        names = []
    mine = _stem_folds(stem)
    for n in names:
        if n in found:
            continue
        if any(_stem_folds(s) & mine for s in _entry_stems(n)):
            found.append(n)
    return found


def check_log_link(log):
    """判断ログの名前がリンクなら断る（K28。open も同じ）。渡された名前の実体（realpath）が、フォルダだけを解いた場所と
    違えば Fail。違わなければ実体のパスを返す。まだ無い判断ログの名前でも、リンクでなければ通る（open が作る）。"""
    try:
        absl = os.path.abspath(log)
        real = os.path.realpath(log)
        here = os.path.join(os.path.realpath(os.path.dirname(absl)), os.path.basename(absl))
    except (OSError, ValueError) as ex:
        raise Fail(f"判断ログ {log} の場所を確かめられません（{ex}）")
    if os.path.normcase(real) != os.path.normcase(here):
        raise Fail(f"判断ログ {log} はリンクで、実体は {os.path.basename(real)} です。判断ログは実体の名前で渡してください"
                   "（道具は素材ログ・覚え書き・watch の印を判断ログの名前から作るので、リンクの名前では別の記録を作ってしまう）")
    return real


def check_log_target(log):
    """在る判断ログを読む・書く命令（watch・next・append・end・pause・status・digest と監査）の入口の照らし（K28）。
    どれも Traceback ではなく、使う人に向けた文で断る（Fail。何も読まず、何も書かない）。

    - 名前の決め（check_log_path。「/」「/.」で終わる名前・「..」・.jsonl でない名前・派生ファイルの名前）
    - リンクを断る: 渡された名前の実体（realpath）が、フォルダだけを解いた場所と違えば断る。道具は素材ログ・覚え書き・
      watch の印の名前を、渡された判断ログの名前から作るので、別の名前のリンクで本番の判断ログを名指すと、別の素材ログを
      作って本番の窓を書いてしまう（R2b が黙って崩れる）。素材ログ・覚え書き・印を指すリンクも、ここで断る
    - 実体の場所にも名前の決めを当てる。フォルダ・無い判断ログは断る（status・digest が、打ち間違えた名前を始めたばかりの
      記録のように見せないため）
    """
    check_log_path(log)
    real = check_log_link(log)
    check_log_path(real)
    if os.path.isdir(real):
        raise Fail(f"{log} はフォルダです。判断ログはファイルの名前で渡します")
    if not os.path.isfile(real):
        raise Fail(f"判断ログ {log} がありません（名前と場所を確かめてください。新しい記録は rt.py open で始めます）")


def guard_log(log):
    """watch・next・append・end・pause の入口: 判断ログの名前と実体の照らし（K28）と、watch の印の持ち主を照らす（K9）。
    印に書かれた判断ログの名前が自分と違えば、何もせずに断る（P07。終了コード 2）。"""
    check_log_target(log)
    why = watch_mark_foreign(log)
    if why:
        refuse(why)


def make_log_folder(log):
    """判断ログを置くフォルダが無ければ、そのフォルダ 1 つだけを作る（K20。その上の無いフォルダは作らない）。
    作れなければ、使う人に向けた文で断る（Fail。何も書いていない）。"""
    folder = Path(log).parent
    if folder.is_dir():
        return
    for up in folder.parents:
        if os.path.lexists(up) and not up.is_dir():
            raise Fail(f"判断ログを置くフォルダ {folder} を作れません（途中の {up} と同じ名前のファイルがあります）。"
                       "別の場所を選んでください（何も書いていません）")
        if up.is_dir():
            break
    if not folder.parent.is_dir():
        raise Fail(f"判断ログを置くフォルダ {folder} を作れません。その上のフォルダ {folder.parent} がありません"
                   "（open が作るのは、判断ログのすぐ上のフォルダ 1 つだけです。先にフォルダを作るか、ある場所を選んでください。"
                   "何も書いていません）")
    try:
        folder.mkdir(exist_ok=True)
    except OSError as ex:
        why = "同じ名前のファイルがあります" if os.path.lexists(folder) else (ex.strerror or type(ex).__name__)
        raise Fail(f"判断ログを置くフォルダ {folder} を作れません（{why}）。別の場所を選んでください（何も書いていません）")
    if not folder.is_dir():
        raise Fail(f"判断ログを置くフォルダ {folder} を作れません（同じ名前のファイルがあります）。別の場所を選んでください（何も書いていません）")


def cmd_open(a):
    rules = load_rules()
    # 「..」を挟んだ名前は、直す前の名前で断る。そのあとは、断る・受ける・印を見るのどの判定よりも前に、絶対パスに直し
    # （シンボリックリンクも解く）、直したパスで名前の決めと派生ファイルの重なりを照らす（K20。無いフォルダを挟んだ書き方や
    # リンクで、同じフォルダにある判断ログ・派生ファイルを見落とさないため）
    check_log_path(a.log)
    for nm in (a.transcript, a.src):
        why = dotdot_material(nm)   # 素材の名前の「..」も、直す前の名前で断る（K27）
        if why:
            raise Fail(why)
    # 判断ログの名前がリンクなら断る（まだ無い先を指すリンクも。K28 の照らしを open にも当て、open で始めた名前が
    # そのまま watch・next・append・end でも通るようにする）
    check_log_link(a.log)
    log = Path(os.path.realpath(a.log))
    check_log_path(log)
    if log.is_dir():
        raise Fail(f"{log} はフォルダです。判断ログはファイルの名前で渡します")
    # 判断ログ自身・派生ファイル（素材ログ・覚え書き・watch の印）がもうあるか、同じフォルダに語幹が大小文字を無視して
    # 同じになる別の判断ログか派生ファイルがあれば断る（K9。別の判断ログの派生ファイルを自分のものとして読み書きしないため。
    # 空のファイルでも断る）
    clash = stem_conflicts(log)
    if clash:
        raise Fail(f"{log} は始められません。同じフォルダに、この判断ログか、語幹（{log_stem(log)}）が同じ判断ログ・素材ログ・"
                   f"覚え書き・watch の印がもうあります（{'・'.join(clash)}。大小文字は区別しません）。新しいログは別の名前で始めます")
    if bool(a.live) == bool(a.src):
        raise Fail("--live か --src <素材ファイル> のどちらか一方を指定します")
    if a.live and not a.transcript:
        # 素材があるかどうかは open の時点で決まる。live の記録は必ず素材（メモ帳）を名指しする
        raise Fail("--live には --transcript <メモ帳> が要ります（メモ帳はまだ無くてよい。そのフォルダがあれば open が空のメモ帳を作る）")
    if not isinstance(a.window, int):
        # 窓の幅は整数の秒（ページの刻みと rt.py の窓が、同じ境目で切れるように）
        raise Fail(f"--window は整数の秒で書きます（{a.window!r} は整数ではありません）")
    if a.src and a.transcript and not same_file(material_path(log, a.transcript), material_path(log, a.src)):
        raise Fail("--src と --transcript が別のファイルです（素材は 1 つ。file の記録は --src だけで名指しします）")
    if a.src and not find_src(log, a.src):
        raise Fail(f"素材ファイルが見つかりません: {a.src}")
    at = wall_clock(a.now, bool(a.live))
    e = {"e": "open", "v": 2, "name": a.name or Path(a.log).stem, "t0": at,
         "mode": "live" if a.live else "file", "window": a.window, "known": a.known or ""}
    if a.src:
        e["src"] = a.src
    elif a.transcript:
        e["src"] = a.transcript
    st = State(rules)
    # 素材にできるのは素材ファイルとメモ帳だけ（名前の形は検査器の P30。ここでは加えて、記録のファイルと、
    # 別のログの記録（そのログの素材ログ・覚え書きなど）を名指していないかを見る）。いまの規則表では記録の名前は
    # どれも P30 で断られるので、同じことを 2 回言わないように、P30 を通った名前だけを見る（規則表の拡張子が
    # 広げられたときの守り）
    why = named_record(log, e["src"]) if src_name_ok(e["src"], src_exts(rules)) else None
    if why:
        st.err("開始", "P07", why)
    # 1 つの素材に開けるログは 1 つ。別のログ（まだ在るもの）が持ち主なら、何も書かずに断る
    material = material_path(log, e["src"])
    other = owner_conflict(log, material)
    if other:
        st.err("開始", "P07", owner_message(e["src"], other))
    check_batch(st, [e], at)
    if st.errors:
        fail_errors(st, "open できません（何も書いていません）:")
    if a.src and Path(find_src(log, a.src)).is_file():
        # 発話が 1 つも無い素材は、記録を作らずに断る（K21。ページのファイルの入口と同じ文。名前の照らしを通った素材だけ読む）
        no = material_refusal(find_src(log, a.src))
        if no:
            raise Fail("\n".join(no))
    # 素材（メモ帳）は実体の場所で扱う（K27）。持ち主の印は実体の隣に書き、そのフォルダが無ければ 1 つだけ作る
    # （その上も無ければ、何も書かずに断る）。メモ帳の名前がフォルダなら断る
    mreal = Path(os.path.realpath(material))
    mfold = mreal.parent
    if a.live and os.path.isdir(material):
        raise Fail(f"メモ帳 {e['src']} はフォルダです。メモ帳はファイルの名前で渡します（何も書いていません）")
    if not mfold.is_dir():
        if os.path.lexists(mfold):
            raise Fail(f"素材の隣に持ち主の印を置くフォルダ {mfold} を作れません（同じ名前のファイルがあります）。"
                       "別の場所を選んでください（何も書いていません）")
        if not (mfold.parent.is_dir() or _real(mfold.parent) == _real(log.parent)):
            raise Fail(f"素材の隣に持ち主の印を置くフォルダ {mfold} を作れません。その上のフォルダ {mfold.parent} がありません"
                       "（open が作るのは、印のすぐ上のフォルダ 1 つだけです。先にフォルダを作るか、ある場所を選んでください。"
                       "何も書いていません）")
    make_log_folder(log)
    memo_folder = mfold.is_dir()   # メモ帳を作ってよいのは、そのフォルダが既にあるときだけ（K27。印のために作ったフォルダには作らない）
    try:
        write_owner(log, material)
        write_events(log, [e])
    except OSError as ex:
        raise Fail(f"判断ログ {log} か持ち主の印 {owner_path(material)} を書けません: {ex}")
    memo_note = None
    if a.live and not os.path.lexists(material):
        if memo_folder:
            try:
                with open(mreal, "xb"):
                    pass
                memo_note = f"メモ帳 {e['src']} が無かったので、空のファイルとして作りました。"
            except OSError as ex:
                memo_note = (f"メモ帳 {e['src']} を作れませんでした（{ex.strerror or type(ex).__name__}）。"
                             "watch は、メモ帳ができるまで「見つかりません」と知らせます。")
        else:
            memo_note = (f"メモ帳 {e['src']} はまだありません（置くフォルダが無かったので、持ち主の印のためにフォルダだけを作りました）。"
                         "watch は、メモ帳ができるまで「見つかりません」と知らせます。")
    # known と素材の本文の重なり（P28）は、印とログを書き終えてから見る（書けなかった open で、
    # 素材の中身を当てる問いを繰り返せないように）
    warn_known_overlap(st, log)
    print_warnings(st)
    print(f"{log} を始めました（v2、{e['mode']}、窓 {a.window} 秒）。")
    print(f"素材 {e['src']} の隣に持ち主の印 {owner_path(material).name} を書きました（この素材は、このログでだけ読めます）。")
    if a.live:
        if memo_note:
            print(memo_note)
        print(f"素材は {e['src']} から読みます。素材ログ {srclog_path(log)} は、watch が最初の行を足したときにできます。")
        print(f"次: 会議のあいだ、別の窓（裏）で rt.py watch {log} を回してください（メモ帳の新しい行に、届いた時刻を押して"
              "素材ログに足します。記録が end で閉じると止まります）。それから next で1ステップ目の発話を出します。")
    else:
        print("次: next で1ステップ目の発話を出してください。")


def _int_or(v, default):
    return _to_int(v) if _is_int(v) else default


def refuse(msg, code="P07"):
    """違反として断る（何も書かない。終了コード 2）。"""
    print(f"{code}: {clean_text(msg)}", file=sys.stderr)
    sys.exit(EXIT_REJECT)


def cmd_next(a):
    guard_log(a.log)
    rules = load_rules()
    st = fold(load_jsonl(a.log), rules)
    if st.errors:
        fail_errors(st, "ログが規則に反しているので、次の窓は見せません:", EXIT_USAGE)
    if st.open_ev is None:
        raise Fail("ログの先頭に open がありません（先に rt.py open で始めます）")
    if st.ended:
        print("（ログは end で閉じた。ここで終わり）")
        return
    # 1 つの素材に開けるログは 1 つ。--transcript は open.src と同じファイル（v2）。素材を読む前に照らす
    msg = guard_material(st, a, claim=True)
    if msg:
        refuse(msg)
    if not st.v2:
        if not a.transcript:
            raise Fail("v1 のログには --transcript が要ります")
        if st.chunk is None:
            raise Fail("v1 のログの open に、1 つの窓の行数（chunk）が書かれていません")
        start = 1 if st.last_step is None else st.last_step["lines"][1] + 1
        s = st.last_step
        if s and s["lines"][1] - s["lines"][0] + 1 < st.chunk:
            print("（前の窓で素材の最後まで読みました。ここで終わり）")
            return
        got = read_raw_lines(a.transcript, start, st.chunk)
        if not got:
            print(f"（{start}行目は空でした。素材はもう残っていません。ここで終わり）")
            return
        print(f"--- {got[0][0]}〜{got[-1][0]}行 ---")
        for _, line in got:
            print(line)
        return

    live = st.open_ev.get("mode") == "live"
    wall_clock(a.now, live)  # 未来の --now・試験でない live の --now は、窓を計算する前に断る
    side = load_sidecar(a.log) or {}
    memo_name = st.open_ev.get("src") if live else None
    first_i = st.last_step["lines"][1] + 1 if st.last_step else 1
    if a.last:
        if not live:
            raise Fail("--last は live の記録で使います（file の記録の窓は、素材ファイルから決まります）")
        return next_last(a, st, side, memo_name, first_i)
    deadline = time.time() + (a.wait or 0)
    grace = time.time() + WATCH_STALE_SEC
    while True:
        clock = now_iso(a.now)
        extra = []
        pend = 0
        if live:
            # 素材ログに行を足すのは watch だけ。watch が回っていないのに新しい行があれば、窓を出さない
            # （next の時刻で行を押すと、話した位置が後ろへずれるため）
            pend = memo_pending(a.log, memo_name) if memo_name else 0
            alive = watch_alive(a.log, clock)
            if pend and not alive:
                raise Fail(f"watch が回っていません。{MEMO_PENDING_TEXT.format(n=pend)}"
                           "（行に届いた時刻を押せるのは watch だけで、next の時刻では押しません）。"
                           f"会議のあいだ、別の窓（裏）で rt.py watch {a.log} を回してから、もう一度 next を打ってください")
            if not alive:
                extra = ["watch が回っていません（メモ帳に新しい行が入っても、素材ログには入りません。rt.py watch で回してください）"]
            nomemo = memo_notice(a, st)
            if nomemo:
                extra.append(nomemo)   # メモ帳が見つからないあいだは、黙って 0 行にしない（K27）
        material, source, named, where = resolve_material(st, a)
        if source is None:
            if named:
                raise Fail(f"素材が見つかりません: {where}")
            raise Fail("素材がありません（open の src か、--transcript で渡します）")
        now_t = (iso_sec(clock) - iso_sec(st.open_ev["t0"])) if live else None
        win = compute_window(st, utts_iter(source), now_t=now_t, live=live)
        if live and pend and time.time() < max(deadline, grace):
            time.sleep(0.5)  # watch がまだ素材ログに足していない行を、足すまで待つ（1 秒ごとに見ている）
            continue
        if win is not None and win[4]:
            break
        if time.time() >= deadline:
            if win is None:
                # まだ渡していない発話に付いた知らせと、最後の発話より後の知らせ（行番号だけ）
                notes = (read_srclog(srclog_path(a.log)).tail if live
                         else file_notices(source, first_i, float("inf"), tail=True))
                for x in notice_lines(notes) + extra:
                    print(f"（知らせ）{x}")
                if live:
                    print("（新しい発話はまだありません）")
                    return
                print(f"（{first_i}番目の発話はありませんでした。ここで終わり）")
                return
            for x in extra:
                print(f"（知らせ）{x}")
            print(f"（窓 {fmt(win[0])}〜{fmt(win[1])} はまだ閉じていません。発話は {len(win[3])} 件）")
            return
        time.sleep(1)
    show_window(a, st, side, win, live, source, material, extra, clock)


def show_window(a, st, side, win, live, source, material, extra, clock, last=None, tail_lines=()):
    """窓の覚え書きを書いて、窓の発話を出す（next と next --last）。last は最後の窓の終わり（next --last のときだけ）。"""
    t0, t1, lines, utts, _ = win
    if live:
        sl = read_srclog(srclog_path(a.log))
        notes = [n for i in range(lines[0], lines[1] + 1) for n in sl.notes.get(i, [])]
        if last is not None and sl.utts and lines[1] == sl.utts[-1]["i"]:
            notes += sl.tail   # 最後の発話より後ろで起きた出来事の知らせは、最後の窓に出す（K18 の 7）
    else:
        notes = file_notices(source, lines[0], lines[1])
    notices = notice_lines(notes) + extra + list(tail_lines)
    same = side.get("t") == [t0, t1] and side.get("lines") == lines and side.get("last") == last
    attempt = _int_or(side.get("attempt"), 1) if same else 1
    violations = side.get("violations", []) if same and isinstance(side.get("violations"), list) else []
    history = side.get("history", []) if same and isinstance(side.get("history"), list) else []
    rec = {"t": [t0, t1], "lines": lines, "attempt": attempt, "violations": violations, "history": history}
    if last is not None:
        rec["last"] = last
    save_sidecar(a.log, rec)
    new = {"t": [t0, t1], "lines": [{"i": u["i"], "t": u["t"], "who": u.get("who"), "text": u.get("text", "")} for u in utts]}
    if a.json:
        pack = build_pack(st, clock, new=new, attempt=attempt, violations=violations,
                          gap_lines=gap_lines_for(st, material))
        if notices:
            pack["notices"] = notices
        print(json.dumps(pack, ensure_ascii=False))
        return
    print(f"--- 窓 {fmt(t0)}〜{fmt(t1)}（発話 {lines[0]}〜{lines[1]}）---")
    for u in utts:
        who = f"{u['who']}: " if u.get("who") else ""
        print(f"{u['i']} {fmt(u['t'])} {who}{u['text']}")
    for x in notices:
        print(f"（知らせ）{x}")
    if attempt > 1:
        print(f"（この窓は {attempt} 回目。前の返事の違反: " + " / ".join(str(v) for v in violations) + "）")
    gl = gap_lines_for(st, material)
    if gl:
        print(f"（未確定の窓の発話 {len(gl)} 件を gap_lines として読み直せます: " + "、".join(str(u['i']) for u in gl) + "）")
    n = st.next_ids()
    print(f"次の id: カード {n['card']} / 保留 {n['hold']} / 括り {n['group']} / 数え上げ {n['list']}")


LAST_WAIT_SEC = TAIL_SETTLE_SEC + WATCH_STALE_SEC + 1   # next --last がメモ帳の最後の行を待つ長さ（秒。--wait が長ければそちら）
# 最後の窓の結びの文（K31。メモ帳の行はすべて読んだが、拾わなかった行は知らせのとおり。食い違わない言い方にする）
LAST_DONE = "（最後の窓です。メモ帳の行はすべて読みました（足していない行は上の知らせのとおり）。append のあとで end を打てます）"
LAST_MORE = "（まだ渡していない発話が {n} 件あります。append のあとで、もう一度 next --last を打ってください）"
LAST_NONE = "（渡す発話は残っていません。メモ帳の行はすべて読みました（足していない行は上の知らせのとおり）。end を打てます）"
# メモ帳が見つからない・フォルダのとき（K27）。読めていないことを、すべて読んだとは言わない
LAST_DONE_NOMEMO = "（最後の窓です。メモ帳を読めていません（上の知らせ）。読ませるなら、watch が読めるようにしてから、もう一度 next --last を打ってください。このまま終えるなら、append のあとで end を打てます）"
LAST_NONE_NOMEMO = "（渡す発話は残っていません。メモ帳を読めていません（上の知らせ）。読ませるなら、watch が読めるようにしてから、もう一度 next --last を打ってください。このまま終えるなら end を打てます）"
LAST_TAIL_HEAD = "（最後の発話より後ろで起きたメモ帳の出来事の知らせです。最後の窓で知らせたものも含みます）"
MEMO_PENDING_TEXT = "メモ帳に、素材ログへまだ入っていない変化（新しい行・消えた行・戻した行・時刻の列の直しなど）が {n} 件あります"


def wait_memo_in(a, memo_name, what="next --last"):
    """メモ帳の変化（改行の無い最後の行も）が全部素材ログに入るまで待つ（K25。watch が 2 秒の確定をして書き終えるのを
    待つ）。watch が回っていない・待っても入らないときは Fail。"""
    limit = time.time() + max(a.wait or 0, LAST_WAIT_SEC)
    locked = memo_unreadable(material_path(a.log, memo_name), memo_name) if memo_name else None
    if locked:
        raise Fail(f"{locked}。開けるようにしてから、もう一度 {what} を打ってください")
    while True:
        clock = now_iso(a.now)
        pend = memo_pending(a.log, memo_name, tail=True) if memo_name else 0
        if not pend:
            return clock
        if not watch_alive(a.log, clock):
            raise Fail(f"watch が回っていません。{MEMO_PENDING_TEXT.format(n=pend)}（改行の無い最後の行も数えます）。"
                       f"別の窓（裏）で rt.py watch {a.log} を回してから、もう一度 {what} を打ってください")
        if time.time() >= limit:
            raise Fail(f"{MEMO_PENDING_TEXT.format(n=pend)}（最後の行が変わり続けているか、watch が追いついていない）。"
                       f"打ち終えて {TAIL_SETTLE_SEC} 秒たってから、もう一度 {what} を打ってください")
        time.sleep(0.5)


def memo_notice(a, st):
    """live の記録のメモ帳が見つからない・フォルダ・開けないなら、その知らせの文（K27・8 回目）。読めれば None。"""
    name = (st.open_ev or {}).get("src")
    if (st.open_ev or {}).get("mode") != "live" or not name:
        return None
    path = material_path(a.log, name)
    return memo_problem(path, name) or memo_unreadable(path, name)


def next_last(a, st, side, memo_name, first_i):
    """live の聞き終えるとき: watch がメモ帳の最後の行まで素材ログに入れたのを確かめてから、まだ窓にしていない
    発話を、窓の幅の刻みに関係なく最後の窓として出す（K23。ページの「聞き終える」と同じ）。

    窓の始まりは、いつもの窓と同じ（直前の窓の終わり。発話の無い窓を丸ごと飛ばすときは窓の幅の刻みで進める）。
    終わり t[1] は、聞き終えた時計の秒 H（聞き始めからの整数の秒）と「始まり + window × 3」の早いほう。H のほうが
    手前で、H ちょうどに届いた発話があれば、時計が次の秒へ進むまで待つ（窓の終わりは、窓の中のどの発話よりも後）。
    「始まり + window × 3」で切ったときと、上限の件数で切ったときは、残りを言い、もう一度 next --last を打つように言う。
    同じ最後の窓を出し直すとき（返事が落ちて打ち直すとき）は、前の覚え書きの窓をそのまま使う（同じ窓の回数を数え続ける）。
    最後の窓が最後の発話まで渡すときは、最後の発話より後ろで起きたメモ帳の出来事の知らせも出す（K18 の 7）。
    待つのは、メモ帳の変化（新しい行・出来事・改行の無い最後の行）がすべて素材ログに入るまで（K25）。メモ帳が見つからない
    ときは待たずに、その知らせを最後の窓に出し、「すべて読みました」とは言わない（K27）。渡す発話が残っていないときも、
    --json なら JSON（{"last": true, "window": null, "notices": [...]}）で返す（K31）。
    """
    clock = wait_memo_in(a, memo_name)
    nomemo = memo_notice(a, st)   # メモ帳が見つからない・フォルダなら、最後の窓に知らせる（K27）
    material, source, named, where = resolve_material(st, a)
    if source is None:
        raise Fail(f"素材が見つかりません: {where}")
    t0s = iso_sec(st.open_ev["t0"])
    w = st.window or 30
    factor = st.rules.limit("step.width_factor") or 3
    for _ in range(4):
        now_t = int(math.floor(iso_sec(clock) - t0s))   # 最後の窓の終わりは整数の秒（窓の境目はどれも整数の秒）
        base = compute_window(st, utts_iter(source), now_t=now_t, live=True)
        if base is None:
            notes = notice_lines(read_srclog(srclog_path(a.log)).tail) + ([nomemo] if nomemo else [])
            end_line = LAST_NONE_NOMEMO if nomemo else LAST_NONE
            if a.json:
                # 渡す発話が無いときも JSON で返す（K31。窓は null。知らせと結びの文は notices に入れる）
                print(json.dumps({"last": True, "window": None, "notices": notes + [end_line[1:-1]]}, ensure_ascii=False))
                return
            if notes:
                print(LAST_TAIL_HEAD)
            for x in notes:
                print(f"（知らせ）{x}")
            print(end_line)
            return
        rest = [u for u in source if u["i"] >= first_i]
        start = window_start(st, rest[0])
        cap_end = _window_ends(start, w, factor)[-1]
        if now_t >= cap_end:
            end = cap_end            # 幅は window × 3 まで。そこちょうどか後ろの発話は、次の最後の窓
            break
        if now_t > rest[-1]["t"]:
            end = now_t
            break
        if a.now:
            raise Fail("時計が最後の発話の時刻を過ぎていません（--now の時計を進めて、もう一度 next --last を打ってください）")
        time.sleep(1.05)   # 同じ秒に届いた発話がある: 時計が進むまで待つ（最後の窓の終わりは、どの発話よりも後）
        clock = now_iso(a.now)
    else:
        raise Fail("時計が進みません。もう一度 next --last を打ってください")
    old_last = side.get("last")
    if _is_num(old_last) and _pair_of(side.get("lines"), _is_int) and start <= old_last <= end:
        # 前に出した最後の窓と同じ発話なら、その窓のまま（終わりを動かさない。同じ窓の回数を数え続ける）
        r = compute_window(st, utts_iter(source), now_t=now_t, live=True, end=old_last)
        r_new = compute_window(st, utts_iter(source), now_t=now_t, live=True, end=end)
        if r is not None and r_new is not None and r[2] == side["lines"] and r_new[2] == r[2]:
            end = old_last
    win = compute_window(st, utts_iter(source), now_t=now_t, live=True, end=end)
    more = len(rest) - len(win[3])
    done = LAST_DONE_NOMEMO if nomemo else LAST_DONE
    show_window(a, st, side, win, True, source, material, [nomemo] if nomemo else [], clock, last=end,
                tail_lines=[(LAST_MORE.format(n=more) if more else done)[1:-1]])


def window_start(st, u):
    """まだ読んでいない最初の発話 u に対する窓の始まり（compute_window と同じ。直前の step の t[1]、無ければ 0。
    u がその窓より先にあるときだけ、発話の無い窓を丸ごと飛ばして窓の幅の倍数だけ進む）。"""
    w = st.window or 30
    start = st.last_step["t"][1] if st.last_step else 0
    if u["t"] >= start + w:
        start = start + w * int((u["t"] - start) // w)
    return start


END_UNSENT = "まだ渡していない発話が {n} 件あります。next --last で最後の窓を出し、追記してから end を打ってください"
END_MEMO = (MEMO_PENDING_TEXT + "（改行の無い最後の行も数えます）。watch が素材ログに入れるのを待って next --last で最後の窓を出し、"
            "追記してから end を打ってください")


def end_refusal(a, st):
    """end を書く前の断り（K7・K10・K25）。live の記録で、まだどの窓にも入っていない発話か、メモ帳にまだ素材ログへ
    入っていない変化（新しい行・出来事・改行の無い最後の行）があれば、断るわけを返す（無ければ None）。

    end を書く道はすべて（rt.py end と、rt.py append に end だけのバッチを渡す道）ここを通る。
    """
    if not (st.v2 and (st.open_ev or {}).get("mode") == "live"):
        return None
    memo_name = st.open_ev.get("src")
    locked = memo_unreadable(material_path(a.log, memo_name), memo_name) if memo_name else None
    if locked:
        return f"{locked}。開けるようにしてから end を打ってください"
    n, m = unsent_count(a, st)
    if n:
        return END_UNSENT.format(n=n) + (f"（ほかに、{MEMO_PENDING_TEXT.format(n=m)}）" if m else "")
    return END_MEMO.format(n=m) if m else None


def unsent_count(a, st):
    """live: (まだどの窓にも入っていない発話（素材ログ）の数, まだ素材ログに入っていないメモ帳の変化の数（K25。改行の
    無い最後の行も）)。"""
    sl = read_srclog(srclog_path(a.log))
    done = st.last_step["lines"][1] if st.last_step else 0
    n = sum(1 for u in sl.utts if u["i"] > done)
    memo_name = st.open_ev.get("src")
    return n, (memo_pending(a.log, memo_name, tail=True) if memo_name else 0)


def _count_failure(a, old, rules, material, side, window, violations, clock):
    """同じ窓での失敗を1回に数える。3回目なら未確定の窓の最小バッチを書いて窓を進め、終了コード 3 で終わる。"""
    attempt = _int_or(side.get("attempt"), 1)
    history = side.get("history") if isinstance(side.get("history"), list) else []
    if attempt >= 3:
        st2 = fold(old, rules)
        st2.material = material
        gap = gap_batch(st2, window, history + [violations], clock)
        out2 = check_batch(st2, gap, clock, window=window)
        if st2.errors:
            fail_errors(st2, "未確定の窓の最小バッチも違反になりました（道具の欠陥です）:", EXIT_USAGE)
        write_events(a.log, out2)
        drop_sidecar(a.log)
        print(f"同じ窓で3回落ちたので、未確定の窓として {len(out2)} 件を書き、窓を進めました。", file=sys.stderr)
        print_status(st2, out2)
        sys.exit(EXIT_GAP)
    side["attempt"] = attempt + 1
    side["violations"] = violations
    side["history"] = history + [violations]
    save_sidecar(a.log, side)


NO_WINDOW = ("道具が渡した窓がありません（素材のある記録では、先に next で窓を出してから append します。"
             "next が「まだ閉じていません」と言う間は追記できません）")


APPEND_NO_OPEN = "append は open を受けません。新しい記録は rt.py open で始めます（v1 の形のログは、元からあるログに書き足すことしかできません）"


def cmd_append(a):
    guard_log(a.log)
    rules = load_rules()
    old = load_jsonl(a.log)
    st = fold(old, rules)
    if st.errors:
        fail_errors(st, "いまのログが規則に反しているので、書き足しません:", EXIT_USAGE)
    live = (st.open_ev or {}).get("mode") == "live"
    clock = wall_clock(a.now, live)
    if a.batch:
        try:
            data = Path(a.batch).read_bytes()
        except OSError as ex:
            raise Fail(f"返事のファイル {a.batch} を読めません（{ex.strerror or ex}）。返事は、ファイルの場所か標準入力で渡します")
    else:
        # Windows の標準入力は既定で OS の文字コードとして解釈され、日本語が化ける。バイト列で受けて UTF-8 で読む
        data = sys.stdin.buffer.read()
    # 1 つの素材に開けるログは 1 つ。--transcript は open.src と同じファイル（v2）。素材を読む前に照らす
    msg = guard_material(st, a, claim=True)
    if msg:
        st.err("入力", "P07", msg)
        fail_errors(st, "規則に反する所があったので、何も書き足していません:")
    side = load_sidecar(a.log)
    # 素材ログに行を足す（時刻を押す）のは watch だけ。append は watch が残した行を読むだけ
    material, source, named, where = resolve_material(st, a)
    st.material = material
    # 窓。素材のある記録では、next が書いた覚え書きを素材から計算し直して照らし、合ったときだけ使う。
    # 素材の無い記録（試験・手書き）では、覚え書きがあればそのまま使う
    window, window_errs = None, []
    if st.v2 and named:
        if source is None:
            window_errs = [f"素材が見つかりません: {where}（open で素材を名指しした記録は、素材が無いままでは追記できません）"]
        elif side is None:
            window_errs = [NO_WINDOW]
        else:
            window, window_errs = check_window(st, source, live, side)
    elif side is not None and _pair_of(side.get("t"), _is_num) and _pair_of(side.get("lines"), _is_int):
        window = {"t": side["t"], "lines": side["lines"]}
    # 同じ窓の回数に数えられるのは、道具が渡した（照らして合った）窓があるときだけ
    pending = st.v2 and window is not None and side is not None

    def unreadable(msg, code=None):
        violations = [f"{code}: {msg}" if code else f"返事を読めません: {msg}"]
        if pending:
            print("規則に反する所があったので、何も書き足していません:", file=sys.stderr)
            print("  " + violations[0], file=sys.stderr)
            _count_failure(a, old, rules, material, side, window, violations, clock)
            sys.exit(EXIT_REJECT)
        if code:
            st.err("入力", code, msg)
            fail_errors(st, "規則に反する所があったので、何も書き足していません:")
        raise Fail(msg)

    try:
        kind, data = parse_batch(decode_reply(data))
    except BadReply as ex:
        unreadable(str(ex), ex.code)
    needs_window = kind == "reply" or (bool(data) and isinstance(data[0], dict) and data[0].get("e") == "step")
    if needs_window and st.v2 and named and window is None:
        for m in window_errs:
            st.err("入力", "P07", m)
        fail_errors(st, "規則に反する所があったので、何も書き足していません:")
    if kind == "reply":
        try:
            batch = reply_to_batch(data, st, window)
        except BadReply as ex:
            unreadable(str(ex), ex.code)
    else:
        batch = data
    first = batch[0].get("e") if batch and isinstance(batch[0], dict) else None
    if first == "end" and not st.ended:
        # end だけのバッチも、rt.py end と同じ断りを通る（K10。まだ渡していない発話があれば何も書かない。終了コード 1。
        # live の t が聞き終えた時計より先なら断る。K23）
        why = end_refusal(a, st) or end_t_ahead(st, batch[0].get("t"), clock, a.now)
        if why:
            raise Fail(why)
    if not st.v2 and a.transcript and first == "step":
        e = batch[0]
        if _pair_of(e.get("lines"), _is_int):
            want = read_raw_lines(a.transcript, e["lines"][0], e["lines"][1] - e["lines"][0] + 1)
            if len(want) != e["lines"][1] - e["lines"][0] + 1:
                st.err("入力1行目", "P07", "step が読んだという行が、文字起こしの中にありません")
            elif st.chunk and len(want) < st.chunk and read_raw_lines(a.transcript, e["lines"][1] + 1, 1):
                st.err("入力1行目", "P05", f"chunk（{st.chunk} 行）より少なく読めるのは、素材の最後の窓だけです")
    is_step = first == "step"
    n_old_warn = len(st.warnings)
    out = check_batch(st, batch, clock, window=window if is_step else None)
    if first == "open" and not any(code == "P01" for _, code, _ in st.errors):
        # 新しい記録を始める入口は rt.py open だけ（open は v2 だけを書く）。バッチの他の違反も並べて返す
        st.err("入力1行目", "P01", APPEND_NO_OPEN)
    st.warnings = st.warnings[n_old_warn:]  # 既存のログの警告は status で見る。ここでは今回の分だけ
    if not a.json:
        print_warnings(st)
    if st.errors:
        violations = State.short(st.errors)
        # 窓の返事として数えるのは、step で始まる追記と、イベントとして読めない行で始まる追記（end・pause・open は数えない）
        if pending and (is_step or first not in ("end", "pause", "open")):
            print("規則に反する所があったので、何も書き足していません:", file=sys.stderr)
            for x in State.lines(st.errors):
                print("  " + x, file=sys.stderr)
            _count_failure(a, old, rules, material, side, window, violations, clock)
            sys.exit(EXIT_REJECT)
        fail_errors(st, "規則に反する所があったので、何も書き足していません:")
    write_events(a.log, out)
    if is_step or first in ("end", "pause"):
        drop_sidecar(a.log)
    if a.json:
        pack = build_pack(st, clock, gap_lines=gap_lines_for(st, material))
        pack["warnings"] = State.short(st.warnings)
        print(json.dumps(pack, ensure_ascii=False))
        return
    print(f"{len(out)}件を書き足しました。")
    if first in ("end", "pause"):
        print(f"{LABEL[first]}を書きました（{fmt(out[0]['t'])}、{out[0]['at']}）。")
        return
    print_status(st, out)


def gap_batch(st, window, history, clock):
    """検証に3回落ちた窓の最小バッチ（step ＋ hold{kind:gap} ＋ note）。history は各回の違反文。"""
    t0, t1 = window["t"]
    n = (st.last_step["n"] + 1) if st.last_step else 1
    ids = st.next_ids()
    violations = [str(v) for v in history[-1]]
    same = len(history) >= 3 and all([str(v) for v in h] == violations for h in history if isinstance(h, list))
    text = " / ".join(violations) + ("（3回とも同じ違反）" if same else "（3回目の違反）")
    lim = st.rules.limit("note.x") or {"max": 400}
    if len(text) > lim["max"]:
        text = text[: lim["max"] - 1] + "…"
    return [
        {"e": "step", "n": n, "lines": list(window["lines"]), "t": [t0, t1]},
        {"e": "hold", "id": ids["hold"], "t": t0, "who": None, "kind": "gap",
         "q": f"この窓（{fmt(t0)}〜{fmt(t1)}）の構造は未確定（検証に3回落ちた）"},
        {"e": "note", "t": t1, "x": text},
    ]


def cmd_status(a):
    check_log_target(a.log)   # 素材ログ・覚え書き・watch の印（リンクも）・フォルダ・無いログは、中身を読まずに断る（K20・K28）
    rules = load_rules()
    st = fold(load_jsonl(a.log), rules, a.upto)
    if a.json:
        # 素材は、持ち主の印と open.src に合うときだけ読む（status は印を書かない）
        msg = guard_material(st, a)
        if msg:
            print(f"（素材は読みません: {clean_text(msg)}）", file=sys.stderr)
        material = None if msg else resolve_material(st, a)[0]
        pack = build_pack(st, now_iso(a.now), gap_lines=gap_lines_for(st, material))
        pack["warnings"] = State.short(st.warnings)
        pack["errors"] = State.short(st.errors)
        print(json.dumps(pack, ensure_ascii=False))
        return
    print_warnings(st)
    if st.errors:
        print("ログに規則に反する所があります:")
        for x in State.lines(st.errors):
            print("  ", x)
    print_status(st)


KNOWN_TITLE = "聞き始める前に知っていたこと"


def digest_text(st, name, full, limit=DIGEST_MAX):
    """引き継ぎの文。--full でも limit 字以内に収める（次の open --known にそのまま渡せる長さ）。

    収まらなければ、前回の引き継ぎ → 見出し・決着した保留・閉じた章 → 数え上げ・開いている章・
    開いている保留 の順に、それぞれ古いものから1件ずつ落とし、落とした件数を末尾に書く。
    見出しの行と最上位候補は落とさない。
    """
    s = st.last_step
    upto = f"{fmt(s['t'][1])} まで・{s['n']} ステップ" if s else "ステップなし"
    head = f"# 引き継ぎ: {name}（{upto}" + ("、聞き終えた" if st.ended else "、途中") + "）"
    if not full:
        lines = [head, f"カード {len(st.cards)} 枚 / 章 {len(st.groups)} / 保留 {len(st.holds)}（開いている {len(st.open_holds())}）/ 数え上げ {len(st.lists)}"]
        if st.top:
            lines.append(f"最上位候補: {st.top['id']} {st.cards.get(st.top['id'], {}).get('ti', '')}")
        return "\n".join(lines)

    # 節ごとの項目。項目は (落とす順の段, 時刻, 文)。段が小さいものから、同じ段では古いものから落とす
    sections = []
    known = (st.open_ev or {}).get("known")
    if known:
        sections.append([KNOWN_TITLE, [(0, -1, known)]])
    if st.lists:
        items = []
        for l in st.lists.values():
            k = st.list_at_item.get(l["id"])
            items.append((2, l["t"], f"- {l['id']} {l['n']} 点: " + ("／".join(l["items"]) or "（項目は未定）") + (f"（最後に触れたのは {k} 番目）" if k else "")))
        sections.append(["宣言された数え上げ", items])
    if st.groups:
        items = []
        for g in st.groups.values():
            sp = g["span"]
            rng = f"{fmt(sp[0])}〜" + (fmt(sp[1]) if sp[1] is not None else "（開いたまま）")
            items.append((1 if sp[1] is not None else 2, g["t"], f"- {g['id']} {g['lb']}（{rng}、{KIND_JA.get(g['kind'], g['kind'])}）"))
        sections.append(["章", items])
    heads = [c for c in st.cards.values() if c.get("d", 0) <= 1]
    items = []
    for c in heads:
        who = f" {c['who']}" if c.get("who") else ""
        ind = "  " * c.get("d", 0)
        items.append((1, c["t"], f"- {ind}{fmt(c['t'])} {c['id']} [{ROLE_JA.get(c['role'], c['role'])}]{who} {c['ti']}"))
    sections.append(["見出し", items])
    top = []
    if st.top:
        top = ["", "## 最上位候補", f"- {st.top['id']} {st.cards.get(st.top['id'], {}).get('ti', '')}"]
        if st.top.get("why"):
            top.append(f"  理由: {st.top['why']}")
    opened = sorted(st.open_holds(), key=lambda h: h["t"])
    items = []
    for h in opened:
        tag = "（未確定の窓）" if h.get("kind") == "gap" else (f"（{h['who']}）" if h.get("who") else "")
        items.append((2, h["t"], f"- {h['id']} {fmt(h['t'])} {h['q']}{tag}"))
    sections.append(["開いている保留", items])
    closed = [(i, cs) for i, cs in st.closes.items() if st.holds[i].get("kind") != "gap"]
    if closed:
        items = []
        for i, cs in closed:
            h = st.holds[i]
            ans = " ／ ".join(f"{fmt(c['t'])} {c['as']}" for c in cs)
            items.append((1, h["t"], f"- {i} {fmt(h['t'])} {h['q']} → {ans}"))
        sections.append(["決着した保留", items])

    totals = [len(sec[1]) for sec in sections]
    order = sorted(((tier, t, si, ii) for si, sec in enumerate(sections) for ii, (tier, t, _) in enumerate(sec[1])),
                   key=lambda x: (x[0], x[1], x[2], x[3]))
    dropped = set()

    def render():
        out = [head]
        for si, (title, items) in enumerate(sections):
            kept = [txt for ii, (_, _, txt) in enumerate(items) if (si, ii) not in dropped]
            gone = totals[si] - len(kept)
            if title == KNOWN_TITLE:
                if kept:  # 前回の引き継ぎを落としたら、節ごと出さない（末尾の一文で知らせる）
                    out += ["", f"## {title}"] + kept
                continue
            label = (f"{title}（" + ("深さ1まで、" if title == "見出し" else "") + f"{len(kept)} 件"
                     + (f"。古い {gone} 件は落とした" if gone else "") + "）")
            out += ["", f"## {label}"] + kept
            if title == "見出し":
                out += top
        if dropped:
            out += ["", f"（{limit} 字に収めるため、古いものから {len(dropped)} 件を落としました）"]
        return "\n".join(out)

    text = render()
    for key in order:
        if len(text) <= limit:
            break
        dropped.add((key[2], key[3]))
        text = render()
    if len(text) > limit:  # 見出しの行と最上位候補だけでも収まらない（名前が長すぎる）。末尾を切る
        text = text[: limit - 1] + "…"
    return text


def cmd_digest(a):
    check_log_target(a.log)   # 素材ログ・覚え書き・watch の印（リンクも）・フォルダ・無いログは、中身を読まずに断る（K20・K28）
    rules = load_rules()
    st = fold(load_jsonl(a.log), rules, a.upto)
    name = (st.open_ev or {}).get("name", Path(a.log).stem)
    lim = (rules.limit("open.known") or {}).get("max") or DIGEST_MAX
    print(digest_text(st, name, a.full, lim))


def cmd_watch(a):
    """live: 会議のあいだ裏で回し、1 秒ごとにメモ帳を見て、新しく確定した行を届いた時刻で素材ログに足す。

    出すのは件数と行番号と知らせだけ（行の中身は出さない。裏の出力を読んでも先が見えないように）。
    記録が end で閉じたら止まる。--for 秒を過ぎても止まる（試験用）。--once は 1 回だけ見て止まる（試験用。
    環境変数 KIKU_TEST_CLOCK=1 のときだけ）。1 つのログに watch は 1 つ（印 <ログ名>.watch.json）。
    """
    guard_log(a.log)
    if a.once and not test_clock_on():
        raise Fail(f"--once は試験のときだけ使えます（環境変数 {TEST_CLOCK_ENV}=1 を付けます）")
    rules = load_rules()
    st = fold(load_jsonl(a.log), rules)
    if st.errors:
        fail_errors(st, "ログが規則に反しているので、watch を始めません:", EXIT_USAGE)
    if st.open_ev is None:
        raise Fail("ログの先頭に open がありません（先に rt.py open --live で始めます）")
    if not st.v2 or st.open_ev.get("mode") != "live":
        raise Fail("watch は live の記録（open --live）でだけ使います（file の記録は素材ファイルをそのまま読みます）")
    if st.ended:
        print("（ログは end で閉じた。watch は回しません）")
        return
    clock = wall_clock(a.now, True)
    msg = guard_material(st, a, claim=True)
    if msg:
        refuse(msg)
    memo_name = st.open_ev.get("src")
    t0 = iso_sec(st.open_ev["t0"])
    srclog = srclog_path(a.log)
    token = secrets.token_hex(8)
    mark = {"token": token, "pid": os.getpid(), "started": clock, "beat": clock, "log": Path(a.log).name}
    if not claim_watch_mark(a.log, mark, clock):
        raise Fail(f"このログには、もう別の watch が回っています（印 {watch_mark_path(a.log).name}）。1 つのログに watch は 1 つです"
                   "（2 つ回すと同じ行を二度足すおそれがあるため）。止まった watch の印なら、5 秒たつと引き継げます")
    stop_at = time.time() + a.for_sec if a.for_sec else None
    total = 0
    mark_failed = False
    tail_state = {"key": None, "since": 0.0}   # 改行の無い最後の行と、その中身を初めて見た時（2 秒の確定に使う）
    memo_said = None   # 最後に知らせたメモ帳の様子（None は読める）
    read_fails = 0     # 続けて読めなかった回数
    try:
        memo = material_path(a.log, memo_name)
        try:
            pend = memo_pending(a.log, memo_name, only_new=True)
        except OSError:
            pend = 0
        print(f"watch を始めました。メモ帳 {memo_name} を {WATCH_POLL_SEC} 秒ごとに見て、新しく確定した行（改行で終わった行と、"
              f"{TAIL_SETTLE_SEC} 秒変わらなかった最後の行）を、届いた時刻を押して素材ログ {srclog.name} に足します。"
              "記録が end で閉じると止まります（いま止めるなら Ctrl+C）。", flush=True)
        if pend:
            print(f"（知らせ）watch を始める前にメモ帳に入っていた行が {pend} 行あります。届いた時刻は分からないので、"
                  "いま見た時刻を押します", flush=True)
        while True:
            cur = read_watch_mark(a.log)
            if cur is not None and cur.get("token") != token:
                print("別の watch がこのログの印を取りました。こちらは止まります。", flush=True)
                break
            ended = log_ended(a.log)   # 閉じていても、最後にもう 1 回だけメモ帳を見てから止まる
            clock = now_iso(a.now)
            memo = material_path(a.log, memo_name)
            # メモ帳が見つからない・フォルダのあいだは突き合わせない。様子が変わったときに 1 回ずつ知らせる（K27）
            prob = memo_problem(memo, memo_name)
            if prob != memo_said:
                if prob:
                    print(f"（知らせ）{prob}", flush=True)
                else:
                    print(f"（知らせ）メモ帳 {memo_name} が見つかりました。読み始めます", flush=True)
                memo_said = prob
            got = None
            if not prob:
                try:
                    # 2 秒の確定は実時間で測る（--now の時計は秒に切り捨てた値なので使わない。試験の時計のときはそれで測る）
                    got = sync_memo(memo, srclog, t0, clock, tail_state=tail_state,
                                    now_sec=iso_sec(clock) if a.now else time.monotonic())
                    if read_fails >= MEMO_READ_FAILS:
                        print(f"（知らせ）メモ帳 {memo_name} を読めるようになりました", flush=True)
                    read_fails = 0
                except OSError:
                    # メモ帳がほかのアプリに掴まれていて読めない。次の回に読み直す。続けて読めないときは 1 回だけ知らせる
                    read_fails += 1
                    if read_fails == MEMO_READ_FAILS:
                        print(f"（知らせ）メモ帳 {memo_name} を続けて読めません（ほかのアプリが掴んでいるかもしれません）。"
                              "読めるようになるまで読み直します", flush=True)
            if got:
                us = [r for r in got if "i" in r]
                lines = [r["i"] for r in us]
                total += len(us)
                if us:
                    span = f"{lines[0]}" if len(lines) == 1 else f"{lines[0]}〜{lines[-1]}"
                    print(f"{fmt(now_t_of(clock, t0))} 発話 {len(us)} 件を素材ログに足しました（発話の番号 {span}）。", flush=True)
                for x in notice_lines([r for r in got if r.get("ev") in ("changed", "timecol")]):
                    print(f"（知らせ）{x}", flush=True)
            if ended:
                print(f"記録が end で閉じました。watch を止めます（足した発話 {total} 件）。", flush=True)
                break
            mark["beat"] = clock
            cur = read_watch_mark(a.log)
            if cur is None or cur.get("token") == token:
                # 書けなければ次の回に書き直す（落ちない。続けて書けないあいだは 1 回だけ知らせる。K23）
                if write_watch_mark(a.log, mark):
                    mark_failed = False
                elif not mark_failed:
                    mark_failed = True
                    print(f"（知らせ）watch の印 {watch_mark_path(a.log).name} を書けませんでした（ほかのアプリが掴んでいる"
                          "かもしれません）。次の回に書き直します。書けないあいだは、next が watch を止まっているとみなすことがあります",
                          flush=True)
            if a.once:
                break
            if stop_at is not None and time.time() >= stop_at:
                print(f"--for の {a.for_sec:g} 秒が過ぎたので止めます（足した発話 {total} 件）。", flush=True)
                break
            time.sleep(WATCH_POLL_SEC)
    except KeyboardInterrupt:
        print(f"watch を止めました（足した発話 {total} 件）。", flush=True)
    finally:
        drop_watch_mark(a.log, token)


def now_t_of(clock, t0):
    """壁時計 clock の、聞き始めからの秒（整数に切り捨て。0 未満は 0）。"""
    return max(0, int(math.floor(iso_sec(clock) - t0)))


def _write_standalone(a, kind):
    guard_log(a.log)
    rules = load_rules()
    st = fold(load_jsonl(a.log), rules)
    if st.errors:
        fail_errors(st, "いまのログが規則に反しているので、書き足しません:", EXIT_USAGE)
    if st.open_ev is None:
        raise Fail("ログの先頭に open がありません")
    live = st.open_ev.get("mode") == "live"
    clock = wall_clock(a.now, live)
    if kind == "end":
        # 聞き終える前に、まだ渡していない発話を最後の窓として渡す（end が黙って落とさない。append の end も同じ断り）
        why = end_refusal(a, st)
        if why:
            raise Fail(why)
    t = a.t if a.t is not None else end_t(st, clock) if kind == "end" else (st.last_step["t"][1] if st.last_step else 0)
    if kind == "end":
        why = end_t_ahead(st, t, clock, a.now)
        if why:
            raise Fail(why)
    e = {"e": kind, "t": t}
    if kind == "pause":
        e["why"] = a.why or ""
    out = check_batch(st, [e], clock)
    print_warnings(st)
    if st.errors:
        fail_errors(st, f"{LABEL[kind]}を書けません:")
    write_events(a.log, out)
    drop_sidecar(a.log)
    print(f"{LABEL[kind]}を書きました（{fmt(t)}、{out[0]['at']}）。" + ("以後は追記できません。" if kind == "end" else "再開は次の next から。"))


def end_t(st, clock):
    """end の t の既定（K14。ページの「聞き終える」と同じ）。live は聞き終えた時計の秒（聞き始めからの整数の秒）と
    直前の窓の終わりの大きいほう、file は直前の窓の終わり（窓が無ければ 0）。"""
    last = st.last_step["t"][1] if st.last_step else 0
    if (st.open_ev or {}).get("mode") == "live" and iso_ok(st.open_ev.get("t0")):
        return max(last, now_t_of(clock, iso_sec(st.open_ev["t0"])))
    return last


def end_t_ahead(st, t, clock, fixed):
    """live の end の t が、聞き終えた時計の秒（聞き始めからの整数の秒）より先なら断るわけ（K23。聞き終える前の所に
    終わりを置かせない。P27 と同じ考え）。試験の時計（--now）のときと、file の記録では見ない。無ければ None。"""
    if fixed or (st.open_ev or {}).get("mode") != "live" or not iso_ok(st.open_ev.get("t0")) or not _is_num(t):
        return None
    heard = now_t_of(clock, iso_sec(st.open_ev["t0"]))
    if t > heard:
        return (f"end の t {fmt(t)} は、聞き終えた時計 {fmt(heard)} より先です（live の記録では、まだ聞いていない所に終わりを"
                "置けません。何も書いていません）。--t を省けば、聞き終えた時計と直前の窓の終わりの大きいほうになります")
    return None


def cmd_end(a):
    _write_standalone(a, "end")


def cmd_pause(a):
    _write_standalone(a, "pause")


def main(argv=None):
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="backslashreplace")
        except Exception:
            pass
    # 規則表は道具の隣の format/rules.json だけを読む（呼び出しで別の表に差し替えられない）
    p = argparse.ArgumentParser(description="判断ログの追記スクリプト v2（規則表 format/rules.json を読む）")
    sub = p.add_subparsers(dest="cmd", required=True)

    q = sub.add_parser("open", help="新しいログを始める")
    q.add_argument("log")
    q.add_argument("--name")
    q.add_argument("--live", action="store_true", help="素材が届くそばから処理する")
    q.add_argument("--src", help="素材ファイル（事後の作り直し・試験用）")
    q.add_argument("--transcript", help="live のメモ帳の場所（--live では必須。まだ無くてよい。open.src に書く）")
    q.add_argument("--window", type=float, default=30, help="窓の幅（秒）。既定 30。値の範囲は規則表の open.window（5〜180）")
    q.add_argument("--known", default="", help="聞き始める前に知っていたこと（digest --full の出力など。2000 字まで）")
    q.add_argument("--now", help="壁時計を固定する（試験用。ISO 8601 の UTC）。live の記録では実時計から 120 秒以上進んだ値は受けない")
    q.set_defaults(fn=cmd_open)

    q = sub.add_parser("watch", help="live: 会議のあいだ裏で回し、メモ帳の新しい行を届いた時刻で素材ログに足す（end で止まる）")
    q.add_argument("log")
    q.add_argument("--for", dest="for_sec", type=float, help="この秒数だけ回して止まる（試験用）")
    q.add_argument("--once", action="store_true", help="1 回だけ見て止まる（試験用。環境変数 KIKU_TEST_CLOCK=1 のときだけ）")
    q.add_argument("--now", help="壁時計を固定する（試験用。環境変数 KIKU_TEST_CLOCK=1 のときだけ）")
    q.set_defaults(fn=cmd_watch, transcript=None)

    q = sub.add_parser("next", help="次の窓の発話を出す（窓が閉じたときだけ覚え書き <ログ名>.next.json を書く。append はそれを要る）")
    q.add_argument("log")
    q.add_argument("--transcript")
    q.add_argument("--wait", type=float, default=0, help="live: 窓が閉じるまで待つ秒数")
    q.add_argument("--json", action="store_true", help="pack.md の形で出す")
    q.add_argument("--last", action="store_true", help="live: 聞き終えるとき。メモ帳の最後の行まで素材ログに入るのを待ち、残りを最後の窓として出す")
    q.add_argument("--now", help="壁時計を固定する（試験用。ISO 8601 の UTC）。live の記録では実時計から 120 秒以上進んだ値は受けない")
    q.set_defaults(fn=cmd_next)

    q = sub.add_parser("append", help="判断を追記する（素材のある記録では先に next が要る。1回の追記は step とその窓のイベントか、end・pause のどちらか1件。open は受けない）")
    q.add_argument("log")
    q.add_argument("batch", nargs="?", help="バッチのファイル（無ければ標準入力）")
    q.add_argument("--transcript")
    q.add_argument("--json", action="store_true")
    q.add_argument("--now", help="壁時計を固定する（試験用。ISO 8601 の UTC）。live の記録では実時計から 120 秒以上進んだ値は受けない")
    q.set_defaults(fn=cmd_append)

    q = sub.add_parser("status", help="いまの状態を出す")
    q.add_argument("log")
    q.add_argument("--upto", type=int)
    q.add_argument("--transcript")
    q.add_argument("--json", action="store_true")
    q.add_argument("--now")
    q.set_defaults(fn=cmd_status)

    q = sub.add_parser("digest", help="次回への引き継ぎ（--full でも 2000 字以内。収まらなければ古いものから落とす）")
    q.add_argument("log")
    q.add_argument("--full", action="store_true")
    q.add_argument("--upto", type=int)
    q.set_defaults(fn=cmd_digest)

    for name, fn in (("end", cmd_end), ("pause", cmd_pause)):
        q = sub.add_parser(name)
        q.add_argument("log")
        q.add_argument("--t", type=float, help=(
            "素材時間（秒）。既定は、live は聞き終えた時計の秒（聞き始めからの整数の秒）と直前の窓の終わりの大きいほう、"
            "file は直前の窓の終わり（窓が無ければ 0）。live では聞き終えた時計の秒より先に置けない（試験の時計のときを除く）"
            if name == "end" else
            "素材時間（秒）。既定は直前の窓の終わり（窓が無ければ 0）。直前の窓の終わりより先には置けない"))
        q.add_argument("--now", help="壁時計を固定する（試験用。ISO 8601 の UTC）。live の記録では実時計から 120 秒以上進んだ値は受けない")
        if name == "pause":
            q.add_argument("--why", default="")
        q.set_defaults(fn=fn)

    a = p.parse_args(argv)
    if getattr(a, "t", None) is not None and float(a.t).is_integer():
        a.t = int(a.t)
    if getattr(a, "window", None) is not None and float(a.window).is_integer():
        a.window = int(a.window)
    try:
        a.fn(a)
    except Fail as e:
        print(str(e), file=sys.stderr)
        sys.exit(EXIT_USAGE)


if __name__ == "__main__":
    main()
