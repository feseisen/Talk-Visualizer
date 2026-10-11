#!/usr/bin/env python3
"""
build_html.py — src/ と format/・prompts/ を 1 枚の kiku.html に組み立てる（外部参照ゼロ）

    python3 build_html.py            このファイルと同じフォルダに kiku.html を書く
    python3 build_html.py --check    書かずに、組み立てた結果の検査だけ出す
    python3 build_html.py --artifact 枠（claude.ai のアーティファクト）に貼る中身 kiku-artifact.html を書く。
                                     doctype・html・head・body・meta は枠が付けるので外し、<title> と <style> と本文と <script> だけにする。
                                     中身は kiku.html と同じ（枠の中かどうかは app.js が起動時に window.claude の有無で決める）。
                                     --check と合わせると、枠で効かない呼び出し（alert・confirm・prompt・window.print・a[download]）の
                                     ある場所を src/ のファイルと行で出す（注意。落とさない。行に「枠では使わない」と書いてあれば出さない）

src/shell.html の印を置き換える:
    <!--@@css <ファイル>-->            src/<ファイル> を <style> として埋め込む
    <!--@@js <ファイル>-->             src/<ファイル> を <script> として埋め込む（無ければ失敗）
    <!--@@js? <ファイル>-->            同上。無ければ「未配線」の印を残して通す（まだ作っていない部品）
    <!--@@data <名前> <パス>-->        <パス>（このフォルダからの相対）の JSON を globalThis.<名前> に入れる <script>
    <!--@@text <名前> <パス>-->        <パス>（このフォルダからの相対）の文字列を globalThis.<名前> に入れる <script>（無ければ空文字）
    <!--@@zip <名前> bridge-->          枠に貼る形（--artifact）だけ: 拡張「橋」の ZIP（bridge/chrome/build_bridge.py の make_zip）を
                                     globalThis.<名前> = {file, version, b64} に入れる。kiku.html では null（枠の外では拡張が要らない）

組み立てたあと、外部参照（http(s):// の src/href、@import）が無いことと、
API の鍵の形（決まった頭の文字で始まる長い英数字）が紛れていないことを検査する。
"""
import base64
import importlib.util
import json
import re
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent
SRC = KIT / "src"
OUT = KIT / "kiku.html"
OUT_ARTIFACT = KIT / "kiku-artifact.html"

MARK = re.compile(r"<!--@@(css|js\??|data|text|zip)\s+([^\s>]+)(?:\s+([^\s>]+))?-->")


def js_string(s: str) -> str:
    """JSON 文字列にしたうえで、<script> の中に置いても壊れないよう </ を逃がす"""
    return json.dumps(s, ensure_ascii=False).replace("</", "<\\/")


def js_json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def inline_script(body: str) -> str:
    # 中身に </script が入っていると閉じられてしまうので逃がす
    return "<script>\n" + body.replace("</script", "<\\/script") + "\n</script>"


def bridge_zip() -> dict:
    """拡張「橋」の ZIP を bridge/chrome/build_bridge.py で作り、{file, version, b64} にする。
    写しが元と違う・中身を変えたのに版を上げていない（zip.lock が合わない）ときは失敗する"""
    spec = importlib.util.spec_from_file_location("build_bridge", KIT / "bridge" / "chrome" / "build_bridge.py")
    bb = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bb)
    for problem in (bb.copy_problem(), bb.lock_problem()):
        if problem:
            raise ValueError("拡張: " + problem)
    data = bb.make_zip()
    return {"file": bb.zip_name(), "version": bb.manifest()["version"], "b64": base64.b64encode(data).decode("ascii")}


def build(shell_text: str, report: list, artifact: bool = False) -> str:
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
        if kind == "zip":
            name, what = a, b
            if what != "bridge":
                raise ValueError(f"@@zip が知らないもの: {what}")
            if not artifact:
                report.append(("zip", "bridge（枠に貼る形だけ）", True))
                return f"<script>globalThis.{name} = null; /* 拡張の ZIP は枠に貼る形（--artifact）にだけ入れる */</script>"
            z = bridge_zip()
            report.append(("zip", f"{z['file']}（{len(z['b64'])} 字）", True))
            return f"<script>globalThis.{name} = {js_json(z)};</script>"
        raise ValueError(kind)

    return MARK.sub(repl, shell_text)


