"""Read S2 Table of Bastin et al. 2019 (PLOS ONE 14(7): e0217592) into scripts/.cache/bastin/s2.json.

The table is an OpenDocument spreadsheet; this reads content.xml with the standard library only.

    python -I scripts/bastin_table.py
"""
import json
import sys
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

DIR = Path(__file__).resolve().parent / ".cache" / "bastin"
URL = "https://journals.plos.org/plosone/article/file?type=supplementary&id=10.1371/journal.pone.0217592.s002"
NS = {"table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
      "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
      "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0"}
T = "{%s}" % NS["table"]


def rows(sheet):
    out = []
    for r in sheet.iter(T + "table-row"):
        rep = int(r.get(T + "number-rows-repeated", "1"))
        cells = []
        for c in r:
            if c.tag not in (T + "table-cell", T + "covered-table-cell"):
                continue
            n = int(c.get(T + "number-columns-repeated", "1"))
            v = c.get("{%s}value" % NS["office"])
            if v is None:
                v = " ".join("".join(p.itertext()) for p in c.findall("text:p", NS))
            cells += [v] * min(n, 50)
        while cells and cells[-1] in ("", None):
            cells.pop()
        if cells:
            out += [cells] * min(rep, 1)
    return out


def main():
    DIR.mkdir(parents=True, exist_ok=True)
    f = DIR / "s002.ods"
    if not f.exists():
        f.write_bytes(urllib.request.urlopen(URL, timeout=120).read())
    root = ET.fromstring(zipfile.ZipFile(f).read("content.xml"))
    sheets = {s.get(T + "name"): rows(s) for s in root.iter(T + "table")}
    (DIR / "s2.json").write_text(json.dumps(sheets, ensure_ascii=False), encoding="utf-8")
    for name, rs in sheets.items():
        print(name, len(rs))
        for r in rs[:4]:
            print("  ", r)


if __name__ == "__main__":
    sys.exit(main())
