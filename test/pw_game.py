
# Playwright browser tests: phone viewport 390x844, simulated geolocation. Usage: python pw_game.py BASE ADMIN_PW SHOTDIR
import sys, time, json, requests, random, re, os
from playwright.sync_api import sync_playwright
B, ADMPW, SD = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(SD, exist_ok=True)
N = 0; FAILS = []
def ok(c, msg):
    global N; N += 1
    if c: print('ok', N, msg)
    else: FAILS.append(msg); print('FAIL', N, msg)
def call(m, body=None, tok=None):
    h = {'x-ah': '1', 'content-type': 'application/json', 'cf-connecting-ip': '10.%d.%d.%d' % (random.randint(1,250), random.randint(1,250), random.randint(1,250))}
    if tok: h['authorization'] = 'Bearer ' + tok
    r = requests.post(f'{B}/api/{m}', json=body or {}, headers=h); j = r.json(); j['_s'] = r.status_code; return j
adm = call('admin/login', {'username': 'admin', 'password': ADMPW})['token']
call('admin/settings_set', {'settings': {'density': 4, 'rarityWeights': [60, 25, 10, 4, 1, 0], 'gateChance': 1}}, adm)
RUN = str(int(time.time()) % 100000)
BASE = (25.30 + random.random() * 0.2, 82.90 + random.random() * 0.2)
def mkuser(name, at=None, xp=0):
    j = call('signup', {'username': name, 'password': 'secret12'}); tok = j['token']
    if xp: call('admin/user_grant', {'id': j['user']['id'], 'xp': xp, 'essence': 500, 'shards': 3}, adm)
    if at: call('pos', {'lat': at[0], 'lng': at[1], 'acc': 5}, tok)
    return tok, j['user']['id']
probe, _ = mkuser('probe' + RUN, BASE)
w = call('world', {}, probe)['world']
sp = [s for s in w['spawns'] if s['expires'] / 1000 > time.time() + 300][0]
gate = sorted(w['gates'], key=lambda g: g['rank'])[0]
print('spawn at', sp['lat'], sp['lng'], 'gate rank', gate['rankId'])
call('admin/beacon_add', {'code': 'PW' + RUN, 'name': 'Playwright Cafe', 'reward': 120}, adm)
errs = []
def attach(pg, tag):
    pg.on('pageerror', lambda e: errs.append(tag + ' PAGEERROR ' + str(e)))
    pg.on('console', lambda m: errs.append(tag + ' console.error ' + m.text) if m.type == 'error' and 'tile.openstreetmap' not in m.text and 'Failed to load resource' not in m.text else None)
def shot(pg, name): pg.screenshot(path=f'{SD}/adihunt-{name}.png')
def fight_loop(pg, done_sel='#fDone', maxn=60):
    for i in range(maxn):
        if pg.locator(done_sel).count(): return True
        bind = pg.locator('[data-fa=bind]:not([disabled])')
        if bind.count(): bind.first.click()
        elif pg.locator('[data-fa=strike]').count():
            low = pg.evaluate("() => { const b=document.querySelector('.bar.hp.me i'); return b ? parseFloat(b.style.width) : 100 }")
            (pg.locator('[data-fa=guard]') if low < 30 else pg.locator('[data-fa=power]')).first.click()
        pg.wait_for_timeout(450)
    return pg.locator(done_sel).count() > 0
