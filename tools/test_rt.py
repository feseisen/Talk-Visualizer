#!/usr/bin/env python3
"""rt.py の試験。どこからでも動く（例: 道具の根で `python tools/test_rt.py`。場所は自分で解決する）。

(a) tests/cases/*.json と、このファイルの中の追加ケースを全部通す。受理／拒否が期待どおりで、
    拒否のときはログが一字も動かない。
    ケースに src があるときは「watch が素材ログに残した行」として書いておき、window が無ければ
    batch の step の窓を next の覚え書きとして置く（素材のある記録は next を経ないと追記できないため）
(b) tests/fixtures/meeting10.jsonl を next / append で窓ごとに組み直し、元と同じになる
    （壁時計は記録の at を --now で渡す）。
    さらに、分析役の返事の形（schema.json）でも作り直し、ステップ 6 は壊れた返事を3回渡して
    道具が未確定の窓の最小バッチを書くところまで確かめる
(c) v1 の回帰は、架空の小さな v1 の記録 tests/fixtures/v1_small.jsonl（素材は v1_small.txt）で行う
    （作り直して一致、違反の拒否、v が 1 の open の受理、知らない版の拒否）
(d) live の小さな試験（メモの行に watch が届いた時刻を押し、メモ帳に打った時刻は使わない。改行で終わらない行は --once では読まない）と、
    「素材のある記録では next を経ないと append できない」こと、未来の --now を受けないこと
(e) audit_r2b.py が fixture を通し、壊したログを落とし、知らない版を落とす
(f) 覚え書きを信じきらない: 手で書いた覚え書き・素材と合わない覚え書きは P07（live でも file でも）
(g) 素材があるかは open で決まる: 名指しした素材が見つからなくても免除しない（P07）。live の open には --transcript が要る
(h) 壁時計: live の窓は壁時計が窓の終わりを過ぎたときだけ閉じる。聞き終える前の壁時計は P27（過去の --now も）
(i) 中断と窓の幅: pause は読み終えた所より先に置けない（P22）。open.window は規則表の範囲
(j) 値の型: 有限でない数・NaN の字句・末尾の改行・オブジェクトでない行・U+2028 を落ちずに扱う
(k) 壊れた返事も同じ窓の1回に数え、3回で未確定の窓へ進む
(l) digest --full は 2000 字以内（古いものから落とし、落としたと書く）。そのまま open --known に渡せる
(m) 窓の終わりちょうどの発話は、最後の発話でも次の窓。known が素材と一致したら警告（P28）
(n) 素材ファイルの読み: 共通の期待値 tests/fixtures/materials.json（alone・tsv・inline・vtt・混ざった書き方・最後の発話の
    後ろ・発話無し）と、書き方・発話の列・知らせ・窓とその窓の知らせの文が一字違わず同じ。読めないバイトで落ちない
(o) 時刻を単調にする（打ち間違い・巻き戻り）と、1 つの窓は 40 件まで（超えた分は次の窓）
(p) 1 つの素材に 1 つのログ: 別のログの open・next・append を断る（v1 の記録も）。消えたログの印は引き継ぐ。
    監査は印が別のログを指す記録を数える
(q) file の記録で、open.src と別の素材を --transcript に渡すと P07。known の比較は句読点・空白をはさんでも同じ
(r) 値: --now の全角・24 時・2 月 30 日は使い方の誤り。桁の多い整数・e が配列の行も同じ窓の1回に数える。
    返事の think は捨てる。append は open を受けない（v1 の新しい記録も始められない）
(s) watch（実時計）: メモ帳の行に届いた時刻を押す。2 つ目の watch は断る。watch が止まっていて新しい行があれば
    next は窓を出さない。end は渡していない発話があれば断り、next --last が改行の無い最後の行の 2 秒の確定を待って
    最後の窓を出す。end で watch が止まる（数秒だけ実時間で回して止める）
(t) watch: 読み終えた行の書き換え・消去・挿入を拾わずに知らせ、末尾の新しい行は落とさず二度足さない
    （K18。書き換えは「消えた」と「間の行」の 2 つの知らせ、末尾へ動かした行は元の場所が消去で末尾が戻した行、
    半分以上が一度に消えたら残った行を名指す）。保存の途中に見えたメモ帳では何もしない
(u) --now: live の記録では KIKU_TEST_CLOCK=1 のときだけ受ける（file の記録はいつでも受ける）
(v) 読めない行・全角の時刻・時刻の飛びを、行番号で、その行を含む発話を渡す窓で知らせる（file。種類ごとに 1 文）。
    live のメモ帳には読めない行も時刻の飛びも無い
(w) 40 件で切った窓は終わりを縮める（まだ渡していない所に括りの終わり・保留を置けない）
(x) 返事の形: events の無い返事・step の無い返事・events の中の note・``` の囲み・2 つの返事・空の src・整数でない窓の幅
(y) 壊れた step の欄・深すぎる入れ子を、落ちずに拒み、同じ窓の1回に数える
(z) 4 回目の反証の再現（台本を小さくした形）:
    z1 捨てるログの素材に、本番の素材ログ・判断ログ・印・覚え書きを名指せない（P30・P07。監査も数える）
    z2 メモ帳の時刻を打ち間違えても、そのあとの発話の位置はずれない（時刻はいつも届いた時刻）
    z3 聞き終え方は next --last → append → end。end は渡していない発話があれば断る。改行の無い最後の行は 2 秒で確定
    z4 消して戻した行は二度足さない（K18。末尾でも間でも、消えた行と同じ中身なら戻した行として知らせる。新しい発話を受けても覚えは残る）
    z5 「話者: 本文」の切り出し（ページの splitWho と同じ決まり）と、時刻らしい頭で始まる行
    z6 上限で切った窓は、同じ時刻の塊の手前で切る
    z7 events:null・前後の空白の集まり・文字の入れ子の事前検査
    z8 open の window・chunk の型が違っても落ちない
(z9) 5 回目の反証の再現:
    判断ログの名前は小文字の .jsonl だけ・派生ファイルか大小文字だけ違う語幹があれば open は断る・名前の違う watch の印は断る
    append に end だけのバッチを渡しても rt.py end と同じ断り
    時刻の列だけの直しは記録に効かないと知らせる・時刻らしい列を落とす・話者の列の終わりの「:」を落とす
    同じ位置で続けて消えた行は 1 文にまとめる
    end の t（live は時計と直前の窓の終わりの大きいほう、file は直前の窓の終わり）・遅れて閉じる窓は窓の幅の目盛り
    欄の型や深さの F02 に連鎖した文を重ねない・P30 は名前の終わりを残す
(z10) 7 回目の決め（K18・K20・K23）:
    K18 メモ帳の突き合わせ: 6 回目の R1〜R4・x6・x8 と、並べ方の決め（同点は後ろの行を残す）、5 回目・4 回目の消して戻す
        場面を 1 保存ずつ流し、知らせの種類・発話・素材ログの発話を見る。戻した行・間の行・残った行・打ち直した行の文、
        発話を持たない行が消えても知らせない、改行が CRLF でも同じ、3000 行で 0.2 秒以内
    K18w 突き合わせの知らせは next の窓と next --last の最後の窓に出る。最後の発話より後ろの出来事は最後の窓
    K20 判断ログのパス: 「..」を断る・リンクを解いて照らす・フォルダは 1 つだけ作る・status・digest・監査も照らす
    K23 end -h の文・live の end の t は聞き終えた時計まで・next --last の終わりは時計と「始まり＋幅×3」の早いほう・
        watch の印の読み書きのやり直し・.gitignore が印の一時ファイルを外す
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT / "tools"))
sys.dont_write_bytecode = True   # rt を読み込んでも tools/ に __pycache__ を残さない（-B を付け忘れても）
import rt as RTM  # noqa: E402  open で始まるケースは、検査の関数を直に呼んで判定する

RT = KIT / "tools" / "rt.py"
AUDIT = KIT / "tools" / "audit_r2b.py"
RULES = KIT / "format" / "rules.json"
CASES = KIT / "tests" / "cases"
FX = KIT / "tests" / "fixtures"
V1_LOG = FX / "v1_small.jsonl"
V1_TXT = FX / "v1_small.txt"


TEST_ENV = dict(os.environ, KIKU_TEST_CLOCK="1")   # live の記録で --now を使う試験の環境
REAL_ENV = {k: v for k, v in os.environ.items() if k != "KIKU_TEST_CLOCK"}   # 本番と同じ環境


def run(args, stdin=None, tool=RT, env=None):
    """道具を呼ぶ。既定は試験の環境（live でも --now を受ける）。env=REAL_ENV で本番と同じ環境。"""
    r = subprocess.run([sys.executable, str(tool)] + [str(x) for x in args], input=stdin,
                       capture_output=True, text=True, encoding="utf-8", env=env or TEST_ENV)
    return r.returncode, r.stdout + r.stderr


def watch_once(log, now):
    """watch を 1 回だけ回す（試験用）。メモ帳の新しい行に now の時刻を押して素材ログに足す。"""
    code, out = run(["watch", log, "--once", "--now", now])
    assert code == 0, f"watch --once が落ちた:\n{out}"
    return out


def dumps(e):
    return json.dumps(e, ensure_ascii=False, separators=(",", ":"))


def write_jsonl(path, events):
    """1 行 1 イベントで書く。片割れのサロゲートを含む行だけは \\u の字面で書く（UTF-8 にできないため）。"""
    with open(path, "wb") as f:
        for e in events:
            try:
                line = dumps(e).encode("utf-8")
            except UnicodeEncodeError:
                line = json.dumps(e, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
            f.write(line + b"\n")


def write_sidecar(log, t, lines):
    """next が窓を閉じたときに残す覚え書きと同じ形。"""
    Path(log).with_name(Path(log).stem + ".next.json").write_text(
        json.dumps({"t": t, "lines": lines, "attempt": 1, "violations": [], "history": []}), encoding="utf-8")


# ------------------------------------------------------------ (a) cases

# tests/cases と同じ形の追加ケース。共通の素材は「道具の置き場」（話者は甲・乙、3 発話）
_OPEN = {"e": "open", "v": 2, "name": "道具の置き場", "t0": "2026-10-07T09:00:00Z", "mode": "live", "window": 30, "known": ""}
_PREFIX = [
    _OPEN,
    {"e": "step", "n": 1, "lines": [1, 2], "t": [0, 30], "at": "2026-10-07T09:00:31Z"},
    {"e": "list", "id": "L1", "t": 1, "who": "甲", "n": 2, "items": ["棚", "箱"]},
    {"e": "group", "id": "A", "t": 10, "span": [10, None], "lb": "（仮）棚の話", "kind": "start"},
    {"e": "card", "id": "C1", "t": 1, "d": 0, "role": "claim", "who": "甲", "src": [1], "li": ["L1", 1],
     "ti": "置き場は棚か箱か", "b": "二つの案を並べた。"},
    {"e": "hold", "id": "H1", "t": 20, "who": "乙", "q": "棚の高さはどれにするか"},
    {"e": "note", "t": 30, "x": "二つの案が出た。"},
]
_STEP2 = {"e": "step", "n": 2, "lines": [3, 3], "t": [30, 60]}
_NOTE2 = {"e": "note", "t": 60, "x": "棚に決まりかけている。"}
_CLOCK2 = "2026-10-07T09:01:02Z"
_V1_PREFIX = [
    {"e": "open", "v": 1, "name": "古い形の記録", "chunk": 3},
    {"e": "step", "n": 1, "lines": [1, 3], "t": [0, 30]},
    {"e": "card", "id": "C1", "t": 2, "d": 0, "role": "claim", "ti": "最初の主張", "b": ""},
]


def _case(name, prefix, batch, expect, clock=_CLOCK2, **kw):
    return {"name": name, "log_prefix": prefix, "batch": batch, "expect": expect, "clock": clock, **kw}


INLINE_CASES = [
    # 2. fix(span) の起点が括りの印より後 → P14
    _case("拒否：fix(span) の起点が括りの印より後", _PREFIX,
          [_STEP2, {"e": "fix", "id": "A", "t": 40, "field": "span", "now": [12, 40]}, _NOTE2], "reject", expect_rule="P14"),
    _case("受理：fix(span) の起点が括りの印と同じ", _PREFIX,
          [_STEP2, {"e": "fix", "id": "A", "t": 40, "field": "span", "now": [10, 40]}, _NOTE2], "accept"),
    # 3. fix(items) の各項目に字数の上限 → P14
    _case("拒否：fix(items) の項目が 51 字", _PREFIX,
          [_STEP2, {"e": "fix", "id": "L1", "t": 40, "field": "items", "now": ["棚", "箱" * 51]}, _NOTE2], "reject", expect_rule="P14"),
    _case("拒否：fix(items) の項目が空", _PREFIX,
          [_STEP2, {"e": "fix", "id": "L1", "t": 40, "field": "items", "now": ["棚", ""]}, _NOTE2], "reject", expect_rule="P14"),
    # 4. step の追記に end・pause を混ぜる → P02
    _case("拒否：step と end を同じ追記に", _PREFIX, [_STEP2, _NOTE2, {"e": "end", "t": 60}], "reject", expect_rule="P02"),
    _case("拒否：step と pause を同じ追記に", _PREFIX,
          [_STEP2, {"e": "pause", "t": 60, "why": "休憩"}, _NOTE2], "reject", expect_rule="P02"),
    _case("拒否：end にイベントを続ける", _PREFIX, [{"e": "end", "t": 30}, _NOTE2], "reject", expect_rule="P02"),
    # 5. 知らない版 → F07（黙って v1 にしない）
    _case("拒否：open.v が 3", [], [dict(_OPEN, v=3)], "reject", expect_rule="F07"),
    _case("拒否：open.v が文字列", [], [dict(_OPEN, v="2")], "reject", expect_rule="F07"),
    _case("拒否：open.v が 0", [], [dict(_OPEN, v=0)], "reject", expect_rule="F07"),
    _case("受理：open.v が 1（v1 の記録を始める）", [], [{"e": "open", "v": 1, "name": "古い形の記録", "chunk": 3}], "accept"),
    # 7. v1 でも欄の定義の範囲は見る（fix(d) の負、card.d の負）
    _case("拒否：v1 の fix(d) が負", _V1_PREFIX,
          [{"e": "step", "n": 2, "lines": [4, 6], "t": [30, 60]}, {"e": "fix", "id": "C1", "t": 32, "field": "d", "was": 0, "now": -1}],
          "reject", expect_rule="P14"),
    _case("拒否：v1 のカードの d が負", _V1_PREFIX,
          [{"e": "step", "n": 2, "lines": [4, 6], "t": [30, 60]}, {"e": "card", "id": "C2", "t": 32, "d": -1, "role": "claim", "ti": "x", "b": ""}],
          "reject", expect_rule="F04"),
    _case("受理：v1 の fix(d)（was つき）", _V1_PREFIX,
          [{"e": "step", "n": 2, "lines": [4, 6], "t": [30, 60]}, {"e": "fix", "id": "C1", "t": 32, "field": "d", "was": 0, "now": 1}], "accept"),
    _case("拒否：v1 でも lines は 2 つ", _V1_PREFIX,
          [{"e": "step", "n": 2, "lines": [4, 6, 8], "t": [30, 60]}], "reject", expect_rule="F02"),
    # 9. P24 は欄ごと・語ごと、P25 は保留×カードごと（件数は verify.js と同じ）
    _case("受理＋警告：推量語が 3 つ（ti に 1・b に 2）", _PREFIX,
          [_STEP2, {"e": "card", "id": "C2", "t": 35, "d": 1, "role": "case", "who": "乙", "src": [3], "li": None,
                    "ti": "棚だろうと言った", "b": "箱かもしれないし、おそらく違う。"}, _NOTE2],
          "accept", expect_warn="P24", expect_warn_count=3),
    _case("受理＋警告：閉じ忘れの疑いが 2 枚", _PREFIX,
          [_STEP2, {"e": "card", "id": "C2", "t": 35, "d": 1, "role": "case", "who": "乙", "src": [3], "li": None,
                    "ti": "棚の高さは胸まで", "b": ""},
           {"e": "card", "id": "C3", "t": 36, "d": 1, "role": "case", "who": "乙", "src": [3], "li": None,
            "ti": "棚の高さは目線", "b": ""}, _NOTE2],
          "accept", expect_warn="P25", expect_warn_count=2),
    # 10. open.known の上限（規則表の limits に open.known があるとき F04）
    _case("拒否：open.known が 2001 字", [], [dict(_OPEN, known="前" * 2001)], "reject", expect_rule="F04"),
    _case("受理：open.known が 2000 字", [], [dict(_OPEN, known="前" * 2000)], "accept"),
    # 11. 欄の壊れたカードでも id は取る: 後ろの close.by は P10 を重ねず、採番も進む
    _case("拒否：壊れたカードを指す close.by（P10 は出ない）", _PREFIX,
          [_STEP2, {"e": "card", "id": "C2", "t": 35, "d": 1, "role": "case", "who": "乙", "src": [3], "ti": "x" * 51, "b": ""},
           {"e": "close", "id": "H1", "t": 36, "as": "胸まで", "by": ["C2"]},
           {"e": "card", "id": "C3", "t": 37, "d": 1, "role": "case", "who": "乙", "src": [3], "ti": "次のカード", "b": ""}, _NOTE2],
          "reject", expect_rule="F04", forbid_rules=["P10", "P11"]),
    # 共通の決め (b): 文字数の上限は v1 では見ない（v1 は limits が false）
    _case("受理：v1 では ti の字数を縛らない", _V1_PREFIX,
          [{"e": "step", "n": 2, "lines": [4, 6], "t": [30, 60]}, {"e": "card", "id": "C2", "t": 32, "d": 0, "role": "claim", "ti": "x" * 80, "b": ""}], "accept"),
    # (p) 分析役が step・end・pause に書いた at は、欄の検査より前に捨てる（F02・F05 にしない）
    _case("受理：分析役が書いた step.at が数でも捨てる", _PREFIX, [dict(_STEP2, at=5), _NOTE2], "accept", expect_step_at=_CLOCK2),
    _case("受理：分析役が書いた step.at が null でも捨てる", _PREFIX, [dict(_STEP2, at=None), _NOTE2], "accept", expect_step_at=_CLOCK2),
    _case("受理：分析役が書いた pause.at が壊れていても捨てる", _PREFIX, [{"e": "pause", "t": 30, "why": "休憩", "at": "きのう"}], "accept",
          expect_in_log=[f'"at":"{_CLOCK2}"']),
    _case("受理：v1 の step に書いた at は欄ごと落とす", _V1_PREFIX, [{"e": "step", "n": 2, "lines": [4, 6], "t": [30, 60], "at": "x"}], "accept",
          expect_not_in_log=['"at":"x"']),
    # (o) 整数の欄の 2.0 は整数として受け、書くときに 2 に直す
    _case("受理：整数の欄の 2.0（step.n・card.d・li の番目）", _PREFIX,
          [dict(_STEP2, n=2.0), {"e": "card", "id": "C2", "t": 35, "d": 1.0, "role": "case", "who": "乙", "src": [3.0], "li": ["L1", 2.0],
                                "ti": "箱は使わない", "b": ""}, _NOTE2], "accept",
          expect_in_log=['"n":2,', '"d":1,', '"src":[3]', '"li":["L1",2]'], expect_not_in_log=['2.0', '1.0', '3.0']),
    _case("受理：open.v が 2.0 は版 2", [], [dict(_OPEN, v=2.0)], "accept", expect_in_log=['"v":2,']),
    _case("受理：fix(d) の was が 0.0（現状は 0。JSON の文字列で比べると同じ）", _PREFIX,
          [_STEP2, {"e": "fix", "id": "C1", "t": 40, "field": "d", "was": 0.0, "now": 1.0}, _NOTE2], "accept",
          expect_in_log=['"was":0,"now":1']),
    # (o) 版の判定は型も比べる。true は 1 ではない
    _case("拒否：open.v が true", [], [dict(_OPEN, v=True)], "reject", expect_rule="F07"),
    # (o) 正規表現は末尾まで当てる（末尾の改行は違反）
    _case("拒否：open.t0 の末尾に改行", [], [dict(_OPEN, t0="2026-10-07T09:00:00Z\n")], "reject", expect_rule="F02"),
    _case("拒否：top.prev の末尾に改行", _PREFIX,
          [_STEP2, {"e": "top", "id": "C1", "t": 40, "prev": "C1\n"}, _NOTE2], "reject", expect_rule="F06"),
    _case("拒否：card.id の末尾に改行", _PREFIX,
          [_STEP2, {"e": "card", "id": "C2\n", "t": 35, "d": 1, "role": "case", "who": "乙", "src": [3], "ti": "x", "b": ""}, _NOTE2],
          "reject", expect_rule="F06"),
    # (o) was と現状は JSON の文字列で比べる（false と 0 は別）
    _case("拒否：fix(d) の was が false（現状は 0）", _PREFIX,
          [_STEP2, {"e": "fix", "id": "C1", "t": 40, "field": "d", "was": False, "now": 1}, _NOTE2], "reject", expect_rule="P14"),
    _case("拒否：rename の was が数（現状は文字列）", _PREFIX,
          [_STEP2, {"e": "rename", "id": "A", "t": 40, "was": 1, "now": "棚の話"}, _NOTE2], "reject", expect_rule="F02"),
    # (o) オブジェクトでない行は落ちずに F07
    _case("拒否：オブジェクトでない行（文字列）", _PREFIX, [_STEP2, "ただの文字列", _NOTE2], "reject", expect_rule="F07"),
    _case("拒否：オブジェクトでない行（配列と null）", _PREFIX, [_STEP2, [1, 2], None, _NOTE2], "reject", expect_rule="F07"),
    # (n) 欄の min/max は、その版に在る欄だけ（v1 の open.window は v1 に無い）
    _case("受理：v1 の open の window 0（v1 に無い欄の範囲は見ない）", [], [{"e": "open", "name": "古い形の記録", "chunk": 3, "window": 0}], "accept"),
    _case("拒否：v1 の open の chunk 0（v1 に在る欄の範囲は見る）", [], [{"e": "open", "name": "古い形の記録", "chunk": 0}], "reject",
          expect_rule="F04"),
    # (m) pause は読み終えた所より先に置けない
    _case("拒否：pause の時刻が読み終えた所より先", _PREFIX, [{"e": "pause", "t": 45, "why": "休憩"}], "reject", expect_rule="P22"),
    _case("拒否：まだステップが無いのに先の時刻の pause", [_OPEN], [{"e": "pause", "t": 600, "why": "休憩"}], "reject", expect_rule="P22"),
    _case("受理：まだステップが無いときの 0 の pause", [_OPEN], [{"e": "pause", "t": 0, "why": "休憩"}], "accept"),
    # (l) live の記録では、聞き終える前に判断を押せない（聞き始めより前の壁時計も）
    _case("拒否：live で聞き始めより前の壁時計", _PREFIX, [_STEP2, _NOTE2], "reject", clock="2026-10-07T08:00:00Z", expect_rule="P27"),
]


def judge(c, code, out, before, after):
    """受理／拒否の期待と照らす。合っていれば None、違えば理由。"""
    if c["expect"] == "accept":
        if code != 0:
            return f"受理されるはずが終了コード {code}"
        if c.get("expect_warn"):
            n = sum(1 for l in out.splitlines() if f"{c['expect_warn']}:" in l)
            if n == 0:
                return f"警告 {c['expect_warn']} が出ていない"
            if c.get("expect_warn_count") and n != c["expect_warn_count"]:
                return f"警告 {c['expect_warn']} が {n} 件（期待 {c['expect_warn_count']} 件）"
        if c.get("expect_step_at"):
            steps = [json.loads(l) for l in after.splitlines() if l.strip() and '"e":"step"' in l]
            if steps[-1].get("at") != c["expect_step_at"]:
                return f"step.at が {steps[-1].get('at')}（期待 {c['expect_step_at']}）"
        added = after[len(before):]
        for x in c.get("expect_in_log", []):
            if x not in added:
                return f"書いた行に {x!r} が無い:\n{added}"
        for x in c.get("expect_not_in_log", []):
            if x in added:
                return f"書いた行に {x!r} がある:\n{added}"
        return None
    if code == 0:
        return "拒否されるはずが受理された"
    if f"{c['expect_rule']}:" not in out:
        return f"違反文に {c['expect_rule']} が無い"
    for r in c.get("forbid_rules", []):
        if f"{r}:" in out:
            return f"違反文に {r} があってはいけない"
    if after != before:
        return "拒否なのにログが変わった"
    return None


def run_open_case(c, d):
    """open で始まるケース。append は open を受けない（P01）ので、

    (1) rt.py append にかけて P01 で拒まれ、ログが一字も動かないことを確かめ、
    (2) 検査器そのもの（rt.py の check_batch。ページの検査器と同じ判定）にかけて期待と照らす。
    """
    log, batch = d / "t.jsonl", d / "b.jsonl"
    write_jsonl(log, c["log_prefix"])
    write_jsonl(batch, c["batch"])
    before = log.read_bytes()
    code, out = run(["append", log, batch, "--now", c["clock"]])
    if code != 2 or "P01:" not in out or log.read_bytes() != before:
        return f"append が open を受けた（または P01 で拒まない。終了コード {code}）", out
    rules = RTM.load_rules()
    st = RTM.fold(c["log_prefix"], rules)
    if st.errors:
        return "前置きのログが規則に反している（open で始まるケースの前置きは空のはず）", "\n".join(RTM.State.lines(st.errors))
    written = RTM.check_batch(st, c["batch"], c["clock"])
    lines = RTM.State.lines(st.errors) + RTM.State.lines(st.warnings)
    text = "\n".join(lines)
    ok = not st.errors
    after = "" if not ok else "".join(RTM.dumps(RTM._canon(e)) + "\n" for e in written)
    return judge(c, 0 if ok else 2, text, "", after), text


def run_case(c, d):
    """1件のケースを rt.py append にかけ、期待と違えば理由を返す（合っていれば None）。"""
    first = c["batch"][0] if c["batch"] else {}
    if isinstance(first, dict) and first.get("e") == "open":
        return run_open_case(c, d)
    log, batch = d / "t.jsonl", d / "b.jsonl"
    write_jsonl(log, c["log_prefix"])
    write_jsonl(batch, c["batch"])
    args = ["append", log, batch, "--now", c["clock"]]
    if "window" in c:
        write_sidecar(log, c["window"]["t"], c["window"]["lines"])
    elif "src" in c and first.get("e") == "step" and isinstance(first.get("t"), list) and isinstance(first.get("lines"), list):
        write_sidecar(log, first["t"], first["lines"])
    if "src" in c:
        mode = (c["log_prefix"][0].get("mode") if c["log_prefix"] else None)
        if mode == "live":
            # watch が素材ログに残した行として置く
            write_jsonl(d / "t.src.jsonl", [dict(u, at=c["clock"]) for u in c["src"]])
        else:
            src = d / "src.txt"
            with open(src, "w", encoding="utf-8", newline="\n") as g:
                for u in c["src"]:
                    g.write(f"{u['t'] // 60}:{u['t'] % 60:02d}\t{u['who'] or ''}\t{u['text']}\n")
            args += ["--transcript", src]
    before = log.read_bytes().decode("utf-8")
    code, out = run(args)
    after = log.read_bytes().decode("utf-8")
    return judge(c, code, out, before, after), out


def test_cases(tmp):
    files = sorted(CASES.glob("*.json"))
    assert files, "cases が無い"
    todo = [(f.name, json.loads(f.read_text(encoding="utf-8"))) for f in files]
    todo += [(f"inline{i:02d}", c) for i, c in enumerate(INLINE_CASES, 1)]
    bad = []
    for label, c in todo:
        why, out = run_case(c, Path(tempfile.mkdtemp(dir=tmp)))
        if why:
            bad.append(f"[{label}] {c['name']}: {why}\n{out}")
    assert not bad, "\n".join(bad)
    return len(files), len(INLINE_CASES)


# ------------------------------------------------------------ (b) fixture の作り直し

def split_batches(events):
    batches, cur = [], []
    for e in events:
        if e["e"] in ("open", "step", "end", "pause") and cur:
            batches.append(cur)
            cur = []
        cur.append(e)
    batches.append(cur)
    return batches


def test_rebuild_fixture(tmp):
    d = Path(tempfile.mkdtemp(dir=tmp))
    shutil.copy(FX / "meeting10.txt", d / "meeting10.txt")
    log, bf = d / "m.jsonl", d / "b.jsonl"
    lines = [l for l in (FX / "meeting10.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    events = [json.loads(l) for l in lines]
    n_steps = 0
    for b in split_batches(events):
        first = b[0]
        if first["e"] == "open":
            # append は open を受けない（新しい記録の入口は rt.py open だけ）。fixture の open は手で置く
            write_jsonl(bf, b)
            # 無い判断ログには書き足さない（K28。使う人に向けた文で断り、ファイルを作らない）
            code, out = run(["append", log, bf])
            assert code == 1 and "がありません" in out and not log.exists(), f"無い判断ログに書き足した:\n{out}"
            log.write_bytes(b"")
            code, out = run(["append", log, bf])
            assert code == 2 and "P01:" in out and log.read_bytes() == b"", f"append が open を受けた:\n{out}"
            write_jsonl(log, b)
            continue
        if first["e"] == "step":
            if first["n"] == 2:
                # 素材のある記録では、next を経ない append（覚え書きが無い）は P07 で拒まれる
                write_jsonl(bf, b)
                code, out = run(["append", log, bf, "--now", first["at"]])
                assert code == 2 and "P07:" in out, f"next を経ない append が通った:\n{out}"
            code, out = run(["next", log, "--json"])
            assert code == 0, out
            pack = json.loads(out)
            new = pack["new"]
            got = [new["t"], [new["lines"][0]["i"], new["lines"][-1]["i"]]]
            assert got == [first["t"], first["lines"]], f"S{first['n']}: next の窓が合わない {got}"
            assert pack["now"]["n"] == first["n"]
            assert "next_ids" in pack and pack["next_ids"]["card"].startswith("C")
            n_steps += 1
        if first["e"] == "end":
            code, out = run(["end", log, "--now", first["at"], "--t", first["t"]])
            assert code == 0, out
            continue
        write_jsonl(bf, b)
        args = ["append", log, bf]
        if first["e"] == "step":
            args += ["--now", first["at"]]
        code, out = run(args)
        assert code == 0, f"追記に失敗: {first}\n{out}"
        if first["e"] == "step" and first["n"] == 3:
            assert "P25:" in out, "ステップ 3 で P25 の警告が出るはず（H2 と C5）"
    assert log.read_text(encoding="utf-8").splitlines() == lines, "組み直したログが元と違う"
    code, out = run(["next", log])
    assert "ここで終わり" in out, "終わりを伝えていない"
    assert not (d / "m.next.json").exists(), "追記の後に窓の覚え書きが残っている"
    code, out = run(["digest", log, "--full"])
    assert code == 0 and "H7" in out and "E " in out, "digest --full に開いている保留と章が無い"
    return n_steps


def to_reply(step_events):
    """fixture のステップを分析役の返事の形（schema.json）に直す。"""
    evs = []
    note = None
    for e in step_events[1:]:
        e = dict(e)
        if e["e"] == "note":
            note = e
            continue
        if e["e"] in ("fix", "rename"):
            e.pop("was", None)
        if e["e"] == "hold":
            e.pop("kind", None)
        if e["e"] == "card" and "li" not in e:
            e["li"] = None
        evs.append(e)
    return {"step": {"t": step_events[0]["t"]}, "events": evs, "note": {"x": note["x"]}}


def test_rebuild_fixture_as_replies(tmp):
    d = Path(tempfile.mkdtemp(dir=tmp))
    shutil.copy(FX / "meeting10.txt", d / "meeting10.txt")
    log, bf = d / "m.jsonl", d / "reply.json"
    lines = [l for l in (FX / "meeting10.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    events = [json.loads(l) for l in lines]
    broken = {"step": {"t": [150, 180]},
              "events": [{"e": "card", "id": "C10", "t": 190, "d": 1, "role": "claim", "who": "日向",
                          "src": [], "li": ["L1", 1], "ti": "あ" * 51, "b": ""}],
              "note": {"x": "壊れた返事"}}
    gap_done = False
    for b in split_batches(events):
        first = b[0]
        if first["e"] == "open":
            write_jsonl(log, b)  # append は open を受けないので、fixture の open は手で置く
            continue
        if first["e"] == "end":
            code, out = run(["end", log, "--now", first["at"]])
            assert code == 0, out
            continue
        if first["n"] == 6:
            for k in range(1, 4):
                code, out = run(["next", log, "--json"])
                assert code == 0, out
                pack = json.loads(out)
                assert pack["attempt"] == k, f"attempt が {pack['attempt']}（期待 {k}）"
                if k > 1:
                    assert any(v.startswith("P09:") for v in pack["violations"]), "前の違反文が pack に無い"
                bf.write_text(json.dumps(broken, ensure_ascii=False), encoding="utf-8")
                code, out = run(["append", log, bf, "--now", first["at"]])
                if k < 3:
                    assert code == 2, f"{k} 回目は拒否（終了コード 2）のはず: {code}\n{out}"
                else:
                    assert code == 3, f"3 回目は未確定の窓を書く（終了コード 3）のはず: {code}\n{out}"
                    gap_done = True
            continue
        code, out = run(["next", log, "--json"])
        assert code == 0, out
        pack = json.loads(out)
        if first["n"] == 7:
            assert [u["i"] for u in pack["gap_lines"]] == [25, 26, 27, 28, 29], "gap_lines が未確定の窓の発話でない"
            assert any(h.get("kind") == "gap" for h in pack["open_holds"]), "未確定の窓の保留が open_holds に無い"
        bf.write_text(json.dumps(to_reply(b), ensure_ascii=False), encoding="utf-8")
        code, out = run(["append", log, bf, "--now", first["at"], "--json"])
        assert code == 0, f"返事の形の追記に失敗: S{first['n']}\n{out}"
        pack = json.loads(out)
        assert pack["next_ids"] and pack["new"] is None
    assert gap_done
    got = log.read_text(encoding="utf-8").splitlines()
    # 未確定の窓の所感（違反文を並べたもの）だけは、違反の id と並びで比べる（違反文の言い回しは道具の版で変わる）
    k = next(i for i, l in enumerate(lines) if '"kind":"gap"' in l) + 1

    def ids(line):
        x = json.loads(line)["x"]
        return re.findall(r"(?:^| / )([PF][0-9]{2}):", x), x.endswith("（3回とも同じ違反）")
    assert got[:k] + got[k + 1:] == lines[:k] + lines[k + 1:], "返事の形で組み直したログが元と違う"
    # 壊れた返事のカードは src が空。v2 のカードは根拠の発話を 1 つ以上指す（P29）ので、fixture の所感（P09・F04）の
    # 間に P29 が入る（fixture は JSONL の作り直しでそのまま使うので、書き換えない）
    want = ids(lines[k])
    assert want == (["P09", "F04"], True), f"fixture の未確定の窓の所感が想定と違う:\n{lines[k]}"
    assert ids(got[k]) == (["P09", "P29", "F04"], True), f"未確定の窓の所感が違う:\n{got[k]}\n{lines[k]}"


# ------------------------------------------------------------ (c) v1 の回帰（架空の小さな記録）

def test_v1_rebuild(tmp):
    log = Path(tmp) / "v1-rebuild.jsonl"
    evs = [l for l in V1_LOG.read_text(encoding="utf-8").splitlines() if l.strip()]
    batches, cur = [], []
    for l in evs:
        if json.loads(l)["e"] in ("open", "step") and cur:
            batches.append(cur)
            cur = []
        cur.append(l)
    batches.append(cur)
    for b in batches:
        first = json.loads(b[0])
        if first["e"] == "open":
            # v1 の形のログは、元からあるログに書き足すことしかできない。append は v1 の open も受けない
            code, out = run(["append", log, "--transcript", V1_TXT], "\n".join(b) + "\n")
            assert code == 1 and "がありません" in out and not log.exists(), f"無い判断ログに書き足した:\n{out}"
            log.write_bytes(b"")
            code, out = run(["append", log, "--transcript", V1_TXT], "\n".join(b) + "\n")
            assert code == 2 and "P01:" in out and log.read_bytes() == b"", f"append が v1 の open を受けた:\n{out}"
            log.write_text("\n".join(b) + "\n", encoding="utf-8")
            continue
        if first["e"] == "step":
            _, out = run(["next", log, "--transcript", V1_TXT])
            m = re.search(r"--- (\d+)〜(\d+)行 ---", out)
            assert m and [int(m.group(1)), int(m.group(2))] == first["lines"], f"S{first['n']}: next の行が合わない\n{out}"
        code, out = run(["append", log, "--transcript", V1_TXT], "\n".join(b) + "\n")
        assert code == 0, f"追記に失敗: S{first.get('n')}\n{out}"
    assert log.read_text(encoding="utf-8").splitlines() == evs, "組み直した v1 の形のログが元と違う"
    _, out = run(["next", log, "--transcript", V1_TXT])
    assert "ここで終わり" in out, "終わりを伝えていない"
    code, out = run(["status", log])
    assert code == 0 and "開いている保留（0件）" in out, f"v1 の status が読めない:\n{out}"
    return len(batches)


def test_v1_rejects(tmp):
    base = Path(tmp) / "v1-base.jsonl"
    with open(V1_LOG, encoding="utf-8") as f, open(base, "w", encoding="utf-8", newline="\n") as g:
        for _ in range(4):  # open と S1（card・hold）
            g.write(f.readline())
    s2 = '{"e":"step","n":2,"lines":[5,8],"t":[17,24]}'
    cases = {
        "行を飛ばす": ("P04", '{"e":"step","n":2,"lines":[9,10],"t":[33,33]}'),
        "chunk を超える": ("P05", '{"e":"step","n":2,"lines":[5,10],"t":[17,33]}'),
        "窓の終わりより後のカード": ("P09", s2 + '\n{"e":"card","id":"CX","t":120,"d":0,"role":"claim","ti":"x","b":"x"}'),
        "無い保留の決着": ("P13", s2 + '\n{"e":"close","id":"H99","t":20,"as":"x"}'),
        "一度に窓が二つ": ("P02", s2 + '\n{"e":"step","n":3,"lines":[9,10],"t":[33,33]}'),
        "番号が飛ぶ": ("P03", '{"e":"step","n":3,"lines":[5,8],"t":[17,24]}'),
        "ない役割": ("F03", s2 + '\n{"e":"card","id":"CX","t":20,"d":0,"role":"foo","ti":"x","b":"x"}'),
        "v1 に無い種類（list）": ("F07", s2 + '\n{"e":"list","id":"L1","t":20,"who":null,"n":2,"items":[]}'),
        "fix(d) が負": ("P14", s2 + '\n{"e":"fix","id":"C1","t":20,"field":"d","was":0,"now":-1}'),
        "文字起こしに無い行": ("P07", s2),
    }
    # 「文字起こしに無い行」は、行の続きは正しいが素材が 6 行しか無いときの拒否。短い素材を別に用意する
    short_txt = Path(tmp) / "v1-short.txt"
    short_txt.write_text("".join(V1_TXT.read_text(encoding="utf-8").splitlines(keepends=True)[:6]), encoding="utf-8")
    for name, (rule, body) in cases.items():
        p = Path(tmp) / "case.jsonl"
        shutil.copy(base, p)
        before = p.read_text(encoding="utf-8")
        txt = short_txt if name == "文字起こしに無い行" else V1_TXT
        code, out = run(["append", p, "--transcript", txt], body + "\n")
        assert code != 0, f"[{name}] が通ってしまった"
        assert f"{rule}:" in out, f"[{name}] の違反文に {rule} が無い:\n{out}"
        assert p.read_text(encoding="utf-8") == before, f"[{name}] のあとログが動いた"
    # 知らない版の記録には next も append も効かない（黙って v1 にしない）
    p = Path(tmp) / "v3.jsonl"
    write_jsonl(p, [{"e": "open", "v": 3, "name": "知らない版", "chunk": 3}])
    code, out = run(["next", p, "--transcript", V1_TXT])
    assert code != 0 and "F07:" in out, f"知らない版の next が通った:\n{out}"
    code, out = run(["append", p, "--transcript", V1_TXT], s2 + "\n")
    assert code != 0 and "F07:" in out and p.read_text(encoding="utf-8").count("\n") == 1, f"知らない版の append が通った:\n{out}"
    return len(cases)


# ------------------------------------------------------------ (d) live

def test_live(tmp):
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo = d / "live" / "k.jsonl", d / "memo.txt"
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", "2026-10-07T01:00:00Z"])
    assert code == 0, out
    memo.write_text("最初の発話です。\n0:12\t甲\t時刻つきの発話です。\n途中の行", encoding="utf-8")
    # watch が回っていないのにメモ帳に新しい行があれば、next は窓を出さない（next の時刻で行を押さない）
    code, out = run(["next", log, "--now", "2026-10-07T01:00:20Z"])
    assert code == 1 and "watch" in out and not (d / "live" / "k.src.jsonl").exists(), out
    out = watch_once(log, "2026-10-07T01:00:20Z")   # 行が 1:00:20 に届いた
    # メモ帳に打った時刻（0:12）は使わない。初めて見たときに一度だけ知らせる
    assert out.count(RTM.MEMO_TIME_TEXT) == 1, out
    code, out = run(["next", log, "--now", "2026-10-07T01:00:20Z"])
    assert code == 0 and "まだ閉じていません" in out, out
    code, out = run(["next", log, "--now", "2026-10-07T01:00:35Z", "--json"])
    assert code == 0, out
    new = json.loads(out)["new"]
    assert [u["i"] for u in new["lines"]] == [1, 2], "改行で終わらない行まで読んでいる"
    # 時刻はどの行も「watch が見た時刻 − 聞き始め」（20）。メモ帳の 0:12 は捨て、話者と本文だけ使う
    assert new["lines"][0]["t"] == 20 and new["lines"][1]["t"] == 20, "時刻の押し方が違う"
    assert new["lines"][1]["who"] == "甲", new["lines"][1]
    src = [json.loads(l) for l in (d / "live" / "k.src.jsonl").read_text(encoding="utf-8").splitlines()]
    utts = [u for u in src if "i" in u]
    assert len(utts) == 2 and all("at" in u for u in utts), "素材ログに壁時計が無い"
    assert [u["t"] for u in utts] == [20, 20], "素材ログに届いた時刻でない時刻がある"
    assert [r for r in src if r.get("ev") == "timecol"], "メモ帳の時刻を捨てた印が素材ログに無い"
    reply = {"step": {"t": [0, 30]},
             "events": [{"e": "card", "id": "C1", "t": 20, "d": 0, "role": "claim", "who": "甲",
                         "src": [1, 2], "li": None, "ti": "試しの発話", "b": ""}],
             "note": {"x": "試し。"}}
    bf = d / "b.json"
    bf.write_text(json.dumps(reply, ensure_ascii=False), encoding="utf-8")
    code, out = run(["append", log, bf, "--now", "2026-10-07T01:00:36Z"])
    assert code == 0, out
    bad = dict(reply)
    bad["events"] = [dict(reply["events"][0], id="C2", who="乙")]
    bad["step"] = {"t": [30, 60]}
    with open(memo, "a", encoding="utf-8") as f:
        f.write("\n")
    watch_once(log, "2026-10-07T01:01:05Z")
    code, out = run(["next", log, "--now", "2026-10-07T01:01:05Z"])
    assert code == 0 and "まだ閉じていません" in out, out  # 1:05 に初めて見た行は t=65。窓 1:00〜1:30 はまだ開いている
    assert not (d / "live" / "k.next.json").exists(), "窓が閉じていないのに覚え書きがある"
    bf.write_text(json.dumps(bad, ensure_ascii=False), encoding="utf-8")
    code, out = run(["append", log, bf, "--now", "2026-10-07T01:01:06Z"])
    assert code == 2 and "P07:" in out, f"窓が閉じる前の append が通った:\n{out}"
    code, out = run(["next", log, "--now", "2026-10-07T01:01:31Z"])
    assert code == 0 and "発話 3〜3" in out and "1:00〜1:30" in out, out
    code, out = run(["append", log, bf, "--now", "2026-10-07T01:01:32Z"])
    assert code == 2 and "P20:" in out, f"聞いた範囲に無い話者が通った:\n{out}"
    # 渡した窓（発話 3）がまだ追記されていないので、end は断る（K7）
    before = log.read_text(encoding="utf-8")
    code, out = run(["end", log, "--now", "2026-10-07T01:02:00Z"])
    assert code == 1 and "まだ渡していない発話が 1 件" in out and "next --last" in out, out
    assert log.read_text(encoding="utf-8") == before
    good = dict(bad, events=[dict(reply["events"][0], id="C2", t=65, src=[3])], step={"t": [60, 90]})
    bf.write_text(json.dumps(good, ensure_ascii=False), encoding="utf-8")
    code, out = run(["append", log, bf, "--now", "2026-10-07T01:01:33Z"])
    assert code == 0, out
    code, out = run(["end", log, "--now", "2026-10-07T01:02:00Z"])
    assert code == 0, out
    code, out = run(["next", log])
    assert "ここで終わり" in out


def test_live_requires_next(tmp):
    """素材のある live の記録で、next を経ない append・窓を自分で決めた append・未来の --now を拒む。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo = d / "live" / "k.jsonl", d / "memo.txt"
    memo.write_text("最初の発話です。\n二つ目の発話です。\n", encoding="utf-8")
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", "2026-10-07T01:00:00Z"])
    assert code == 0, out
    before = log.read_text(encoding="utf-8")
    bf = d / "b.jsonl"
    write_jsonl(bf, [{"e": "step", "n": 1, "lines": [1, 50], "t": [0, 90]},
                     {"e": "card", "id": "C1", "t": 85, "d": 0, "role": "claim", "who": None, "src": [40], "li": None,
                      "ti": "まだ語られていない時刻のカード", "b": ""},
                     {"e": "note", "t": 90, "x": "試し"}])
    # (1) next を経ない JSONL の append
    code, out = run(["append", log, bf, "--now", "2026-10-07T01:00:20Z"])
    assert code == 2 and "P07:" in out, f"next を経ない append が通った:\n{out}"
    assert log.read_text(encoding="utf-8") == before
    assert not (d / "live" / "k.src.jsonl").exists(), "append が素材ログに行を足している（足すのは watch だけ）"
    # (2) next が「まだ閉じていません」のとき覚え書きは無く、append は拒まれる
    watch_once(log, "2026-10-07T01:00:35Z")
    code, out = run(["next", log, "--now", "2026-10-07T01:00:35Z"])
    assert code == 0 and "まだ閉じていません" in out, out
    assert not (d / "live" / "k.next.json").exists()
    code, out = run(["append", log, bf, "--now", "2026-10-07T01:00:36Z"])
    assert code == 2 and "P07:" in out, out
    assert log.read_text(encoding="utf-8") == before
    # (3) 窓が閉じたあと、覚え書きと違う step は P07
    code, out = run(["next", log, "--now", "2026-10-07T01:01:05Z"])
    assert code == 0 and "0:30〜1:00" in out and "発話 1〜2" in out, out
    assert (d / "live" / "k.next.json").exists()
    code, out = run(["append", log, bf, "--now", "2026-10-07T01:01:06Z"])
    assert code == 2 and "P07:" in out and "0:30〜1:00" in out, out
    assert log.read_text(encoding="utf-8") == before
    # (4) 未来の --now は open・next・append・end・pause・watch のどれも受けない（live。試験の環境でも）
    for args in (["watch", log, "--once", "--now", "2999-01-01T00:00:00Z"],
                 ["next", log, "--now", "2999-01-01T00:00:00Z"],
                 ["append", log, bf, "--now", "2999-01-01T00:00:00Z"],
                 ["end", log, "--now", "2999-01-01T00:00:00Z"],
                 ["pause", log, "--now", "2999-01-01T00:00:00Z"],
                 ["open", d / "live" / "k2.jsonl", "--live", "--transcript", memo, "--now", "2999-01-01T00:00:00Z"]):
        code, out = run(args)
        assert code == 1 and "実時計より" in out, f"未来の --now が通った: {args[0]}\n{out}"
    assert log.read_text(encoding="utf-8") == before
    assert not (d / "live" / "k2.jsonl").exists()
    # file の記録では --now は自由（過去の記録を作り直す試験のため）
    src = d / "src.txt"
    src.write_text("0:01\t甲\t最初の発話です。\n", encoding="utf-8")
    code, out = run(["open", d / "f.jsonl", "--src", src, "--now", "2999-01-01T00:00:00Z"])
    assert code == 0, out
    # 正しい手順（next → 覚え書きどおりの step）は通る
    write_jsonl(bf, [{"e": "step", "n": 1, "lines": [1, 2], "t": [30, 60]},
                     {"e": "card", "id": "C1", "t": 35, "d": 0, "role": "claim", "who": None, "src": [1, 2], "li": None,
                      "ti": "二つの発話", "b": ""},
                     {"e": "note", "t": 60, "x": "試し"}])
    code, out = run(["append", log, bf, "--now", "2026-10-07T01:01:07Z"])
    assert code == 0, out
    assert not (d / "live" / "k.next.json").exists(), "追記の後に覚え書きが残っている"


