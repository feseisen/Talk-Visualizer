#!/usr/bin/env python3
"""tests/_data.js を作る。

ブラウザで tests/tests.html を file:// で開いたとき fetch が効かないので、
規則表・試験ケース・fixture を 1 つの JS に埋め込んでおく。

使い方（道具の根で。kiku.html のあるフォルダ）:
    python tools/make_test_data.py

読むもの:  format/rules.json、tests/cases/*.json、tests/fixtures/meeting10.jsonl、
           tests/fixtures/meeting10.txt、tests/fixtures/meeting10.status.json
書くもの:  tests/_data.js（globalThis.TSV_TEST_DATA に入れる。node でも require できる。一時ファイルに書いて置き換える）

fixture の素材（.txt）は「m:ss<TAB>話者<TAB>本文」を {i,t,who,text} に直して入れる（P20 の検査に使う）。
"""
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FORMAT = ROOT / "format"
TESTS = ROOT / "tests"


def read_jsonl(path):
    out = []
    for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as e:
                sys.exit(f"{path} の {i} 行目が JSON として読めません: {e}")
    return out


def read_src(path):
    """m:ss<TAB>話者<TAB>本文 → {i,t,who,text}。i は 1 から。"""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            sys.exit(f"{path}: 「{line[:30]}…」がタブ区切り 3 列ではありません")
        ts, who, text = parts
        p = [int(x) for x in ts.split(":")]
        t = p[0] * 3600 + p[1] * 60 + p[2] if len(p) == 3 else p[0] * 60 + p[1]
        out.append({"i": len(out) + 1, "t": t, "who": who, "text": text})
    return out


def main():
    rules = json.loads((FORMAT / "rules.json").read_text(encoding="utf-8"))
    cases = []
    for p in sorted((TESTS / "cases").glob("*.json")):
        c = json.loads(p.read_text(encoding="utf-8"))
        c["_file"] = p.name
        cases.append(c)
    fixture = read_jsonl(TESTS / "fixtures" / "meeting10.jsonl")
    src = read_src(TESTS / "fixtures" / "meeting10.txt")
    status = json.loads((TESTS / "fixtures" / "meeting10.status.json").read_text(encoding="utf-8"))
    data = {
        "generated_from": {
            "rules": "format/rules.json",
            "cases": f"tests/cases/*.json（{len(cases)} 件）",
            "fixture": "tests/fixtures/meeting10.jsonl",
            "src": "tests/fixtures/meeting10.txt",
            "status": "tests/fixtures/meeting10.status.json",
        },
        "rules": rules,
        "cases": cases,
        "fixture": fixture,
        "src": src,
        "status": status,
    }
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    # </script> が中に現れても壊れないように逃がす
    body = body.replace("</", "<\\/")
    # 対になっていないサロゲート（わざと壊した値の試験に使う）は UTF-8 で書けないので、\uXXXX の形で逃がす
    body = re.sub("[\ud800-\udfff]", lambda m: "\\u%04x" % ord(m.group()), body)
    js = (
        "/* 生成物。手で直さない。tools/make_test_data.py が format/rules.json・tests/cases・tests/fixtures から作る */\n"
        "(function(){\n"
        f"  const DATA = {body};\n"
        "  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;\n"
        "  else globalThis.TSV_TEST_DATA = DATA;\n"
        "})();\n"
    )
    out = TESTS / "_data.js"
    # 一時ファイルに書いてから置き換える（書いている途中で試験のページや node が読んでも、半端な中身を見ない。
    # 途中で落ちても元の _data.js は残る）
    tmp = out.with_name(out.name + f".{os.getpid()}.tmp")
    try:
        tmp.write_text(js, encoding="utf-8", newline="\n")
        os.replace(tmp, out)
    finally:
        if tmp.exists():
            tmp.unlink()
    print(f"{out} を書いた（規則表 1、ケース {len(cases)} 件、fixture {len(fixture)} 行、素材 {len(src)} 行、期待値 {len(status.get('steps', []))} ステップ）")


if __name__ == "__main__":
    main()