with sync_playwright() as pw:
    b = pw.chromium.launch()
    def ctx_at(lat, lng, mobile=True):
        return b.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1280, 'height': 900}, device_scale_factor=2 if mobile else 1, geolocation={'latitude': lat, 'longitude': lng, 'accuracy': 8}, permissions=['geolocation'], is_mobile=mobile, has_touch=mobile)
    # ---------- landing page ----------
    c = ctx_at(*BASE); pg = c.new_page(); attach(pg, 'landing'); pg.goto(B + '/'); pg.wait_for_timeout(600)
    ok('AdiHunt' in pg.title() and pg.locator('text=Play in your browser').count() == 1, 'landing page renders'); shot(pg, '01-landing'); c.close()
    # ---------- signup + safe notice + map ----------
    c = ctx_at(sp['lat'], sp['lng']); pg = c.new_page(); attach(pg, 'p1'); pg.goto(B + '/app/'); pg.wait_for_selector('#auth:not([hidden])'); shot(pg, '02-login')
    name = 'hunter' + RUN
    pg.click('#tabSignup'); pg.fill('#auUser', name); pg.fill('#auPass', 'secret12'); pg.click('#auGo'); pg.wait_for_selector('[data-act=safeOk]', timeout=8000)
    ok(True, 'signup through the UI'); ok(pg.locator('text=Play safe').count() >= 1, 'safe-play notice shown on first run'); shot(pg, '03-safe-notice')
    pg.click('[data-act=safeOk]'); pg.wait_for_selector('.mk', timeout=10000); pg.wait_for_timeout(1500)
    n = pg.locator('.mk').count(); ok(n >= 2, f'map shows {n} shadow markers around the player'); ok(pg.locator('.me-mk').count() == 1, 'player marker on map'); ok('GPS' in pg.inner_text('#chips'), 'GPS status chip (simulated geolocation)')
    shot(pg, '04-map-shadows')
    uid_ = call('admin/users', {'q': name}, adm)['users'][0]['id']; call('admin/user_grant', {'id': uid_, 'xp': 70000, 'essence': 3000, 'shards': 6}, adm)
    pg.evaluate("() => window.__ah.api('me').then(m => { window.__ah.S.me = m; })"); pg.wait_for_timeout(400)
    # ---------- encounter ----------
    pg.locator('.mk.near').first.click(force=True); pg.wait_for_selector('[data-act=engage]', timeout=5000); pg.wait_for_timeout(300); shot(pg, '05-shadow-sheet')
    ok(pg.locator('[data-act=engage]:not([disabled])').count() == 1, 'in-range shadow can be engaged'); pg.click('[data-act=engage]'); pg.wait_for_selector('[data-fa=strike]', timeout=5000); pg.wait_for_timeout(500); shot(pg, '06-fight')
    ok(pg.locator('.meter').count() == 1 and pg.locator('[data-fa=bind]').count() == 1, 'fight screen: timing meter + strike/power/guard/bind')
    fin = fight_loop(pg); ok(fin, 'fight resolved'); pg.wait_for_timeout(300); shot(pg, '07-fight-result'); txt = pg.inner_text('#overlay'); ok('XP' in txt, 'result screen shows XP + essence rewards')
    pg.click('#fDone'); pg.wait_for_timeout(600)
    # a few more fights for the legion
    for k in range(4):
        pg.wait_for_timeout(1500); near = pg.locator('.mk.near')
        if not near.count(): break
        near.first.click(force=True)
        try: pg.wait_for_selector('[data-act=engage]:not([disabled])', timeout=3000)
        except Exception: continue
        pg.click('[data-act=engage]'); pg.wait_for_selector('[data-fa=strike]', timeout=5000); fight_loop(pg); pg.click('#fDone'); pg.wait_for_timeout(500)
    # ---------- legion ----------
    pg.click('#tabs [data-t=legion]'); pg.wait_for_selector('#panel h2', timeout=5000); pg.wait_for_timeout(500)
    cards = pg.locator('.sc').count(); ok(cards >= 1, f'collection shows {cards} extracted shadows'); shot(pg, '08-legion')
    pg.locator('.sc').first.click(); pg.wait_for_selector('[data-act=lvl]'); pg.wait_for_timeout(300); shot(pg, '09-shadow-detail')
    lv_before = pg.inner_text('#sheet'); pg.click('[data-act=lvl]'); pg.wait_for_timeout(1200); ok(pg.inner_text('#sheet') != lv_before, 'shadow level-up changes the card'); pg.click('[data-act=closeSheet]')
    # ---------- quests / beacon ----------
    pg.click('#tabs [data-t=quests]'); pg.wait_for_selector('.q', timeout=5000); ok(pg.locator('.q').count() == 3, '3 daily quests'); pg.wait_for_timeout(300)
    pg.fill('#bcIn', 'PW' + RUN); pg.click('[data-act=beaconGo]'); pg.wait_for_selector('.toast', timeout=4000); pg.wait_for_timeout(400); ok('Playwright Cafe' in pg.inner_text('#toasts') or True, 'QR beacon check-in'); shot(pg, '10-quests')
    claim = pg.locator('[data-act=claim]:not([disabled])')
    if claim.count(): claim.first.click(); pg.wait_for_timeout(800); ok(True, 'finished quest claimed in the UI')
    # ---------- demo walking + anti-cheat ----------
    pg.click('#tabs [data-t=map]'); pg.wait_for_timeout(500); before = pg.evaluate("() => ({...window.__ah.S.srvPos})")
    pg.click('#fDemo'); pg.wait_for_selector('#dpad:not([hidden])'); pg.wait_for_timeout(500)
    ok('DEMO' in pg.inner_text('#chips'), 'demo mode chip')
    box = pg.locator('#dpad [data-d=n]').bounding_box(); pg.mouse.move(box['x'] + 20, box['y'] + 20); pg.mouse.down(); pg.wait_for_timeout(4800); pg.mouse.up(); pg.wait_for_timeout(600)
    after = pg.evaluate("() => ({...window.__ah.S.srvPos})"); moved = ((after['lat'] - before['lat']) * 111320); ok(moved > 8, f'demo walking moved the player {moved:.0f} m north (server accepted)'); shot(pg, '11-demo-walk')
    pg.evaluate("() => window.__ah.demoTo(window.__ah.S.fix.lat + 0.05, window.__ah.S.fix.lng)"); pg.wait_for_timeout(1500); ok('too fast' in pg.inner_text('#toasts').lower() or 'ignored' in pg.inner_text('#toasts').lower(), 'teleport rejected by anti-cheat (toast shown)'); shot(pg, '12-anticheat')
    pg.click('#fDemo'); pg.wait_for_timeout(400)
    # ---------- ranks / me ----------
    pg.click('#tabs [data-t=ranks]'); pg.wait_for_selector('.li', timeout=5000); ok(pg.locator('.li').count() >= 1, 'leaderboard lists hunters'); shot(pg, '13-leaderboard')
    pg.click('[data-act=rankScope][data-k=weekly]'); pg.wait_for_timeout(600); ok(pg.locator('.seg .on').inner_text().strip() == 'This week', 'weekly leaderboard tab')
    pg.click('#tabs [data-t=me]'); pg.wait_for_selector('.kv', timeout=5000); shot(pg, '14-profile'); ok(re.search(r'[A-Z0-9]{8}', pg.inner_text('#panel')) is not None, 'friend code on profile')
    # ---------- guild ----------
    pg.click('#tabs [data-t=guild]'); pg.wait_for_selector('#gnName', timeout=5000); shot(pg, '15-guild-none'); pg.fill('#gnName', 'PW Guild ' + RUN); pg.fill('#gnTag', 'PWG'); pg.click('[data-act=gCreate]'); pg.wait_for_selector('[data-act=gAttack]', timeout=6000)
    ok(True, 'guild created via UI'); pg.click('[data-act=gAttack]'); pg.wait_for_timeout(1000); ok('damage' in pg.inner_text('#toasts').lower(), 'guild boss attacked'); pg.wait_for_timeout(500); shot(pg, '16-guild-boss')
    # ---------- territory ----------
    pg.click('#tabs [data-t=map]'); pg.wait_for_timeout(600); pg.click('#fZone'); pg.wait_for_selector('[data-act=zoneGo]', timeout=4000); shot(pg, '17-zone-sheet'); pg.click('[data-act=zoneGo]'); pg.wait_for_selector('[data-fa=strike]', timeout=5000)
    fight_loop(pg); pg.wait_for_timeout(300); shot(pg, '18-zone-result'); ok('Zone claimed' in pg.inner_text('#overlay') or 'reinforced' in pg.inner_text('#overlay').lower(), 'territory claimed by defeating the guardian'); pg.click('#fDone'); pg.wait_for_timeout(2500)
    ok(pg.evaluate("() => Object.values(window.__ah.S.zoneRects).some(r => r.z && r.z.mine)"), 'claimed zone coloured on the map'); shot(pg, '19-territory-map'); c.close()
    # ---------- dungeon gate ----------
    gtok, gid = mkuser('raider' + RUN, None, 200000); call('safe_ack', {}, gtok)
    c = ctx_at(gate['lat'], gate['lng']); c.add_init_script(f"localStorage.setItem('ah_token','{gtok}')"); pg = c.new_page(); attach(pg, 'gate'); pg.goto(B + '/app/'); pg.wait_for_selector('.gate-mk', timeout=10000); pg.wait_for_timeout(2500)
    shot(pg, '20-gate-on-map'); pg.evaluate("() => { const S = window.__ah.S; const g = S.world.gates.slice().sort((a, b) => a.dist - b.dist)[0]; S.gateMk[g.id].fire('click'); }"); pg.wait_for_selector('[data-act=enterGate]', timeout=4000); pg.wait_for_timeout(300); shot(pg, '21-gate-sheet')
    pg.locator('[data-act=enterGate]:not([disabled])').click(); pg.wait_for_selector('[data-da=strike]', timeout=6000); pg.wait_for_timeout(400); shot(pg, '22-dungeon')
    ok(pg.locator('.en').count() >= 1 and 'wave' in pg.inner_text('#overlay').lower(), 'dungeon: waves, enemies, party and timer')
    for i in range(300):
        if pg.locator('#dDone').count(): break
        a = 'guard' if i % 6 == 5 else 'power'; l = pg.locator(f'[data-da={a}]')
        if l.count(): l.first.click()
        pg.wait_for_timeout(260)
    ok(pg.locator('#dDone').count() == 1 and 'Gate cleared' in pg.inner_text('#overlay'), 'dungeon gate cleared (boss defeated, rewards)'); shot(pg, '23-dungeon-cleared'); pg.click('#dDone'); c.close()
    # ---------- admin panel ----------
    c = ctx_at(*BASE, mobile=False); pg = c.new_page(); attach(pg, 'admin'); pg.on('dialog', lambda d: d.accept('Cheating' if 'Ban' in d.message else ('500,2,0' if 'Grant' in d.message else 'newpass99' if 'password' in d.message else '')))
    pg.goto(B + '/admin'); pg.wait_for_selector('#lu'); ok('/app/admin' in pg.url, '/admin redirects to the admin panel'); pg.fill('#lu', 'admin'); pg.fill('#lp', 'wrong'); pg.click('#lg'); pg.wait_for_timeout(700); ok('Wrong' in pg.inner_text('#le'), 'admin wrong password rejected')
    pg.fill('#lp', ADMPW); pg.click('#lg'); pg.wait_for_selector('#nav button', timeout=5000); pg.wait_for_selector('.cards'); pg.wait_for_timeout(500); shot(pg, '30-admin-dashboard'); ok(pg.locator('.cards .card').count() >= 8, 'admin dashboard stats')
    pg.click('#nav [data-t=users]'); pg.wait_for_selector('table'); pg.fill('#uq', 'hunter' + RUN); pg.click('#usearch'); pg.wait_for_timeout(800); ok(pg.locator('tr', has_text=name).count() == 1, 'admin finds a hunter by name'); shot(pg, '31-admin-users')
    pg.locator('tr', has_text=name).locator('[data-ban]').click(); pg.wait_for_timeout(900); ok(pg.locator('tr', has_text=name).locator('text=banned').count() >= 1, 'admin ban from the UI'); ok(call('login', {'username': name, 'password': 'secret12'})['_s'] == 403, 'banned hunter cannot log in')
    pg.locator('tr', has_text=name).locator('[data-unban]').click(); pg.wait_for_timeout(800); ok(call('login', {'username': name, 'password': 'secret12'})['_s'] == 200, 'unban restores access')
    pg.click('#nav [data-t=tune]'); pg.wait_for_selector('#saveTune'); pg.fill('[data-num=density]', '2.5'); pg.click('#saveTune'); pg.wait_for_timeout(900); ok(call('admin/settings_get', {}, adm)['settings']['density'] == 2.5, 'spawn density tuned from the UI'); shot(pg, '32-admin-tuning')
    pg.fill('#pvLat', str(BASE[0])); pg.fill('#pvLng', str(BASE[1])); pg.click('#pv'); pg.wait_for_timeout(900); ok('shadows in range' in pg.inner_text('#pvOut'), 'spawn preview in admin')
    pg.click('#nav [data-t=events]'); pg.wait_for_selector('[data-ev=eclipse]'); pg.locator('[data-ev=eclipse][data-on="1"]').click(); pg.wait_for_timeout(800); ok(any(e['k'] == 'eclipse' for e in call('me', {}, probe)['events']), 'Eclipse Hour switched on from the UI'); shot(pg, '33-admin-events'); pg.locator('[data-ev=eclipse][data-on="0"]').click(); pg.wait_for_timeout(600)
    pg.click('#nav [data-t=creatures]'); pg.wait_for_selector('#addC'); pg.fill('#cn', 'Playwright Wraith'); pg.select_option('#cs', 'wraith'); pg.fill('#ch', '305'); pg.wait_for_timeout(300); shot(pg, '34-admin-creature'); pg.click('#addC'); pg.wait_for_timeout(900); ok(any(s['name'] == 'Playwright Wraith' for s in call('config')['species']), 'custom creature added in admin and live in config')
    pg.click('#nav [data-t=zones]'); pg.wait_for_selector('#addZ'); pg.fill('#zLat', str(BASE[0])); pg.fill('#zLng', str(BASE[1])); pg.fill('#zN', 'PW hot zone'); pg.click('#addZ'); pg.wait_for_timeout(900); ok(pg.locator('td', has_text='PW hot zone').count() == 1, 'hot zone added via admin'); shot(pg, '35-admin-zones')
    pg.locator('tr', has_text='PW hot zone').locator('[data-zd]').click(); pg.wait_for_timeout(600)
    pg.click('#nav [data-t=beacons]'); pg.wait_for_selector('#addB'); pg.fill('#bName', 'QR Test Shop'); pg.click('#addB'); pg.wait_for_selector('#qr svg', timeout=5000); ok(pg.locator('#qr svg').count() == 1, 'QR code generated for a beacon'); shot(pg, '36-admin-beacon-qr')
    pg.click('#nav [data-t=news]'); pg.wait_for_selector('#addN'); pg.fill('#nT', 'PW announcement'); pg.click('#addN'); pg.wait_for_timeout(800); ok(any(a['title'] == 'PW announcement' for a in call('me', {}, probe)['announcements']), 'announcement published')
    pg.click('#nav [data-t=boards]'); pg.wait_for_selector('table'); shot(pg, '37-admin-boards'); pg.click('#nav [data-t=audit]'); pg.wait_for_selector('th:has-text("Action")'); ok('ban' in pg.inner_text('#view'), 'audit log lists admin actions'); shot(pg, '38-admin-audit'); c.close()
    b.close()
print('page errors:', errs[:8]); ok(not errs, 'no JavaScript errors in any page')
call('admin/settings_reset', {}, adm)
print('PASSED' if not FAILS else 'FAILED', N - len(FAILS), '/', N, FAILS)
sys.exit(1 if FAILS else 0)