# 枠（アーティファクト）に貼る形: 枠が付けるものを外す。残るのは <title>・<style>・本文・<script>
FRAME_STRIP = [
    re.compile(r"<!doctype html>\s*", re.I),
    re.compile(r"<html[^>]*>\s*"),
    re.compile(r"</html>\s*"),
    re.compile(r"<head>\s*"),
    re.compile(r"</head>\s*"),
    re.compile(r"<body>\s*"),
    re.compile(r"</body>\s*"),
    re.compile(r'<meta charset="utf-8">\s*'),
    re.compile(r'<meta name="viewport"[^>]*>\s*'),
]


def to_artifact(html: str) -> str:
    for rx in FRAME_STRIP:
        html, n = rx.subn("", html, count=1)
        if n != 1:
            raise ValueError(f"枠に貼る形に直せない（{rx.pattern} が 1 つでない）")
    head = ("<!-- kiku-artifact.html: 枠（claude.ai のアーティファクト）に貼る中身。build_html.py --artifact が作る生成物。\n"
            "     doctype・html・head・body・meta は枠が付ける。kiku.html と中身は同じで、枠の中かどうかは app.js が起動時に決める -->\n")
    return head + html


# 枠で効かない呼び出し（画面の外に出る確認・印刷・a[download]）。src/ のファイルを行ごとに見て、場所を出す
FRAME_UNFRIENDLY = [
    (re.compile(r"(?<![\w.])alert\("), "alert()"),
    (re.compile(r"(?<![\w.])confirm\("), "confirm()"),
    (re.compile(r"window\.confirm\("), "window.confirm()"),
    (re.compile(r"(?<![\w.])prompt\("), "prompt()"),
    (re.compile(r"window\.print\b"), "window.print"),
    (re.compile(r"\.download\s*="), "a.download ="),
    (re.compile(r"<a\b[^>]*\sdownload\b"), "<a download>"),
]


def frame_warnings() -> list:
    out = []
    for f in sorted(SRC.iterdir()):
        if f.suffix not in (".js", ".html"):
            continue
        text = f.read_text(encoding="utf-8")
        # そのファイルの中で同じ名前の関数を自分で定義していれば（intake.js の confirm など）、裸の呼び出しはそれ
        local = {m.group(1) for m in re.finditer(r"\bfunction\s+(alert|confirm|prompt)\s*\(", text)}
        for i, line in enumerate(text.split("\n"), 1):
            if "枠では使わない" in line:
                continue
            for rx, what in FRAME_UNFRIENDLY:
                if rx.search(line) and not (what.rstrip("()") in local and not line.lstrip().startswith("window.")):
                    out.append(f"src/{f.name}:{i}: {what} は枠（アーティファクト）の中では効かない")
    return out


def check(html: str, artifact: bool = False) -> list:
    """組み立てた 1 枚の検査。問題があれば文の一覧を返す。artifact なら、枠が付けるもの（doctype・meta・lang）は求めない"""
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
    needles = [("等倍", "速度表記「等倍」（R9）")]
    if not artifact:
        needles = [
            ("<!doctype html>", "doctype"),
            ('<meta charset="utf-8">', "charset"),
            ('name="viewport"', "viewport"),
            ('<html lang="ja">', "lang=ja"),
        ] + needles
    else:
        for rx, why in [(r"<!doctype\b", "doctype"), (r"<html[\s>]", "html の開き"), (r"<body[\s>]", "body の開き"), (r"<head[\s>]", "head の開き"), (r"<meta\b", "meta")]:
            if re.search(rx, html, re.I):
                problems.append(f"枠に貼る形に {why} が残っている")
    for needle, why in needles:
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
    artifact = "--artifact" in argv
    shell = (SRC / "shell.html").read_text(encoding="utf-8")
    report = []
    html = build(shell, report, artifact)
    for kind, name, ok in report:
        print(f"  {'組み込み' if ok else '無し    '}  {kind:5} {name}")
    if artifact:
        html = to_artifact(html)
    problems = check(html, artifact)
    marks = MARK.findall(html)
    if marks:
        problems.append(f"置き換えられなかった印が残っている: {marks}")
    if problems:
        print("検査に落ちた:")
        for p in problems:
            print("  - " + p)
        return 1
    if artifact:
        for w in frame_warnings():
            print("  注意  " + w)
    out = OUT_ARTIFACT if artifact else OUT
    if only_check:
        print(f"検査だけ: 問題なし（{len(html.encode('utf-8'))} バイト。{'枠に貼る形' if artifact else out.name}）")
        return 0
    out.write_text(html, encoding="utf-8", newline="\n")
    print(f"書いた: {out}（{len(html.encode('utf-8'))} バイト）")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
