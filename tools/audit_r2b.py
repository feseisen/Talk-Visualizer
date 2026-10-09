#!/usr/bin/env python3
"""判断ログの R2b 監査。書いた中身が、書いた時点までに聞いた範囲だけでできているかを、書き終えた記録に対して後から確かめる。

  python tools/audit_r2b.py <判断ログ.jsonl> [--json]

rt.py の検査器とは独立に、ログを先頭から1行ずつ歩いて次を数える（rt.py の検査器を信用しない第二の目）。
版の判定だけは rt.py と同じ規則表（format/rules.json の versions.<版>.open_v。型も比べる）で行う。
  0. 先頭 open の v が規則表のどの版にも無ければ違反（知らない版。黙って v1 にしない）
  1. 全イベントの t が、それを書いたステップの t[1]（読み終えた時刻）以下。カードは別に数える
  2. step.at（壁時計）が単調非減少。end・pause の at も直前の step の at 以上
  3. close が指す保留は、それより前に開かれている
  4. group.span の終わりと fix(span) の now の終わりが、その時点で聞いた範囲の中
  5. step の n が 1 ずつ増え、lines が直前の続き
  6. end の後に行が無い
  7. live の記録では、step.at − open.t0 が step.t[1] 以上（聞き終える前に判断を押していない）
  8. pause の t が直前の step の t[1] ちょうど（先に置いて窓を飛ばしていない）
  9. v2 の open.window が整数の秒で規則表の値の範囲の中、各 step の窓の幅が window × 3 以下、
     各 step の発話の数が limits.step.max_lines（既定 40）以下。幅 0 の窓（t[1] = t[0]）は、発話がちょうど
     上限の件数のときだけ（上限で切って終わりを縮めた窓）。v2 の open.t0 が暦に在る壁時計
 10. 行が JSON のオブジェクトで、数が有限で絶対値が 2^53−1 以下、文字列に片割れのサロゲートが無い
 11. 並びの位置（R1）: すべての t（step は t[0]）が 0 以上。close の t が、閉じる保留の t 以上
 12. 1 つの素材に 1 つのログ（v2 で open.src のある記録）: 素材の隣の持ち主の印 <素材>.owner が
     このログを指している。別のログを指していれば違反（同じ素材を別のログでも開いた疑い）。
     素材か印が見つからなければ、違反にはせず「見ていない」と書く
 13. v2 のカードは根拠の発話を 1 つ以上指す（src が空の配列でない）
 14. 素材の名前（v2 の open.src）が素材ファイル・メモ帳の形（.txt・.tsv・.vtt。大小文字を問わない）で、
     記録のファイル（判断ログ・素材ログ・印・覚え書き）や、別のログの記録（持ち主の印が指す別のログの
     素材ログ・覚え書き）を名指していない（捨てるログで本番の素材ログを読む道を、後から見つける）
 15. live の記録が end で閉じているとき、素材ログ（<ログ名>.src.jsonl）の発話が、どれかのステップの窓に
     入っている（聞き終えたときに、まだ渡していない発話が残っていない）。数えるのは発話の番号だけで、本文は読まない。
     素材ログが見つからなければ、違反にはせず「見ていない」と書く

監査が見ないもの: 素材の中身（文字起こし・素材ログの本文）と会話記録。判断ログに書かれた窓が、素材から計算した
窓と一致するか、カードの位置が根拠の発話の時刻の間にあるかは、rt.py の追記の時点で照らしている
（P07・P29）。会話の中で素材を直接開かなかったか、持ち主の印や覚え書きを手で書き換えなかったかは、
Claude Code が持っている会話記録を人が開いて確かめる。

判断ログの名前は rt.py と同じ決め（check_log_target）で照らし、素材ログ・覚え書き・watch の印・「..」を挟んだ名前・
「/」で終わる名前・リンク・フォルダ・無いログは、中身を読まずに断る（終了コード 1）。

終了コード: 0 違反なし / 1 読めない・名前の決めに合わない / 2 違反あり
"""
import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.dont_write_bytecode = True   # rt を読み込んでも tools/ に __pycache__ を残さない
# 版の判定（Rules.version_of）と、JSON の読み方・壁時計の読み方・持ち主の印の読み方だけを借りる
from rt import (MAX_LINES, Fail, check_log_target, find_src, has_lone_surrogate, has_nonfinite, iso_sec as _rt_iso_sec,  # noqa: E402
                load_rules, loads, named_record, owner_record, read_srclog, read_utf8, same_file, split_lines,
                src_exts, src_name_ok, srclog_path)


