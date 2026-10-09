#!/usr/bin/env python3
"""
build_html.py — src/ と format/・prompts/ を 1 枚の kiku.html に組み立てる（外部参照ゼロ）

    python3 build_html.py            このファイルと同じフォルダに kiku.html を書く
    python3 build_html.py --check    書かずに、組み立てた結果の検査だけ出す

src/shell.html の印を置き換える:
    <!--@@css <ファイル>-->            src/<ファイル> を <style> として埋め込む
    <!--@@js <ファイル>-->             src/<ファイル> を <script> として埋め込む（無ければ失敗）
    <!--@@js? <ファイル>-->            同上。無ければ「未配線」の印を残して通す（まだ作っていない部品）
    <!--@@data <名前> <パス>-->        <パス>（このフォルダからの相対）の JSON を globalThis.<名前> に入れる <script>
    <!--@@text <名前> <パス>-->        <パス>（このフォルダからの相対）の文字列を globalThis.<名前> に入れる <script>（無ければ空文字）

組み立てたあと、外部参照（http(s):// の src/href、@import）が無いことと、
API の鍵の形（決まった頭の文字で始まる長い英数字）が紛れていないことを検査する。
"""
import json
import re
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent
SRC = KIT / "src"
OUT = KIT / "kiku.html"

MARK = re.compile(r"<!--@@(css|js\??|data|text)\s+([^\s>]+)(?:\s+([^\s>]+))?-->")


def js_string(s: str) -> str:
    """JSON 文字列にしたうえで、<script> の中に置いても壊れないよう </ を逃がす"""
    return json.dumps(s, ensure_ascii=False).replace("</", "<\\/")


def js_json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def inline_script(body: str) -> str:
    # 中身に </script が入っていると閉じられてしまうので逃がす
    return "<script>\n" + body.replace("</script", "<\\/script") + "\n</script>"


def build(shell_text: str, report: list) -> str:
    def repl(m):
        kind, a, b = m.group(1), m.group(2), m.group(3)
        if kind == "css":
            p = SRC / a
            report.append(("css", a, p.exists()))
            if not p.exists():
                raise FileNotFoundError(p)
            return "<style>\n" + p.read_text(encoding="utf-8").replace("</style", "<\\/style") + "\n</style>"
        if kind in ("js", "js?"):
            p = SRC / a
            report.append(("js", a, p.exists()))
            if not p.exists():
                if kind == "js?":
                    return f"<script>/* {a} は未配線（まだ無い）。画面には「未配線」と出る */</script>"
                raise FileNotFoundError(p)
            return inline_script(p.read_text(encoding="utf-8"))
        if kind == "data":
            name, rel = a, b
            p = KIT / rel
            report.append(("data", rel, p.exists()))
            if not p.exists():
                raise FileNotFoundError(p)
            obj = json.loads(p.read_text(encoding="utf-8"))
            return f"<script>globalThis.{name} = {js_json(obj)};</script>"
        if kind == "text":
            name, rel = a, b
            p = KIT / rel
            report.append(("text", rel, p.exists()))
            text = p.read_text(encoding="utf-8") if p.exists() else ""
            note = "" if p.exists() else f" /* {rel} が無いので空 */"
            return f"<script>globalThis.{name} = {js_string(text)};{note}</script>"
        raise ValueError(kind)

    return MARK.sub(repl, shell_text)


def check(html: str) -> list:
    """組み立てた 1 枚の検査。問題があれば文の一覧を返す"""
    problems = []
    # 外部参照
    for m in re.finditer(r"""(?:src|href)\s*=\s*["'](https?:)?//""", html):
        problems.append(f"外部参照がある: …{html[max(0, m.start()-40):m.end()+60]!r}")
    if re.search(r"@import\s+url\(\s*['\"]?https?://", html):
        problems.append("CSS の @import に外部参照がある")
    # CSS の url(https://…) / url(//…)（背景画像・書体など。<style> の中も style="…" の中も）
    for m in re.finditer(r"""url\(\s*['"]?(?:https?:)?//""", html):
        problems.append(f"CSS の url() に外部参照がある: …{html[max(0, m.start()-40):m.end()+60]!r}")
    if re.search(r"<link\b[^>]*\bhref", html):
        problems.append("<link> がある（外部参照の疑い）")
    # 鍵の形（実物も鍵風の例文も入れない）。k を [] で囲むのは、この検査の文そのものが
    # 鍵の頭の文字に見えて、公開前の残り物の検査に引っかからないようにするため（当たる文字は同じ）
    if re.search(r"s[k]-[A-Za-z0-9_-]{16,}", html):
        problems.append("鍵の形の文字列がある")
    # 必ずある印
    for needle, why in [
        ("<!doctype html>", "doctype"),
        ('<meta charset="utf-8">', "charset"),
        ('name="viewport"', "viewport"),
        ('<html lang="ja">', "lang=ja"),
        ("等倍", "速度表記「等倍」（R9）"),
    ]:
        if needle not in html:
            problems.append(f"{why} が無い")
    for bad in ("1×", "1x"):
        if re.search(r">\s*" + re.escape(bad) + r"\s*<", html):
            problems.append(f"速度表記に「{bad}」がある（R9）")
    # CSS の zoom / transform:scale（R8）
    css = "\n".join(re.findall(r"<style>(.*?)</style>", html, re.S))
    if re.search(r"\bzoom\s*:", css) or re.search(r"transform\s*:[^;]*scale\(", css):
        problems.append("CSS に zoom か transform:scale がある（R8）")
    return problems


def main(argv):
    only_check = "--check" in argv
    shell = (SRC / "shell.html").read_text(encoding="utf-8")
    report = []
    html = build(shell, report)
    for kind, name, ok in report:
        print(f"  {'組み込み' if ok else '無し    '}  {kind:5} {name}")
    problems = check(html)
    marks = MARK.findall(html)
    if marks:
        problems.append(f"置き換えられなかった印が残っている: {marks}")
    if problems:
        print("検査に落ちた:")
        for p in problems:
            print("  - " + p)
        return 1
    if only_check:
        print(f"検査だけ: 問題なし（{len(html.encode('utf-8'))} バイト）")
        return 0
    OUT.write_text(html, encoding="utf-8", newline="\n")
    print(f"書いた: {OUT}（{len(html.encode('utf-8'))} バイト）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
