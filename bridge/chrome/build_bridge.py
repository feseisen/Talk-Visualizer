#!/usr/bin/env python3
"""build_bridge.py — 拡張「橋」の組み立て。

    python3 kit/bridge/chrome/build_bridge.py              kit/src/intake.js を kit/bridge/chrome/intake.js に写す（頭に「生成物」のコメントを足す）
    python3 kit/bridge/chrome/build_bridge.py --check      写しが元と一致するか、版の控え（zip.lock）が今の中身と版に合うかを確かめるだけ（違えば終了コード 1）
    python3 kit/bridge/chrome/build_bridge.py --lock       版の控え（zip.lock）を今の中身と版で書き直す（中身が変わったのに版が同じなら書かずに終了コード 1）
    python3 kit/bridge/chrome/build_bridge.py --zip <出力>  拡張の ZIP を書く（manifest.json を ZIP の根に置く。中身は make_zip と同じ。--check が通らなければ書かない）

写した intake.js はリポジトリに入れる（拡張は kit/src を読めないため）。kit/src/intake.js を直したら、この道具を走らせて写しを作り直す。

ZIP（make_zip）: manifest.json と、manifest が読むファイル（content_scripts の js、background の service_worker）と README.md を、
名前の順に、日時を 1980-01-01 に揃えて詰める。同じ中身からはいつも同じバイト列になる（build_html.py --artifact が枠に埋め込み、
枠の「拡張を保存する」がこの ZIP を渡す。ZIP は chrome://extensions に落とせば入る——README）。

版の控え（zip.lock）: 拡張が動かすもの（ZIP の中身から README.md を除いたもの。manifest.json は version を除いて読む）の
SHA-256 と、そのときの版を置く。枠は manifest の version を比べて「新しい版があります」を出すので、中身を変えて版を上げ忘れると、
古い拡張を入れたままの人に新しい版が知らされない。それを --check（と build_html.py --artifact・--zip）で止める。
直し方: manifest.json の version を上げてから --lock。
"""
import hashlib
import io
import json
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE.parent.parent / "src" / "intake.js"
DST = HERE / "intake.js"
HEAD = ("/* kit/bridge/chrome/intake.js: 生成物。build_bridge.py が kit/src/intake.js から写す。"
        "手で直さず、kit/src/intake.js を直してから build_bridge.py を走らせる */\n")
ZIP_DATE = (1980, 1, 1, 0, 0, 0)
LOCK = HERE / "zip.lock"


def expected() -> str:
    return HEAD + SRC.read_text(encoding="utf-8")


def copy_problem():
    """写しの食い違い（無ければ None）"""
    if not DST.exists():
        return "写しが無い: bridge/chrome/intake.js（build_bridge.py で作る）"
    if DST.read_text(encoding="utf-8") != expected():
        return "写しが元と違う: bridge/chrome/intake.js は src/intake.js と一致しない（build_bridge.py で作り直す）"
    return None


def version_key(v: str) -> tuple:
    """"0.2.10" → (0, 2, 10, 0)。数でない欄は 0 と読み、4 つの欄に 0 で埋める（manifest の version は数を . でつないだ 1〜4 つの欄。
    枠の versionLess（src/intake.js）も 4 つの欄に埋めて比べるので、"0.2.0" と "0.2.0.0" はどちらでも同じ版になる）"""
    out = []
    for part in str(v).split("."):
        out.append(int(part) if part.isdigit() else 0)
    out += [0] * (4 - len(out))
    return tuple(out)


def content_hash() -> str:
    """拡張が動かすものの SHA-256（ZIP の中身から README.md を除く。manifest.json は version を除き、鍵の順に並べて読む。改行は LF に揃える）"""
    h = hashlib.sha256()
    for name in zip_files():
        if name == "README.md":
            continue
        if name == "manifest.json":
            m = manifest()
            m.pop("version", None)
            data = json.dumps(m, ensure_ascii=False, sort_keys=True).encode("utf-8")
        else:
            # 改行は LF に揃えて読む（Windows で core.autocrlf=true のまま取り出すと CRLF になる。改行の違いで中身が変わったと見なさない）
            data = (HERE / name).read_bytes().replace(b"\r\n", b"\n")
        h.update(name.encode("utf-8") + b"\0" + str(len(data)).encode("ascii") + b"\0" + data)
    return h.hexdigest()


