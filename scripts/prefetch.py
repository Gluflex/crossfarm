"""Snapshot climate + soil for the demo farms into site/data/farms/<id>.json.

The app fetches the same two APIs live for any other location. The snapshots
exist so the pitch demo never waits on (or gets rate-limited by) Open-Meteo.

    python scripts/prefetch.py            # all farms
    python scripts/prefetch.py foggia     # one farm
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FARMS = json.loads((ROOT / "site" / "data" / "farms.json").read_text(encoding="utf-8"))
OUT = ROOT / "site" / "data" / "farms"

# Snapshots also carry the model's daily mean; live requests in site/js/api.js
# derive it from max/min to stay under Open-Meteo's per-minute weight limit.
CLIMATE = ("https://climate-api.open-meteo.com/v1/climate?latitude={lat}&longitude={lon}"
           "&start_date=1991-01-01&end_date=2050-12-31&models=EC_Earth3P_HR"
           "&daily=temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum")
SOIL = ("https://rest.isric.org/soilgrids/v2.0/properties/query?lon={lon}&lat={lat}"
        "&property=phh2o&property=clay&property=sand&property=silt&property=soc&property=nitrogen"
        "&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean")


def get(url, tries=6):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "crossfarm-prefetch"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.load(r)
        except Exception as e:  # 429 / timeouts: back off and retry
            print(f"  retry {i + 1}: {e}")
            time.sleep(65)
    raise RuntimeError(url)


def main():
    want = set(sys.argv[1:])
    for f in FARMS:
        if want and f["id"] not in want:
            continue
        print(f["id"])
        clim = get(CLIMATE.format(**f))
        d = clim["daily"]
        for k in list(d):
            if k != "time":
                d[k] = [None if v is None else round(v, 1) for v in d[k]]
        soil = get(SOIL.format(**f))
        snap = {"elevation": clim.get("elevation"), "daily": d, "soil": soil}
        (OUT / f"{f['id']}.json").write_text(json.dumps(snap, separators=(",", ":")), encoding="utf-8")
        print("  ok", f["id"])
        time.sleep(20)


if __name__ == "__main__":
    main()
