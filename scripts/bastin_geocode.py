"""Coordinates for the cities of Bastin et al. 2019 S2 Table (the table has names only).

Open-Meteo geocoding (GeoNames based), most populous match per name, cached in
scripts/.cache/bastin/geocode.json. Writes scripts/.cache/bastin/s2-geo.json:
[{city, lat, lon, cc, self, analogues: [{name, dissim, lat, lon, cc} x 3]}, ...] for every row.

    python -I scripts/bastin_geocode.py
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

DIR = Path(__file__).resolve().parent / ".cache" / "bastin"
API = "https://geocoding-api.open-meteo.com/v1/search?count=10&language=en&format=json&name="
# Names the most-populous rule gets wrong or GeoNames does not find (checked by hand)
FIX = {
    "Agana": (13.47, 144.75, "GU"), "Dili": (-8.56, 125.57, "TL"), "Kiev": (50.45, 30.52, "UA"),
    "Taizz": (13.58, 44.02, "YE"), "San Marino": (43.94, 12.45, "SM"), "Stanley": (-51.69, -57.86, "FK"),
    "Tel Aviv-Yafo": (32.08, 34.78, "IL"), "Irbil": (36.19, 44.01, "IQ"), "Ad Damman": (26.43, 50.10, "SA"),
    "Ogbomosho": (8.13, 4.24, "NG"), "Shenyeng": (41.80, 123.43, "CN"), "Shijianzhuang": (38.04, 114.51, "CN"),
    "Sri Jawewardenepura Kotte": (6.89, 79.92, "LK"),
}


def geocode(name, cache):
    if name in FIX:
        lat, lon, cc = FIX[name]
        return {"lat": lat, "lon": lon, "cc": cc, "pop": None, "name": name}
    if name in cache:
        return cache[name]
    q = name.replace("_", " ")
    with urllib.request.urlopen(API + urllib.parse.quote(q), timeout=30) as r:
        res = json.loads(r.read()).get("results") or []
    time.sleep(0.25)
    res = [x for x in res if x.get("feature_code", "").startswith("PPL")] or res
    best = max(res, key=lambda x: x.get("population") or 0) if res else None
    cache[name] = None if best is None else {
        "lat": best["latitude"], "lon": best["longitude"], "cc": best.get("country_code"),
        "pop": best.get("population"), "name": best["name"]}
    return cache[name]


def main():
    rows = json.loads((DIR / "s2.json").read_text(encoding="utf-8"))["database_S2"]
    head, body = rows[0], rows[1:]
    cf = DIR / "geocode.json"
    cache = json.loads(cf.read_text(encoding="utf-8")) if cf.exists() else {}
    out = []
    try:
        for r in body:
            d = dict(zip(head, r))
            if d["current_city"] == "NA" or d["future_city_1_source"] == "NA":
                continue
            c = geocode(d["current_city"], cache)
            ans = []
            for k in (1, 2, 3):
                n = d[f"future_city_{k}_source"]
                a = geocode(n, cache)
                ans.append({"name": n, "dissim": float(d[f"future_city_{k}_source_dissim"]),
                            **({"lat": a["lat"], "lon": a["lon"], "cc": a["cc"]} if a else {})})
            out.append({"city": d["current_city"], "self": float(d["selfdissim_current_future"]),
                        **({"lat": c["lat"], "lon": c["lon"], "cc": c["cc"]} if c else {}),
                        "analogues": ans})
    finally:
        cf.write_text(json.dumps(cache, ensure_ascii=False, indent=0), encoding="utf-8")
    (DIR / "s2-geo.json").write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    miss = sorted({n for n, v in cache.items() if v is None and n not in FIX})
    print(len(out), "rows; not found:", miss)


if __name__ == "__main__":
    sys.exit(main())
