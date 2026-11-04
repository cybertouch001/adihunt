# Browser tests for Live Match (v1.1): python3 test/pw_match.py BASE SHOTDIR
import sys, json, time, random, os, requests
from playwright.sync_api import sync_playwright
B, SD = sys.argv[1], sys.argv[2]; os.makedirs(SD, exist_ok=True)
N = 0; FAILS = []
def ok(c, msg):
    global N; N += 1
    print(('ok ' if c else 'FAIL ') + str(N) + ' ' + msg)
    if not c: FAILS.append(msg)
def call(m, body=None, tok=None):
    h = {'x-ah': '1', 'content-type': 'application/json', 'cf-connecting-ip': '10.%d.%d.%d' % (random.randint(1, 250), random.randint(1, 250), random.randint(1, 250))}
    if tok: h['authorization'] = 'Bearer ' + tok
    r = requests.post(f'{B}/api/{m}', json=body or {}, headers=h); j = r.json(); j['_s'] = r.status_code; return j
RUN = str(int(time.time()) % 100000)
LAT, LNG = 25.3176 + random.random() * 0.1, 82.9739 + random.random() * 0.1
def mk(name, dx=0.0, dy=0.0):
    j = call('signup', {'username': name, 'password': 'secret12'}); tok = j['token']
    call('pos', {'lat': LAT + dy / 110574, 'lng': LNG + dx / 110000, 'acc': 5, 'demo': 1}, tok)
    return tok, j['user']['id']
