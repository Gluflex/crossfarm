"""Live path check: a custom field (no snapshot) through scan, farm and community.

    python scripts\\verify_custom.py [base-url] [lat] [lon]
Costs one live Open-Meteo request (about 460 of the 600 per minute weight).
"""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8771/site/"
LAT = float(sys.argv[2]) if len(sys.argv) > 2 else 47.18
LON = float(sys.argv[3]) if len(sys.argv) > 3 else 20.2
OUT = Path(__file__).resolve().parent.parent / "docs" / "screens" / "custom"
OUT.mkdir(parents=True, exist_ok=True)
farm = {"id": "custom", "custom": True, "lat": LAT, "lon": LON, "name": "Test field", "region": "Test", "country": "",
        "cc": "", "ha": 40, "family": "maize", "since": None}
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True).new_page()
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "?frame=0")
    page.evaluate(f"localStorage.setItem('cf:farm', {json.dumps(json.dumps(farm))})")
    page.goto(BASE + "?frame=0")
    page.wait_for_selector("#main.on", timeout=150000)
    page.wait_for_timeout(1500)
    page.evaluate("document.querySelector('#tFarm').scrollTop = 470")
    page.screenshot(path=str(OUT / "farm-twin.png"))
    page.click('[data-go="community"]')
    page.wait_for_timeout(2500)
    page.screenshot(path=str(OUT / "community.png"))
    page.evaluate("localStorage.clear()")
    b.close()

real = [e for e in errors if "Failed to load resource" not in e]
print("console errors:", len(errors), "| non-network:", len(real))
for e in errors[:10]:
    print("  ", e[:200])
sys.exit(1 if real else 0)
