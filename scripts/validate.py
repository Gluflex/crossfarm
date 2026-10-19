"""Inputs for the analogue back-test (scripts/validate.mjs runs the test itself).

Downloads once into scripts/.cache, then writes two scratch files there:

  validation-past.bin   TerraClimate v1.1 1961-1990 normals, 12 seasonal variables for
                        every land cell of site/data/analogue-grid.bin, same 0.25 degree
                        block mean as scripts/analogues.py uses for 1991-2020
  validation-icv.bin    year-to-year seasonal values (1961-1990 and 1991-2020) from the
                        TerraClimate monthly files, one native pixel every 1 degree, for
                        the sigma scaling of every sampled cell
  validation-input.json the layout of both

    python scripts/validate.py
    node scripts/validate.mjs
"""
import json
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from analogues import (CACHE, COLS, J0, K0, NORTH, OUT, ROWS, SEASONS, WEST, dods,  # noqa: E402
                       fill_nearest, seasons)

VARS = ("tmax", "tmin", "ppt")
ICV_STEP = 24                       # native pixels: 1 degree
ICV_ROWS, ICV_COLS = ROWS // 4, COLS // 4                       # 42 x 70
YEARS = list(range(1960, 2021))     # 1960 only for the December of the 1961 winter


def past_normals(var):
    """1961-1990 monthly normals, exactly the sampling of analogues.normals()."""
    sel = f"[0:1:11][{K0}:2:{K0 + 6 * ROWS - 1}][{J0}:2:{J0 + 6 * COLS - 1}]"
    a = dods(f"climatology/TerraClimate_19611990_{var}.nc", var, sel, (12, 3 * ROWS, 3 * COLS))
    b = a.reshape(12, ROWS, 3, COLS, 3)
    valid = np.isfinite(b).sum(axis=(2, 4))
    with np.errstate(invalid="ignore"):
        m = np.nanmean(b, axis=(2, 4))
    m[valid < 5] = np.nan
    return m


def yearly(var, y):
    """Monthly values of one year, one native pixel at the centre of every 1 degree block."""
    k, j = K0 + ICV_STEP // 2, J0 + ICV_STEP // 2
    sel = f"[0:1:11][{k}:{ICV_STEP}:{K0 + 6 * ROWS - 1}][{j}:{ICV_STEP}:{J0 + 6 * COLS - 1}]"
    return dods(f"data/TerraClimate_{var}_{y}.nc", var, sel, (12, ICV_ROWS, ICV_COLS))


def season_years(monthly, first, last):
    """12 seasonal values per year, December counted toward the next year's winter."""
    out = []
    for y in range(first, last + 1):
        row = []
        for v in VARS:
            cur, prev = monthly[v][y], monthly[v][y - 1]
            for s in SEASONS:
                vals = np.stack([prev[11] if m == 11 else cur[m] for m in s])
                row.append(vals.sum(0) if v == "ppt" else vals.mean(0))
        out.append(np.stack(row))           # 12 x ICV_ROWS x ICV_COLS
    return np.stack(out)                     # years x 12 x rows x cols


def main():
    print("1961-1990 normals", flush=True)
    tx, tn, pr = (past_normals(v) for v in VARS)
    past = np.concatenate([seasons(tx, "mean"), seasons(tn, "mean"), seasons(pr, "sum")])   # 12 x ROWS x COLS

    head = json.loads((OUT / "analogue-grid.json").read_text(encoding="utf-8"))
    idx = np.frombuffer((OUT / "analogue-grid.bin").read_bytes()[:2 * head["cells"]], dtype="<u2").astype(int)
    past_cells = past.reshape(12, -1)[:, idx].T.astype("<f4")        # cells x 12, NaN where missing

    print("yearly series for the variability, 1960 to 2020", flush=True)
    jobs = [(v, y) for v in VARS for y in YEARS]
    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(lambda vy: yearly(*vy), jobs))
    monthly = {v: {} for v in VARS}
    for (v, y), a in zip(jobs, res):
        monthly[v][y] = fill_nearest(a)       # coastal pixels can be sea: borrow the neighbour
    icv_past = season_years(monthly, 1961, 1990)
    icv_today = season_years(monthly, 1991, 2020)

    (CACHE / "validation-past.bin").write_bytes(past_cells.tobytes())
    (CACHE / "validation-icv.bin").write_bytes(np.concatenate([icv_past.ravel(), icv_today.ravel()]).astype("<f4").tobytes())
    meta = {
        "cells": int(len(idx)), "vars": 12,
        "icv": {"rows": ICV_ROWS, "cols": ICV_COLS, "north": NORTH, "west": WEST, "step": 1.0,
                "lat0": 90 - (K0 + ICV_STEP // 2 + 0.5) / 24, "lon0": -180 + (J0 + ICV_STEP // 2 + 0.5) / 24,
                "periods": [[1961, 1990], [1991, 2020]], "years": 30,
                "layout": "float32 LE: period x year x variable x row x col"},
        "past": "float32 LE: cell (order of analogue-grid.bin) x 12 variables, TerraClimate 1961-1990 normals",
    }
    (CACHE / "validation-input.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print("missing past cells", int(np.isnan(past_cells).any(1).sum()), "of", len(idx), flush=True)


if __name__ == "__main__":
    sys.exit(main())