def fmt(s):
    if not isinstance(s, (int, float)) or isinstance(s, bool) or not math.isfinite(s):
        return repr(s)
    sign = "-" if s < 0 else ""
    s = int(abs(s))
    h, m, x = s // 3600, s % 3600 // 60, s % 60
    return sign + (f"{h}:{m:02d}:{x:02d}" if h else f"{m}:{x:02d}")


def iso_sec(s):
    """壁時計を秒に。形が違う・暦に無い日時（24 時・2 月 30 日など）なら ValueError。"""
    try:
        return _rt_iso_sec(s)
    except Fail:
        raise ValueError(s)


def owner_check(log, open_ev, v, notes):
    """12. 素材の持ち主の印がこのログを指しているか。"""
    name = open_ev.get("src")
    if not isinstance(name, str) or not name:
        return
    material = find_src(log, name)
    if not material:
        notes.append(f"素材 {name} が見つからないので、持ち主の印は見ていません")
        return
    mark, rec = owner_record(material)
    if rec is None:
        notes.append(f"素材 {name} の隣に持ち主の印 {mark.name} がありません（rt.py open を通さずに始めた記録か、印が消えている）")
        return
    if not same_file(rec, log):
        v.append(f"素材 {name} の持ち主の印 {mark.name} は、このログではなく {rec} を指しています"
                 "（同じ素材を別のログでも開いた疑い。ログを動かしただけなら、そのことを確かめる）")


def src_check(log, open_ev, rules, v, where="ログ1行目"):
    """14. 素材の名前が素材ファイル・メモ帳の形（P30）で、記録のファイルや別のログの記録を名指していないか。1 つの名前に 1 件。"""
    name = open_ev.get("src")
    if not isinstance(name, str) or not name:
        return
    exts = src_exts(rules)
    why = named_record(log, name)
    if why:
        v.append(f"{where}: P30: {why}")
    elif not src_name_ok(name, exts):
        v.append(f"{where}: P30: 素材の名前 {name} は {'・'.join(exts)} で終わっていません（記録のファイルを素材にした疑い）")


def unsent_check(log, last_step, v, notes):
    """15. live の記録が end で閉じているとき、素材ログの発話がどれかの窓に入っているか（番号だけを見る）。"""
    sp = srclog_path(log)
    if not sp.is_file():
        notes.append(f"素材ログ {sp.name} が見つからないので、渡していない発話が残っていないかは見ていません")
        return
    try:
        utts = read_srclog(sp).utts
    except Fail as ex:
        notes.append(f"素材ログ {sp.name} が読めないので、渡していない発話が残っていないかは見ていません（{ex}）")
        return
    done = last_step["lines"][1] if last_step is not None and _pair(last_step.get("lines")) else 0
    left = [u["i"] for u in utts if u["i"] > done]
    if left:
        v.append(f"end で閉じた記録に、どの窓にも入っていない発話が {len(left)} 件あります（発話 {left[0]}〜{left[-1]}。"
                 "聞き終える前に next --last で最後の窓を出していない）")


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _pair(v, pred=_num):
    return isinstance(v, list) and len(v) == 2 and all(pred(x) for x in v)


