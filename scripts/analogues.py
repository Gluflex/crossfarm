"""Bake the climate-analogue grid: site/data/analogue-grid.json + .bin

For every 0.25 degree land cell between 30 and 72 N, 25 W and 45 E:
  - today:  TerraClimate v1.1 monthly normals 1991-2020 (Abatzoglou et al. 2018),
            block mean of the 1/24 degree grid, folded into four seasons
  - change: TerraClimate +2 C pseudo-climate (ensemble median change of CMIP6 models,
            applied to the observed record), mean of six sample years vs. the same
            observed years, on a 0.5 degree grid
  - soil:   ISRIC SoilGrids 2.0 topsoil (0 to 30 cm) pH, clay, sand via WCS

The browser compares a farm's future climate with every cell's climate today.
TerraClimate is served over plain http only, so it cannot be fetched from the
https app; this script runs once and the result ships as a static file.

    python scripts/analogues.py
"""
import hashlib
import io
import json
import re
import struct
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "scripts" / ".cache"
OUT = ROOT / "site" / "data"

TC = "http://thredds.northwestknowledge.net:8080/thredds/dodsC/TERRACLIMATE_ALL"
# Native TerraClimate grid: 1/24 degree, row k at lat 90 - (k + 0.5) / 24, col j at lon -180 + (j + 0.5) / 24
NORTH, SOUTH, WEST, EAST = 72.0, 30.0, -25.0, 45.0
K0, J0 = int((90 - NORTH) * 24), int((WEST + 180) * 24)          # 432, 3720
ROWS, COLS = int((NORTH - SOUTH) * 4), int((EAST - WEST) * 4)     # 168 x 280 cells of 0.25 degree
STEP = 0.25
YEARS = [1992, 1997, 2002, 2007, 2012, 2017]                      # sample years for the +2 C change
SEASONS = [(11, 0, 1), (2, 3, 4), (5, 6, 7), (8, 9, 10)]           # DJF MAM JJA SON, 0-based months

SOIL = ("https://maps.isric.org/mapserv?map=/map/{p}.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
        "&COVERAGEID={p}_{d}_mean&FORMAT=image/tiff&SUBSET=long({w},{e})&SUBSET=lat({s},{n})"
        "&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326"
        "&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326&SCALESIZE=long({cw}),lat({ch})")


def fetch(url, name, timeout=600):
    """Download once into scripts/.cache, retrying on server hiccups."""
    CACHE.mkdir(exist_ok=True)
    f = CACHE / name
    if f.exists() and f.stat().st_size > 0:
        return f.read_bytes()
    for i in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "crossfarm-analogues"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                b = r.read()
            f.write_bytes(b)
            return b
        except Exception as e:
            print(f"  retry {i + 1} {name}: {e}", flush=True)
            time.sleep(10 * (i + 1))
    raise RuntimeError(url)


def packing(path, var):
    das = fetch(f"{TC}/{path}.das", path.replace("/", "_") + ".das", 120).decode()
    block = das[das.index(f"    {var} {{"):]
    block = block[:block.index("}")]
    num = lambda k, d: float(m.group(1)) if (m := re.search(rf"{k} (-?[\d.eE+-]+);", block)) else d
    return num("scale_factor", 1.0), num("add_offset", 0.0), num("_FillValue", None)


def dods(path, var, sel, shape):
    """One OPeNDAP binary subset as a float array (NaN where missing)."""
    q = urllib.request.quote(f"{var}.{var}{sel}", safe=".:")
    name = f"{path.replace('/', '_')}_{hashlib.md5(sel.encode()).hexdigest()[:8]}.dods"
    b = fetch(f"{TC}/{path}.dods?{q}", name)
    data = b[b.index(b"Data:\n") + 6:]
    n = struct.unpack(">I", data[:4])[0]
    assert n == int(np.prod(shape)), (n, shape)
    raw = np.frombuffer(data[8:8 + 4 * n], dtype=">i4").astype(np.float64).reshape(shape)
    scale, offset, fill = packing(path, var)
    out = raw * scale + offset
    if fill is not None:
        out[raw == fill] = np.nan
    return out