def read_lock():
    try:
        d = json.loads(LOCK.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) and isinstance(d.get("version"), str) and isinstance(d.get("content"), str) else None


def lock_problem():
    """版の控えの食い違い（無ければ None）"""
    lock = read_lock()
    ver = manifest()["version"]
    if lock is None:
        return "版の控えが無い・読めない: bridge/chrome/zip.lock（build_bridge.py --lock で作る）"
    same = lock["content"] == content_hash()
    if version_key(lock["version"]) == version_key(ver):
        if same:
            return None
        return ("拡張の中身が変わったのに版が " + ver + " のまま（枠が「新しい版があります」を出せない）。"
                "manifest.json の version を上げてから build_bridge.py --lock")
    if version_key(ver) < version_key(lock["version"]):
        return "版が下がった: zip.lock は " + lock["version"] + "、manifest.json は " + ver
    return "版を " + lock["version"] + " から " + ver + " に上げた。build_bridge.py --lock で zip.lock を書き直す"


def check() -> int:
    bad = [p for p in (copy_problem(), lock_problem()) if p]
    for p in bad:
        print(p)
    if bad:
        return 1
    print("一致: bridge/chrome/intake.js は src/intake.js の写し。zip.lock は版 %s の中身と合う" % manifest()["version"])
    return 0


def write_lock() -> int:
    p = copy_problem()
    if p:
        print(p)
        return 1
    lock = read_lock()
    ver = manifest()["version"]
    digest = content_hash()
    if lock is not None and version_key(ver) < version_key(lock["version"]):
        print("書かなかった: 版が " + lock["version"] + " から " + ver + " に下がる（入れてある拡張より古い版は、枠が新しい版と見なさない）")
        return 1
    if lock is not None and lock["content"] != digest and version_key(ver) <= version_key(lock["version"]):
        print("書かなかった: 中身が変わったのに版が " + lock["version"] + " から上がっていない（manifest.json の version を上げる）")
        return 1
    LOCK.write_text(json.dumps({"version": ver, "content": digest}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("書いた: bridge/chrome/zip.lock（版 %s）" % ver)
    return 0


def manifest() -> dict:
    return json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))


def zip_files() -> list:
    """ZIP に入れるファイルの名前（manifest.json からの相対）。manifest が読むものが無ければ失敗する"""
    m = manifest()
    names = {"manifest.json", "README.md"}
    for cs in m.get("content_scripts", []):
        names.update(cs.get("js", []))
    sw = (m.get("background") or {}).get("service_worker")
    if sw:
        names.add(sw)
    missing = sorted(n for n in names if not (HERE / n).is_file())
    if missing:
        raise FileNotFoundError("拡張の ZIP に入れるファイルが無い: " + ", ".join(missing))
    return sorted(names)


def make_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name in zip_files():
            info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, (HERE / name).read_bytes())
    return buf.getvalue()


def zip_name() -> str:
    return "kiku-bridge-" + manifest()["version"] + ".zip"


def main(argv) -> int:
    if not SRC.exists():
        print("元が無い: src/intake.js")
        return 1
    if "--check" in argv:
        return check()
    if "--lock" in argv:
        return write_lock()
    if "--zip" in argv:
        i = argv.index("--zip")
        if i + 1 >= len(argv):
            print("--zip の後に出力のパスが要る")
            return 1
        out = Path(argv[i + 1])
        if check() != 0:
            return 1
        data = make_zip()
        out.write_bytes(data)
        print("書いた: %s（%d バイト、%s）" % (out, len(data), ", ".join(zip_files())))
        return 0
    DST.write_text(expected(), encoding="utf-8", newline="\n")
    print("写した: bridge/chrome/intake.js（%d バイト）" % DST.stat().st_size)
    p = lock_problem()
    if p:
        print("まだ: " + p)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