# ------------------------------------------------------------ (e) audit

def test_audit(tmp):
    code, out = run([FX / "meeting10.jsonl"], tool=AUDIT)
    assert code == 0 and "違反 0" in out, out
    code, out = run([V1_LOG], tool=AUDIT)
    assert code == 0 and "違反 0" in out and "v1" in out, out
    d = Path(tempfile.mkdtemp(dir=tmp))
    events = [json.loads(l) for l in (FX / "meeting10.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    broken = [dict(e) for e in events]
    for e in broken:
        if e["e"] == "card" and e["id"] == "C3":
            e["t"] = 999
        if e["e"] == "step" and e["n"] == 9:
            e["at"] = "2026-10-07T08:00:00Z"
    p = d / "broken.jsonl"
    write_jsonl(p, broken)
    code, out = run([p], tool=AUDIT)
    assert code == 2 and "C3" in out and "S9" in out, out
    # 空の src のカード・整数でない窓の幅・上限ちょうどでない幅 0 の窓も、監査が数える
    broken = [dict(e) for e in events]
    broken[0]["window"] = 30.5
    for e in broken:
        if e["e"] == "card" and e["id"] == "C2":
            e["src"] = []
        if e["e"] == "step" and e["n"] == 4:
            e["t"] = [e["t"][0], e["t"][0]]
    p = d / "src_empty.jsonl"
    write_jsonl(p, broken)
    code, out = run([p], tool=AUDIT)
    assert code == 2 and "C2 の src が空" in out and "整数の秒" in out and "S4 の窓の幅が 0" in out, out
    # 知らない版は監査でも違反（版の判定は rt.py の規則表と同じ）
    unknown = [dict(events[0], v=3)] + events[1:]
    p = d / "unknown.jsonl"
    write_jsonl(p, unknown)
    code, out = run([p], tool=AUDIT)
    assert code == 2 and "知らない版" in out, out


# ------------------------------------------------------------ (f)〜(m) 窓の照らし直し・壁時計・値の厳しさ・壊れた返事・digest の上限・known の重なりの試験

T0 = "2026-10-07T01:00:00Z"


def at_plus(sec, base=T0):
    """T0 から sec 秒後の壁時計。"""
    from datetime import datetime, timedelta, timezone
    b = datetime.strptime(base, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return (b + timedelta(seconds=sec)).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_tsv(path, rows):
    """rows は (秒, 話者, 本文)。m:ss<TAB>話者<TAB>本文 で書く。"""
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        for t, who, text in rows:
            f.write(f"{t // 60}:{t % 60:02d}\t{who}\t{text}\n")


def reply(t, events=None, x="試し。"):
    return {"step": {"t": t}, "events": events or [], "note": {"x": x}}


def put(path, obj):
    Path(path).write_text(obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False), encoding="utf-8")


def card(i, t, src, who=None, ti="試しのカード"):
    return {"e": "card", "id": i, "t": t, "d": 0, "role": "claim", "who": who, "src": src, "li": None, "ti": ti, "b": ""}


def test_window_recompute(tmp):
    """(f) append は覚え書きを信じきらず、素材から窓を計算し直して照らす。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    # --- live: next を打たずに手で覚え書きを書いても通らない
    log, memo, bf = d / "live" / "k.jsonl", d / "memo.txt", d / "b.json"
    memo.write_text("最初の発話です。\n二つ目の発話です。\n", encoding="utf-8")
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    before = log.read_text(encoding="utf-8")
    side = log.with_name("k.next.json")
    put(side, {"t": [0, 90], "lines": [1, 50]})
    put(bf, reply([0, 90], [card("C1", 85, [40])]))
    code, out = run(["append", log, bf, "--now", at_plus(100)])
    assert code == 2 and "P07:" in out, f"手で書いた覚え書きで追記できた:\n{out}"
    assert log.read_text(encoding="utf-8") == before
    assert not log.with_name("k.src.jsonl").exists(), "append が素材ログを作った"
    # --- live: next が書いた覚え書きを、始まり・幅・発話の範囲で書き換えても通らない
    watch_once(log, at_plus(65))
    code, out = run(["next", log, "--now", at_plus(65)])  # 2 行とも t=65 → 窓 1:00〜1:30 はまだ開いている
    assert code == 0 and "まだ閉じていません" in out, out
    code, out = run(["next", log, "--now", at_plus(95)])
    assert code == 0 and "1:00〜1:30" in out and "発話 1〜2" in out, out
    good = loads_file(side)
    for bad_t, bad_lines, why in (([0, 90], [1, 2], "始まり"), ([60, 105], [1, 2], "終わり"), ([60, 90], [1, 1], "発話")):
        put(side, dict(good, t=bad_t, lines=bad_lines))
        put(bf, reply(bad_t, [card("C1", 65, [1])]))
        code, out = run(["append", log, bf, "--now", at_plus(120)])
        assert code == 2 and "P07:" in out and why in out, f"書き換えた覚え書き（{why}）で追記できた:\n{out}"
        assert log.read_text(encoding="utf-8") == before
    put(side, good)
    put(bf, reply([60, 90], [card("C1", 65, [1, 2])]))
    code, out = run(["append", log, bf, "--now", at_plus(96)])
    assert code == 0, f"next が書いたとおりの覚え書きで追記できない:\n{out}"
    # --- file: 手で書いた覚え書き（窓 0:00〜1:30）は、素材から計算した窓 0:00〜0:30 と違う
    src = d / "src.tsv"
    write_tsv(src, [(5, "甲", "一つ目"), (20, "乙", "二つ目"), (40, "甲", "三つ目"), (70, "乙", "四つ目")])
    flog = d / "f.jsonl"
    code, out = run(["open", flog, "--src", src, "--name", "試し", "--now", T0])
    assert code == 0, out
    fside = flog.with_name("f.next.json")
    before = flog.read_text(encoding="utf-8")
    put(fside, {"t": [0, 90], "lines": [1, 3]})
    jb = d / "b.jsonl"
    write_jsonl(jb, [{"e": "step", "n": 1, "lines": [1, 3], "t": [0, 90]}, card("C1", 40, [3], who="甲"), {"e": "note", "t": 90, "x": "試し"}])
    for k in range(3):  # 何回落としても、手で書いた覚え書きの窓で未確定の窓は書かれない
        code, out = run(["append", flog, jb, "--now", at_plus(10)])
        assert code == 2 and "P07:" in out, f"file で手で書いた覚え書きの窓が通った（{k + 1} 回目）:\n{out}"
    assert flog.read_text(encoding="utf-8") == before
    put(fside, {"t": [0, 30], "lines": [1, 3]})
    write_jsonl(jb, [{"e": "step", "n": 1, "lines": [1, 3], "t": [0, 30]}, card("C1", 20, [2], who="乙"), {"e": "note", "t": 30, "x": "試し"}])
    code, out = run(["append", flog, jb, "--now", at_plus(10)])
    assert code == 2 and "P07:" in out and "1〜2" in out, f"窓の発話の範囲を広げた覚え書きが通った:\n{out}"
    code, out = run(["next", flog])
    assert code == 0 and "0:00〜0:30" in out and "発話 1〜2" in out, out


def loads_file(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def test_material_named(tmp):
    """(g) 素材があるかどうかは open で決まる。名指しした素材が見つからなくても免除しない。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src = d / "src.tsv"
    write_tsv(src, [(5, "甲", "一つ目"), (20, "乙", "二つ目"), (40, "甲", "三つ目")])
    log = d / "k.jsonl"
    code, out = run(["open", log, "--src", src, "--name", "試し"])
    assert code == 0, out
    before = log.read_text(encoding="utf-8")
    jb = d / "b.jsonl"
    write_jsonl(jb, [{"e": "step", "n": 1, "lines": [1, 3], "t": [0, 90]}, card("C1", 88, [3], who="丙"), {"e": "note", "t": 90, "x": "試し"}])
    # open で名指しした素材と別のファイル（無いファイルも）を --transcript に渡しても、免除も差し替えもしない
    code, out = run(["append", log, jb, "--transcript", d / "無い.tsv"])
    assert code == 2 and "P07:" in out and "別のファイル" in out, f"無い素材を渡すと免除された:\n{out}"
    # next が書いた覚え書きがあっても、素材ファイルが消えていれば免除しない
    code, out = run(["next", log])
    assert code == 0, out
    src.rename(d / "よけた.tsv")
    write_jsonl(jb, [{"e": "step", "n": 1, "lines": [1, 2], "t": [0, 30]}, card("C1", 20, [2], who="丙"), {"e": "note", "t": 30, "x": "試し"}])
    code, out = run(["append", log, jb])
    assert code == 2 and "P07:" in out and "素材が見つかりません" in out, f"素材が消えたら免除された:\n{out}"
    assert log.read_text(encoding="utf-8") == before
    code, out = run(["status", log])
    assert code == 0, f"素材が無いと status が落ちる:\n{out}"
    # live: メモ帳がまだ無い（会議の前）ときも、next を経ない追記は通らない。メモ帳を置くフォルダ（判断ログと同じ
    # フォルダ。open が作った）があるので、open は空のメモ帳を作る（K27）
    llog, memo = d / "live" / "m.jsonl", d / "live" / "m.txt"
    code, out = run(["open", llog, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0 and memo.read_bytes() == b"" and "空のファイルとして作りました" in out, out
    write_jsonl(jb, [{"e": "step", "n": 1, "lines": [1, 20], "t": [0, 90]}, card("C1", 89, [20]), {"e": "note", "t": 90, "x": "試し"}])
    code, out = run(["append", llog, jb, "--now", at_plus(100)])
    assert code == 2 and "P07:" in out, f"メモ帳が無いうちに next を経ない追記が通った:\n{out}"
    code, out = run(["next", llog, "--now", at_plus(10)])
    assert code == 0 and "まだありません" in out, out
    memo.write_text("会議を始めます。\n一つ目の議題です。\n", encoding="utf-8")
    watch_once(llog, at_plus(20))
    code, out = run(["next", llog, "--now", at_plus(20)])
    assert code == 0 and "まだ閉じていません" in out, out
    code, out = run(["next", llog, "--now", at_plus(31)])
    assert code == 0 and "発話 1〜2" in out, f"会議の最初の発話が飛ばされた:\n{out}"
    # live の open には --transcript が要る（素材の無い live の記録を作らない）
    code, out = run(["open", d / "live" / "n.jsonl", "--live", "--name", "試し"])
    assert code == 1 and "--transcript" in out and not (d / "live" / "n.jsonl").exists(), out


def test_wall_clock(tmp):
    """(h) live の窓は壁時計で閉じ、聞き終える前の壁時計（過去の --now も）は P27。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo, bf = d / "live" / "k.jsonl", d / "memo.txt", d / "b.json"
    # メモ帳に先の時刻（2:00）が打ってあっても使わない。窓は壁時計が窓の終わりを過ぎるまで閉じない
    memo.write_text("0:05\t甲\t一つ目\n2:00\t乙\t先の時刻の行\n", encoding="utf-8")
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    watch_once(log, at_plus(10))
    code, out = run(["next", log, "--now", at_plus(10)])
    assert code == 0 and "まだ閉じていません" in out, f"壁時計より先の素材の時刻で窓が閉じた:\n{out}"
    code, out = run(["next", log, "--now", at_plus(31)])
    assert code == 0 and "0:00〜0:30" in out and "発話 1〜2" in out and "2 0:10 乙" in out, out
    before = log.read_text(encoding="utf-8")
    put(bf, reply([0, 30], [card("C1", 10, [1, 2], who="甲")]))
    for now in ("2000-01-01T00:00:00Z", at_plus(29)):
        code, out = run(["append", log, bf, "--now", now])
        assert code == 2 and f"{'P27'}:" in out, f"聞き終える前の壁時計 {now} が通った:\n{out}"
        assert log.read_text(encoding="utf-8") == before
    code, out = run(["append", log, bf, "--now", at_plus(30)])
    assert code == 0, f"聞き終えたちょうどの壁時計が通らない:\n{out}"
    # 監査も同じことを数える（道具を通さずに書いたログ）
    evs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()]
    evs[1]["at"] = at_plus(12)
    p = d / "early.jsonl"
    write_jsonl(p, evs)
    code, out = run([p], tool=AUDIT)
    assert code == 2 and "聞き終える前" in out, f"監査が聞き終える前の壁時計を数えない:\n{out}"


def test_pause_and_window(tmp):
    """(i) pause は読み終えた所より先に置けない。open.window は規則表の範囲。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src = d / "src.tsv"
    write_tsv(src, [(k * 20, "甲" if k % 2 else "乙", f"{k}番目の発話") for k in range(1, 61)])
    log = d / "k.jsonl"
    code, out = run(["open", log, "--src", src, "--name", "試し"])
    assert code == 0, out
    before = log.read_text(encoding="utf-8")
    code, out = run(["pause", log, "--t", 1170, "--why", "休憩"])
    assert code == 2 and "P22:" in out and log.read_text(encoding="utf-8") == before, f"先の時刻の pause が通った:\n{out}"
    code, out = run(["next", log, "--json"])
    pack = json.loads(out)
    assert pack["new"]["t"] == [0, 30] and len(pack["new"]["lines"]) == 1, f"窓が先へ飛んだ: {pack['new']['t']}"
    put(d / "b.json", reply([0, 30], [card("C1", 20, [1], who="甲")]))
    code, out = run(["append", log, d / "b.json"])
    assert code == 0, out
    code, out = run(["pause", log, "--why", "休憩"])
    assert code == 0 and "0:30" in out, f"読み終えた所の pause が通らない:\n{out}"
    code, out = run(["next", log, "--json"])
    assert json.loads(out)["new"]["t"] == [30, 60], "中断の後の窓が直前の窓の続きでない"
    # 監査も、先に置いた中断を数える
    evs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()]
    evs[-1]["t"] = 1170
    p = d / "pause.jsonl"
    write_jsonl(p, evs)
    code, out = run([p], tool=AUDIT)
    assert code == 2 and "pause" in out, f"監査が先に置いた中断を数えない:\n{out}"
    # open.window は規則表の欄の定義（min/max）で縛る
    fs = json.loads(RULES.read_text(encoding="utf-8"))["events"]["open"]["fields"]["window"]
    checked = []
    for key, w in (("max", fs.get("max", 0) + 1), ("min", fs.get("min", 0) - 1)):
        if key not in fs:
            continue
        for mode in (["--src", src], ["--live", "--transcript", d / "m.txt"]):
            p = d / f"w{len(checked)}.jsonl"
            code, out = run(["open", p, *mode, "--window", w])
            assert code == 2 and "F04:" in out and not p.exists(), f"window {w} の open が通った:\n{out}"
            checked.append(w)
    assert "max" in fs and "min" in fs, "規則表の open.window に min と max が無い"
    return checked


def test_values(tmp):
    """(j) 有限でない数・NaN の字句・末尾の改行のある既存のログ・U+2028 を、落ちずに扱う。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, bf = d / "t.jsonl", d / "b.jsonl"
    write_jsonl(log, _PREFIX)
    before = log.read_text(encoding="utf-8")
    step2 = dumps(_STEP2)
    note2 = dumps(_NOTE2)
    # 読むと無限になる 1e999 は F02（書けば JSON でなくなる）
    bf.write_text(step2 + '\n{"e":"note","t":-1e999,"x":"所感"}\n', encoding="utf-8")
    code, out = run(["append", log, bf, "--now", _CLOCK2])
    assert code == 2 and "F02:" in out and log.read_text(encoding="utf-8") == before, f"1e999 が通った:\n{out}"
    # 知らない欄（v1）や fix.now のように型が決まらない欄でも同じ
    v1 = d / "v1.jsonl"
    write_jsonl(v1, _V1_PREFIX)
    bf.write_text('{"e":"step","n":2,"lines":[4,6],"t":[30,60],"x":1e999}\n', encoding="utf-8")
    code, out = run(["append", v1, bf])
    assert code == 2 and "F02:" in out, f"知らない欄の 1e999 が通った:\n{out}"
    # NaN・Infinity の字句は JSON として読めない（道具が渡した窓が無いので、使い方の誤り）
    bf.write_text(step2 + '\n{"e":"note","t":NaN,"x":"所感"}\n', encoding="utf-8")
    code, out = run(["append", log, bf, "--now", _CLOCK2])
    assert code == 1 and "JSON として読み取れません" in out and "Traceback" not in out, out
    # 末尾に改行のある壁時計を持つ既存のログでも落ちない（違反として拒む）
    bad = d / "nl.jsonl"
    evs = [dict(e) for e in _PREFIX]
    evs[1]["at"] = evs[1]["at"] + "\n"
    write_jsonl(bad, evs)
    bf.write_text(step2 + "\n" + note2 + "\n", encoding="utf-8")
    code, out = run(["append", bad, bf, "--now", _CLOCK2])
    assert code == 1 and "F02:" in out and "Traceback" not in out, f"末尾の改行で落ちた:\n{out}"
    # U+2028 を含む文字列も1行のまま読み書きできる
    bf.write_text(step2 + "\n" + dumps(dict(_NOTE2, x="一行目 二行目")) + "\n", encoding="utf-8")
    code, out = run(["append", log, bf, "--now", _CLOCK2])
    assert code == 0, out
    code, out = run(["status", log])
    assert code == 0 and "違反" not in out, f"U+2028 を含むログが読めない:\n{out}"


def test_bad_reply_counts(tmp):
    """(k) 壊れた返事も同じ窓の1回に数え、3回で未確定の窓へ進む。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src = d / "src.tsv"
    write_tsv(src, [(5, "甲", "一つ目"), (20, "乙", "二つ目"), (40, "甲", "三つ目")])
    log = d / "k.jsonl"
    code, out = run(["open", log, "--src", src, "--name", "試し"])
    assert code == 0, out
    code, out = run(["next", log])
    assert code == 0, out
    bads = ['{"step":{"t":[0,30]},"events":{"e":"card"},"note":{"x":"試し"}}',
            '{"step":{"t":[0,30]},"events":[{"e":"card",',
            '{"step":{"t":[0,30]},"events":[],"note":{"x":NaN}}']
    side = log.with_name("k.next.json")
    for k, b in enumerate(bads, 1):
        put(d / "b.json", b)
        code, out = run(["append", log, d / "b.json"])
        if k < 3:
            assert code == 2 and "返事を読めません" in out, f"{k} 回目: 壊れた返事が数えられない（{code}）:\n{out}"
            assert loads_file(side)["attempt"] == k + 1, "覚え書きの回数が増えていない"
        else:
            assert code == 3, f"3 回目で未確定の窓に進まない（{code}）:\n{out}"
    evs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()]
    assert [e["e"] for e in evs] == ["open", "step", "hold", "note"] and evs[2].get("kind") == "gap", evs
    assert "返事を読めません" in evs[3]["x"]
    assert not side.exists(), "未確定の窓を書いた後に覚え書きが残っている"
    code, out = run(["next", log, "--json"])
    pack = json.loads(out)
    assert pack["new"]["t"] == [30, 60] and [u["i"] for u in pack["gap_lines"]] == [1, 2], pack


def test_digest_limit(tmp):
    """(l) digest --full は 2000 字以内に収め、そのまま次の open --known に渡せる。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src = d / "src.tsv"
    rows = [(k * 15 - 5, "甲" if k % 2 else "乙", f"{k}番目の発話です") for k in range(1, 121)]
    write_tsv(src, rows)
    # 道具を通した記録と同じ形のログを直に組み立てる（60 ステップ、各 1 枚。速さのため）
    evs = [{"e": "open", "v": 2, "name": "三十分の会議", "t0": T0, "mode": "file", "window": 30, "known": "", "src": str(src)}]
    hid = 0
    for n in range(1, 61):
        t0, t1 = (n - 1) * 30, n * 30
        evs.append({"e": "step", "n": n, "lines": [2 * n - 1, 2 * n], "t": [t0, t1], "at": at_plus(t1)})
        evs.append(card(f"C{n}", t0 + 10, [2 * n - 1], who="甲", ti=f"{n}つ目の窓で語られた主張を三十字ほどの見出しにしたもの"))
        if n % 6 == 0:
            hid += 1
            evs.append({"e": "hold", "id": f"H{hid}", "t": t0 + 10, "who": "乙", "q": f"{n}つ目の窓で出た、まだ決着していない問い"})
        evs.append({"e": "note", "t": t1, "x": "試し"})
    evs.append({"e": "end", "t": 1800, "at": at_plus(1800)})
    log = d / "k.jsonl"
    write_jsonl(log, evs)
    code, out = run(["status", log])
    assert code == 0 and "違反" not in out, f"組み立てたログに違反がある:\n{out}"
    code, out = run(["digest", log, "--full"])
    text = out.rstrip("\n")
    assert code == 0 and len(text) <= 2000, f"digest --full が {len(text)} 字"
    assert "落としました" in text and "H10" in text, f"落としたと書いていない、または開いている保留が落ちた:\n{text}"
    assert "C1 " not in text and "C60" in text, "古いものから落としていない"
    code, out = run(["open", d / "次.jsonl", "--src", src, "--name", "次の会議", "--known", text])
    assert code == 0, f"digest --full の出力を open --known に渡せない:\n{out}"
    code, out = run(["digest", FX / "meeting10.jsonl", "--full"])
    assert code == 0 and "落としました" not in out, "収まる引き継ぎから落としている"
    return len(text)


def test_last_and_known(tmp):
    """(m) 窓の終わりちょうどの発話は、最後の発話でも次の窓。known が素材と一致したら P28 の警告。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src = d / "src.tsv"
    write_tsv(src, [(5, "甲", "一つ目"), (20, "乙", "二つ目"), (30, "甲", "三つ目")])
    log = d / "k.jsonl"
    code, out = run(["open", log, "--src", src, "--name", "試し"])
    assert code == 0, out
    code, out = run(["next", log])
    assert "0:00〜0:30" in out and "発話 1〜2" in out, f"最後の発話が窓の終わりちょうどで前の窓に入った:\n{out}"
    put(d / "b.json", reply([0, 30], [card("C1", 5, [1], who="甲")]))
    assert run(["append", log, d / "b.json"])[0] == 0
    code, out = run(["next", log])
    assert "0:30〜1:00" in out and "発話 3〜3" in out, out
    put(d / "b.json", reply([30, 60]))
    assert run(["append", log, d / "b.json"])[0] == 0
    code, out = run(["next", log])
    assert "ここで終わり" in out, out
    # known に素材の本文をそのまま入れたら警告（拒まない）
    src2 = d / "src2.tsv"
    write_tsv(src2, [(k * 20, "甲", f"{k}番目の発話。結論は案{k}にする") for k in range(1, 41)])
    known = "".join(f"{k}番目の発話。結論は案{k}にする" for k in range(31, 41))
    code, out = run(["open", d / "k2.jsonl", "--src", src2, "--name", "試し", "--known", known])
    assert code == 0 and "P28:" in out, f"known と素材の重なりを知らせない:\n{out}"
    # 1 つの素材に開けるログは 1 つなので、重ならない known は同じ中身の別の素材で確かめる
    src3 = d / "src3.tsv"
    shutil.copy(src2, src3)
    code, out = run(["open", d / "k3.jsonl", "--src", src3, "--name", "試し", "--known", "前回は予算の上限を決めた。今回は日程の話から入る。"])
    assert code == 0 and "P28:" not in out, out


# ------------------------------------------------------------ (n)〜(r) 素材の読み・単調化と上限・持ち主の印・素材の取り違え・値

def read_material(path):
    """素材を MaterialReader で読み切り、共通の期待値（tests/fixtures/*.expect.json）と同じ形にする。"""
    rd = RTM.MaterialReader(path)
    got = {"format": None, "utterances": [], "unreadable": [], "bad_bytes": [], "jumps": [], "time_head": [], "skipped_lines": [],
           "attach": []}

    def take(notes, i):
        for n in notes:
            # 知らせは、付けて返された発話（最後の発話より後ろの知らせは最後の発話。発話が無ければ null）と一緒に数える
            got["attach"].append({"kind": n["ev"], "line": n["line"], "i": i})
            if n["ev"] == "unreadable":
                got["unreadable"].append({"line": n["line"], "raw": n["raw"]})
            elif n["ev"] == "badbyte":
                got["bad_bytes"].append({"line": n["line"], "raw": n["raw"]})
            elif n["ev"] == "timehead":
                got["time_head"].append({"line": n["line"]})
            else:
                got["jumps"].append({"line": n["line"], "t": n["to"], "prev": n["from"]})
    while True:
        r = rd.next()
        if r is None:
            break
        got["utterances"].append(r[0])
        take(r[1], r[0]["i"])
    take(rd.tail, rd.last["i"] if rd.last else None)
    got["format"], got["skipped_lines"] = rd.format, rd.skipped
    return got


def material_windows(d, src, width):
    """file の記録で素材を窓幅 width で最後まで回し、[(窓, 発話の範囲, 知らせの文)] と終わりの出力を返す。"""
    log = d / (src.stem + ".jsonl")
    code, out = run(["open", log, "--src", src, "--name", "試し", "--window", width])
    assert code == 0, out
    wins = []
    for _ in range(200):
        code, out = run(["next", log, "--json"])
        if "ここで終わり" in out:
            return wins, out
        assert code == 0, out
        pack = json.loads(out)
        new = pack["new"]
        wins.append({"t": new["t"], "lines": [new["lines"][0]["i"], new["lines"][-1]["i"]], "notices": pack.get("notices", [])})
        put(d / "b.json", reply(new["t"]))
        code, out = run(["append", log, d / "b.json"])
        assert code == 0, out
    raise AssertionError("窓が終わらない")


def test_material_reading(tmp):
    """(n) 素材ファイルの読み（format/FORMAT.md「素材ファイルの形」）。共通の素材のどれも、ページの読み手と同じ期待値
    （tests/fixtures/materials.json に並べた *.expect.json）に一字違わず合う。BOM を付けて CR LF にした写しと、
    最後の改行を落とした写しも同じ。窓幅 30 秒の file の記録で出る窓と、その窓で出す知らせの文も同じ（K12）。"""
    index = json.loads((FX / "materials.json").read_text(encoding="utf-8"))
    keys = ("format", "utterances", "unreadable", "bad_bytes", "jumps", "time_head", "skipped_lines", "attach")
    for m in index["materials"]:
        want = json.loads((FX / m["expect"]).read_text(encoding="utf-8"))
        d = Path(tempfile.mkdtemp(dir=tmp))
        body = (FX / m["file"]).read_bytes()
        crlf = d / ("crlf_" + m["file"])
        crlf.write_bytes(b"\xef\xbb\xbf" + body.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
        bare = d / ("bare_" + m["file"])
        bare.write_bytes(body.rstrip(b"\n"))
        for src in (FX / m["file"], crlf, bare):
            got = read_material(src)
            for k in keys:
                assert dumps(got[k]) == dumps(want[k]), f"{m['name']}（{src.name}）の {k} が期待と違う:\n{dumps(got[k])}\n{dumps(want[k])}"
            # 発話が 1 つも無い素材の断りの文（K21。ページの materialRefusal と同じ）
            no = RTM.material_refusal(src)
            assert dumps(no) == dumps(want["refuse"]), f"{m['name']}（{src.name}）の断りの文が期待と違う:\n{dumps(no)}\n{dumps(want['refuse'])}"
        # 窓と知らせの文（素材は写しで回す。open は素材の隣に持ち主の印を書くので、fixtures の中では回さない）
        src = d / m["file"]
        src.write_bytes(body)
        if want["refuse"]:
            # file の open は記録を作らずに断る（判断ログも持ち主の印も書かない）
            log = d / (src.stem + ".jsonl")
            code, out = run(["open", log, "--src", src, "--name", "試し", "--window", want["window"]])
            assert code == 1 and out.strip() == "\n".join(want["refuse"]), f"{m['name']} の open が断らない:\n{out}"
            assert not log.exists() and not RTM.owner_path(src).exists(), f"{m['name']}: 断ったのに書いた"
            assert want["windows"] == [], m["name"]
            continue
        wins, end_out = material_windows(d, src, want["window"])
        assert dumps(wins) == dumps(want["windows"]), f"{m['name']} の窓が期待と違う:\n{dumps(wins)}\n{dumps(want['windows'])}"
        # 素材の終わりを告げるときに出す知らせは、付ける発話が無かったもの（i が null）だけ
        rest = [{"kind": a["kind"], "line": a["line"]} for a in want["attach"] if a["i"] is None]
        tail = [f"（知らせ）{x}" for x in RTM.notice_lines([{"ev": a["kind"], "line": a["line"]} for a in rest])]
        assert [x for x in end_out.splitlines() if x.startswith("（知らせ）")] == tail, f"{m['name']} の終わりの知らせが違う:\n{end_out}"
    # 知らせの文の表（種類ごとに 1 文。行番号は 5 つまで並べ、残りは数だけ）
    nt = index["notice_text"]
    for k in RTM.MATERIAL_KINDS:
        assert RTM.MATERIAL_TEXT[k] == nt[k], f"{k} の知らせの文がページと違う: {RTM.MATERIAL_TEXT[k]}"
    assert RTM.MATERIAL_KINDS == ("unreadable", "badbyte", "jump", "timehead"), RTM.MATERIAL_KINDS
    # WEBVTT の行の無いまま字幕と決めた素材を断るときに添える文（K31。ページと同じ文）
    assert RTM.VTT_DECIDED_TEXT == index["vtt_decided_text"], RTM.VTT_DECIDED_TEXT
    for row in nt["rows"]:
        got = RTM.notice_lines([{"ev": x["kind"], "line": x["line"]} for x in row["notices"]])
        assert got == row["text"], f"知らせの文が期待と違う:\n{got}\n{row['text']}"
    d = Path(tempfile.mkdtemp(dir=tmp))
    # 読めないバイトを含む行は読めない行（K30 の c。置換文字を本文に入れない）。落ちずに読み続け、BOM・CR LF も同じ
    src = d / "bad.txt"
    src.write_bytes(b"\xef\xbb\xbf0:01\t\xe7\x94\xb2\t\xff\xfe\xe4\xb8\x80\r\n0:02\t\xe4\xb9\x99\t\xe4\xba\x8c\r\n")
    got = list(RTM.iter_utterances(src))
    assert [(u["i"], u["t"], u["who"], u["text"]) for u in got] == [(1, 2, "乙", "二")], got
    log = d / "k.jsonl"
    code, out = run(["open", log, "--src", src, "--name", "試し"])
    assert code == 0, out
    code, out = run(["next", log])
    assert code == 0 and "発話 1〜1" in out and "Traceback" not in out, out
    assert RTM.MATERIAL_TEXT["badbyte"].format(lines="1 行目") in out, out
    # 時刻の書き方: 続く数はちょうど 2 桁、数字は半角だけ、先頭の数は 6 桁まで
    for text, want_t in (("0:05", 5), ("1:02:03", 3723), ("1:02.5", 62.5), ("0:05.000", 5), (" 0:05 ", 5), ("999999:59", 59999999),
                         ("０:０５", 5), ("１：０２：０３", 3723),
                         ("0:5", None), ("1:60", None), ("1:02:60", None), ("1234567:00", None), ("0:05.", None), ("1:2:03", None)):
        assert RTM.parse_time(text) == want_t and type(RTM.parse_time(text)) is type(want_t), f"{text!r} → {RTM.parse_time(text)!r}（期待 {want_t!r}）"


def test_monotone_and_cap(tmp):
    """(o) 打ち間違えた時刻・巻き戻った時刻があっても、1 つの窓が素材の残りを丸ごと渡さない。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    # 50:00 は 0:50 の打ち間違い。その後の発話はすべて 50:00 に揃い、窓は 40 件ずつ渡す
    rows = [(10, "甲", "一つ目"), (20, "乙", "二つ目"), (3000, "甲", "打ち間違えた時刻")]
    rows += [(60 + k, "乙" if k % 2 else "甲", f"{k}番目の続き") for k in range(1, 61)]
    src = d / "typo.tsv"
    write_tsv(src, rows)
    log = d / "k.jsonl"
    code, out = run(["open", log, "--src", src, "--name", "試し"])
    assert code == 0, out
    seen = []
    for k in range(10):
        code, out = run(["next", log, "--json"])
        if "ここで終わり" in out:
            break
        new = json.loads(out)["new"]
        ls = [u["i"] for u in new["lines"]]
        assert len(ls) <= 40, f"1 つの窓に {len(ls)} 件"
        assert all(u["t"] >= 3000 for u in new["lines"] if u["i"] >= 3), "巻き戻った時刻が単調になっていない"
        seen.append((new["t"], ls[0], ls[-1]))
        put(d / "b.json", reply(new["t"]))
        code, out = run(["append", log, d / "b.json"])
        assert code == 0, out
    # 2 つ目の窓は 40 件で切れ、渡さなかった最初の発話（43 番、3000 秒）まで終わりを縮める（幅 0 の窓）。
    # 3 つ目の窓は縮めた終わりから始まり、残りの 21 件を渡す
    assert seen[0] == ([0, 30], 1, 2) and seen[1] == ([3000, 3000], 3, 42) and seen[2] == ([3000, 3030], 43, 63), seen
    # live では、メモ帳に打った時刻は使わない（巻き戻っていても、どの行も届いた時刻）。時刻の飛びも知らせない
    llog, memo = d / "live" / "m.jsonl", d / "live" / "m.txt"
    code, out = run(["open", llog, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    memo.write_text("0:20\t甲\t一つ目\n0:05\t乙\t巻き戻った時刻\n", encoding="utf-8")
    watch_once(llog, at_plus(25))
    code, out = run(["next", llog, "--now", at_plus(31), "--json"])
    pack = json.loads(out)
    assert code == 0 and [u["t"] for u in pack["new"]["lines"]] == [25, 25], out
    assert pack.get("notices", [])[:1] == [RTM.MEMO_TIME_TEXT], f"メモ帳の時刻を捨てたと知らせない:\n{out}"
    assert not any("飛んでいる" in x for x in pack.get("notices", [])), out
    # カードは根拠の発話の時刻の間に置く（P29）。届いた時刻で比べる
    put(d / "b.json", reply([0, 30], [card("C1", 5, [2], who="乙")]))
    code, out = run(["append", llog, d / "b.json", "--now", at_plus(32)])
    assert code == 2 and "P29:" in out, f"根拠の発話より前に置いたカードが通った:\n{out}"
    put(d / "b.json", reply([0, 30], [card("C1", 25, [1, 2], who="乙")]))
    code, out = run(["append", llog, d / "b.json", "--now", at_plus(32)])
    assert code == 0, out


def test_owner(tmp):
    """(p) 1 つの素材に開けるログは 1 つ。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src = d / "src.tsv"
    write_tsv(src, [(k * 20, "甲" if k % 2 else "乙", f"{k}番目の発話") for k in range(1, 31)])
    mark = d / "src.tsv.owner"
    a = d / "a.jsonl"
    code, out = run(["open", a, "--src", src, "--name", "本番"])
    assert code == 0 and mark.exists(), out
    assert mark.read_text(encoding="utf-8").strip() == "a.jsonl", "印が素材のフォルダからの相対で書かれていない"
    # (1) 同じ素材に別のログを open すると断る（何も書かない。印も変えない）
    b = d / "b.jsonl"
    code, out = run(["open", b, "--src", src, "--name", "捨て", "--window", 180])
    assert code == 2 and "P07:" in out and not b.exists(), out
    assert mark.read_text(encoding="utf-8").strip() == "a.jsonl"
    # (2) open の行を手で書いた別のログでも、next・append を断る（覚え書きも作らない）
    write_jsonl(b, [json.loads(a.read_text(encoding="utf-8").splitlines()[0])])
    code, out = run(["next", b])
    assert code == 2 and "P07:" in out and not (d / "b.next.json").exists(), out
    write_jsonl(d / "x.jsonl", [{"e": "step", "n": 1, "lines": [1, 1], "t": [0, 30]}, {"e": "note", "t": 30, "x": "試し"}])
    code, out = run(["append", b, d / "x.jsonl"])
    assert code == 2 and "P07:" in out, out
    # (3) v1 の形で手で書いたログでも、--transcript の素材に別のログの印があれば断る（v1 は印を書かない）
    c = d / "c.jsonl"
    write_jsonl(c, [{"e": "open", "name": "古い形", "chunk": 40}])
    for args in (["next", c, "--transcript", src], ["append", c, d / "x.jsonl", "--transcript", src]):
        code, out = run(args)
        assert code == 2 and "P07:" in out, f"v1 の形のログで別のログの素材を読めた（{args[0]}）:\n{out}"
    # (4) 本番のログは読める。監査は印が自分を指していれば違反にしない
    code, out = run(["next", a])
    assert code == 0 and "発話 1〜1" in out, out
    code, out = run([a], tool=AUDIT)
    assert code == 0 and "違反 0" in out, out
    # (5) 同じ中身を別の名前に写したログは、監査が数える（印は元のログを指している）
    shutil.copy(a, d / "写し.jsonl")
    code, out = run([d / "写し.jsonl"], tool=AUDIT)
    assert code == 2 and "持ち主の印" in out, f"監査が印の食い違いを数えない:\n{out}"
    # (6) 印が指すログが消えていれば、新しいログが引き継ぐ
    a.unlink()
    code, out = run(["open", b.with_name("e.jsonl"), "--src", src, "--name", "次"])
    assert code == 0 and mark.read_text(encoding="utf-8").strip() == "e.jsonl", out
    # (7) 判断ログを返事のバッチの名前（分析役が書き換えてよい場所）には置けない
    src4 = d / "src4.tsv"
    shutil.copy(src, src4)
    g = d / "g.batch.jsonl"
    code, out = run(["open", g, "--src", src4, "--name", "捨て"])
    assert code == 1 and not g.exists() and not (d / "src4.tsv.owner").exists(), out
    write_jsonl(g, [{"e": "open", "v": 2, "name": "手で置いた", "t0": T0, "mode": "file", "window": 30, "known": "", "src": "src4.tsv"}])
    for args in (["next", g], ["append", g, d / "x.jsonl"], ["end", g], ["pause", g]):
        code, out = run(args)
        assert code == 1 and "batch.jsonl" in out and not (d / "src4.tsv.owner").exists(), f"バッチの名前のログに {args[0]} が効いた:\n{out}"
    # (8) open を通さずに置いた v2 のログ（印が無い素材）は、最初の next が印を書く
    src2 = d / "src2.tsv"
    shutil.copy(src, src2)
    f = d / "f.jsonl"
    write_jsonl(f, [{"e": "open", "v": 2, "name": "手で置いた", "t0": T0, "mode": "file", "window": 30, "known": "", "src": "src2.tsv"}])
    code, out = run(["next", f])
    assert code == 0 and (d / "src2.tsv.owner").read_text(encoding="utf-8").strip() == "f.jsonl", out


def test_transcript_and_known(tmp):
    """(q) 素材は open で決まる（--transcript で取り替えられない）。known の比較は句読点・空白をはさんでも同じ。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src, other = d / "本物.tsv", d / "別.tsv"
    write_tsv(src, [(20, "甲", "一つ目"), (40, "乙", "二つ目")])
    write_tsv(other, [(20, "甲", "一つ目")] + [(21 + k, "乙", f"先の{k}") for k in range(40)])
    log = d / "k.jsonl"
    code, out = run(["open", log, "--src", src, "--name", "試し"])
    assert code == 0, out
    code, out = run(["next", log, "--transcript", other])
    assert code == 2 and "P07:" in out and not (d / "k.next.json").exists(), f"別の素材で窓を出した:\n{out}"
    code, out = run(["next", log, "--transcript", src.resolve()])
    assert code == 0 and "発話 1〜1" in out, f"同じ素材を絶対パスで渡すと断られた:\n{out}"
    put(d / "b.json", reply([0, 30], [card("C1", 20, [1], who="甲")]))
    code, out = run(["append", log, d / "b.json", "--transcript", other])
    assert code == 2 and "P07:" in out, out
    code, out = run(["append", log, d / "b.json", "--transcript", src])
    assert code == 0, out
    # live でも、--transcript は open で名指ししたメモ帳と同じでなければ断る
    llog, memo = d / "live" / "m.jsonl", d / "live" / "m.txt"
    code, out = run(["open", llog, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    code, out = run(["next", llog, "--transcript", other, "--now", at_plus(31)])
    assert code == 2 and "P07:" in out, out
    # known に読点・空白をはさんでも、素材の本文と同じなら P28
    src2 = d / "長い.tsv"
    write_tsv(src2, [(k * 20, "甲", f"{k}番目の発話。結論は案{k}にする") for k in range(1, 41)])
    raw = "".join(f"{k}番目の発話。結論は案{k}にする" for k in range(31, 41))
    known = "、 ".join(raw[i:i + 3] for i in range(0, len(raw), 3))
    code, out = run(["open", d / "k2.jsonl", "--src", src2, "--name", "試し", "--known", known])
    assert code == 0 and "P28:" in out, f"句読点をはさんだ known を知らせない:\n{out}"


def test_values_more(tmp):
    """(r) 値と入口の厳しさ。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    # 壁時計: 全角の数字・24 時・2 月 30 日は使い方の誤り（ログを作らない）
    for now in ("２０２６-１０-０７T０９:００:００Z", "2026-10-06T24:00:00Z", "2026-02-30T09:00:00Z", "2026-10-07T09:00:60Z"):
        p = d / "w.jsonl"
        code, out = run(["open", p, "--live", "--transcript", d / "m.txt", "--now", now])
        assert code == 1 and not p.exists() and "Traceback" not in out, f"--now {now!r} が通った:\n{out}"
    # append は open を受けない（v2 も v1 も）。新しい記録は rt.py open で始める
    for ev in (dict(_OPEN), {"e": "open", "name": "古い形", "chunk": 3}):
        p = d / "new.jsonl"
        write_jsonl(d / "o.jsonl", [ev])
        code, out = run(["append", p, d / "o.jsonl"])
        assert code == 1 and "がありません" in out and not p.exists(), out   # 無い判断ログは断る（K28）
        p.write_bytes(b"")
        code, out = run(["append", p, d / "o.jsonl"])
        assert code == 2 and "P01:" in out and p.read_bytes() == b"", out
        p.unlink()
    # 桁の多い整数・e が配列の行・片割れのサロゲートは、落ちずに同じ窓の1回に数える
    src = d / "src.tsv"
    write_tsv(src, [(5, "甲", "一つ目"), (20, "乙", "二つ目")])
    log = d / "k.jsonl"
    code, out = run(["open", log, "--src", src, "--name", "試し"])
    assert code == 0, out
    code, out = run(["next", log])
    assert code == 0, out
    side = log.with_name("k.next.json")
    before = log.read_bytes()
    bads = ['{"step":{"t":[0,30]},"events":[{"e":"card","id":"C1","t":' + "9" * 400 + ',"d":0,"role":"claim","who":"甲","src":[1],"li":null,"ti":"x","b":""}],"note":{"x":"試し"}}',
            '{"step":{"t":[0,30]},"events":[{"e":["card"]}],"note":{"x":"試し"}}']
    for k, b in enumerate(bads, 1):
        put(d / "b.json", b)
        code, out = run(["append", log, d / "b.json"])
        assert code == 2 and ("F02:" in out if k == 1 else "F07:" in out) and "Traceback" not in out, out
        assert loads_file(side)["attempt"] == k + 1, "同じ窓の1回に数えていない"
        assert log.read_bytes() == before
    # 5000 桁の整数も読めない行にせず、使えない数（F02）として拒む
    put(d / "b.json", '{"step":{"t":[0,' + "9" * 5000 + ']},"events":[],"note":{"x":"試し"}}')
    code, out = run(["append", log, d / "b.json"])
    assert code == 3 and "Traceback" not in out and "F02:" in out, f"3 回目で未確定の窓に進まない:\n{out}"
    # 返事の think は捨てる（道具が埋める欄）。片割れのサロゲートは F02 で、1 文字も書かない
    log2 = d / "k2.jsonl"
    src3 = d / "src3.tsv"
    shutil.copy(src, src3)
    code, out = run(["open", log2, "--src", src3, "--name", "試し"])
    assert code == 0, out
    code, out = run(["next", log2])
    before = log2.read_bytes()
    (d / "b.json").write_bytes(b'{"step":{"t":[0,30]},"events":[{"e":"card","id":"C1","t":5,"d":0,"role":"claim","who":"\\u7532","src":[1],"li":null,"ti":"\\ud800","b":""}],"note":{"x":"t"}}')
    code, out = run(["append", log2, d / "b.json"])
    assert code == 2 and "F02:" in out and log2.read_bytes() == before, out
    obj = reply([0, 30], [card("C1", 5, [1], who="甲")])
    obj["think"] = "分析役が書いた先の見通し"
    put(d / "b.json", obj)
    code, out = run(["append", log2, d / "b.json"])
    assert code == 0 and "先の見通し" not in log2.read_text(encoding="utf-8"), out


# ------------------------------------------------------------ (s)〜(y) watch・--now・読めない行・窓の縮め・返事の形・壊れた入力

def test_watch_realtime(tmp):
    """(s) watch を実時計で数秒だけ回す。"""
    import time
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo = d / "live" / "k.jsonl", d / "live" / "k.txt"
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--window", 5], env=REAL_ENV)
    assert code == 0, out
    t0 = time.time()
    w = subprocess.Popen([sys.executable, str(RT), "watch", str(log), "--for", "6"], stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, encoding="utf-8", env=REAL_ENV)
    try:
        time.sleep(1.0)
        with open(memo, "a", encoding="utf-8") as f:
            f.write("一つ目の発話\n")
        arrived1 = time.time() - t0
        # 2 つ目の watch は断る（同じ行を二度足さないため）
        code, out = run(["watch", log, "--for", "1"], env=REAL_ENV)
        assert code == 1 and "別の watch" in out, f"2 つ目の watch が回った:\n{out}"
        time.sleep(max(0, t0 + 4.5 - time.time()))
        with open(memo, "a", encoding="utf-8") as f:
            f.write("二つ目の発話\n書きかけの行")
        arrived2 = time.time() - t0
        # watch が回っている間に新しい行があれば、next は watch が足すのを待ってから見る（落ちない）
        code, out = run(["next", log], env=REAL_ENV)
        assert code == 0, f"watch が回っているのに next が断った:\n{out}"
        wout, _ = w.communicate(timeout=15)
    finally:
        if w.poll() is None:
            w.kill()
    assert "発話 1 件" in wout and "一つ目" not in wout, f"watch の出力が違う（行の中身は出さない）:\n{wout}"
    src = [json.loads(l) for l in log.with_name("k.src.jsonl").read_text(encoding="utf-8").splitlines()]
    # 書きかけの行は、watch が止まるまでに 2 秒変わらないままでいなかったので、まだ読まない
    assert [u["text"] for u in src] == ["一つ目の発話", "二つ目の発話"], f"書きかけの行まで読んだか、行が落ちた: {src}"
    # 押した時刻は届いた時刻（1 秒ごとに見る。秒に切り捨て、聞き始めも秒に切り捨てるので、前後に 1〜2 秒ずれる）。
    # 1 つ目の行は、次に next を打った時刻（4.5 秒より後）ではなく、届いた時刻（1 秒ごろ）で押されている
    assert src[0]["t"] <= 3 and src[0]["t"] < arrived2 - 1, f"1 つ目の行を届いた時刻で押していない: {src[0]['t']}（届いた {arrived1:.1f} 秒）"
    for u, arrived in zip(src, (arrived1, arrived2)):
        assert arrived - 1.5 <= u["t"] <= arrived + 3.0, f"届いた時刻で押していない: t={u['t']} 届いた {arrived:.1f} 秒"
    assert not log.with_name("k.watch.json").exists(), "止まった watch の印が残っている"
    # watch が止まっているのに新しい行があれば、next は窓を出さない（next の時刻で押さない）
    with open(memo, "a", encoding="utf-8") as f:
        f.write("\n")
    code, out = run(["next", log], env=REAL_ENV)
    assert code == 1 and "watch" in out, f"watch が止まっているのに next が窓を出した:\n{out}"
    assert len(log.with_name("k.src.jsonl").read_text(encoding="utf-8").splitlines()) == 2, "next が素材ログに書いた"
    # 聞き終え方は next --last → append → end（K7）。記録が end で閉じると watch は止まる
    w = subprocess.Popen([sys.executable, str(RT), "watch", str(log), "--for", "40"], stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, encoding="utf-8", env=REAL_ENV)
    try:
        time.sleep(1.5)
        before = log.read_text(encoding="utf-8")
        code, out = run(["end", log], env=REAL_ENV)
        assert code == 1 and "まだ渡していない発話が 3 件" in out and "next --last" in out, f"渡していない発話があるのに end が通った:\n{out}"
        assert log.read_text(encoding="utf-8") == before
        shown = []
        for k in range(6):
            code, out = run(["next", log, "--last", "--json"], env=REAL_ENV)
            assert code == 0, out
            if "渡す発話は残っていません" in out:
                break
            pack = json.loads(out)
            shown += [u["text"] for u in pack["new"]["lines"]]
            put(d / "b.json", reply(pack["new"]["t"], [card("C%d" % (k + 1), pack["new"]["lines"][-1]["t"],
                                                          [pack["new"]["lines"][-1]["i"]])]))
            code, out = run(["append", log, d / "b.json"], env=REAL_ENV)
            assert code == 0, out
        # 改行の無い最後の行（書きかけの行）も、2 秒変わらなければ確定して最後の窓に入る
        assert shown == ["一つ目の発話", "二つ目の発話", "書きかけの行"], shown
        code, out = run(["end", log], env=REAL_ENV)
        assert code == 0, out
        wout, _ = w.communicate(timeout=8)
    finally:
        if w.poll() is None:
            w.kill()
    assert "end で閉じました" in wout, f"end で止まらない:\n{wout}"
    src = [json.loads(l) for l in log.with_name("k.src.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [u["text"] for u in src if "i" in u][-1] == "書きかけの行", "end の前の watch が残りの行を足していない"


def test_watch_changes(tmp):
    """(t) 読み終えた行が変わっても、新しい行を落とさず、二度足さない。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo = d / "live" / "k.jsonl", d / "live" / "k.txt"
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    srclog = log.with_name("k.src.jsonl")

    def texts():
        return [json.loads(l).get("text") for l in srclog.read_text(encoding="utf-8").splitlines() if '"i":' in l]

    def events(kind):
        return [json.loads(l) for l in srclog.read_text(encoding="utf-8").splitlines() if f'"kind":"{kind}"' in l]

    # 誤認識の行を消し、そのあとに 2 行届く（前の版では次の 1 行が消えた）
    memo.write_text("0:05\t甲\t一つ目の発話\n0:10\t乙\tえーと（誤認識）\n0:20\t甲\t三つ目の発話\n", encoding="utf-8")
    watch_once(log, at_plus(21))
    code, out = run(["next", log, "--now", at_plus(31)])
    assert code == 0 and "発話 1〜3" in out, out
    put(d / "b.json", reply([0, 30]))
    assert run(["append", log, d / "b.json", "--now", at_plus(32)])[0] == 0
    lines = ["0:05\t甲\t一つ目の発話", "0:20\t甲\t三つ目の発話", "0:40\t乙\t四つ目の発話", "0:50\t甲\t五つ目の発話"]
    memo.write_text("".join(x + "\n" for x in lines), encoding="utf-8")
    out = watch_once(log, at_plus(51))
    assert "消えた" in out and "四つ目" not in out, f"消えた行を知らせない（または行の中身を出した）:\n{out}"
    assert texts() == ["一つ目の発話", "えーと（誤認識）", "三つ目の発話", "四つ目の発話", "五つ目の発話"], texts()
    code, out = run(["next", log, "--now", at_plus(61)])
    assert code == 0 and "発話 4〜5" in out and "読み終えた行が消えた" in out, f"消えた行の知らせが窓に無い:\n{out}"
    put(d / "b.json", reply([30, 60]))
    assert run(["append", log, d / "b.json", "--now", at_plus(62)])[0] == 0

    def step(new_lines, now, want_kinds, want_new):
        n0 = len(srclog.read_text(encoding="utf-8").splitlines())
        memo.write_text("".join(x + "\n" for x in new_lines), encoding="utf-8")
        watch_once(log, now)
        added = [json.loads(l) for l in srclog.read_text(encoding="utf-8").splitlines()[n0:]]
        kinds = [x["kind"] for x in added if x.get("ev") == "changed"]
        assert kinds == want_kinds, f"変化の種類が違う: {kinds}（期待 {want_kinds}）"
        assert [x["text"] for x in added if "i" in x] == want_new, f"新しい行の拾い方が違う: {added}"
        # もう一度見ても何も足さない（突き合わせが落ち着く）
        n1 = len(srclog.read_text(encoding="utf-8").splitlines())
        watch_once(log, now)
        assert len(srclog.read_text(encoding="utf-8").splitlines()) == n1, "変化の無いメモ帳で素材ログが増えた"

    # 分割・間への挿入・書き換えと、末尾の新しい行（K18）。新しい行だけを拾い、拾わなかった行はすべて名指す:
    # 消えた行 2 つ（一つ目・四つ目）、間の行（1〜3・5 行目）。消えた読み終えた行が 3 行に満たないので、残った行は
    # 名指さない（K26）
    lines = ["0:05\t甲\t一つ目の", "発話", "追記した行", "0:20\t甲\t三つ目の発話", "0:40\t乙\t四つ目の発話です",
             "0:50\t甲\t五つ目の発話", "1:05\t乙\t六つ目の発話"]
    step(lines, at_plus(66), ["deleted", "deleted", "inserted", "inserted"], ["六つ目の発話"])
    # 読み終えた行を末尾へ動かし、新しい行を足す。末尾に現れた行は消えた行と同じ中身なので、戻した行とみなして
    # 足さない（K18 の 5。二度足さない）。七つ目だけが新しい発話
    lines = lines[:3] + lines[4:] + [lines[3], "1:10\t甲\t七つ目の発話"]
    step(lines, at_plus(71), ["deleted", "restored"], ["七つ目の発話"])
    # 2 行を 1 行にまとめて元の行に戻し、新しい行を足す。まとめた行は前に消えた一つ目の行と同じ中身なので、戻した行
    # （拾っていない 2 行の消去は知らせない）
    lines = ["0:05\t甲\t一つ目の発話"] + lines[2:] + ["1:15\t乙\t八つ目の発話"]
    step(lines, at_plus(76), ["deleted", "restored"], ["八つ目の発話"])
    # 拾っていない行を消すだけ、の次に届いた行は落とさない
    lines = lines[:1] + lines[2:] + ["1:20\t甲\t九つ目の発話"]
    step(lines, at_plus(81), ["deleted"], ["九つ目の発話"])
    once = lambda: all(texts().count(x) == 1 for x in set(texts()))
    assert once(), f"同じ行を二度足した: {texts()}"
    # 保存の途中に見えた（末尾が短くなった）メモ帳では何も書かず、保存し終えたら新しい行だけを足す
    import threading
    full = memo.read_bytes() + "1:25\t乙\t十番目の発話\n".encode("utf-8")
    memo.write_bytes(full[: full.index("五つ目".encode("utf-8"))])   # 保存の途中: 五つ目の行から後ろがまだ無い
    timer = threading.Timer(0.1, lambda: memo.write_bytes(full))
    timer.start()
    n0 = len(srclog.read_text(encoding="utf-8").splitlines())
    got = RTM.sync_memo(str(memo), str(srclog), RTM.iso_sec(T0), at_plus(85))
    timer.join()
    assert got is None and len(srclog.read_text(encoding="utf-8").splitlines()) == n0, f"保存の途中のメモ帳で素材ログに書いた: {got}"
    watch_once(log, at_plus(86))
    added = [json.loads(l) for l in srclog.read_text(encoding="utf-8").splitlines()[n0:]]
    assert [x.get("text") for x in added] == ["十番目の発話"], f"保存の途中を、行が消えたと読んだ: {added}"
    assert once(), f"同じ行を二度足した: {texts()}"


def test_now_needs_env(tmp):
    """(u) live の記録では、--now は KIKU_TEST_CLOCK=1 のときだけ。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    memo = d / "m.txt"
    # 聞き始めを過去にずらす open --live --now は、本番の環境では断る
    p = d / "live.jsonl"
    code, out = run(["open", p, "--live", "--transcript", memo, "--now", "2026-10-07T00:00:00Z"], env=REAL_ENV)
    assert code == 1 and "KIKU_TEST_CLOCK" in out and not p.exists(), f"本番の環境で live の --now が通った:\n{out}"
    # 試験の環境で作った live の記録にも、本番の環境の --now はどの命令でも効かない
    code, out = run(["open", p, "--live", "--transcript", memo, "--now", T0])
    assert code == 0, out
    memo.write_text("0:01\t甲\t始めます\n", encoding="utf-8")
    before = p.read_text(encoding="utf-8")
    put(d / "b.json", reply([0, 90], [card("C1", 1, [1], who="甲")]))
    for args in (["watch", p, "--now", at_plus(1)], ["watch", p, "--once"], ["next", p, "--now", at_plus(95)],
                 ["append", p, d / "b.json", "--now", at_plus(95)], ["end", p, "--now", at_plus(95)],
                 ["pause", p, "--now", at_plus(95)]):
        code, out = run(args, env=REAL_ENV)
        assert code == 1 and "KIKU_TEST_CLOCK" in out and "Traceback" not in out, f"本番の環境で {args[0]} の --now が通った:\n{out}"
    assert p.read_text(encoding="utf-8") == before and not p.with_name("live.src.jsonl").exists()
    # file の記録は --now を受ける（過去の記録を作り直す試験のため）
    src = d / "src.tsv"
    write_tsv(src, [(5, "甲", "一つ目")])
    f = d / "file.jsonl"
    code, out = run(["open", f, "--src", src, "--now", "2020-01-01T00:00:00Z"], env=REAL_ENV)
    assert code == 0, out
    code, out = run(["next", f, "--now", "2020-01-01T00:00:00Z"], env=REAL_ENV)
    assert code == 0 and "発話 1〜1" in out, out
    # watch は file の記録では使わない
    code, out = run(["watch", f, "--once", "--now", T0])
    assert code == 1 and "live" in out, out


def test_unreadable_notices(tmp):
    """(v) 読めない行・全角の時刻・時刻の飛びを、黙って捨てずに行番号で知らせる。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src = d / "src.txt"
    src.write_text("0:05\t甲\t一つ目\n0:5\t乙\t秒が一桁\n１:２０\t乙\t全角の時刻\n1：40\t甲\t全角のコロン\n"
                   "1:30\t甲\t巻き戻り\n20:00\t乙\t十分を超える飛び\n2:0\t甲\t最後の打ち間違い\n", encoding="utf-8")
    log = d / "k.jsonl"
    code, out = run(["open", log, "--src", src, "--name", "試し"])
    assert code == 0, out
    seen, notes, by_win, end_out = [], [], [], ""
    for _ in range(20):
        code, out = run(["next", log, "--json"])
        if "ここで終わり" in out:
            end_out = out
            break
        pack = json.loads(out)
        seen += [(u["i"], u["t"], u["text"]) for u in pack["new"]["lines"]]
        notes += pack.get("notices", [])
        by_win.append(([u["i"] for u in pack["new"]["lines"]], pack.get("notices", [])))
        put(d / "b.json", reply(pack["new"]["t"]))
        assert run(["append", log, d / "b.json"])[0] == 0
    assert [x[2] for x in seen] == ["一つ目", "全角の時刻", "全角のコロン", "巻き戻り", "十分を超える飛び"], seen
    assert [x[1] for x in seen] == [5, 80, 100, 100, 1200], seen
    un = lambda ls: RTM.MATERIAL_TEXT["unreadable"].format(lines=ls)
    ju = lambda ls: RTM.MATERIAL_TEXT["jump"].format(lines=ls)
    for want in (un("2 行目"), ju("5 行目"), ju("6 行目"), un("7 行目")):
        assert want in notes, f"「{want}」を知らせない: {notes}"
    # K12: 知らせは、読めない行なら後ろの最初の発話（2 行目は 1:20 の発話の窓。0:05 の窓では出さない）、
    # 最後の発話より後ろの知らせ（7 行目）は最後の発話を渡す窓で出す。終わりを告げるときには繰り返さない
    win_of = {i: ns for ls, ns in by_win for i in ls}
    assert un("2 行目") in win_of[2] and un("2 行目") not in win_of[1], by_win
    assert un("7 行目") in win_of[5] and ju("6 行目") in win_of[5], by_win
    assert "（知らせ）" not in end_out, f"最後の窓で出した知らせを、終わりでもう一度出した:\n{end_out}"
    code, out = run(["status", log])
    assert code == 0 and "違反" not in out, out
    # live（K2）: メモ帳には読めない行も時刻の飛びも無い。空でない行はすべて発話で、時刻はどれも届いた時刻。
    # 1 列目が時刻らしい列（全角も、0:5 のような正しくない時刻も。K13）は落とし、時刻らしい頭で始まる行
    # （0:12 甲 …）は行の全体が話者無しの本文
    llog, memo = d / "live" / "m.jsonl", d / "live" / "m.txt"
    code, out = run(["open", llog, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    memo.write_text("0:05\t甲\t一つ目\n0:5\t乙\t秒が一桁\n０：１０\t乙\t全角の時刻\n0:12 甲 空白で区切った\n乙\t話者つきの行\n",
                    encoding="utf-8")
    out = watch_once(llog, at_plus(14))
    assert "読めない行" not in out and out.count(RTM.MEMO_TIME_TEXT) == 1, out
    code, out = run(["next", llog, "--now", at_plus(31), "--json"])
    pack = json.loads(out)
    assert [(u["t"], u["who"], u["text"]) for u in pack["new"]["lines"]] == [
        (14, "甲", "一つ目"), (14, "乙", "秒が一桁"), (14, "乙", "全角の時刻"), (14, None, "0:12 甲 空白で区切った"),
        (14, "乙", "話者つきの行")], pack["new"]
    assert pack["notices"][:1] == [RTM.MEMO_TIME_TEXT] and not any("読めない" in x for x in pack["notices"]), pack.get("notices")
    srcl = [json.loads(l) for l in llog.with_name("m.src.jsonl").read_text(encoding="utf-8").splitlines()]
    assert not [x for x in srcl if x.get("ev") == "unreadable"], srcl
    # 時刻の列を落とした行も、素材ログの raw には打ったままの行を残す
    assert [x.get("raw") for x in srcl if x.get("i") == 1] == ["0:05\t甲\t一つ目"], srcl


def test_cap_shrink(tmp):
    """(w) 40 件で切った窓は、渡さなかった最初の発話の時刻まで終わりを縮める。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src = d / "src.txt"
    with open(src, "w", encoding="utf-8", newline="\n") as f:
        for k in range(60):
            t = k * 0.5
            f.write(f"0:{int(t):02d}.{int(t * 10) % 10}\t{'甲' if k % 2 else '乙'}\t{k + 1}番目\n")
    log = d / "k.jsonl"
    code, out = run(["open", log, "--src", src, "--name", "試し"])
    assert code == 0, out
    code, out = run(["next", log, "--json"])
    new = json.loads(out)["new"]
    assert new["t"] == [0, 20] and [new["lines"][0]["i"], new["lines"][-1]["i"]] == [1, 40], new["t"]
    before = log.read_text(encoding="utf-8")
    bad = reply([0, 20], [{"e": "group", "id": "A", "t": 0, "span": [0, 29], "lb": "最初の議題", "kind": "start"},
                          {"e": "hold", "id": "H1", "t": 29, "who": None, "q": "まだ渡していない所の問い"}])
    put(d / "b.json", bad)
    code, out = run(["append", log, d / "b.json"])
    assert code == 2 and "P09:" in out and "P15:" in out and log.read_text(encoding="utf-8") == before, out
    put(d / "b.json", reply([0, 30]))
    code, out = run(["append", log, d / "b.json"])
    assert code == 2 and "P07:" in out, f"縮める前の窓の終わりで書けた:\n{out}"
    put(d / "b.json", reply([0, 20], [{"e": "hold", "id": "H1", "t": 19.5, "who": None, "q": "渡した所の問い"}]))
    code, out = run(["append", log, d / "b.json"])
    assert code == 0, out
    # 同じ時刻の発話が上限より多く続くと、幅 0 の窓になる（受ける。監査も違反にしない）
    src2 = d / "same.tsv"
    write_tsv(src2, [(5, "甲", "一つ目")] + [(30, "乙" if k % 2 else "甲", f"同じ時刻の{k}") for k in range(45)])
    log2 = d / "same.jsonl"
    assert run(["open", log2, "--src", src2, "--name", "試し"])[0] == 0
    for want_t, want_n in (([0, 30], 1), ([30, 30], 40), ([30, 60], 5)):
        code, out = run(["next", log2, "--json"])
        new = json.loads(out)["new"]
        assert new["t"] == want_t and len(new["lines"]) == want_n, (new["t"], len(new["lines"]))
        put(d / "b.json", reply(new["t"]))
        code, out = run(["append", log2, d / "b.json"])
        assert code == 0, out
    code, out = run([log2], tool=AUDIT)
    assert code == 0 and "違反 0" in out, out
    code, out = run(["next", log, "--json"])
    new = json.loads(out)["new"]
    assert new["t"] == [20, 50] and [new["lines"][0]["i"], new["lines"][-1]["i"]] == [41, 60], new["t"]
    code, out = run([log], tool=AUDIT)
    assert code == 0 and "違反 0" in out, out


def test_reply_shapes(tmp):
    """(x) 返事の形（ページの読み方と同じ）。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src = d / "src.tsv"
    write_tsv(src, [(5, "甲", "一つ目"), (20, "乙", "二つ目"), (40, "甲", "三つ目"), (70, "乙", "四つ目")])

    def fresh(name):
        s2 = d / f"{name}.tsv"
        shutil.copy(src, s2)
        lg = d / f"{name}.jsonl"
        code, out = run(["open", lg, "--src", s2, "--name", "試し"])
        assert code == 0, out
        code, out = run(["next", lg])
        assert code == 0, out
        return lg

    good = reply([0, 30], [card("C1", 5, [1], who="甲")])
    # events の無い返事は、書くことの無い窓（events:[]）
    lg = fresh("a")
    put(d / "b.json", {"step": {"t": [0, 30]}, "note": {"x": "静かな窓"}})
    code, out = run(["append", lg, d / "b.json"])
    assert code == 0, f"events の無い返事を受けない:\n{out}"
    # 1 回だけ ``` で包んだ返事は外して読む（json の札つきも）
    lg = fresh("b")
    put(d / "b.json", "```json\n" + json.dumps(good, ensure_ascii=False) + "\n```\n")
    code, out = run(["append", lg, d / "b.json"])
    assert code == 0, f"``` で包んだ返事を読まない:\n{out}"
    # 読めない返事は、どれも同じ窓の 1 回に数える（3 回で未確定の窓）
    shapes = [
        ("step の無い返事", {"events": [], "note": {"x": "試し"}}, "step"),
        ("step が配列", {"step": [0, 30], "events": [], "note": {"x": "試し"}}, "step"),
        ("events の中の note", {"step": {"t": [0, 30]}, "events": [{"e": "note", "t": 30, "x": "所感"}]}, "note"),
        ("2 回包んだ返事", "```\n```json\n" + json.dumps(good, ensure_ascii=False) + "\n```\n```", "JSON"),
        ("2 つの返事", json.dumps(good, ensure_ascii=False) + "\n" + json.dumps(good, ensure_ascii=False), "F07"),
        ("空の src", reply([0, 30], [card("C1", 5, [], who="甲")]), "P29"),
    ]
    for k, (name, body, word) in enumerate(shapes):
        lg = fresh(f"c{k}")
        side = lg.with_name(lg.stem + ".next.json")
        before = lg.read_text(encoding="utf-8")
        put(d / "b.json", body)
        code, out = run(["append", lg, d / "b.json"])
        assert code == 2 and word in out and "Traceback" not in out, f"[{name}] が拒まれない（{code}）:\n{out}"
        assert loads_file(side)["attempt"] == 2, f"[{name}] を同じ窓の 1 回に数えていない"
        assert lg.read_text(encoding="utf-8") == before
    # 窓の幅は整数の秒
    for w, ok in ((30.5, False), (30.0, True)):
        p = d / f"w{w}.jsonl"
        s2 = d / f"w{w}.tsv"
        shutil.copy(src, s2)
        code, out = run(["open", p, "--src", s2, "--window", w])
        assert (code == 0) == ok and ("整数" in out or ok), f"--window {w}:\n{out}"
        if ok:
            assert '"window":30,' in p.read_text(encoding="utf-8")


def test_broken_input(tmp):
    """(y) 壊れた step の欄・深すぎる入れ子を、落ちずに拒み、同じ窓の 1 回に数える。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src = d / "src.tsv"
    write_tsv(src, [(5, "甲", "一つ目"), (20, "乙", "二つ目"), (40, "甲", "三つ目")])
    log = d / "k.jsonl"
    code, out = run(["open", log, "--src", src, "--name", "試し"])
    assert code == 0, out
    code, out = run(["next", log])
    assert code == 0, out
    side = log.with_name("k.next.json")
    before = log.read_text(encoding="utf-8")
    c1 = card("C1", 5, [1], who="甲")
    note = {"e": "note", "t": 30, "x": "試し"}
    steps = [
        ({"e": "step", "lines": [1, 2], "t": [0, 30]}, "F01"),        # n が無い
        ({"e": "step", "n": 1, "lines": "1-2", "t": [0, 30]}, "F02"),  # lines が文字列
        ({"e": "step", "n": 1, "lines": [2], "t": [0, 30]}, "F02"),    # lines が 1 つ
    ]
    for k, (st, code_want) in enumerate(steps[:2], 1):
        write_jsonl(d / "b.jsonl", [st, c1, note])
        code, out = run(["append", log, d / "b.jsonl"])
        assert code == 2 and f"{code_want}:" in out and "Traceback" not in out, f"壊れた step {st} で:\n{out}"
        assert loads_file(side)["attempt"] == k + 1, "壊れた step を同じ窓の 1 回に数えていない"
    write_jsonl(d / "b.jsonl", [steps[2][0], c1, note])
    code, out = run(["append", log, d / "b.jsonl"])
    assert code == 3 and "Traceback" not in out, f"3 回目で未確定の窓に進まない:\n{out}"
    assert log.read_text(encoding="utf-8") != before
    # 深すぎる入れ子: 33 段・500 段・10 万段。どれも F02 で、落ちない
    code, out = run(["next", log])
    assert code == 0 and "発話 3〜3" in out, out
    for k, depth in enumerate((33, 500, 100000), 1):
        deep = "[" * depth + "]" * depth
        body = ('{"step":{"t":[30,60]},"events":[{"e":"fix","id":"C1","t":40,"field":"d","now":' + deep +
                '}],"note":{"x":"試し"}}') if depth < 100000 else ('{"step":{"t":[30,60]},"events":' + deep + '}')
        put(d / "b.json", body)
        code, out = run(["append", log, d / "b.json"])
        assert code == (2 if k < 3 else 3) and "F02:" in out and "Traceback" not in out, f"入れ子 {depth} 段で:\n{out[-2000:]}"
        if k < 3:
            assert loads_file(side)["attempt"] == k + 1, "深すぎる入れ子を同じ窓の 1 回に数えていない"
    # 32 段ちょうどは深さでは拒まない
    ok32 = "[" * 31 + "]" * 31
    assert RTM.value_depth(json.loads("[" + ok32 + "]")) == 32


# ------------------------------------------------------------ (z) 4 回目の反証の再現（5 回目で揃えた決め K1〜K7）

def test_peek_blocked(tmp):
    """(z1) r01・r01b: 捨てるログの素材に、本番の素材ログ・判断ログ・印・覚え書きを名指せない（K6。P30 と P07）。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    live = d / "live"
    log, memo = live / "会議.jsonl", live / "会議.txt"
    code, out = run(["open", log, "--live", "--name", "会議", "--transcript", memo, "--now", T0])
    assert code == 0, out
    memo.write_text("甲\tまだ窓が閉じていない発話\n乙\t結論は案Bです\n", encoding="utf-8")
    watch_once(log, at_plus(2))
    code, out = run(["next", log, "--now", at_plus(3)])
    assert code == 0 and "まだ閉じていません" in out, out
    peek = live / "peek.jsonl"
    for nm in ("会議.src.jsonl", "会議.jsonl", "会議.txt.owner", "会議.next.json", "会議.watch.json", "会議.SRC.JSONL",
               "会議", "会議.text"):
        for args in (["--live", "--window", 5, "--transcript", live / nm], ["--src", live / nm]):
            code, out = run(["open", peek, "--name", "peek", "--now", at_plus(4)] + args)
            # file の記録では、無いファイルは名前を見る前に「見つかりません」で断る（在るファイルは P30）
            why = "P30:" in out or (args[0] == "--src" and not (live / nm).exists() and "見つかりません" in out)
            assert code != 0 and why and "結論" not in out, f"{nm}（{args[0]}）を素材にした open が通った:\n{out}"
            assert not peek.exists() and not (live / "peek.src.jsonl").exists(), nm
    # 本番のメモ帳そのものは、本番のログが持ち主（1 つの素材に 1 つのログ。P07）
    code, out = run(["open", peek, "--live", "--name", "peek", "--transcript", memo, "--now", at_plus(4)])
    assert code != 0 and "P07:" in out and not peek.exists(), out
    # 大小文字は問わない（.TXT の素材ファイルは受ける）
    up = d / "会議の記録.TXT"
    up.write_text("0:05\t甲\t一つ目\n", encoding="utf-8")
    code, out = run(["open", d / "up.jsonl", "--src", up, "--name", "大文字"])
    assert code == 0, out
    # v1 の記録の --transcript も素材ファイルの名前だけ
    v1 = d / "v1.jsonl"
    write_jsonl(v1, [{"e": "open", "name": "古い形", "chunk": 3}])
    code, out = run(["next", v1, "--transcript", live / "会議.src.jsonl"])
    assert code != 0 and "P07:" in out and "結論" not in out, out
    # 監査も数える（道具を通さずに書いたログ）
    bad = live / "bad.jsonl"
    write_jsonl(bad, [{"e": "open", "v": 2, "name": "手書き", "t0": T0, "mode": "live", "window": 30, "known": "",
                       "src": "会議.src.jsonl"}])
    code, out = run([bad], tool=AUDIT)
    assert code == 2 and "P30" in out, out


def test_memo_time_typo(tmp):
    """(z2) r02: メモ帳の時刻を 1 か所先へ打ち間違えても、そのあとの発話の位置はずれない（K2。時刻はいつも届いた時刻）。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo, bf = d / "live" / "k.jsonl", d / "live" / "k.txt", d / "b.json"
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    for sec, line in ((3, "0:03\t甲\t予算の話から"), (20, "2:00\t甲\t打ち間違えた時刻の行"), (26, "0:26\t乙\t次の行")):
        with open(memo, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        watch_once(log, at_plus(sec))
    code, out = run(["next", log, "--now", at_plus(31), "--json"])
    pack = json.loads(out)
    assert pack["new"]["t"] == [0, 30] and [(u["i"], u["t"]) for u in pack["new"]["lines"]] == [(1, 3), (2, 20), (3, 26)], pack["new"]
    assert pack["notices"][:1] == [RTM.MEMO_TIME_TEXT], pack.get("notices")
    put(bf, reply([0, 30], [card("C1", 26, [3], who="乙")]))
    code, out = run(["append", log, bf, "--now", at_plus(32)])
    assert code == 0, out
    with open(memo, "a", encoding="utf-8") as f:
        f.write("0:44\t甲\t反対はありますか\n")
    watch_once(log, at_plus(44))
    code, out = run(["next", log, "--now", at_plus(61), "--json"])
    pack = json.loads(out)
    assert pack["new"]["t"] == [30, 60] and [(u["i"], u["t"]) for u in pack["new"]["lines"]] == [(4, 44)], pack["new"]
    assert RTM.MEMO_TIME_TEXT not in pack.get("notices", []), "メモ帳の時刻の知らせを 2 回出した"
    # 話された 0:44 に、その発話を根拠にしたカードを置ける
    put(bf, reply([30, 60], [card("C2", 44, [4], who="甲")]))
    code, out = run(["append", log, bf, "--now", at_plus(62)])
    assert code == 0, out


def test_live_last_and_end(tmp):
    """(z3) r03: 聞き終え方は next --last → append → end。end は渡していない発話があれば断る（K7）。
    改行の無い最後の行は 2 秒変わらなければ確定し、確定した後に足された字は書き換え（K2）。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo, bf = d / "live" / "k.jsonl", d / "live" / "k.txt", d / "b.json"
    srclog = log.with_name("k.src.jsonl")
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    memo.write_text("甲\t始めます\n乙\t案は二つ\n", encoding="utf-8")
    watch_once(log, at_plus(10))
    code, out = run(["next", log, "--now", at_plus(31), "--json"])
    assert json.loads(out)["new"]["t"] == [0, 30], out
    put(bf, reply([0, 30], [card("C1", 10, [1, 2], who="甲")]))
    assert run(["append", log, bf, "--now", at_plus(32)])[0] == 0
    with open(memo, "a", encoding="utf-8") as f:
        f.write("甲\t結論はA案です\n乙\t以上で終わります")   # 最後の行は Enter を押していない
    watch_once(log, at_plus(40))   # --once では 2 秒を見られないので、最後の行は確定しない
    texts = lambda: [u["text"] for u in map(json.loads, srclog.read_text(encoding="utf-8").splitlines()) if "i" in u]
    assert texts() == ["始めます", "案は二つ", "結論はA案です"], texts()
    # end は断る: どの窓にも入っていない発話 1 件 ＋ メモ帳の改行の無い最後の行 1 行（まだ入っていない変化。K25）
    before = log.read_text(encoding="utf-8")
    code, out = run(["end", log, "--now", at_plus(41)])
    assert code == 1 and "まだ渡していない発話が 1 件" in out and "next --last" in out, out
    assert "まだ入っていない変化（新しい行・消えた行・戻した行・時刻の列の直しなど）が 1 件" in out, out
    assert log.read_text(encoding="utf-8") == before
    # watch が回っていなければ、next --last は最後の行を待てない（落とさずに断る）
    code, out = run(["next", log, "--last", "--now", at_plus(41)])
    assert code == 1 and "watch が回っていません" in out, out
    # 2 秒の確定（watch の 1 回分を直に呼ぶ。tail_state は watch が持つものと同じ形）
    t0s = RTM.iso_sec(T0)
    ts = {"key": None, "since": 0.0}
    tick = lambda sec: RTM.sync_memo(memo, srclog, t0s, at_plus(int(sec)), settle=0, tail_state=ts, now_sec=t0s + sec)
    assert tick(42) == [] and tick(43.9) == [], "2 秒たたないうちに最後の行を確定した"
    got = tick(44)
    assert [(u["i"], u["t"], u["text"]) for u in got if "i" in u] == [(4, 44, "以上で終わります")], got
    # 確定した後にその行へ字が足されたら、読み終えた行の書き換え（K18）: 前の行は消えた行として知らせ、
    # 字を足した行は末尾の新しい行（消えた行と中身が違う）なので新しい発話にする（黙って欠かさない）
    with open(memo, "a", encoding="utf-8") as f:
        f.write("。")
    assert tick(45) is None, "打っている途中の最後の行で何かを書いた"
    got = tick(47)
    assert [x.get("kind") for x in got if "ev" in x] == ["deleted"], got
    assert [(u["i"], u["t"], u["text"]) for u in got if "i" in u] == [(5, 47, "以上で終わります。")], got
    # next --last: 残りの発話を、窓の幅に関係なく最後の窓として出す（終わりは いまの時計。どの発話よりも後）
    code, out = run(["next", log, "--last", "--now", at_plus(44)])
    assert code == 1 and "過ぎていません" in out, out
    code, out = run(["next", log, "--last", "--now", at_plus(50), "--json"])
    pack = json.loads(out)
    assert pack["new"]["t"] == [30, 50] and [u["i"] for u in pack["new"]["lines"]] == [3, 4, 5], pack["new"]
    assert '"t": [30, 50]' in out, f"最後の窓の終わりが整数の秒で出ていない:\n{out}"
    assert any("最後の窓です" in x for x in pack.get("notices", [])), pack.get("notices")
    assert any("読み終えた行が消えた" in x for x in pack.get("notices", [])), f"書き換えの知らせが最後の窓に無い: {pack.get('notices')}"
    assert loads_file(log.with_name("k.next.json"))["last"] == 50
    # 打ち直しても同じ窓（終わりを動かさない。同じ窓の回数を数え続ける）
    code, out = run(["next", log, "--last", "--now", at_plus(55), "--json"])
    assert json.loads(out)["new"]["t"] == [30, 50], out
    # 覚え書きの last を手で動かすと、窓が素材と合わないので P07
    side = loads_file(log.with_name("k.next.json"))
    put(log.with_name("k.next.json"), dict(side, last=52))
    put(bf, reply([30, 50], [card("C2", 44, [3, 4], who="甲")]))
    code, out = run(["append", log, bf, "--now", at_plus(56)])
    assert code == 2 and "P07:" in out, out
    put(log.with_name("k.next.json"), side)
    code, out = run(["append", log, bf, "--now", at_plus(56)])
    assert code == 0, out
    code, out = run(["next", log, "--last", "--now", at_plus(57)])
    assert code == 0 and "渡す発話は残っていません" in out, out
    code, out = run(["end", log, "--now", at_plus(58)])
    assert code == 0, out
    code, out = run([log], tool=AUDIT)
    assert code == 0 and "違反 0" in out, out
    # file の記録には --last は無い
    src = d / "f.txt"
    src.write_text("0:05\t甲\t一つ目\n", encoding="utf-8")
    assert run(["open", d / "f.jsonl", "--src", src])[0] == 0
    code, out = run(["next", d / "f.jsonl", "--last"])
    assert code == 1 and "--last" in out, out
    # 監査: end で閉じた live の記録に、どの窓にも入っていない発話が残っていれば数える（道具を通さずに書いたログ）
    evs = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()]
    n2 = next(k for k, e in enumerate(evs) if e.get("e") == "step" and e.get("n") == 2)
    cut = evs[:n2] + [evs[-1]]
    hand = d / "live" / "h.jsonl"
    write_jsonl(hand, cut)
    shutil.copy(srclog, hand.with_name("h.src.jsonl"))
    code, out = run([hand], tool=AUDIT)
    assert code == 2 and "どの窓にも入っていない発話が 3 件" in out and "以上で" not in out, out


def test_memo_restored(tmp):
    """(z4) r05・K18: 消した行を元に戻しても、二度は足さない（戻した行として知らせる）。全部・末尾の 2 行・別の位置・
    新しい発話のあと。知らせのとおり末尾にもう一度打った行は新しい発話。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo = d / "live" / "k.jsonl", d / "live" / "k.txt"
    srclog = log.with_name("k.src.jsonl")
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    lines = ["甲\t始めます", "乙\t案は二つです", "甲\tA案とB案", "乙\tA案がよい", "甲\tではA案で"]
    names = [x.split("\t")[1] for x in lines]

    def save(ls, sec):
        memo.write_text("".join(x + "\n" for x in ls), encoding="utf-8")
        return watch_once(log, at_plus(sec))

    def recs():
        return [json.loads(l) for l in srclog.read_text(encoding="utf-8").splitlines()]

    def texts():
        return [u["text"] for u in recs() if "i" in u]

    save(lines, 5)
    assert texts() == names, texts()
    for k, (cut, back, sec, want_lines) in enumerate((
            ([], lines, 7, [1, 2, 3, 4, 5]),                      # (a) 全部を消して保存し、元に戻して保存
            (lines[:3], lines, 11, [4, 5]),                       # (b) 末尾の 2 行を消して戻す
            (lines[:1] + lines[2:], lines, 15, [2]))):            # (c) 間の 1 行を消して、同じ位置に戻す
        save(cut, sec)
        n0 = len(recs())
        out = save(back, sec + 2)
        got = recs()[n0:]
        restored = [x for x in got if x.get("kind") == "restored"]
        assert len(restored) == 1 and not [x for x in got if "i" in x], f"({'abc'[k]}) 戻した行を新しい発話にした: {got}"
        assert restored[0]["lines"] == want_lines, f"({'abc'[k]}) 戻した行の番号が違う: {restored}"
        # 出来事 1 件につき知らせ 1 文。戻った行の数だけ行番号を並べる
        assert out.count("（知らせ）") == 1 and RTM.RESTORED_TEXT.format(line=RTM.line_list(want_lines)) in out, out
        assert texts() == names, f"({'abc'[k]}) 同じ本文が二重になった: {texts()}"
    # K18 (d) 消した行を別の位置（末尾）に貼り直したら、消えた行と同じ中身の末尾の行なので、戻した行とみなして
    # 足さない（二度足さない）。知らせは行番号を挙げる
    save(lines[:1] + lines[2:], 19)
    n0 = len(recs())
    out = save(lines[:1] + lines[2:] + [lines[1]], 21)
    assert [x.get("kind") for x in recs()[n0:]] == ["restored"] and texts() == names, f"(d) 末尾に戻した行を足した: {recs()[n0:]}"
    assert RTM.RESTORED_TEXT.format(line=RTM.line_list([5])) in out, out
    # K18 の 8: 知らせのとおり末尾にもう一度打つと、組になれる消えた行が無いので新しい発話
    cur = lines[:1] + lines[2:] + [lines[1]]
    out = save(cur + [lines[1]], 23)
    assert "戻した行" not in out and texts() == names + ["案は二つです"], f"(d) 打ち直した行を拾わない: {texts()}"
    cur = cur + [lines[1]]
    # K18 (e) 消えた行の覚えは、新しい発話を受けても捨てない。あとで末尾に同じ中身が現れたら戻した行（二度足さない）
    gone = cur[2]                                   # 乙\tA案がよい
    save(cur[:2] + cur[3:], 25)
    save(cur[:2] + cur[3:] + ["甲\t次の議題へ"], 27)  # 新しい発話を受ける
    n0 = len(recs())
    out = save(cur[:2] + cur[3:] + ["甲\t次の議題へ", gone], 29)
    assert [x.get("kind") for x in recs()[n0:]] == ["restored"], recs()[n0:]
    assert texts() == names + ["案は二つです", "次の議題へ"], f"(e) 消えた行と同じ中身を末尾で二度足した: {texts()}"
    cur = cur[:2] + cur[3:] + ["甲\t次の議題へ", gone]
    # 間の行を消し、新しい発話を受けたあとで同じ位置に戻しても、消えた行と同じ中身なので戻した行（二度足さない）
    save(cur[:1] + cur[2:], 31)
    save(cur[:1] + cur[2:] + ["乙\t承知しました"], 33)
    n0 = len(recs())
    out = save(cur + ["乙\t承知しました"], 35)
    assert [x.get("kind") for x in recs()[n0:]] == ["restored"] and not [x for x in recs()[n0:] if "i" in x], recs()[n0:]
    code, out = run(["next", log, "--now", at_plus(41)])
    assert code == 0 and "戻した行とみなして足していません" in out and "発話 1〜7" in out, out
    assert texts() == names + ["案は二つです", "次の議題へ", "承知しました"], texts()


def test_memo_speaker(tmp):
    """(z5) r07・K3: 「話者: 本文」の切り出し（ページの splitWho と同じ決まり）と、時刻らしい頭で始まる行。"""
    for line, want in (("司会: 始めます", ("司会", "始めます")), ("司会：始めます", ("司会", "始めます")),
                       ("司会: 始めます", ("司会", "始めます")), ("結論：A案", ("結論", "A案")),
                       ("0:45 甲 反対です", (None, "0:45 甲 反対です")), ("15:00までに送る", (None, "15:00までに送る")),
                       ("9:00 から始めて、", (None, "9:00 から始めて、")), ("16:9 の画面", (None, "16:9 の画面")),
                       ("https://example.com を見る", (None, "https://example.com を見る")),
                       ("司会:始めます", (None, "司会:始めます")), ("司会 太郎: 本文", (None, "司会 太郎: 本文")),
                       ("１班: 発表します", (None, "１班: 発表します")), ("あ" * 20 + ": 本文", ("あ" * 20, "本文")),
                       ("あ" * 21 + ": 本文", (None, "あ" * 21 + ": 本文")), ("\U0001F600" * 20 + "：本文", ("\U0001F600" * 20, "本文")),
                       ("　司会: 始めます　", ("司会", "始めます")), ("司会：", ("司会", ""))):
        assert RTM.split_who(line) == want, f"{line!r} → {RTM.split_who(line)!r}（期待 {want!r}）"
    # 1 行の読み方はページの打つ入口と同じ（共通の期待値 tests/fixtures/typed_lines.json。ページの readTypedLine も同じ表を通す）
    rows = json.loads((FX / "typed_lines.json").read_text(encoding="utf-8"))["rows"]
    for r in rows:
        got = RTM.memo_kind(r["line"])
        assert got == (r["kind"], r["who"], r["text"]), f"{r['line']!r} → {got!r}（期待 {r!r}）"
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo = d / "live" / "k.jsonl", d / "live" / "k.txt"
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    memo.write_text("0:05 甲 始めます\n0:45 乙 反対です\n司会: 始めます\n15:00までに送る\n甲\t乙: タブの話者の列はそのまま\n"
                    "司会：\n", encoding="utf-8")
    out = watch_once(log, at_plus(46))
    assert "読めない" not in out and RTM.MEMO_TIME_TEXT not in out, out
    code, out = run(["next", log, "--now", at_plus(61), "--json"])
    pack = json.loads(out)
    assert [(u["t"], u["who"], u["text"]) for u in pack["new"]["lines"]] == [
        (46, None, "0:05 甲 始めます"), (46, None, "0:45 乙 反対です"),
        (46, "司会", "始めます"), (46, None, "15:00までに送る"), (46, "甲", "乙: タブの話者の列はそのまま"),
        (46, None, "司会：")], pack["new"]


def test_cap_same_time(tmp):
    """(z6) K4: 上限で切った窓は、同じ時刻の塊の手前で切る。塊が窓の最初から始まるときだけ幅 0 の窓。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src = d / "same.tsv"
    write_tsv(src, [(k, "甲", f"{k}秒の発話") for k in range(1, 11)] + [(20, "乙", f"同じ時刻の{k}") for k in range(45)]
              + [(25, "甲", "最後")])
    log = d / "k.jsonl"
    assert run(["open", log, "--src", src, "--name", "試し"])[0] == 0
    for want_t, want_lines in (([0, 20], [1, 10]), ([20, 20], [11, 50]), ([20, 50], [51, 56])):
        code, out = run(["next", log, "--json"])
        new = json.loads(out)["new"]
        got = [new["lines"][0]["i"], new["lines"][-1]["i"]]
        assert new["t"] == want_t and got == want_lines, (new["t"], got)
        # 幅のある窓では、渡した発話はどれも t[1] より前
        assert new["t"][0] == new["t"][1] or all(u["t"] < new["t"][1] for u in new["lines"]), new
        put(d / "b.json", reply(new["t"]))
        code, out = run(["append", log, d / "b.json"])
        assert code == 0, out
    code, out = run([log], tool=AUDIT)
    assert code == 0 and "違反 0" in out, out


def test_reply_reading(tmp):
    """(z7) K5: events:null は読めない返事（数える）。前後の空白は JS の trim と同じ集まり。入れ子は読む前に 500 段で断る。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    src = d / "src.tsv"
    write_tsv(src, [(5, "甲", "一つ目"), (20, "乙", "二つ目"), (40, "甲", "三つ目")])
    good = json.dumps(reply([0, 30], [card("C1", 5, [1], who="甲")]), ensure_ascii=False)

    def fresh(name):
        s2 = d / f"{name}.tsv"
        shutil.copy(src, s2)
        lg = d / f"{name}.jsonl"
        assert run(["open", lg, "--src", s2, "--name", "試し"])[0] == 0
        assert run(["next", lg])[0] == 0
        return lg

    for k, (name, text, ok, word) in enumerate((
            ("events が null", json.dumps(dict(reply([0, 30]), events=None)), False, "events が配列ではありません"),
            ("step が null", json.dumps(dict(reply([0, 30]), step=None)), False, "step がオブジェクトではありません"),
            ("前に NBSP と BOM、後ろに全角スペース", " ﻿" + good + "　", True, ""),
            ("後ろに U+0085", good + "\u0085", False, "JSON"),
            ("前に U+001C", "\u001c" + good, False, "JSON"),
            ("前に U+200B", "​" + good, False, "JSON"),
            ("文字列の外の入れ子 501 段", good[:-1] + ',"zz":' + "[" * 501 + "]" * 501 + "}", False, "500 段"),
            ("文字列の中の [ は数えない", json.dumps(dict(reply([0, 30]), think="[" * 600), ensure_ascii=False), True, ""))):
        lg = fresh(f"r{k}")
        before = lg.read_text(encoding="utf-8")
        (d / "b.json").write_text(text, encoding="utf-8")
        code, out = run(["append", lg, d / "b.json"])
        assert "Traceback" not in out, out
        if ok:
            assert code == 0, f"[{name}] が受けられない:\n{out}"
        else:
            assert code == 2 and word in out, f"[{name}] が拒まれない（{code}）:\n{out}"
            assert loads_file(lg.with_name(lg.stem + ".next.json"))["attempt"] == 2, f"[{name}] を同じ窓の 1 回に数えていない"
            assert lg.read_text(encoding="utf-8") == before
            assert len(set(l for l in out.splitlines() if l.strip())) == len([l for l in out.splitlines() if l.strip()]), \
                f"[{name}] 同じ文を 2 回出した:\n{out}"


def test_open_field_types(tmp):
    """(z8) p_window_str: open の window・chunk が文字列・配列・オブジェクトでも、status・digest・next・append が落ちない（F02）。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    bf = d / "b.jsonl"
    write_jsonl(bf, [{"e": "step", "n": 2, "lines": [2, 2], "t": [30, 60]}, {"e": "note", "t": 60, "x": "二つ目。"}])
    for k, v in enumerate(("30", [30], {"a": 30}, None, True, 30.5)):
        lg = d / f"w{k}.jsonl"
        write_jsonl(lg, [{"e": "open", "v": 2, "name": "幅", "t0": T0, "mode": "file", "window": v, "known": ""},
                         {"e": "step", "n": 1, "lines": [1, 1], "t": [0, 30], "at": at_plus(40)},
                         {"e": "note", "t": 30, "x": "一つ目。"}])
        for args in (["status", lg], ["status", lg, "--json"], ["digest", lg], ["next", lg], ["append", lg, bf]):
            code, out = run(args)
            assert "Traceback" not in out and code in (0, 1, 2), f"window={v!r} {args[0]}: {code}\n{out}"
        code, out = run(["append", lg, bf])
        assert code != 0 and "F02" in out and "window" in out, out
        code, out = run(["status", lg])
        assert "F02" in out, out
    for v in ("3", [3], {"a": 3}):
        lg = d / "c.jsonl"
        write_jsonl(lg, [{"e": "open", "name": "v1", "src": "x.txt", "known": "", "chunk": v},
                         {"e": "step", "n": 1, "lines": [1, 3], "t": [0, 30]}])
        for args in (["status", lg], ["digest", lg], ["next", lg]):
            code, out = run(args)
            assert "Traceback" not in out and code in (0, 1, 2), f"chunk={v!r} {args[0]}: {code}\n{out}"
        code, out = run(["status", lg])
        assert "F02" in out and "chunk" in out, out



# ------------------------------------------------------------ 6 回目の決め（K9〜K14・K17）

def test_log_names(tmp):
    """(k9) 判断ログの名前は小文字の .jsonl で終わる名前だけ。自分自身・派生ファイル・大小文字だけ違う語幹の
    判断ログか派生ファイルがあれば open は断る。watch の印に判断ログの名前を書き、名前の違う印では断る。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    live = d / "live"
    live.mkdir()
    memo = live / "memo.txt"
    opn = lambda nm: run(["open", live / nm, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    for nm in ("会議.peek", "会議", "会議.tsv", "会議.JSONL", "会議.Jsonl", "会議.src.jsonl", "会議.SRC.jsonl", ".jsonl", "会議.batch.jsonl"):
        code, out = opn(nm)
        assert code == 1 and "Traceback" not in out, f"{nm} を判断ログの名前に受けた:\n{out}"
    assert os.listdir(live) == [], f"断った open が何か書いた: {os.listdir(live)}"
    code, out = opn("kaigi.jsonl")
    assert code == 0, out
    memo.write_text("甲\t始めます\n", encoding="utf-8")
    watch_once(live / "kaigi.jsonl", at_plus(5))
    assert (live / "kaigi.src.jsonl").exists()
    # 自分自身（空のファイルでも）・大小文字だけ違う語幹・派生ファイルだけが残っている語幹は断る（何も書かない）
    (live / "empty.jsonl").write_text("", encoding="utf-8")
    for name, stray in (("kaigi.jsonl", None), ("Kaigi.jsonl", None), ("KAIGI.jsonl", None), ("empty.jsonl", None),
                        ("teire.jsonl", "teire.next.json"), ("teire2.jsonl", "Teire2.watch.json"),
                        ("teire3.jsonl", "TEIRE3.SRC.JSONL"), ("teire4.jsonl", "TEIRE4.JSONL")):
        if stray:
            (live / stray).write_text("{}", encoding="utf-8")
        before = sorted(os.listdir(live))
        code, out = opn(name)
        assert code == 1 and "語幹" in out and "大小文字" in out, f"{name} を開いた（{stray}）:\n{out}"
        assert sorted(os.listdir(live)) == before, f"断った open が何か書いた: {name}"
    # watch の印には判断ログの名前を書く
    mark = json.loads((live / "kaigi.watch.json").read_text(encoding="utf-8")) if (live / "kaigi.watch.json").exists() else None
    assert mark is None, "watch --once が印を残した"
    log = live / "kaigi.jsonl"
    put(live / "b.json", reply([0, 30]))
    for theirs, want in (("KAIGI.jsonl", "別の判断ログ"), (None, "名前が書かれていない")):
        m = {"token": "x", "beat": at_plus(40)}
        if theirs:
            m["log"] = theirs
        put(live / "kaigi.watch.json", m)
        for args in (["watch", log, "--once", "--now", at_plus(40)], ["next", log, "--now", at_plus(40)],
                     ["append", log, live / "b.json", "--now", at_plus(40)], ["end", log, "--now", at_plus(40)],
                     ["pause", log, "--now", at_plus(40)]):
            before = log.read_text(encoding="utf-8")
            code, out = run(args)
            assert code == 2 and want in out and "Traceback" not in out, f"名前の違う印で {args[0]} が通った:\n{out}"
            assert log.read_text(encoding="utf-8") == before
    # 自分の名前の古い印（止まった watch が残したもの）は引き継ぐ
    put(live / "kaigi.watch.json", {"token": "x", "beat": at_plus(1), "log": "kaigi.jsonl"})
    memo.write_text("甲\t始めます\n乙\t続けます\n", encoding="utf-8")
    out = watch_once(log, at_plus(40))
    assert "発話 1 件" in out, out
    # 名前の違う古い印は引き継がない（印に名前を書いたのは、語幹の同じ別のログの印を使わないため）
    put(live / "kaigi.watch.json", {"token": "x", "beat": at_plus(1), "log": "other.jsonl"})
    code, out = run(["watch", log, "--once", "--now", at_plus(45)])
    assert code == 2 and "別の判断ログ" in out, out
    (live / "kaigi.watch.json").unlink()


def test_append_end_refusal(tmp):
    """(k10) live の end は、rt.py end でも append に end だけのバッチを渡しても、同じ断り（まだ渡していない発話が
    あれば何も書かない。終了コード 1）を通る。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo = d / "live" / "k.jsonl", d / "live" / "k.txt"
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    memo.write_text("甲\t始めます\n乙\t案は二つ\n", encoding="utf-8")
    watch_once(log, at_plus(10))
    code, out = run(["next", log, "--now", at_plus(31)])
    assert code == 0, out
    put(d / "b.json", reply([0, 30], [card("C1", 10, [1, 2], who="甲")]))
    assert run(["append", log, d / "b.json", "--now", at_plus(32)])[0] == 0
    with open(memo, "a", encoding="utf-8") as f:
        f.write("甲\tまだ渡していない発話\n")
    watch_once(log, at_plus(40))
    before = log.read_text(encoding="utf-8")
    end = '{"e":"end","t":45}'
    for name, body in (("end.json", end), ("end.jsonl", end + "\n"), ("end.txt", "```json\n" + end + "\n```\n"),
                       ("endat.jsonl", '{"e":"end","t":45,"at":"2026-10-07T01:00:45Z"}\n')):
        (d / name).write_text(body, encoding="utf-8")
        code, out = run(["append", log, d / name, "--now", at_plus(45)])
        assert code == 1 and RTM.END_UNSENT.format(n=1) in out, f"append の end（{name}）が断りを抜けた:\n{out}"
        assert log.read_text(encoding="utf-8") == before, f"断った append が書いた（{name}）"
    code, out = run(["append", log, "--now", at_plus(45)], stdin=end)
    assert code == 1 and RTM.END_UNSENT.format(n=1) in out, out
    code, out = run(["append", log, d / "無いファイル.json", "--now", at_plus(45)])
    assert code == 1 and "読めません" in out and "Traceback" not in out, out
    code, out = run(["end", log, "--now", at_plus(45)])
    assert code == 1 and RTM.END_UNSENT.format(n=1) in out, out
    assert log.read_text(encoding="utf-8") == before


def test_retimed_and_speaker_col(tmp):
    """(k13) 読み終えた行の時刻の列だけの直しは記録に効かないと知らせ、「末尾に足して」は言わない。
    時刻らしい列（正しくない時刻も）は落とし、残りが 1 列なら「話者: 本文」を切り出す。話者の列の終わりの「:」は落とす。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo = d / "live" / "k.jsonl", d / "live" / "k.txt"
    srclog = log.with_name("k.src.jsonl")
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    memo.write_text("0:05\t甲\t一つ目\n乙\t二つ目\n0:5\t司会: 三つ目\n司会:\t四つ目\n", encoding="utf-8")
    watch_once(log, at_plus(6))
    utts = [json.loads(x) for x in srclog.read_text(encoding="utf-8").splitlines() if '"i":' in x]
    assert [(u["who"], u["text"]) for u in utts] == [("甲", "一つ目"), ("乙", "二つ目"), ("司会", "三つ目"), ("司会", "四つ目")], utts
    for k, (lines, want) in enumerate((
            (["0:07\t甲\t一つ目", "乙\t二つ目", "0:5\t司会: 三つ目", "司会:\t四つ目"], "1"),       # 時刻の列だけ直す
            (["0:07\t甲\t一つ目", "0:20\t乙\t二つ目", "0:5\t司会: 三つ目", "司会:\t四つ目"], "2"))):   # 時刻の列を足す
        n0 = len(srclog.read_text(encoding="utf-8").splitlines())
        memo.write_text("".join(x + "\n" for x in lines), encoding="utf-8")
        out = watch_once(log, at_plus(8 + k))
        got = [json.loads(x) for x in srclog.read_text(encoding="utf-8").splitlines()[n0:]]
        assert [x.get("kind") for x in got] == ["retimed"] and not [x for x in got if "i" in x], got
        assert f"読み終えた行の時刻の列だけが書き換わった（{want} 行目）" in out and RTM.RETIMED_HINT in out, out
        assert RTM.CHANGED_HINT not in out and "末尾に足して" not in out, f"時刻の列だけの直しに「末尾に足して」と言った:\n{out}"
    # 本文の直しは、前の行が消えて、読み終えた行の間に行が足された（K18。拾わずに名指す。末尾に足すように言う）
    memo.write_text("0:07\t甲\t一つ目です\n0:20\t乙\t二つ目\n0:5\t司会: 三つ目\n司会:\t四つ目\n", encoding="utf-8")
    out = watch_once(log, at_plus(11))
    assert "読み終えた行が消えた（いまの 1 行目の手前）" in out and RTM.INSERTED_TEXT.format(line="1") in out, out
    assert RTM.CHANGED_HINT in out, out
    # 同じ位置で続けて消えた行は 1 文にまとめて行数を言う（同じ文を並べない。拾っていなかった間の行は数えない）。
    # 説明も 1 回だけ。消えた読み終えた行が 3 行に満たないので、残った行は名指さない（K26）
    memo.write_text("司会:\t四つ目\n", encoding="utf-8")
    out = watch_once(log, at_plus(12))
    assert out.count("読み終えた行が 2 行消えた（いまの 1 行目の手前）") == 1 and "読み終えた行が消えた（" not in out, out
    assert out.count(RTM.CHANGED_HINT) == 1 and "残った行" not in out, out
    # 共通の期待値（ページの readTypedLine と同じ表）
    for row in json.loads((FX / "typed_lines.json").read_text(encoding="utf-8"))["rows"]:
        assert RTM.memo_kind(row["line"]) == (row["kind"], row["who"], row["text"]), (row, RTM.memo_kind(row["line"]))


def test_end_time_and_late_window(tmp):
    """(k14) end の t: live は聞き終えた時計の秒と直前の窓の終わりの大きいほう、file は直前の窓の終わり。
    live で遅れて閉じる窓の終わりは、窓の始まりから窓幅ずつ足した目盛り（ページの cut.js と同じ）。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo = d / "live" / "k.jsonl", d / "live" / "k.txt"
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    memo.write_text("甲\t始めます\n", encoding="utf-8")
    watch_once(log, at_plus(5))
    with open(memo, "a", encoding="utf-8") as f:
        f.write("乙\t次の発話\n")
    watch_once(log, at_plus(70))
    # 0:05 と 1:10 の発話。75 秒に next を打つと、窓は 0:00〜1:00（目盛り 30・60・90 のうち、時計が過ぎた最も後ろ）
    code, out = run(["next", log, "--now", at_plus(75), "--json"])
    new = json.loads(out)["new"]
    assert new["t"] == [0, 60] and [u["i"] for u in new["lines"]] == [1], new
    put(d / "b.json", reply([0, 60]))
    assert run(["append", log, d / "b.json", "--now", at_plus(76)])[0] == 0
    code, out = run(["next", log, "--now", at_plus(95), "--json"])
    assert json.loads(out)["new"]["t"] == [60, 90], out
    put(d / "b.json", reply([60, 90]))
    assert run(["append", log, d / "b.json", "--now", at_plus(96)])[0] == 0
    # 中断（1:30。読み終えた所）して、再開後の発話が 3:20 に届く。270 秒に next を打つと、窓の始まりは 1:30 から
    # 窓幅ずつ進めた 3:00、終わりは 3:30・4:00・4:30 のうち時計が過ぎた最も後ろの 4:30
    assert run(["pause", log, "--now", at_plus(97)])[0] == 0
    with open(memo, "a", encoding="utf-8") as f:
        f.write("甲\t再開します\n")
    watch_once(log, at_plus(200))
    code, out = run(["next", log, "--now", at_plus(270), "--json"])
    new = json.loads(out)["new"]
    assert new["t"] == [180, 270] and [u["i"] for u in new["lines"]] == [3], new
    put(d / "b.json", reply([180, 270]))
    assert run(["append", log, d / "b.json", "--now", at_plus(271)])[0] == 0
    # live の end の t は、聞き終えた時計の秒（t0 からの整数の秒）と直前の窓の終わりの大きいほう
    code, out = run(["end", log, "--now", at_plus(281)])
    assert code == 0, out
    assert load_lines(log)[-1]["t"] == 281, load_lines(log)[-1]
    # file の end の t は、直前の窓の終わり（時計は使わない）
    src = d / "f.txt"
    src.write_text("0:05\t甲\t一つ目\n0:40\t乙\t二つ目\n", encoding="utf-8")
    flog = d / "f.jsonl"
    assert run(["open", flog, "--src", src, "--name", "試し"])[0] == 0
    for t in ([0, 30], [30, 60]):
        assert run(["next", flog])[0] == 0
        put(d / "b.json", reply(t))
        assert run(["append", flog, d / "b.json"])[0] == 0
    code, out = run(["end", flog, "--now", "2026-10-07T05:00:00Z"])
    assert code == 0, out
    assert json.loads(flog.read_text(encoding="utf-8").splitlines()[-1])["t"] == 60
    assert RTM.end_t(RTM.fold(load_lines(flog)[:-1], RTM.load_rules()), "2026-10-07T05:00:00Z") == 60


def load_lines(path):
    return [json.loads(x) for x in Path(path).read_text(encoding="utf-8").splitlines()]


class MemoSim:
    """メモ帳の保存 1 回ごとに sync_memo を直に呼ぶ（watch を回さない。K18 の場面を小さく流す）。"""

    def __init__(self, tmp, init=()):
        d = Path(tempfile.mkdtemp(dir=tmp))
        self.memo, self.src = d / "m.txt", d / "m.src.jsonl"
        self.src.write_text("", encoding="utf-8")
        self.sec = 0
        for k in range(1, len(init) + 1):   # 1 行ずつ打って保存
            self.save(init[:k])

    def save(self, lines, nl="\n"):
        self.memo.write_bytes("".join(x + nl for x in lines).encode("utf-8"))
        self.sec += 1
        return RTM.sync_memo(str(self.memo), str(self.src), RTM.iso_sec(T0), at_plus(self.sec), settle=0) or []

    def recs(self):
        return [json.loads(l) for l in self.src.read_text(encoding="utf-8").splitlines() if l.strip()]

    def texts(self):
        return [r["text"] for r in self.recs() if "i" in r and "ev" not in r]


def _k18_summary(got):
    """1 回の保存で書いたもの: 読み終えた行の変化（溜まりの片付けの forget と、知らせにならない打ち直しの印は除く）と新しい発話。"""
    return ([(r["kind"], r.get("lines") or r.get("line")) for r in got if r.get("ev") == "changed" and r["kind"] != "forget"
             and not (r["kind"] == "retyped" and not r.get("drop"))]
            + [("発話", r["text"]) for r in got if "i" in r])


def test_memo_k18(tmp):
    """(k18) メモ帳の突き合わせ（K18）: 黙って欠かさない・黙って二重にしない・拾わなかった行は必ず名指す。
    6 回目の反証の場面（R1〜R4・x6・x8）、決め方の縛り（並べ方が複数あるときは C の後ろの行を残す）、
    5 回目と 4 回目の「消して戻す」の場面、知らせの文、同じ出来事を二度書かないこと、速さ。"""
    L5 = ["甲\t始めます", "乙\t案は二つです", "甲\tA案とB案", "乙\tA案がよい", "甲\tではA案で"]
    NX = "乙\t次の議題へ"
    H = ["乙\tはい", "乙\tA案です", "乙\tはい", "乙\tはい"]
    P3 = ["甲\t提案します", "乙\tはい", "甲\t理由は二つ"]
    R = "restored"
    scenes = (
        # 6 回目の must: 相づちの多いメモ帳で途中の 1 行を消すだけ → 発話は増えない（二重にしない）
        ("R1", H, [([H[0], H[2], H[3]], [("deleted", 2)])], []),
        # 6 回目の must: 2→3 行目を消し、3→2 の逆の順に戻す → どちらも戻した行（二重にしない）
        ("R2", ["乙\tなるほど", "甲\tB案です", "乙\tはい"],
         [(["乙\tなるほど", "乙\tはい"], [("deleted", 2)]), (["乙\tなるほど"], [("deleted", 2)]),
          (["乙\tなるほど", "乙\tはい"], [(R, [2])]), (["乙\tなるほど", "甲\tB案です", "乙\tはい"], [(R, [2])])], []),
        ("R2b", L5, [(L5[:3] + L5[4:], [("deleted", 4)]), (L5[:3], [("deleted", 4)]),
                     (L5[:3] + L5[4:], [(R, [4])]), (L5, [(R, [4])])], []),
        # 6 回目の should: 末尾の はい 2 行を消す → はい（戻した行と名指す）→ 知らせのとおりもう一度（新しい発話。
        # 消した行を戻しただけなら二重になったことも、打ち直した行の知らせで言う）。消えた読み終えた行が 3 行に
        # 満たないので、残った行は名指さない（K26）
        ("R3", ["甲\t提案します", "乙\tはい", "乙\tはい"],
         [(["甲\t提案します"], [("deleted", 2)]), (["甲\t提案します", "乙\tはい"], [(R, [2])]),
          (["甲\t提案します", "乙\tはい", "乙\tはい"], [("retyped", [3]), ("発話", "はい")])], ["はい"]),
        # 6 回目の must: 空にするのと同じ保存で はい を 1 行。消えた読み終えた行は 2 行（3 行に満たない）ので、K26 では
        # 残った行と名指さない（2 行を消しただけの保存と見分けられない。消えた 2 行は名指す）。末尾に打てば新しい発話
        ("R4", P3, [(["乙\tはい"], [("deleted", 1), ("deleted", 2)]),
                    (["乙\tはい", "乙\tはい"], [("発話", "はい")])], ["はい"]),
        # 6 回目の should: 空にするのと同じ保存で打った行は、前の行と同じ中身でも黙って欠かさない（名指す）
        ("x6a", L5, [(["甲\t次の議題です", "乙\tA案がよい", "甲\tではA案で"], [("deleted", 1), ("kept", [2, 3]), ("inserted", [1])])], []),
        ("x6c", L5, [(["甲\t始めます", "乙\t二回目の会です"], [("deleted", 2), ("kept", [1]), ("発話", "二回目の会です")])], ["二回目の会です"]),
        ("x6e", P3 + ["乙\tはい"], [(["甲\t次へ", "乙\tはい"], [("deleted", 1), ("kept", [2]), ("inserted", [1])])], []),
        ("x8", L5, [(L5[:2] + ["甲\tC案もある"] + L5[3:], [("deleted", 3), ("inserted", [3])]),
                    (L5[:2] + ["甲\tC案もある"] + L5[3:] + ["乙\t次"], [("発話", "次")])], ["次"]),
        ("x8b", L5, [(L5[:4], [("deleted", 5)]), (L5[:4] + ["乙\t次"], [("発話", "次")]), (L5 + ["乙\t次"], [(R, [5])])], ["次"]),
        ("x8c", L5, [(L5[:4], [("deleted", 5)]), (L5, [(R, [5])]), (L5 + [L5[4]], [("発話", "ではA案で")])], ["ではA案で"]),
        # 決め方の縛り（K18 の 3）: 並べ方が 2 つあるとき（はい を並べるか 理由は二つ を並べるか）、C の後ろの行
        # （理由は二つ）を残す。末尾の はい は消えた行と組になって名指され、新しく打った行が黙って吸われない。
        # 知らせのとおり末尾にもう一度打った行は新しい発話（K26。同じ中身の消えた行の覚えは残っていないので、知らせは無い）
        ("tie", ["乙\tはい", "甲\t理由は二つ"], [(["甲\t理由は二つ", "乙\tはい"], [("deleted", 1), (R, [2])]),
                                              (["甲\t理由は二つ", "乙\tはい", "乙\tはい"], [("発話", "はい")])], ["はい"]),
        # 5 回目（r05_undo5）と 4 回目（r05_memo_undo）の「消して戻す」: 戻した行は足さず、そのあとの新しい行は落とさない
        ("a 全部消して戻す", L5, [([], [("deleted", 1)]), (L5, [(R, [1, 2, 3, 4, 5])]), (L5 + [NX], [("発話", "次の議題へ")])], ["次の議題へ"]),
        ("b 末尾 2 行", L5, [(L5[:3], [("deleted", 4)]), (L5, [(R, [4, 5])]), (L5 + [NX], [("発話", "次の議題へ")])], ["次の議題へ"]),
        ("c 途中の 1 行", L5, [(L5[:1] + L5[2:], [("deleted", 2)]), (L5, [(R, [2])]), (L5 + [NX], [("発話", "次の議題へ")])], ["次の議題へ"]),
        ("c2 途中の 2 行", L5, [(L5[:1] + L5[3:], [("deleted", 2)]), (L5, [(R, [2, 3])]), (L5 + [NX], [("発話", "次の議題へ")])], ["次の議題へ"]),
        ("d 戻すのと同じ保存で新しい行", L5, [([], [("deleted", 1)]), (L5 + [NX], [(R, [1, 2, 3, 4, 5]), ("発話", "次の議題へ")])], ["次の議題へ"]),
        ("d2 途中を戻すのと同じ保存で 2 行", L5, [(L5[:2] + L5[3:], [("deleted", 3)]),
                                          (L5 + [NX, "甲\tはい"], [(R, [3]), ("発話", "次の議題へ"), ("発話", "はい")])], ["次の議題へ", "はい"]),
        ("e 戻したあと別の保存で 2 回", L5, [(L5[:4], [("deleted", 5)]), (L5, [(R, [5])]), (L5 + [NX], [("発話", "次の議題へ")]),
                                         (L5 + [NX, "甲\t了解"], [("発話", "了解")])], ["次の議題へ", "了解"]),
        ("g 途中の 3 行を 2 回に分けて戻す", L5, [(L5[:1] + L5[4:], [("deleted", 2), ("kept", [1, 2])]), (L5[:2] + L5[4:], [(R, [2])]),
                                              (L5, [(R, [3, 4])]), (L5 + [NX], [("発話", "次の議題へ")])], ["次の議題へ"]),
        ("x1 消したまま戻さなかった行と同じ中身をあとで打つ", L5 + ["甲\tはい"],
         [(L5, [("deleted", 6)]), (L5 + [NX], [("発話", "次の議題へ")]), (L5 + [NX, "甲\tはい"], [(R, [7])]),
          (L5 + [NX, "甲\tはい", "甲\tはい"], [("発話", "はい")])], ["次の議題へ", "はい"]),
        ("x2 空にして続きを打つ", L5,
         [([], [("deleted", 1)]), (["甲\t次の議題です"], [("発話", "次の議題です")]),
          (["甲\t次の議題です", "乙\tA案がよい"], [(R, [2])]), (["甲\t次の議題です", "乙\tA案がよい", "甲\tではA案で"], [(R, [3])]),
          (["甲\t次の議題です", "乙\tA案がよい", "甲\tではA案で", "乙\tA案がよい", "甲\tではA案で"],
           [("発話", "A案がよい"), ("発話", "ではA案で")])], ["次の議題です", "A案がよい", "ではA案で"]),
    )
    for name, init, saves, want_new in scenes:
        m = MemoSim(tmp, init)
        base = m.texts()
        assert base == [x.split("\t")[1] for x in init], (name, base)
        for k, (lines, want) in enumerate(saves):
            got = m.save(lines)
            assert _k18_summary(got) == want, f"{name} の {k + 1} 回目の保存:\n{_k18_summary(got)}\n期待 {want}"
            # 同じメモ帳をもう一度見ても、何も書き足さない（同じ出来事は二度書かない）
            n0 = len(m.recs())
            assert m.save(lines) == [] and len(m.recs()) == n0, f"{name}: 変わらないメモ帳で書き足した"
        assert m.texts() == base + want_new, f"{name} の発話: {m.texts()}（期待 {base + want_new}）"
    # CRLF で戻しても同じ（エディタが改行を変えた）
    m = MemoSim(tmp, L5)
    m.save([])
    got = m.save(L5, nl="\r\n")
    assert _k18_summary(got) == [(R, [1, 2, 3, 4, 5])], got
    # 知らせの文（行番号だけ。行の中身は出さない）
    notes = RTM.notice_lines([{"ev": "changed", "kind": k, "line": 3, "lines": [3, 4], "pos": 0, "was": [], "now": []}
                              for k in ("restored", "inserted", "kept", "retyped")])
    assert notes == [RTM.RESTORED_TEXT.format(line="3・4"), RTM.INSERTED_TEXT.format(line="3・4"),
                     RTM.KEPT_TEXT.format(line="3・4"), RTM.RETYPED_TEXT.format(line="3・4")], notes
    assert "消えた行と同じ中身なので、戻した行とみなして足していません（3・4 行目）。新しい発話なら、末尾にもう一度打ってください" == notes[0]
    assert "読み終えた行の間の行は拾いません（3・4 行目）。新しい発話なら、末尾に打ってください" == notes[1]
    # 拾っていなかった行（間の行）が消えただけなら知らせない
    m = MemoSim(tmp, L5)
    m.save(L5[:2] + ["甲\t間の行"] + L5[2:])
    got = m.save(L5)
    assert [r.get("u") for r in got] == [False] and RTM.notice_lines(got) == [], got
    # 速さ（K18 の 9）: メモ帳 3000 行・真ん中 300 行の突き合わせが 0.2 秒以内（3 回測っていちばん速いもの）
    import random
    import time as _time
    rng = random.Random(18)
    C = [f"甲\t発話 {k} 番目" for k in range(3000)]
    for mid in ([f"乙\t書き換え {k}" for k in range(300)], rng.sample(C[1350:1650], 300),
                [C[1350 + k] if k % 3 else f"乙\t別 {k}" for k in range(300)]):
        M = C[:1350] + mid + C[1650:]
        sl = RTM.SrcLog()
        sl.entries = [[x, True, False] for x in C]
        memo = [(j + 1, x, x) for j, x in enumerate(M)]
        best = 9.0
        for _ in range(3):
            t = _time.perf_counter()
            RTM.plan_memo(sl, memo, 1)
            best = min(best, _time.perf_counter() - t)
        assert best <= 0.2, f"3000 行・真ん中 300 行の突き合わせに {best:.3f} 秒"


def test_k18_windows(tmp):
    """(k18w) 突き合わせの知らせは、next と next --last の窓に必ず出る。最後の発話より後ろで起きた出来事は、
    最後の窓（next --last）に出す。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo, bf = d / "live" / "k.jsonl", d / "live" / "k.txt", d / "b.json"
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    memo.write_text("甲\t始めます\n乙\t案は二つ\n", encoding="utf-8")
    watch_once(log, at_plus(5))
    memo.write_text("甲\t始めます\n甲\t間に足した行\n乙\t案は二つ\n乙\tはい\n", encoding="utf-8")
    watch_once(log, at_plus(8))
    code, out = run(["next", log, "--now", at_plus(31)])
    assert code == 0 and "発話 1〜3" in out and RTM.INSERTED_TEXT.format(line="2") in out, out
    put(bf, reply([0, 30]))
    assert run(["append", log, bf, "--now", at_plus(32)])[0] == 0
    # はい を もう一つ に書き換え（はい が消えて、もう一つ が新しい発話 4）、そのあと最後の発話 もう一つ を消す
    # → 発話 4 の前の消去と、最後の発話より後ろの消去の両方を、最後の窓に出す
    memo.write_text("甲\t始めます\n甲\t間に足した行\n乙\t案は二つ\n乙\tもう一つ\n", encoding="utf-8")
    watch_once(log, at_plus(40))
    memo.write_text("甲\t始めます\n甲\t間に足した行\n乙\t案は二つ\n", encoding="utf-8")
    watch_once(log, at_plus(42))
    code, out = run(["next", log, "--last", "--now", at_plus(45), "--json"])
    pack = json.loads(out)
    assert pack["new"]["t"] == [30, 45] and [u["i"] for u in pack["new"]["lines"]] == [4], pack["new"]
    assert "読み終えた行が 2 行消えた（いまの 4 行目の手前）" in pack.get("notices", []), pack.get("notices")
    put(bf, reply([30, 45]))
    assert run(["append", log, bf, "--now", at_plus(46)])[0] == 0
    # 最後の窓のあとに起きた出来事は、渡す発話の無い next --last でも出す
    memo.write_text("甲\t始めます\n乙\t案は二つ\n", encoding="utf-8")
    watch_once(log, at_plus(47))
    code, out = run(["next", log, "--last", "--now", at_plus(48)])
    assert code == 0 and "渡す発話は残っていません" in out and RTM.LAST_TAIL_HEAD in out, out
    assert "（知らせ）読み終えた行が消えた（いまの 4 行目の手前）" in out, out
    memo.write_text("甲\t始めます\n乙\t案は二つ\n乙\tもう一つ\n乙\tもう一つ\n", encoding="utf-8")
    watch_once(log, at_plus(49))
    memo.write_text("甲\t始めます\n乙\t案は二つ\n", encoding="utf-8")
    watch_once(log, at_plus(50))
    code, out = run(["next", log, "--last", "--now", at_plus(55)])
    # 2 行のうち 1 行目は前に消えた もう一つ と組になって戻した行（名指す）、2 行目が新しい発話 5。
    # そのあと 2 行とも消えた（最後の発話より後ろの出来事）。どれも最後の窓に出す
    assert code == 0 and "発話 5〜5" in out and "（知らせ）" + RTM.RESTORED_TEXT.format(line="3") in out, out
    assert "（知らせ）読み終えた行が 2 行消えた（いまの 3 行目の手前）" in out, out


def test_log_paths_k20(tmp):
    """(k20) 判断ログのパス: 「..」を挟んだ名前は断る。open は絶対パスに直し（リンクも解き）てから照らす。
    無いフォルダは 1 つだけ作り、作れなければ使う人向けの文で断る。status・digest・監査も名前の決めを照らす。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    (d / "live").mkdir()
    memo = d / "live" / "m.txt"
    memos = iter(range(100))
    opn = lambda p, mm=None: run(["open", p, "--live", "--name", "試し", "--transcript",
                                  mm or d / "live" / f"m{next(memos)}.txt", "--now", T0])
    # 「..」を挟んだ名前（無いフォルダを挟んで、同じフォルダの派生ファイルの照らしをすり抜ける書き方）
    for p in (f"{d}/live/x/../k.jsonl", f"{d}/live/../live/k.jsonl", "../k.jsonl", "a\\..\\k.jsonl"):
        code, out = opn(p)
        assert code == 1 and "「..」" in out and "Traceback" not in out, f"{p} を受けた:\n{out}"
    assert sorted(os.listdir(d / "live")) == [] and not (d / "live" / "x").exists()
    for cmd in (["next"], ["status"], ["digest"], ["end"], ["watch", "--once"]):
        code, out = run(cmd[:1] + [f"{d}/live/x/../k.jsonl"] + cmd[1:])
        assert code == 1 and "「..」" in out, f"{cmd[0]} が「..」を受けた:\n{out}"
    # リンク: 判断ログの名前のリンクが素材ログを指していれば、直したパスで照らして断る
    code, out = opn(d / "live" / "k.jsonl", memo)
    assert code == 0, out
    memo.write_text("甲\t始めます\n", encoding="utf-8")
    watch_once(d / "live" / "k.jsonl", at_plus(5))
    (d / "other").mkdir()
    try:
        os.symlink(d / "live" / "k.src.jsonl", d / "other" / "j.jsonl")
        os.symlink(d / "live" / "k.jsonl", d / "other" / "k2.jsonl")
        linked = True
    except (OSError, NotImplementedError):
        linked = False
    if linked:
        code, out = opn(d / "other" / "j.jsonl")
        assert code == 1 and ".src.jsonl" in out, f"素材ログを指すリンクを判断ログとして受けた:\n{out}"
        code, out = opn(d / "other" / "k2.jsonl")
        assert code == 1 and ("語幹" in out or "リンク" in out), f"既にある判断ログを指すリンクで open が通った:\n{out}"
    # 置き場のフォルダ: 無ければ 1 つだけ作る。その上が無ければ作らずに断る。同じ名前のファイルがあれば断る
    code, out = opn(d / "new1" / "k.jsonl")
    assert code == 0 and (d / "new1" / "k.jsonl").exists(), out
    code, out = opn(d / "new2" / "deep" / "k.jsonl")
    assert code == 1 and "その上のフォルダ" in out and "Traceback" not in out and not (d / "new2").exists(), out
    (d / "afile").write_text("x", encoding="utf-8")
    code, out = opn(d / "afile" / "k.jsonl")
    assert code == 1 and "Traceback" not in out and (d / "afile").is_file(), out
    (d / "new3").mkdir()
    (d / "new3" / "f").write_text("x", encoding="utf-8")
    code, out = opn(d / "new3" / "f" / "k.jsonl")
    assert code == 1 and "Traceback" not in out, out
    # status・digest・監査: 素材ログ・覚え書き・watch の印を判断ログとして渡されたら、中身を読まずに断る（行の数も出さない）
    src = d / "live" / "k.src.jsonl"
    side = d / "live" / "k.next.json"
    put(side, {"t": [0, 30], "lines": [1, 1]})
    mark = d / "live" / "k.watch.json"
    put(mark, {"log": "k.jsonl"})
    for p in (src, side, mark):
        for args, tool in ((["status", p], RT), (["digest", p], RT), ([p], AUDIT)):
            code, out = run(args, tool=tool)
            assert code == 1 and "判断ログ" in out and "ステップ" not in out and "Traceback" not in out, f"{args} を受けた:\n{out}"
    mark.unlink()
    side.unlink()


def test_k23(tmp):
    """(k23) end -h の説明・live の end の t は聞き終えた時計より先に置けない・最後の窓の終わり・watch の印の
    読み書きのやり直し・.gitignore。"""
    code, out = run(["end", "-h"])
    assert code == 0 and "聞き終えた時計の秒" in out and "直前の窓の終わりの大きいほう" in out, out
    code, out = run(["pause", "-h"])
    assert code == 0 and "直前の窓の終わり" in out, out
    d = Path(tempfile.mkdtemp(dir=tmp))
    # 本番の環境（実時計）: end --t は聞き終えた時計の秒より先に置けない。append の end も同じ
    log, memo, bf = d / "live" / "r.jsonl", d / "live" / "r.txt", d / "b.json"
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo], env=REAL_ENV)
    assert code == 0, out
    before = log.read_text(encoding="utf-8")
    code, out = run(["end", log, "--t", "3600"], env=REAL_ENV)
    assert code == 1 and "聞き終えた時計" in out and log.read_text(encoding="utf-8") == before, out
    put(bf, '{"e":"end","t":3600}\n')
    code, out = run(["append", log, bf], env=REAL_ENV)
    assert code == 1 and "聞き終えた時計" in out and log.read_text(encoding="utf-8") == before, out
    code, out = run(["end", log, "--t", "0"], env=REAL_ENV)
    assert code == 0, out
    # 最後の窓の終わり（ページの「聞き終える」と同じ）: 窓幅 10 秒・直前の窓の終わり 1:00・まだ窓にしていない発話 1:08
    def setup(name, window):
        lg, mm = d / "live" / f"{name}.jsonl", d / "live" / f"{name}.txt"
        assert run(["open", lg, "--live", "--name", "試し", "--transcript", mm, "--now", T0, "--window", window])[0] == 0
        return lg, mm
    for now, want in ((86, [60, 86]), (95, [60, 90])):   # 1:26 に聞き終えたら 1:00〜1:26、1:35 なら 1:00〜1:30
        lg, mm = setup(f"w{now}", 10)
        mm.write_text("甲\t始めます\n", encoding="utf-8")
        watch_once(lg, at_plus(55))
        code, out = run(["next", lg, "--now", at_plus(61), "--json"])
        assert json.loads(out)["new"]["t"] == [50, 60], out
        put(bf, reply([50, 60]))
        assert run(["append", lg, bf, "--now", at_plus(61)])[0] == 0
        with open(mm, "a", encoding="utf-8") as f:
            f.write("乙\t続き\n")
        watch_once(lg, at_plus(68))
        code, out = run(["next", lg, "--last", "--now", at_plus(now), "--json"])
        assert code == 0 and json.loads(out)["new"]["t"] == want, f"{now}: {out}"
        put(bf, reply(want))
        assert run(["append", lg, bf, "--now", at_plus(now)])[0] == 0, "最後の窓の返事を受けない"
    # window × 3 で切って、そこちょうどか後ろの発話は次の最後の窓（もう一度 next --last を打つように言う）
    lg, mm = setup("c", 10)
    mm.write_text("甲\t始めます\n", encoding="utf-8")
    watch_once(lg, at_plus(5))
    with open(mm, "a", encoding="utf-8") as f:
        f.write("乙\t続き\n")
    watch_once(lg, at_plus(30))
    code, out = run(["next", lg, "--last", "--now", at_plus(31), "--json"])
    pack = json.loads(out)
    assert pack["new"]["t"] == [0, 30] and [u["i"] for u in pack["new"]["lines"]] == [1], pack["new"]
    assert any("まだ渡していない発話が 1 件" in x for x in pack.get("notices", [])), pack
    put(bf, reply([0, 30]))
    assert run(["append", lg, bf, "--now", at_plus(31)])[0] == 0
    code, out = run(["next", lg, "--last", "--now", at_plus(33), "--json"])
    assert json.loads(out)["new"]["t"] == [30, 33], out
    # 中断のあと再開せずに聞き終える: 窓幅 5 秒・0:05 で中断・中断の間の 0:08 に打った行・0:22 に聞き終える → 0:05〜0:20
    lg, mm = setup("p", 5)
    mm.write_text("甲\t始めます\n", encoding="utf-8")
    watch_once(lg, at_plus(2))
    code, out = run(["next", lg, "--now", at_plus(5), "--json"])
    put(bf, reply([0, 5]))
    assert run(["append", lg, bf, "--now", at_plus(5)])[0] == 0
    assert run(["pause", lg, "--now", at_plus(5)])[0] == 0
    with open(mm, "a", encoding="utf-8") as f:
        f.write("乙\t中断の間の行\n")
    watch_once(lg, at_plus(8))
    code, out = run(["next", lg, "--last", "--now", at_plus(22), "--json"])
    assert code == 0 and json.loads(out)["new"]["t"] == [5, 20], out
    # watch の印の読み書きは OSError で落ちない（やり直し、書けなければ偽。一時ファイルも残さない）
    wl = d / "live" / "wm.jsonl"
    mp = RTM.watch_mark_path(wl)
    mp.mkdir()
    assert RTM.read_watch_mark(wl) is None
    assert RTM.write_watch_mark(wl, {"token": "t1", "log": wl.name}) is False
    assert not [x for x in os.listdir(d / "live") if x.endswith(".tmp")], os.listdir(d / "live")
    mp.rmdir()
    real_replace, calls = os.replace, []

    def flaky(a, b):
        calls.append(1)
        if len(calls) < 3:
            raise PermissionError("掴まれている")
        return real_replace(a, b)
    RTM.os.replace = flaky
    try:
        assert RTM.write_watch_mark(wl, {"token": "t2", "log": wl.name}) is True and len(calls) == 3
    finally:
        RTM.os.replace = real_replace
    assert RTM.read_watch_mark(wl) == {"token": "t2", "log": wl.name}
    mp.unlink()
    gi = (KIT / ".gitignore").read_text(encoding="utf-8").splitlines()
    assert "*.watch.json.*.tmp" in gi, "watch の印の一時ファイルが .gitignore に無い"


def test_k24_k26_memo(tmp):
    """(k24・k26) 8 回目の確かめの場面を小さくしたもの（sync_memo を直に呼ぶ）。
    K24: 時刻の列だけが違う行は同じ中身として突き合わせる。同じ中身の行が続くメモ帳で、後ろ・前・途中の行の時刻の列だけを
    直しても、その undo でも、二重にも「消えた」にもならない（retimed だけ）。
    K26: 残った行は、読み終えた行と並んだ M の行すべて（間の行と並んだものも）。消えた読み終えた行が 3 行に満たなければ
    名指さない。戻した行と知らせた中身を末尾にもう一度打った行は、別の保存で消えた同じ中身の覚えが残っていても新しい発話。
    打ち直しの知らせは、spent に覚えのある中身を末尾に打った保存だけ（同じ保存で何行も打ったら、覚えの数まではどの行も
    名指す。消した行をまとめて元に戻したとき、2 行目からが黙って二重にならない）。次の保存からは知らせない。"""
    R = "restored"
    A = ["甲\t始めます", "12:30\t乙\tはい", "12:30\t乙\tはい"]
    B = A + ["甲\tB案です"]
    scenes = (
        # 後ろの行の時刻だけを直す → retimed。戻す（undo）→ また retimed。発話は増えない
        ("t 後ろの行", A, [([A[0], A[1], "12:31\t乙\tはい"], [("retimed", 3)]), (A, [("retimed", 3)])], []),
        # 前の行の時刻だけを直す → retimed（2 行目）。戻す → retimed
        ("t 前の行", A, [([A[0], "12:29\t乙\tはい", A[2]], [("retimed", 2)]), (A, [("retimed", 2)])], []),
        # 後ろにもう 1 行ある途中の行
        ("t 途中の行", B, [([B[0], B[1], "12:31\t乙\tはい", B[3]], [("retimed", 3)]), (B, [("retimed", 3)])], []),
        # 時刻の列を足す・落とす（時刻の列の無い行と、ある行は同じ中身）
        ("t 列を足す・落とす", ["甲\t始めます", "乙\tはい", "乙\tはい"],
         [(["甲\t始めます", "乙\tはい", "0:20\t乙\tはい"], [("retimed", 3)]), (["甲\t始めます", "乙\tはい", "乙\tはい"], [("retimed", 3)])], []),
        # 時刻の列だけを直した行を消して、別の時刻で末尾に打ち直す → 消えた行と同じ中身なので戻した行
        # （同じ中身の行のどちらが消えたかは見分けられないので、位置は C の後ろの行を残す並べ方で決まる）
        ("t 消して時刻違いで戻す", A, [(A[:2], [("deleted", 2)]), (A[:2] + ["12:40\t乙\tはい"], [(R, [3])])], []),
        # K26: 2 回の保存で 1 つずつ消した はい。末尾の はい は戻した行 → 知らせのとおり打ち直すと新しい発話（もう一つの
        # 消えた はい の覚えを除くので、打ち直しの知らせ）→ さらに はい を打つと、知らせ無しの新しい発話
        ("r5 別々の保存", ["甲\t提案します", "乙\tはい", "乙\tはい"],
         [(["甲\t提案します", "乙\tはい"], [("deleted", 2)]), (["甲\t提案します"], [("deleted", 2)]),
          (["甲\t提案します", "乙\tはい"], [(R, [2])]),
          (["甲\t提案します", "乙\tはい", "乙\tはい"], [("retyped", [3]), ("発話", "はい")]),
          (["甲\t提案します", "乙\tはい", "乙\tはい", "乙\tはい"], [("発話", "はい")])], ["はい", "はい"]),
        # K26: 3 行を読ませ、間に はい を差し込み（名指す）、空にするのと同じ保存で はい／D案です を打つ。消えた読み終えた行が
        # 3 行なので、間の行と並んだ はい も残った行として名指す
        ("k 間の行と並んだ行", ["甲\tA案です", "甲\tB案です", "甲\tC案です"],
         [(["甲\tA案です", "乙\tはい", "甲\tB案です", "甲\tC案です"], [("inserted", [2])]),
          (["乙\tはい", "甲\tD案です"], [("deleted", 1), ("deleted", 2), ("kept", [1]), ("発話", "D案です")])], ["D案です"]),
        # 決めの縛り（8 回目の乱数で見つけた、中身からは見分けられない形）: 最後の読み終えた行の手前に、時刻の列だけが違う
        # 同じ中身の行を足すと、「最後の行の時刻の列を直し、末尾に同じ中身を打った」とみなす（retimed と新しい発話）。
        # 生の行まで同じ行と組にし直す決めにすると、時刻の列を直して末尾に打った場面のほうが黙って欠けるので、変えていない
        ("t 最後の行の手前に時刻違い", ["甲\t提案です", "12:05\t乙\tはい"],
         [(["甲\t提案です", "12:04\t乙\tはい", "12:05\t乙\tはい"], [("retimed", 2), ("発話", "はい")])], ["はい"]),
        # 途中の読み終えた行の手前なら、生の行まで同じ行と組にし直して、足した行は間の行（拾わない・名指す）
        ("t 途中の行の手前に時刻違い", ["甲\t提案です", "12:05\t乙\tはい", "甲\t次です"],
         [(["甲\t提案です", "12:04\t乙\tはい", "12:05\t乙\tはい", "甲\t次です"], [("inserted", [2])])], []),
        # K26: 2 行のメモ帳の最後の行だけを書き換える → 消えたのは 1 行なので、書き換えていない 1 行目は名指さない
        ("k 2 行の書き換え", ["甲\t提案です", "乙\tはい"], [(["甲\t提案です", "乙\tいいえ"], [("deleted", 2), ("発話", "いいえ")])], ["いいえ"]),
    )
    for name, init, saves, want_new in scenes:
        m = MemoSim(tmp, init)
        base = m.texts()
        for k, (lines, want) in enumerate(saves):
            got = m.save(lines)
            assert _k18_summary(got) == want, f"{name} の {k + 1} 回目の保存:\n{_k18_summary(got)}\n期待 {want}"
            n0 = len(m.recs())
            assert m.save(lines) == [] and len(m.recs()) == n0, f"{name}: 変わらないメモ帳で書き足した"
        assert m.texts() == base + want_new, f"{name} の発話: {m.texts()}（期待 {base + want_new}）"
    # 時刻の列だけの直しは、知らせの文も「記録に効かない」だけ（消えた・末尾に足して、は言わない）
    m = MemoSim(tmp, A)
    notes = RTM.notice_lines(m.save([A[0], A[1], "12:31\t乙\tはい"]))
    assert notes == ["読み終えた行の時刻の列だけが書き換わった（3 行目）", RTM.RETIMED_HINT], notes
    # spent は打ち直しの知らせを 1 回出したら消える（相づちの多いメモ帳を空にしたあと、本当に新しい はい を何度打っても
    # 「打ち直した」と言い続けない）
    P = ["甲\t提案します", "乙\tはい", "甲\t理由です", "乙\tはい", "甲\t次です", "乙\tはい"]
    m = MemoSim(tmp, P)
    m.save([])
    assert _k18_summary(m.save(["乙\tはい"])) == [(R, [1])]
    assert _k18_summary(m.save(["乙\tはい", "乙\tはい"])) == [("retyped", [2]), ("発話", "はい")]
    assert _k18_summary(m.save(["乙\tはい", "乙\tはい", "甲\t四つ目", "乙\tはい"])) == [("発話", "四つ目"), ("発話", "はい")]
    # 覚えの読み直し（read_srclog_records）も同じ状態になる: 素材ログから当て直した溜まり・spent・戻した行の印で、
    # 次の保存が同じ結果になる
    sl = RTM.read_srclog(m.src)
    assert not sl.pool.has("乙\tはい") and len(sl.spent) == 0 and not any(e[2] for e in sl.entries), (len(sl.pool), len(sl.spent), sl.entries)
    # 8 回目の乱数で見つけた形: 残った行の知らせ（spent へ移した はい が 4 つ）のあと、元に戻す（undo）で はい を 4 行まとめて
    # 戻す → 4 行とも打ち直した行として名指す（前は 1 行目だけ名指し、残りの 3 行が黙って二重になった）
    H = "乙\tはい"
    m = MemoSim(tmp, [H] * 6)
    assert _k18_summary(m.save([H, H, "甲\tD案です"])) == [("deleted", 1), ("kept", [1, 2]), ("発話", "D案です")]
    assert _k18_summary(m.save([H] * 6)) == [("deleted", 3)] + [("retyped", [k]) for k in (3, 4, 5, 6)] + [("発話", "はい")] * 4
    assert len(RTM.read_srclog(m.src).spent) == 0
    # 戻した行と知らせた はい が残ったまま、同じ保存で はい を 3 行戻す → 知らせのとおり打ち直した 1 行目も、続く 2 行も名指す
    m = MemoSim(tmp, [H] * 4)
    assert _k18_summary(m.save([H, "甲\tD案です"])) == [("deleted", 1), ("kept", [1]), ("発話", "D案です")]
    assert _k18_summary(m.save([])) == [("deleted", 1)]
    assert _k18_summary(m.save([H])) == [(R, [1])]
    assert _k18_summary(m.save([H] * 4)) == [("retyped", [2]), ("retyped", [3]), ("retyped", [4])] + [("発話", "はい")] * 3
    sl = RTM.read_srclog(m.src)
    assert len(sl.spent) == 0 and not sl.pool.has(H) and not any(e[2] for e in sl.entries), (len(sl.pool), len(sl.spent), sl.entries)


def test_k25_pending(tmp):
    """(k25) メモ帳の変化（新しい行だけでなく、戻した行・間の行・消えた行・時刻の列の直しの出来事と、改行の無い
    最後の行）が素材ログに入るまで、next --last は待ち（watch が回っていなければ断り）、end は断る。書き終えた出来事の
    知らせは最後の窓に出る。渡す発話が無いときの next --last --json も JSON（K31）。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo, bf = d / "live" / "k.jsonl", d / "live" / "k.txt", d / "b.json"
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    memo.write_text("甲\t始めます\n12:30\t乙\tはい\n", encoding="utf-8")
    watch_once(log, at_plus(5))
    code, out = run(["next", log, "--now", at_plus(31)])
    assert code == 0 and "発話 1〜2" in out, out
    put(bf, reply([0, 30]))
    assert run(["append", log, bf, "--now", at_plus(32)])[0] == 0
    t0s = RTM.iso_sec(T0)
    srclog = log.with_name("k.src.jsonl")
    for name, body, kind in (
            ("消えた行", "甲\t始めます\n", "deleted"),
            ("戻した行（改行の無い最後の行）", "甲\t始めます\n乙\tはい", "restored"),
            ("時刻の列だけの直し", "甲\t始めます\n12:31\t乙\tはい\n", "retimed"),
            ("間の行", "甲\t始めます\n甲\t間の行\n12:31\t乙\tはい\n", "inserted")):
        memo.write_text(body, encoding="utf-8")
        before = log.read_text(encoding="utf-8")
        assert RTM.memo_pending(str(log), str(memo), tail=True) == 1, name
        code, out = run(["end", log, "--now", at_plus(40)])
        assert code == 1 and "まだ入っていない変化" in out and "1 件" in out, f"{name}: end が断らない:\n{out}"
        assert log.read_text(encoding="utf-8") == before
        code, out = run(["next", log, "--last", "--now", at_plus(40)])
        assert code == 1 and "watch が回っていません" in out, f"{name}: next --last が待たずに窓を出した:\n{out}"
        # watch の 1 回分（改行の無い最後の行は 2 秒の確定）
        ts = {"key": None, "since": 0.0}
        tick = lambda sec: RTM.sync_memo(str(memo), str(srclog), t0s, at_plus(int(sec)), settle=0, tail_state=ts, now_sec=t0s + sec)
        got = tick(41) or tick(43.5)
        assert [r.get("kind") for r in got if "ev" in r] == [kind] and not [r for r in got if "i" in r], (name, got)
        assert RTM.memo_pending(str(log), str(memo), tail=True) == 0, name
        code, out = run(["next", log, "--last", "--now", at_plus(44), "--json"])
        assert code == 0, out
        pack = json.loads(out)
        # 渡す発話は無い: JSON で、窓は null。知らせ（戻した行・消えた行など）と結びの文が notices に入る
        assert pack["last"] is True and pack["window"] is None, pack
        assert pack["notices"][-1] == RTM.LAST_NONE[1:-1], pack
        if kind in ("restored", "inserted", "deleted"):
            assert len(pack["notices"]) >= 2, f"{name}: 知らせが最後の窓に無い: {pack}"
    # 新しい発話があれば、最後の窓の結びは「すべて読みました（足していない行は上の知らせのとおり）」
    with open(memo, "a", encoding="utf-8") as f:
        f.write("甲\t終わります\n")
    watch_once(log, at_plus(50))
    code, out = run(["next", log, "--last", "--now", at_plus(55)])
    assert code == 0 and "発話 3〜3" in out and "（知らせ）" + RTM.LAST_DONE[1:-1] in out, out
    assert "すべて素材ログに入っています" not in out, out


def test_k27_memo_paths(tmp):
    """(k27) メモ帳・素材のパス: 「..」を挟んだ名前は断る。メモ帳を置くフォルダが無ければ、持ち主の印のために 1 つだけ
    作り、メモ帳は作らない（その上も無ければ何も書かずに断る）。メモ帳が見つからないあいだ、watch は突き合わせず
    （読み終えた行を消えたことにしない）、様子が変わったときに知らせる。next・next --last もその知らせを出す。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    (d / "live").mkdir()
    # 「..」: open（--transcript・--src）と、--transcript を受ける命令が断る。何も書かない
    for args in ((["--live", "--transcript", f"{d}/live/nope/../m.txt"]), (["--src", f"{d}/live/nope/../m.txt"])):
        code, out = run(["open", d / "live" / "a.jsonl", "--name", "試し", "--now", T0] + args)
        assert code == 1 and "「..」" in out and "Traceback" not in out, out
    assert os.listdir(d / "live") == [], os.listdir(d / "live")
    log, memo = d / "live" / "k.jsonl", d / "live" / "k.txt"
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0 and memo.read_bytes() == b"" and "空のファイルとして作りました" in out, out
    put(d / "b.json", reply([0, 30]))
    for cmd in (["next"], ["append", d / "b.json"]):
        code, out = run(cmd[:1] + [log] + cmd[1:] + ["--transcript", f"{d}/live/x/../k.txt", "--now", at_plus(1)])
        assert code == 2 and "「..」" in out, f"{cmd[0]} が「..」の --transcript を受けた:\n{out}"
    # メモ帳を置くフォルダが無い: その 1 つだけを作って印を書く。メモ帳は作らない。2 段無ければ断る
    log2 = d / "live" / "k2.jsonl"
    memo2 = d / "notes" / "k2.txt"
    code, out = run(["open", log2, "--live", "--name", "試し", "--transcript", memo2, "--now", T0])
    assert code == 0 and (d / "notes" / "k2.txt.owner").is_file() and not memo2.exists() and "まだありません" in out, out
    log3 = d / "live" / "k3.jsonl"
    code, out = run(["open", log3, "--live", "--name", "試し", "--transcript", d / "a" / "b" / "k3.txt", "--now", T0])
    assert code == 1 and "その上のフォルダ" in out and not log3.exists() and not (d / "a").exists(), out
    (d / "live" / "dir.txt").mkdir()
    code, out = run(["open", log3, "--live", "--name", "試し", "--transcript", d / "live" / "dir.txt", "--now", T0])
    assert code == 1 and "フォルダです" in out and not log3.exists() and "Traceback" not in out, out
    # 見つからないメモ帳: watch は知らせ、next の窓にも出す。メモ帳ができたら読み始める
    out = watch_once(log2, at_plus(2))
    assert "メモ帳" in out and "見つかりません" in out, out
    code, out = run(["next", log2, "--now", at_plus(3)])
    assert code == 0 and "（知らせ）メモ帳" in out and "見つかりません" in out, out
    memo2.write_text("甲\t始めます\n乙\t案は二つ\n", encoding="utf-8")
    watch_once(log2, at_plus(5))
    # 会議の途中でメモ帳が消えた（名前を変えた・動かした）: 読み終えた行を消えたことにしない。最後の窓で知らせ、
    # 「すべて読みました」とは言わない
    code, out = run(["next", log2, "--now", at_plus(31)])
    assert code == 0 and "発話 1〜2" in out, out
    put(d / "b.json", reply([0, 30]))
    assert run(["append", log2, d / "b.json", "--now", at_plus(32)])[0] == 0
    n0 = len(log2.with_name("k2.src.jsonl").read_text(encoding="utf-8").splitlines())
    memo2.rename(d / "notes" / "よけた.txt")
    out = watch_once(log2, at_plus(35))
    assert "見つかりません" in out and len(log2.with_name("k2.src.jsonl").read_text(encoding="utf-8").splitlines()) == n0, out
    code, out = run(["next", log2, "--last", "--now", at_plus(36)])
    assert code == 0 and "見つかりません" in out and RTM.LAST_NONE_NOMEMO in out and "すべて読みました" not in out, out
    code, out = run(["next", log2, "--last", "--now", at_plus(36), "--json"])
    pack = json.loads(out)
    assert pack["window"] is None and any("見つかりません" in x for x in pack["notices"]), pack
    (d / "notes" / "よけた.txt").rename(memo2)
    out = watch_once(log2, at_plus(37))
    assert len(log2.with_name("k2.src.jsonl").read_text(encoding="utf-8").splitlines()) == n0, f"戻ったメモ帳で書き足した:\n{out}"
    # watch（回し続ける形）は、見つからなくなったとき・また見つかったときに 1 回ずつ知らせる
    memo2.rename(d / "notes" / "よけた.txt")
    timer = __import__("threading").Timer(2.5, lambda: (d / "notes" / "よけた.txt").rename(memo2))
    timer.start()
    code, out = run(["watch", log2, "--for", "5"], env=REAL_ENV)
    timer.join()
    assert code == 0 and out.count("見つかりません") == 1 and out.count("見つかりました") == 1, out


LOCKED_TOOL = """import builtins, io, os, sys
sys.path.insert(0, {tools!r})
locked = os.path.realpath(os.environ["KIKU_TEST_LOCKED"])
real_open = io.open
def fake_open(f, *a, **k):
    if isinstance(f, (str, os.PathLike)) and os.path.realpath(os.fspath(f)) == locked:
        raise PermissionError(13, "ほかのアプリが掴んでいる（試験）", os.fspath(f))
    return real_open(f, *a, **k)
builtins.open = io.open = fake_open
import rt
sys.exit(rt.main(sys.argv[1:]))
"""


def test_r8_memo_locked(tmp):
    """(r8) メモ帳はあるのに開けない間（ほかのアプリが掴んでいる・権限が無い）: next は窓にその知らせを出し、
    next --last と end は開けるようになるまで断る（開けない間に打った行が、知らせ無しに記録から欠けない）。
    開けない場面は、メモ帳の名前だけを開けなくした道具で作る。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    (d / "live").mkdir()
    tool = d / "locked_rt.py"
    tool.write_text(LOCKED_TOOL.format(tools=str(RT.parent)), encoding="utf-8")
    log, memo = d / "live" / "m.jsonl", d / "live" / "m.txt"
    assert run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])[0] == 0
    memo.write_text("甲\t始めます\n乙\t案は二つ\n", encoding="utf-8")
    watch_once(log, at_plus(2))
    memo.write_text("甲\t始めます\n乙\t案は二つ\n甲\t三つ目\n", encoding="utf-8")
    env = dict(TEST_ENV, KIKU_TEST_LOCKED=str(memo))
    code, out = run(["next", log, "--now", at_plus(31)], tool=tool, env=env)
    assert code == 0 and "発話 1〜2" in out and "開けません" in out, out
    put(d / "b.json", reply([0, 30]))
    assert run(["append", log, d / "b.json", "--now", at_plus(32)])[0] == 0
    code, out = run(["next", log, "--last", "--now", at_plus(40)], tool=tool, env=env)
    assert code != 0 and "開けません" in out and "すべて読みました" not in out and "Traceback" not in out, out
    code, out = run(["end", log, "--now", at_plus(41)], tool=tool, env=env)
    assert code != 0 and "開けません" in out and "Traceback" not in out, out
    assert not RTM.log_ended(str(log)), "開けないメモ帳のまま end が通った"
    # 開けるようになれば、watch が 3 行目を拾い、最後の窓に入ってから閉じられる
    watch_once(log, at_plus(42))
    code, out = run(["next", log, "--last", "--now", at_plus(45)])
    assert code == 0 and "発話 3" in out, out


def test_k28_log_target(tmp):
    """(k28) 在る判断ログを読む・書く命令は、名前の決めに加えて、リンク・フォルダ・無いログ・「/」「/.」で終わる名前を、
    使う人に向けた文で断る（Traceback を出さない。派生ファイルを作らない。status・digest は始めたばかりの記録のように
    見せない）。"""
    d = Path(tempfile.mkdtemp(dir=tmp))
    log, memo, bf = d / "live" / "k.jsonl", d / "live" / "k.txt", d / "b.json"
    code, out = run(["open", log, "--live", "--name", "試し", "--transcript", memo, "--now", T0])
    assert code == 0, out
    memo.write_text("甲\t始めます\n", encoding="utf-8")
    watch_once(log, at_plus(5))
    put(bf, reply([0, 30]))
    cmds = lambda p: ((["watch", p, "--once", "--now", at_plus(6)], RT), (["next", p, "--now", at_plus(31)], RT),
                      (["append", p, bf, "--now", at_plus(32)], RT), (["end", p, "--now", at_plus(33)], RT),
                      (["pause", p, "--now", at_plus(33)], RT), (["status", p], RT), (["digest", p], RT), ([p], AUDIT))
    before = sorted(os.listdir(d / "live"))
    names = [f"{log}/", f"{log}/.", d / "live" / "無い.jsonl"]
    (d / "live" / "dir.jsonl").mkdir()
    names.append(d / "live" / "dir.jsonl")
    try:
        os.symlink(log, d / "live" / "peek.jsonl")
        os.symlink(log.with_name("k.src.jsonl"), d / "live" / "s1.jsonl")
        (d / "other").mkdir()
        os.symlink(log, d / "other" / "k.jsonl")   # 同じ名前で別のフォルダから指すリンクも断る（派生ファイルが別の場所になる）
        names += [d / "live" / "peek.jsonl", d / "live" / "s1.jsonl", d / "other" / "k.jsonl"]
    except (OSError, NotImplementedError):
        pass
    for p in names:
        for args, tool in cmds(p):
            code, out = run(args, tool=tool)
            assert code == 1 and "Traceback" not in out and "ステップ" not in out and "行目" not in out, f"{args[:2]} を受けた:\n{out}"
            assert "まだ窓を一つも書いていません" not in out and "引き継ぎ" not in out, f"{args[:2]}:\n{out}"
    after = sorted(x for x in os.listdir(d / "live") if x not in ("dir.jsonl", "peek.jsonl", "s1.jsonl"))
    assert after == before, f"断ったのに派生ファイルを作った: {after}（前 {before}）"
    assert not os.path.exists(d / "other" / "k.src.jsonl") and not os.path.exists(d / "other" / "k.next.json")
    # 本物の名前なら通る
    code, out = run(["status", log])
    assert code == 0, out
    # open も、判断ログの名前がリンクなら断る（まだ無い先を指すリンクも。open で始めた名前が、そのまま watch・next でも通るように）
    try:
        os.symlink(d / "live" / "real.jsonl", d / "live" / "alias.jsonl")
        os.symlink(d / "other" / "k9.jsonl", d / "live" / "k9.jsonl")
        dangling = True
    except (OSError, NotImplementedError):
        dangling = False
    if dangling:
        for p, m in ((d / "live" / "alias.jsonl", "m7.txt"), (d / "live" / "k9.jsonl", "m8.txt")):
            code, out = run(["open", p, "--live", "--name", "試し", "--transcript", d / "live" / m, "--now", T0])
            assert code == 1 and "リンク" in out and "Traceback" not in out, f"リンクの名前で open が通った:\n{out}"
        assert not (d / "live" / "real.jsonl").exists() and not (d / "other" / "k9.jsonl").exists()
        assert not (d / "live" / "m7.txt").exists() and not (d / "live" / "m8.txt").exists()
    # 判断ログを置くフォルダの途中がファイル: 「同じ名前のファイルがあります」と言って断る
    (d / "f").write_text("x", encoding="utf-8")
    code, out = run(["open", d / "f" / "x" / "k.jsonl", "--live", "--name", "試し", "--transcript", d / "live" / "m9.txt", "--now", T0])
    assert code == 1 and "同じ名前のファイルがあります" in out and "Traceback" not in out, out


def test_chain_messages(tmp):
    """(k17) 欄の型や深さで F02 を出したら、その欄から連鎖する P17・P10・P13・P03・P04・P11・P07 の文を出さない。
    P30 の文で長い名前を縮めるときは終わり（拡張子）を残す。受理と拒否は変えない。"""
    rules = RTM.load_rules()

    def deep_n(v, n):
        for _ in range(n):
            v = [v]
        return v

    def codes(prefix, batch, window=None):
        st = RTM.fold(json.loads(json.dumps(prefix)), rules)
        n = len(st.errors)
        RTM.check_batch(st, json.loads(json.dumps(batch)), "2026-10-07T09:01:01Z", window=window)
        return sorted({c for _, c, _ in st.errors}), sorted({c for _, c, _ in st.errors[:n]})

    step2 = {"e": "step", "n": 2, "lines": [3, 3], "t": [30, 60]}
    note = {"e": "note", "t": 60, "x": "試し"}
    c2 = {"e": "card", "id": "C2", "t": 40, "d": 0, "role": "claim", "who": "乙", "src": [3], "ti": "見出し", "b": ""}
    cases = [
        ("所感の x が null", _PREFIX, [step2, dict(note, x=None)]),
        ("所感の x が 33 段", _PREFIX, [step2, dict(note, x=deep_n("x", 33))]),
        ("所感の t が文字列", _PREFIX, [step2, dict(note, t="60")]),
        ("step の t が文字列", _PREFIX, [dict(step2, t=["30", "60"]), note]),
        ("step の lines が 33 段", _PREFIX, [dict(step2, lines=deep_n(3, 33)), note]),
        ("カードの id が 33 段・決着が指す", _PREFIX, [step2, dict(c2, id=deep_n("C2", 33)), {"e": "close", "id": "H1", "t": 41, "as": "答え", "by": ["C2"]}, note]),
        ("前の step の t が 33 段", [_PREFIX[0], dict(_PREFIX[1], t=deep_n(0, 33))] + _PREFIX[2:], [step2, c2, note]),
        ("前の step の n が文字列", [_PREFIX[0], dict(_PREFIX[1], n="1")] + _PREFIX[2:], [step2, c2, note]),
        ("前のカードの id が 33 段", [x if x.get("e") != "card" else dict(x, id=deep_n("C1", 33)) for x in _PREFIX], [step2, c2, note]),
        ("前の数え上げの id が 33 段", [x if x.get("e") != "list" else dict(x, id=deep_n("L1", 33)) for x in _PREFIX], [step2, dict(c2, li=["L1", 1]), note]),
    ]
    for name, prefix, batch in cases:
        got, _ = codes(prefix, batch, window={"t": [30, 60], "lines": [3, 3]})
        assert got == ["F02"], f"{name}: F02 のほかに連鎖した文を出した: {got}"
    # 連鎖でない違反は、これまでどおり出す（欄の壊れていない所の P11）
    got, _ = codes(_PREFIX, [step2, dict(c2, id="C5"), note])
    assert got == ["P11"], got
    # P30: 長い名前は終わり（拡張子）を残して縮める
    long = "live/" + "とても長いフォルダの名前" * 8 + "/会議.src.jsonl"
    st = RTM.fold([], rules)
    RTM.check_batch(st, [{"e": "open", "v": 2, "name": "試し", "mode": "file", "t0": "2026-10-07T09:00:00Z", "src": long,
                          "window": 30, "known": ""}],
                    "2026-10-07T09:00:00Z")
    msg = [m for _, c, m in st.errors if c == "P30"]
    assert len(msg) == 1 and "会議.src.jsonl\" は" in msg[0] and "素材の名前 \"…" in msg[0], msg
    assert msg[0].split('"')[1] == "…" + long[-59:], msg   # ページの verify.js と同じ切り方（終わりの 59 字）


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        n, m = test_cases(tmp)
        results.append(f"cases {n} 件 ＋ 追加 {m} 件すべて期待どおり")
        n = test_rebuild_fixture(tmp)
        results.append(f"meeting10 の {n} ステップを作り直すと元と同じ")
        test_rebuild_fixture_as_replies(tmp)
        results.append("返事の形で作り直しても同じ（ステップ 6 は 3 回落とし、未確定の窓になる）")
        n = test_v1_rebuild(tmp)
        m = test_v1_rejects(tmp)
        results.append(f"v1: 架空のログを {n} 回の書き足しで組み直して元と同じ / {m} 種類の違反と知らない版を拒否")
        test_live(tmp)
        results.append("live: 時刻の押し方・未確定行・話者の検査")
        test_live_requires_next(tmp)
        results.append("live: next を経ない append・未来の --now を拒否")
        test_audit(tmp)
        results.append("audit_r2b: fixture 合格・壊したログと知らない版を検出")
        test_window_recompute(tmp)
        results.append("覚え書きを素材から照らす（手で書いた・書き換えた覚え書きは P07）")
        test_material_named(tmp)
        results.append("名指しした素材が無くても免除しない")
        test_wall_clock(tmp)
        results.append("live の窓は壁時計で閉じる・聞き終える前の壁時計は P27")
        w = test_pause_and_window(tmp)
        results.append(f"先の時刻の pause は P22・window {w} は F04")
        test_values(tmp)
        results.append("有限でない数・NaN・末尾の改行・U+2028 を落ちずに扱う")
        test_bad_reply_counts(tmp)
        results.append("壊れた返事も3回で未確定の窓")
        n = test_digest_limit(tmp)
        results.append(f"digest --full は {n} 字（2000 字以内）で open --known に渡せる")
        test_last_and_known(tmp)
        results.append("最後の発話も窓の終わりちょうどなら次の窓・known の重なりは P28")
        test_material_reading(tmp)
        results.append("素材の読みは共通の期待値（alone・tsv・inline・vtt・混ざった書き方・最後の後ろ・発話無し）と"
                       "一字違わず同じ・窓と知らせの文も同じ・読めないバイトで落ちない")
        test_monotone_and_cap(tmp)
        results.append("打ち間違えた時刻でも窓は 40 件まで・巻き戻った時刻は揃える・カードは根拠の時刻の間")
        test_owner(tmp)
        results.append("1 つの素材に 1 つのログ（別のログの open・next・append と v1 の形を断る、監査も数える）")
        test_transcript_and_known(tmp)
        results.append("素材の取り替えは P07・句読点をはさんだ known も P28")
        test_values_more(tmp)
        results.append("壁時計の暦・桁の多い整数・e が配列・サロゲート・think・append の open")
        test_watch_realtime(tmp)
        results.append("watch（実時計）: 届いた時刻で押す・2 つ目は断る・止まっていれば next は窓を出さない・end で止まる")
        test_watch_changes(tmp)
        results.append("watch: 読み終えた行の変化を知らせ、新しい行を落とさず二度足さない・保存の途中は読まない")
        test_now_needs_env(tmp)
        results.append("live の --now は試験の環境だけ")
        test_unreadable_notices(tmp)
        results.append("読めない行・全角の時刻・時刻の飛びを行番号で知らせる（file）。live のメモ帳は時刻の列を捨てて全行を読む")
        test_cap_shrink(tmp)
        results.append("40 件で切った窓は終わりを縮める")
        test_reply_shapes(tmp)
        results.append("返事の形（events 無し・step 無し・events の note・囲み・2 つの返事・空の src・窓の幅）")
        test_broken_input(tmp)
        results.append("壊れた step・深い入れ子は落ちずに拒んで数える")
        test_peek_blocked(tmp)
        results.append("捨てるログで本番の素材ログ・判断ログ・印・覚え書きを素材にできない（P30・P07）")
        test_memo_time_typo(tmp)
        results.append("メモ帳の時刻の打ち間違いで発話の位置がずれない")
        test_live_last_and_end(tmp)
        results.append("next --last → append → end。end は渡していない発話があれば断る。最後の行は 2 秒で確定")
        test_memo_restored(tmp)
        results.append("消して戻した行は二度足さない")
        test_memo_speaker(tmp)
        results.append("話者: 本文の切り出しと、時刻らしい頭の行")
        test_cap_same_time(tmp)
        results.append("上限で切った窓は同じ時刻の塊の手前で切る")
        test_reply_reading(tmp)
        results.append("events:null・空白の集まり・500 段の事前検査")
        test_open_field_types(tmp)
        results.append("open の window・chunk の型が違っても落ちない")
        test_log_names(tmp)
        results.append("判断ログの名前は小文字の .jsonl だけ・派生ファイルや大小文字だけ違う語幹があれば open は断る・名前の違う watch の印は断る")
        test_append_end_refusal(tmp)
        results.append("append に end だけのバッチを渡しても、rt.py end と同じ断り")
        test_retimed_and_speaker_col(tmp)
        results.append("時刻の列だけの直しは記録に効かないと知らせる・時刻らしい列を落とし、話者の列の「:」を落とす・同じ位置で続けて消えた行は 1 文")
        test_end_time_and_late_window(tmp)
        results.append("end の t（live は時計と直前の窓の終わりの大きいほう、file は直前の窓の終わり）・遅れて閉じる窓は窓幅の目盛り")
        test_chain_messages(tmp)
        results.append("欄の型や深さの F02 に連鎖した文を重ねない・P30 は名前の終わりを残す")
        test_memo_k18(tmp)
        results.append("メモ帳の突き合わせ（K18）: 6 回目の R1〜R4・x6・x8、並べ方の決め、5 回目・4 回目の消して戻す場面、"
                       "知らせの文、同じ出来事は二度書かない、3000 行・真ん中 300 行が 0.2 秒以内")
        test_k18_windows(tmp)
        results.append("突き合わせの知らせは next と next --last の窓に出る・最後の発話より後ろの出来事は最後の窓")
        test_log_paths_k20(tmp)
        results.append("判断ログのパス（K20）: 「..」を断る・リンクを解いて照らす・フォルダは 1 つだけ作る・status・digest・監査も照らす")
        test_k23(tmp)
        results.append("K23: end -h・live の end の t は聞き終えた時計まで・最後の窓の終わり・watch の印の読み書きのやり直し・.gitignore")
        test_k24_k26_memo(tmp)
        results.append("K24・K26: 時刻の列だけの直しと undo は同じ中身・残った行は 3 行以上消えたときだけ・知らせのとおり打ち直した行は新しい発話・"
                       "打ち直しの知らせはその保存の行だけ（同じ保存で戻した行はどれも名指す）")
        test_k25_pending(tmp)
        results.append("K25・K31: メモ帳の出来事と改行の無い最後の行が入るまで next --last は待ち end は断る・渡す発話が無くても --json は JSON")
        test_k27_memo_paths(tmp)
        results.append("K27: メモ帳・素材の「..」を断る・印のフォルダは 1 つだけ・見つからないメモ帳を空とみなさず知らせる")
        test_k28_log_target(tmp)
        results.append("K28: リンク・フォルダ・無いログ・「/」で終わる名前は、どの命令も文で断り派生ファイルを作らない")
        test_r8_memo_locked(tmp)
        results.append("8回目: メモ帳が開けない間、next は知らせ、next --last と end は断る")
    print("OK: " + " / ".join(results))


if __name__ == "__main__":
    main()