def audit(path, rules=None):
    rules = rules or load_rules(None)
    lines = split_lines(read_utf8(path, "ログ"))
    out = {"log": str(path), "steps": 0, "cards": 0, "events": 0, "violations": [], "notes": [], "version": None,
           "at_checked": False, "first_at": None, "last_at": None}
    v = out["violations"]
    step = None
    last_at = None
    last_at_where = None
    holds = {}  # id -> 開いた時刻
    max_lines = rules.limit("step.max_lines") or MAX_LINES
    ended = False
    open_ev = None
    factor = rules.limit("step.width_factor") or 3
    for idx, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            e = loads(line)
        except ValueError as ex:
            return None, f"{idx} 行目が JSON として読み取れません: {ex}"
        out["events"] += 1
        where = f"{idx}行目"
        if not isinstance(e, dict):
            v.append(f"{where}: イベントとして読めません（JSON のオブジェクトではない）")
            continue
        if has_nonfinite(e):
            v.append(f"{where}: 使えない数があります（有限で、絶対値が 2^53−1 以下の数だけ）")
            continue
        if has_lone_surrogate(e):
            v.append(f"{where}: 文字列に壊れた文字（対になっていないサロゲート）があります")
        k = e.get("e")
        if ended:
            v.append(f"{where}: end の後に {k} があります")
        if k == "open":
            if idx != 1 and any(l.strip() for l in lines[: idx - 1]):
                v.append(f"{where}: open が先頭以外にあります")
            ver = rules.version_of(e)
            if ver is None:
                v.append(f"{where}: open の v {e.get('v')!r} は知らない版です（規則表のどの版の open_v にも無い）")
                ver = rules.latest()
            out["version"] = int(ver) if ver.isdigit() else ver
            open_ev = e
            if out["version"] == 2:
                fs = rules.spec("open").get("window", {})
                w = e.get("window")
                if not _num(w) or ("min" in fs and w < fs["min"]) or ("max" in fs and w > fs["max"]):
                    lo, hi = fs.get("min"), fs.get("max")
                    v.append(f"{where}: open の window {w!r} が規則表の範囲（{lo}〜{hi} 秒）の外です")
                elif not float(w).is_integer():
                    v.append(f"{where}: open の window {w!r} が整数の秒ではありません")
                try:
                    iso_sec(e.get("t0"))
                except ValueError:
                    v.append(f"{where}: open の t0 {e.get('t0')!r} が読めません（暦に在る日時の ISO 8601 の UTC）")
                owner_check(path, e, v, out["notes"])
                src_check(path, e, rules, v, where)
            continue
        if k == "step":
            out["steps"] += 1
            n, ls, t, at = e.get("n"), e.get("lines"), e.get("t"), e.get("at")
            if not _pair(ls) or not _pair(t):
                v.append(f"{where}: S{n} の lines か t が [数, 数] ではありません")
                continue
            if step is not None:
                if n != step["n"] + 1:
                    v.append(f"{where}: S{n} の番号が S{step['n']} の続きではありません")
                if ls[0] != step["lines"][1] + 1:
                    v.append(f"{where}: S{n} の lines が S{step['n']} の続きではありません")
            elif n != 1:
                v.append(f"{where}: 最初のステップの番号が {n} です")
            if ls[1] < ls[0]:
                v.append(f"{where}: S{n} の lines が逆です")
            elif out["version"] == 2 and ls[1] - ls[0] + 1 > max_lines:
                v.append(f"{where}: S{n} の発話が {ls[1] - ls[0] + 1} 件です（1 つの窓は {max_lines} 件まで）")
            if t[1] < t[0]:
                v.append(f"{where}: S{n} の t が逆です")
            elif out["version"] == 2 and t[1] == t[0] and ls[1] - ls[0] + 1 != max_lines:
                v.append(f"{where}: S{n} の窓の幅が 0 です（幅 0 の窓は、発話がちょうど {max_lines} 件で終わりを縮めたときだけ）")
            if t[0] < 0:
                v.append(f"{where}: S{n} の窓の始まり {fmt(t[0])} が 0 より前です（並びの位置）")
            if out["version"] == 2 and open_ev is not None and _num(open_ev.get("window")):
                w = open_ev["window"]
                if t[1] - t[0] > w * factor:
                    v.append(f"{where}: S{n} の窓の幅 {fmt(t[1] - t[0])} が window × {factor}（{fmt(w * factor)}）を超えています")
            if at is not None:
                out["at_checked"] = True
                try:
                    sec = iso_sec(at)
                except Exception:
                    v.append(f"{where}: S{n} の at が読めません: {at!r}")
                    sec = None
                if sec is not None:
                    if last_at is not None and sec < last_at:
                        v.append(f"{where}: S{n} の壁時計 {at} が {last_at_where} より前に戻っています")
                    last_at, last_at_where = sec, f"S{n} ({at})"
                    out["first_at"] = out["first_at"] or at
                    out["last_at"] = at
                    # 7. live の記録では、聞き終える前に判断を押していない
                    if out["version"] == 2 and open_ev is not None and open_ev.get("mode") == "live":
                        try:
                            t0 = iso_sec(open_ev.get("t0"))
                        except Exception:
                            t0 = None
                        if t0 is not None and sec - t0 < t[1]:
                            v.append(f"{where}: S{n} の壁時計 {at} は、聞き始め {open_ev.get('t0')} から窓の終わり {fmt(t[1])} を"
                                     f"聞き終える前です（{fmt(sec - t0)} しか経っていない）")
            elif out["version"] == 2:
                v.append(f"{where}: S{n} に at がありません")
            step = e
            continue
        if k in ("end", "pause"):
            at = e.get("at")
            if at:
                try:
                    sec = iso_sec(at)
                    if last_at is not None and sec < last_at:
                        v.append(f"{where}: {k} の壁時計 {at} が {last_at_where} より前に戻っています")
                    last_at, last_at_where = sec, f"{k} ({at})"
                    out["last_at"] = at
                except Exception:
                    v.append(f"{where}: {k} の at が読めません: {at!r}")
            t = e.get("t")
            if _num(t) and t < 0:
                v.append(f"{where}: {k} の時刻 {fmt(t)} が 0 より前です（並びの位置）")
            if step is not None and _num(t) and t < step["t"][1]:
                v.append(f"{where}: {k} の時刻 {fmt(t)} が S{step['n']} の終わり {fmt(step['t'][1])} より前です")
            if k == "pause" and _num(t):
                hi = step["t"][1] if step is not None else 0
                if t > hi:
                    v.append(f"{where}: pause の時刻 {fmt(t)} が" + (f" S{step['n']} の終わり {fmt(hi)}" if step is not None else "聞き始め 0:00")
                             + " より後です（中断を先に置いて窓を飛ばしている）")
            if k == "end":
                ended = True
                if out["version"] == 2 and open_ev is not None and open_ev.get("mode") == "live":
                    unsent_check(path, step, v, out["notes"])
            continue
        if step is None:
            v.append(f"{where}: step より前に {k} があります")
            continue
        heard = step["t"][1]
        t = e.get("t")
        label = f"カード {e.get('id')}" if k == "card" else f"{k} {e.get('id', '')}".strip()
        if _num(t):
            if t > heard:
                v.append(f"{where}: {label} の t {fmt(t)} は S{step['n']} で読み終えた {fmt(heard)} より先です")
            if t < 0:
                v.append(f"{where}: {label} の t {fmt(t)} が 0 より前です（並びの位置）")
        else:
            v.append(f"{where}: {k} に t がありません")
        if k == "card":
            out["cards"] += 1
            if out["version"] == 2 and not (isinstance(e.get("src"), list) and e["src"]):
                v.append(f"{where}: {label} の src が空です（根拠の発話を 1 つ以上指す）")
        elif k == "hold":
            if isinstance(e.get("id"), str):
                holds[e["id"]] = t
        elif k == "close":
            i = e.get("id")
            if not isinstance(i, str) or i not in holds:
                v.append(f"{where}: close {i} は、それより前に開かれていません")
            elif _num(t) and _num(holds[i]) and t < holds[i]:
                v.append(f"{where}: close {i} の t {fmt(t)} が、保留を開いた {fmt(holds[i])} より前です（並びの位置）")
        elif k == "group":
            sp = e.get("span")
            if isinstance(sp, list) and len(sp) == 2 and _num(sp[1]) and sp[1] > heard:
                v.append(f"{where}: 括り {e.get('id')} の終わり {fmt(sp[1])} は S{step['n']} で読み終えた {fmt(heard)} より先です")
        elif k == "fix" and e.get("field") == "span":
            now = e.get("now")
            if isinstance(now, list) and len(now) == 2 and _num(now[1]) and now[1] > heard:
                v.append(f"{where}: 括り {e.get('id')} の訂正後の終わり {fmt(now[1])} は S{step['n']} で読み終えた {fmt(heard)} より先です")
    return out, None