def normals(var):
    """1991-2020 monthly normals, sampled every 2nd native pixel, block-mean to 0.25 degree."""
    sel = f"[0:1:11][{K0}:2:{K0 + 6 * ROWS - 1}][{J0}:2:{J0 + 6 * COLS - 1}]"
    a = dods(f"climatology/TerraClimate_19912020_{var}.nc", var, sel, (12, 3 * ROWS, 3 * COLS))
    b = a.reshape(12, ROWS, 3, COLS, 3)
    valid = np.isfinite(b).sum(axis=(2, 4))
    with np.errstate(invalid="ignore"):
        m = np.nanmean(b, axis=(2, 4))
    m[valid < 5] = np.nan       # mostly sea: drop the cell
    return m


def change(var):
    """Monthly +2 C change on a 0.5 degree grid: difference (temperature, deficit) or ratio (rain)."""
    sel = f"[0:1:11][{K0 + 6}:12:{K0 + 6 * ROWS - 1}][{J0 + 6}:12:{J0 + 6 * COLS - 1}]"
    shape = (12, ROWS // 2, COLS // 2)

    def pair(y):
        h = dods(f"data/TerraClimate_{var}_{y}.nc", var, sel, shape)
        p = dods(f"data_plus2C/TerraClimate_plus2C_{var}_{y}.nc", var, sel, shape)
        return h, p

    with ThreadPoolExecutor(4) as ex:
        pairs = list(ex.map(pair, YEARS))
    h = np.stack([x[0] for x in pairs]); p = np.stack([x[1] for x in pairs])
    if var == "ppt":
        with np.errstate(invalid="ignore", divide="ignore"):
            d = np.nansum(p, axis=0) / np.nansum(h, axis=0)
        d[~np.isfinite(d)] = np.nan
    else:
        d = np.nanmean(p - h, axis=0)
    d = fill_nearest(d)
    return np.repeat(np.repeat(d, 2, axis=1), 2, axis=2)        # onto the 0.25 degree cells


def fill_nearest(a):
    """Coastal cells of the coarse change grid can be sea: borrow the nearest land value."""
    a = a.copy()
    for _ in range(6):
        miss = ~np.isfinite(a)
        if not miss.any():
            break
        pad = np.pad(a, ((0, 0), (1, 1), (1, 1)), constant_values=np.nan)
        nb = np.stack([pad[:, 1 + dy:pad.shape[1] - 1 + dy, 1 + dx:pad.shape[2] - 1 + dx]
                       for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx])
        with np.errstate(invalid="ignore"):
            fill = np.nanmean(nb, axis=0)
        a[miss] = fill[miss]
    return a


def soil(prop):
    """Topsoil 0-30 cm, depth-weighted like engine.summarizeSoil, block-mean to 0.25 degree."""
    acc = np.zeros((ROWS, COLS)); wsum = np.zeros((ROWS, COLS))
    for d, w in (("0-5cm", 5), ("5-15cm", 10), ("15-30cm", 15)):
        url = SOIL.format(p=prop, d=d, w=WEST, e=EAST, s=SOUTH, n=NORTH, cw=COLS * 5, ch=ROWS * 5)
        a = np.array(Image.open(io.BytesIO(fetch(url, f"soil_{prop}_{d}.tif", 300)))).astype(np.float64)
        assert a.shape == (ROWS * 5, COLS * 5), a.shape
        a[a <= 0] = np.nan
        b = a.reshape(ROWS, 5, COLS, 5)
        with np.errstate(invalid="ignore"):
            m = np.nanmean(b, axis=(1, 3)) / 10          # pH x10, clay and sand g/kg -> %
        ok = np.isfinite(m)
        acc[ok] += m[ok] * w; wsum[ok] += w
    with np.errstate(invalid="ignore"):
        return np.where(wsum > 0, acc / wsum, np.nan)


def seasons(m, how):
    f = np.mean if how == "mean" else np.sum
    return np.stack([f(m[list(s)], axis=0) for s in SEASONS])


def main():
    print("normals", flush=True)
    tx, tn, pr, de = (normals(v) for v in ("tmax", "tmin", "ppt", "def"))
    print("+2 C change", flush=True)
    dtx, dtn, rpr, dde = (change(v) for v in ("tmax", "tmin", "ppt", "def"))
    print("soil", flush=True)
    ph, clay, sand = soil("phh2o"), soil("clay"), soil("sand")

    base = {"tmax": seasons(tx, "mean"), "tmin": seasons(tn, "mean"), "ppt": seasons(pr, "sum")}
    fut = {"tmax": seasons(tx + dtx, "mean"), "tmin": seasons(tn + dtn, "mean"), "ppt": seasons(pr * rpr, "sum")}
    land = np.isfinite(base["tmax"]).all(0) & np.isfinite(base["ppt"]).all(0) & np.isfinite(fut["tmax"]).all(0)

    # Field list: name, scale; value stored = round(x * scale) as int16
    fields = []
    cols = []
    for v, sc in (("tmax", 10), ("tmin", 10), ("ppt", 1)):
        for i, s in enumerate(("djf", "mam", "jja", "son")):
            fields.append([f"{v}_{s}", sc]); cols.append(base[v][i])
    for v, sc in (("tmax", 10), ("tmin", 10), ("ppt", 1)):
        for i, s in enumerate(("djf", "mam", "jja", "son")):
            fields.append([f"{v}_{s}_2c", sc]); cols.append(fut[v][i])
    fields += [["def", 1], ["def_2c", 1], ["ph", 10], ["clay", 1], ["sand", 1]]
    cols += [np.nansum(de, axis=0), np.nansum(de + dde, axis=0), ph, clay, sand]

    idx = np.flatnonzero(land.ravel())
    table = np.stack([c.ravel()[idx] for c in cols], axis=1)
    scales = np.array([f[1] for f in fields], dtype=np.float64)
    packed = np.where(np.isfinite(table), np.round(table * scales), -32768).astype("<i2")

    head = {
        "source": "TerraClimate v1.1 1991-2020 normals and +2 C pseudo-climate (Abatzoglou et al. 2018); ISRIC SoilGrids 2.0 topsoil 0-30 cm",
        "north": NORTH, "west": WEST, "step": STEP, "rows": ROWS, "cols": COLS,
        "cells": int(len(idx)), "fields": fields, "missing": -32768,
        "layout": "little-endian: uint16 cell index (row * cols + col, row 0 at the north edge) x cells, then int16 values cell by cell",
    }
    (OUT / "analogue-grid.json").write_text(json.dumps(head, indent=1), encoding="utf-8")
    with open(OUT / "analogue-grid.bin", "wb") as f:
        f.write(idx.astype("<u2").tobytes())
        f.write(packed.tobytes())
    print(f"cells {len(idx)}, {(OUT / 'analogue-grid.bin').stat().st_size / 1e6:.2f} MB", flush=True)

    # Sanity: print a few known places
    for name, lat, lon in (("Arnhem", 51.99, 5.75), ("Foggia", 41.5, 15.6), ("Cordoba", 37.8, -4.95), ("Bern", 47.0, 7.15)):
        r, c = int((NORTH - lat) / STEP), int((lon - WEST) / STEP)
        print(name, "JJA tmax", round(base["tmax"][2][r, c], 1), "->", round(fut["tmax"][2][r, c], 1),
              "JJA ppt", round(base["ppt"][2][r, c]), "->", round(fut["ppt"][2][r, c]),
              "pH", round(ph[r, c], 1), "clay", round(clay[r, c]), "def", round(np.nansum(de[:, r, c])))


if __name__ == "__main__":
    sys.exit(main())