host_tok, _ = mk('pwh' + RUN, 0, 0)
o1, _ = mk('pwa' + RUN, 15, 10); o2, _ = mk('pwb' + RUN, -20, 12)
errs = []
def attach(pg, tag):
    pg.on('pageerror', lambda e: errs.append(tag + ' PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(tag + ' console.error ' + m.text) if m.type == 'error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text and 'overpass' not in m.text.lower() else None)
def enter_app(pg):
    pg.evaluate("t => localStorage.setItem('ah_token', t)", host_tok); pg.reload(); pg.wait_for_selector('#main:not([hidden])', timeout=15000); pg.wait_for_timeout(800)
    if pg.locator('[data-act=safeOk]').count(): pg.click('[data-act=safeOk]'); pg.wait_for_timeout(500)
with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    def ctx(w, h):
        return b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2 if w < h or w < 500 else 1, is_mobile=w < 500, has_touch=w < 500,
            geolocation={'latitude': LAT, 'longitude': LNG}, permissions=['geolocation'])
    # ---- portrait phone: live match on the map
    c = ctx(390, 844); pg = c.new_page(); attach(pg, 'phone'); pg.goto(B + '/app/')
    enter_app(pg)
    ok(pg.locator('#fMatch').count() == 1, 'the Match button is on the map')
    pg.click('#fMatch'); pg.wait_for_selector('[data-go=live]', timeout=8000); pg.wait_for_timeout(300)
    pg.screenshot(path=f'{SD}/adihunt-v11-01-home-390x844.png')
    ok(pg.locator('text=Hide & seek').count() == 1 or pg.locator('text=Hide &').count() == 1, 'home screen shows Hide & seek')
    pg.click('[data-go=live]'); pg.wait_for_selector('#sGo', timeout=5000); pg.wait_for_timeout(500)
    pg.screenshot(path=f'{SD}/adihunt-v11-02-create-live-390x844.png')
    pg.click('#sGo'); pg.wait_for_selector('#mvLobby:not([hidden])', timeout=8000)
    code = pg.locator('.mvCode b').inner_text().strip(); ok(len(code) == 6, 'lobby shows a 6-character room code')
    pg.screenshot(path=f'{SD}/adihunt-v11-03-lobby-390x844.png')
    for tok in (o1, o2):
        j = call('match_join', {'code': code}, tok); ok(j.get('ok') is True, 'a friend joins by code')
    pg.wait_for_timeout(2600)
    ok(pg.locator('#lStart:not([disabled])').count() == 1, 'start is enabled once 3 players are in')
    pg.click('#lStart'); pg.wait_for_selector('#mvRun:not([hidden])', timeout=8000); pg.wait_for_timeout(3500)
    ok(pg.locator('#mvHud .mvTop').count() == 1 and 'Zone' in pg.inner_text('#mvHud'), 'running HUD shows zone and timer')
    ok(pg.locator('#mvActs [data-act=end]').count() == 1, 'the host sees End match')
    pg.screenshot(path=f'{SD}/adihunt-v11-04-live-running-390x844.png')
    pg.click('[data-act=end]'); pg.wait_for_selector('#mvEnd:not([hidden])', timeout=8000); pg.wait_for_timeout(400)
    ok('Match over' in pg.inner_text('#mvEnd'), 'end screen after the host ends the match')
    pg.click('#eReplay'); pg.wait_for_timeout(900); ok(pg.locator('#eCanvas:not([hidden])').count() == 1, 'route replay draws')
    pg.screenshot(path=f'{SD}/adihunt-v11-05-end-390x844.png')
    c.close()
    # ---- landscape: virtual arena (fresh context, phone turned sideways)
    c = ctx(844, 390); pg = c.new_page(); attach(pg, 'land'); pg.goto(B + '/app/')
    enter_app(pg)
    pg.click('#fMatch'); pg.wait_for_selector('#mvEnd:not([hidden]), [data-go=virtual]', timeout=8000)
    if pg.locator('#eHome').count() and pg.is_visible('#eHome'): pg.click('#eHome')
    pg.wait_for_selector('[data-go=virtual]', timeout=8000)
    pg.click('[data-go=virtual]'); pg.wait_for_selector('#sGo', timeout=5000); pg.wait_for_timeout(1200)
    pg.click('#sGo'); pg.wait_for_selector('#mvLobby:not([hidden])', timeout=12000)
    code2 = pg.locator('.mvCode b').inner_text().strip()
    for tok in (o1, o2): call('match_join', {'code': code2}, tok)
    pg.wait_for_timeout(2600); pg.click('#lStart'); pg.wait_for_selector('#mvRun:not([hidden])', timeout=8000)
    pg.wait_for_timeout(4500)
    ok(pg.locator('#mvCanvas:not([hidden])').count() == 1, 'virtual arena canvas is on screen')
    ok(not pg.is_visible('#mvRotate'), 'landscape: no rotate prompt')
    pg.keyboard.down('ArrowUp'); pg.wait_for_timeout(900); pg.keyboard.up('ArrowUp'); pg.wait_for_timeout(1200)
    ok(pg.locator('#mvPad button').count() == 4, 'on-screen d-pad present')
    pg.screenshot(path=f'{SD}/adihunt-v11-06-virtual-landscape-844x390.png')
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(900)
    ok(pg.is_visible('#mvRotate'), 'portrait: the rotate prompt shows')
    pg.screenshot(path=f'{SD}/adihunt-v11-07-virtual-portrait-rotate-390x844.png')
    pg.set_viewport_size({'width': 844, 'height': 390}); pg.wait_for_timeout(600)
    pg.click('[data-act=end]'); pg.wait_for_selector('#mvEnd:not([hidden])', timeout=8000)
    pg.screenshot(path=f'{SD}/adihunt-v11-08-virtual-end-844x390.png')
    c.close()
    # ---- desktop-width check of the home screen for layout sanity
    c = ctx(1280, 900); pg = c.new_page(); attach(pg, 'desk'); pg.goto(B + '/app/')
    enter_app(pg)
    pg.click('#fMatch'); pg.wait_for_selector('#mvEnd:not([hidden]), [data-go=live]', timeout=8000)
    if pg.locator('#eHome').count() and pg.is_visible('#eHome'): pg.click('#eHome')
    pg.wait_for_selector('[data-go=live]', timeout=8000); pg.screenshot(path=f'{SD}/adihunt-v11-09-home-desktop.png'); c.close()
    b.close()
ok(len(errs) == 0, 'no JS page errors: ' + ' | '.join(errs[:6]))
print('RESULT', N, 'checks,', len(FAILS), 'failed')
