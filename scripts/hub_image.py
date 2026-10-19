"""Render the 16:10 card image for the hackathon hub from docs/screens/light/.

    python scripts\\hub_image.py <out.jpg>

Run scripts/verify.py first so the screenshots are current.
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SCREENS = ROOT / "docs" / "screens" / "light"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "hub-crossfarm.jpg"
PICK = ["03-farm", "01-welcome", "09-crops"]

phones = "".join(
    f'<div class="ph{" mid" if i == 1 else ""}"><img src="{(SCREENS / (n + ".png")).as_uri()}"></div>'
    for i, n in enumerate(PICK)
)
html = f"""<!doctype html><html><head><style>
  html, body {{ margin: 0; width: 1600px; height: 1000px; overflow: hidden; background: #111412; }}
  .row {{ display: flex; justify-content: center; align-items: flex-start; gap: 64px; padding-top: 120px; }}
  .ph {{ width: 390px; height: 844px; border-radius: 54px; padding: 12px; background: #1b1f1c;
         box-shadow: inset 0 0 0 1px #2c322d; }}
  .ph.mid {{ margin-top: -64px; }}
  .ph img {{ display: block; width: 390px; height: 844px; border-radius: 42px; }}
</style></head><body><div class="row">{phones}</div></body></html>"""

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1600, "height": 1000})
    tmp = SCREENS / "_hub.html"  # file:// images only load from a file:// page
    tmp.write_text(html, encoding="utf-8")
    page.goto(tmp.as_uri())
    tmp.unlink()
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT), type="jpeg", quality=86)
    b.close()
print("wrote", OUT)