def main():
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:
            pass
    p = argparse.ArgumentParser(description="判断ログの R2b 監査")
    p.add_argument("log")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()
    try:
        # 判断ログの名前と実体の決め（rt.py と同じ。K20・K28）: 素材ログ・覚え書き・watch の印（それを指すリンクも）・
        # フォルダ・無いログを判断ログとして渡されたら、中身を読まずに断る（行の数も出さない）
        check_log_target(a.log)
    except Fail as ex:
        print(str(ex), file=sys.stderr)
        sys.exit(1)
    try:
        out, err = audit(a.log)
    except Fail as ex:
        print(str(ex), file=sys.stderr)
        sys.exit(1)
    if err:
        print(err, file=sys.stderr)
        sys.exit(1)
    if a.json:
        print(json.dumps(out, ensure_ascii=False))
    else:
        at = ("壁時計 " + (f"{out['first_at']} → {out['last_at']}、単調" if not any("壁時計" in x for x in out["violations"]) else "戻りあり")
              if out["at_checked"] else "壁時計なし")
        print(f"R2b 監査: {a.log}")
        print(f"  v{out['version'] if out['version'] is not None else '?'} / ステップ {out['steps']} / カード {out['cards']} / イベント {out['events']} / {at}")
        print(f"  違反 {len(out['violations'])} 件")
        for x in out["violations"]:
            print("   ", x)
        for x in out["notes"]:
            print("  （見ていない）", x)
    sys.exit(2 if out["violations"] else 0)


if __name__ == "__main__":
    main()
