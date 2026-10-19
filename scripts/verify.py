"""Click through every screen, collect console errors, write screenshots to docs/screens/<scheme>/.

    python scripts\\verify.py [base-url] [farm-id] [light|dark]
"""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8771/site/"
FARM = sys.argv[2] if len(sys.argv) > 2 else "foggia"
SCHEME = sys.argv[3] if len(sys.argv) > 3 else "light"
OUT = Path(__file__).resolve().parent.parent / "docs" / "screens" / SCHEME
OUT.mkdir(parents=True, exist_ok=True)
errors = []
failed = []


def check(cond, msg):
    print("  ok  " if cond else "  FAIL", msg)
    if not cond:
        failed.append(msg)


def shot(page, name):
    page.wait_for_timeout(600)
    page.screenshot(path=str(OUT / f"{name}.png"))
    print("  shot", name)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, color_scheme=SCHEME)
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "?frame=0")
    page.wait_for_selector("#onboard.on")
    page.wait_for_timeout(1500)
    shot(page, "01-welcome")

    page.click(f'[data-farm="{FARM}"]')
    page.wait_for_timeout(1200)
    shot(page, "02-scan")
    page.wait_for_selector("#main.on", timeout=60000)
    page.wait_for_timeout(2500)
    shot(page, "03-farm")
    page.evaluate("document.querySelector('#tFarm').scrollTop = 470")
    shot(page, "03b-farm-twin")
    page.evaluate("document.querySelector('#tFarm').scrollTop = 620")
    shot(page, "04-farm-plan")
    page.evaluate("document.querySelector('#tFarm').scrollTop = 99999")
    shot(page, "05-farm-data")
    page.evaluate("document.querySelector('#tFarm').scrollTop = 0")
    page.click('#mapTog [data-l="ndvi"]')
    page.wait_for_timeout(2500)
    shot(page, "06-farm-ndvi")

    page.click('[data-go="climate"]')
    shot(page, "07-climate")
    page.evaluate("document.querySelector('#tClimate').scrollTop = 99999")
    shot(page, "08-climate-ndvi")

    page.click('[data-go="crops"]')
    shot(page, "09-crops")
    page.click("#famCard")
    page.wait_for_timeout(500)
    shot(page, "10-crop-sheet")
    page.click("#scrim", position={"x": 200, "y": 40})
    page.click('#cropSeg [data-f="rising"]')
    shot(page, "11-crops-rising")

    page.click('[data-go="community"]')
    page.wait_for_timeout(1500)
    shot(page, "12-community")
    page.evaluate("document.querySelector('#tCommunity').scrollTop = 380")
    shot(page, "12b-community-match")
    page.click('#tCommunity [data-r="1"]')
    page.wait_for_timeout(1200)
    page.evaluate("document.querySelector('#tCommunity').scrollTop = 380")
    shot(page, "12c-community-match-2")
    page.click("#tCommunity [data-method]")
    page.wait_for_timeout(500)
    shot(page, "12d-method")
    page.click("#scrim", position={"x": 200, "y": 40})
    page.wait_for_timeout(400)
    page.evaluate("document.querySelector('#tCommunity .posts').scrollIntoView()")
    page.evaluate("document.querySelector('#tCommunity').scrollTop -= 120")
    shot(page, "12e-community-feed")
    page.click("#tCommunity [data-t]")
    page.wait_for_timeout(500)
    shot(page, "13-thread")
    page.click("#scrim", position={"x": 200, "y": 40})
    page.wait_for_timeout(400)
    page.click("#composer")
    page.wait_for_timeout(500)
    page.fill("#askQ", "Anyone selling sorghum to feed mills near Foggia?")
    shot(page, "14-ask")
    page.click("#askGo")
    page.wait_for_timeout(2000)
    shot(page, "15-asked")
    api_up = page.evaluate("fetch('api/stats').then(r => r.ok && r.headers.get('content-type').includes('json')).catch(() => false)")
    pending = page.locator("#sheet .tag.pend").count()
    check(api_up and pending == 0 or (not api_up and pending > 0), f"posted question: api {'up' if api_up else 'down'}, pending tags {pending}")
    page.click("#scrim", position={"x": 200, "y": 40})
    page.wait_for_timeout(400)
    check(page.locator("#tCommunity .tag", has_text="Demo, fictional").count() > 0, "seed threads carry the demo tag")

    # v4: Ask Crossfarm (mock model locally, data answer when the API is down or paused)
    page.click('#tCommunity [data-askai]')
    page.wait_for_timeout(500)
    shot(page, "16-ai")
    page.click("#sheet .chip >> nth=0")
    page.wait_for_selector("#aiOut .ai-text", timeout=50000)
    page.wait_for_timeout(500)
    shot(page, "16b-ai-answer")
    check(page.locator("#aiOut .ai-text").inner_text().strip() != "", "assistant shows an answer")
    page.click("#aiPost")
    page.wait_for_timeout(500)
    check(page.input_value("#askQ") != "", "assistant hands the question to the farmer form")
    page.click("#scrim", position={"x": 200, "y": 40})
    page.wait_for_timeout(400)

    # v4: a thread in another language gets a Translate link
    if api_up:
        tid = page.evaluate("""fetch('api/threads', {method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({who: 'Annelies', place: 'Barneveld', lat: 52.1, lon: 5.6, crop: 'potato',
            q: 'Wie heeft ervaring met Carolus op zand?', body: 'Wij telen 30 ha.', lang: 'nl'})}).then(r => r.json()).then(j => j.id)""")
        page.evaluate("location.reload()")
        page.wait_for_selector("#main.on", timeout=60000)
        page.wait_for_timeout(2500)
        page.click('[data-go="community"]')
        page.click('#feedSeg [data-f="near"]')
        page.wait_for_timeout(500)
        page.click(f'#tCommunity [data-t="{tid}"]')
        page.wait_for_timeout(500)
        page.click('#sheet [data-tr="q"]')
        page.wait_for_timeout(1500)
        shot(page, "17-translated")
        check("Show original" in page.inner_text("#sheet [data-tr='q']"), "translate swaps the text")
        page.click("#scrim", position={"x": 200, "y": 40})
        page.wait_for_timeout(400)

    # v4: pilot sign-up and privacy
    page.evaluate("document.querySelector('[data-sheet=\"pilot\"]').click()")
    page.wait_for_timeout(500)
    shot(page, "18-pilot")
    page.evaluate("document.querySelector('#sheet [data-sheet=\"privacy\"]').click()")
    page.wait_for_timeout(500)
    shot(page, "19-privacy")
    page.click("#scrim", position={"x": 200, "y": 40})
    page.evaluate("localStorage.removeItem('cf:community')")

    # Desktop: phone frame
    d = b.new_context(viewport={"width": 1280, "height": 900}, color_scheme=SCHEME)
    dp = d.new_page()
    dp.on("pageerror", lambda e: errors.append("frame: " + str(e)))
    dp.goto(BASE)
    dp.wait_for_timeout(2500)
    dp.screenshot(path=str(OUT / "00-frame.png"))
    print("  shot 00-frame", dp.url)
    b.close()

real = [e for e in errors if "Failed to load resource" not in e]
print("console errors:", len(errors), "| non-network:", len(real))
for e in errors[:20]:
    print("  ", e[:200])
print("checks failed:", len(failed))
sys.exit(1 if real or failed else 0)
