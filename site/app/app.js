/* AdiHunt web app (also runs inside the Android WebView). Vanilla JS + Leaflet. */
(() => {
'use strict';
if (/AdiHuntAndroid/.test(navigator.userAgent)) window.AH_ANDROID = true;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RC = AHArt.RC, RN = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'], RID = ['E', 'D', 'C', 'B', 'A', 'S'];
const S = { token: localStorage.getItem('ah_token'), me: null, cfg: null, world: null, fix: null, srvPos: null, demo: false, follow: true, tab: 'map', markers: {}, gateMk: {}, zoneRects: {}, bcMk: {}, hornMk: {}, target: null, dir: null, lastSent: 0, lastSentPos: null, mute: localStorage.getItem('ah_mute') === '1', sound: null, sheet: null, speed: 0, softCap: false, fightOpen: false, trail: null };
const DEMO_DEFAULT = { lat: 28.6129, lng: 77.2295 };   // India Gate, New Delhi — neutral demo start
let map, meMk, ring, targetMk, gpsWatch = null, posBusy = false, demoTimer = null;
// ---------- util ----------
const fmtD = m => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(1) + ' km';
const fmtT = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const dist = (a, b) => { const t = Math.PI / 180, R = 6371000, dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(s))); };
function toast(msg, kind = '', ms = 3200) { const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = msg; $('#toasts').appendChild(el); setTimeout(() => el.remove(), ms); }
async function api(method, body = {}) {
  let r; try { r = await fetch((window.AH_API || '') + '/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ah': '1', ...(S.token ? { authorization: 'Bearer ' + S.token } : {}) }, body: JSON.stringify(body) }); } catch (e) { throw new Error('No connection — check your internet'); }
  let j = {}; try { j = await r.json(); } catch { } if (!j.ok) { const err = new Error(j.error || 'Something went wrong'); err.status = r.status; err.data = j; if (r.status === 401 && S.token && method !== 'login') { logoutLocal(); } throw err; } return j;
}
const guard = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, 'bad'); return null; } };
// ---------- tiny synthesized sounds ----------
function beep(f = 440, d = 0.08, type = 'sine', vol = 0.05, when = 0) { if (S.mute) return; try { const c = S.sound || (S.sound = new (window.AudioContext || window.webkitAudioContext)()); const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.value = f; g.gain.value = vol; o.connect(g); g.connect(c.destination); const t = c.currentTime + when; o.start(t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.stop(t + d + 0.02); } catch { } }
const sfx = { hit: () => { beep(180, .09, 'square', .06); }, big: () => { beep(110, .16, 'sawtooth', .07); }, win: () => { [523, 659, 784, 1047].forEach((f, i) => beep(f, .16, 'triangle', .06, i * .1)); }, lose: () => { [300, 220, 160].forEach((f, i) => beep(f, .2, 'sawtooth', .05, i * .12)); }, tap: () => beep(660, .04, 'sine', .03), gate: () => { [200, 300, 450].forEach((f, i) => beep(f, .2, 'sine', .06, i * .1)); } };
// ---------- auth ----------
function showAuth() { $('#main').hidden = true; $('#auth').hidden = false; }
function logoutLocal() { S.token = null; localStorage.removeItem('ah_token'); S.me = null; stopAll(); showAuth(); }
function stopAll() { if (gpsWatch != null) { navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; } clearInterval(demoTimer); demoTimer = null; $('#overlay').hidden = true; $('#panel').hidden = true; $('#sheet').hidden = true; }
let authMode = 'login';
function setAuthMode(m) { authMode = m; $('#tabLogin').classList.toggle('on', m === 'login'); $('#tabSignup').classList.toggle('on', m === 'signup'); $('#auGo').textContent = m === 'login' ? 'Log in' : 'Create hunter'; $('#auPass').autocomplete = m === 'login' ? 'current-password' : 'new-password'; $('#auErr').textContent = ''; }
async function doAuth() {
  $('#auErr').textContent = ''; const body = { username: $('#auUser').value.trim(), password: $('#auPass').value, tz: -new Date().getTimezoneOffset(), app: window.AH_ANDROID ? 'android' : 'web', device: navigator.userAgent.slice(0, 100) };
  $('#auGo').disabled = true; try { const j = await api(authMode, body); S.token = j.token; localStorage.setItem('ah_token', j.token); await boot(); } catch (e) { $('#auErr').textContent = e.message; } finally { $('#auGo').disabled = false; }
}
// ---------- boot ----------
async function boot() {
  try { S.cfg = S.cfg || await api('config'); } catch (e) { toast(e.message, 'bad'); }
  if (!S.token) return showAuth();
  let m; try { m = await api('me', { tz: -new Date().getTimezoneOffset() }); } catch (e) { if (e.status === 401) return showAuth(); toast(e.message, 'bad'); return; }
  S.me = m; $('#auth').hidden = true; $('#main').hidden = false; initMap(); renderHud(); startGPS();
  const w = await api('world').catch(() => null); if (w && w.world) applyWorld(w.world); else if (!S.demo) { /* wait for gps */ }
  if (!m.me.safeAck) safeNotice(true); const bc = new URLSearchParams(location.search).get('beacon'); if (bc) { history.replaceState({}, '', location.pathname); beacon(bc); }
  if (m.announcements && m.announcements.length) { const a = m.announcements[0]; const seen = localStorage.getItem('ah_ann'); if (String(a.id) !== seen) { localStorage.setItem('ah_ann', String(a.id)); toast('📣 ' + a.title + (a.body ? ' — ' + a.body : ''), '', 6000); } }
}
async function refreshMe() { const m = await api('me', { tz: -new Date().getTimezoneOffset() }); S.me = m; renderHud(); if (S.tab !== 'map') renderPanel(); return m; }
function renderHud() {
  const m = S.me.me, ph = S.me.phase; $('#hLvl').textContent = m.level; $('#hName').textContent = m.username; $('#hRank').textContent = m.rank; $('#hRank').style.setProperty('--c', RC[Math.min(5, 'EDCBAS'.indexOf(m.rank))]);
  $('#hEss').textContent = '✦ ' + m.essence; $('#hXp').style.width = Math.min(100, 100 * (m.xp - m.xpCur) / (m.xpNext - m.xpCur)) + '%';
  const chips = []; chips.push(`<span class="pill ${ph.night ? '' : 'warn'}">${ph.phase === 'night' ? '🌙 Night — stronger shadows' : ph.phase === 'day' ? '☀ Day — weaker shadows' : ph.phase === 'dusk' ? '🌆 Dusk' : '🌅 Dawn'}</span>`);
  for (const e of (S.me.events || [])) chips.push(`<span class="pill ok" title="${esc(e.descr)}">✨ ${esc(e.name)}</span>`);
  chips.push(S.demo ? '<span class="pill warn">DEMO walking</span>' : S.fix ? `<span class="pill ${S.fix.acc > 60 ? 'warn' : 'ok'}">GPS ±${Math.round(S.fix.acc)} m</span>` : '<span class="pill bad">Waiting for GPS…</span>');
  if (S.softCap) chips.push(`<span class="pill warn">🚶 ${(m.todayWalk / 1000).toFixed(1)} km today — take a break?</span>`);
  if (S.speed > 3.2) chips.push('<span class="pill bad">Moving fast? Don’t play while driving or riding.</span>');
  if (S.lockedUntil && S.lockedUntil > Date.now()) chips.push(`<span class="pill bad">Cooldown ${fmtT(S.lockedUntil - Date.now())}</span>`);
  $('#chips').innerHTML = chips.join('');
}
function safeNotice(first) {
  const L = (S.cfg && S.cfg.safe) || [];
  openSheet(`<h2>🛡 Play safe</h2><div class="notice">${L.map(x => '<div>• ' + esc(x) + '</div>').join('')}</div><div class="sm mut gap">AdiHunt never needs you on a road, a rail line, in water, or on private land. If a shadow is somewhere unsafe, skip it.</div><button class="btn full gap" data-act="safeOk">${first ? 'I understand — let’s hunt' : 'Got it'}</button>`);
}
// ---------- map ----------
function initMap() {
  if (map) return; const start = S.fix || DEMO_DEFAULT;
  map = L.map('map', { zoomControl: false, attributionControl: true, maxZoom: 19, minZoom: 4, tap: true }).setView([start.lat, start.lng], 17);
  const url = (S.cfg && S.cfg.tileUrl) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  L.tileLayer(url, { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', crossOrigin: true }).addTo(map);
  map.on('dragstart', () => { S.follow = false; $('#fCenter').classList.remove('on'); });
  map.on('click', e => { if (S.demo) { S.target = { lat: e.latlng.lat, lng: e.latlng.lng }; S.dir = null; if (targetMk) targetMk.setLatLng(e.latlng); else targetMk = L.marker(e.latlng, { icon: L.divIcon({ className: '', html: '<div style="font-size:22px;transform:translate(-50%,-100%)">📍</div>' }), interactive: false }).addTo(map); sfx.tap(); } });
}
function setFixMarker() {
  if (!map) return; const p = S.srvPos || S.fix; if (!p) return; const ll = [p.lat, p.lng];
  if (!meMk) { meMk = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-mk"></div>', iconSize: [0, 0] }), zIndexOffset: 1000, interactive: false }).addTo(map); ring = L.circle(ll, { radius: (S.cfg && S.cfg.engageRadius) || 40, color: '#a78bfa', weight: 1.5, fillColor: '#8b5cf6', fillOpacity: .12, dashArray: '5 5', interactive: false }).addTo(map); }
  else { meMk.setLatLng(ll); ring.setLatLng(ll); } if (S.follow) map.panTo(ll, { animate: true, duration: .6 });
}
function colorOf(r) { return RC[r]; }
function spawnIcon(s, near) { return L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="mk ${near ? 'near' : ''}" style="--c:${colorOf(s.r)};width:${46 + s.r * 4}px;height:${46 + s.r * 4}px"><div class="art">${AHArt.svg({ shape: s.shape, hue: s.hue, eyes: s.eyes, horns: s.horns, r: s.r, size: 80, label: s.name })}</div><div class="lv">${s.level}</div></div>` }); }
function applyWorld(w) {
  S.world = w; const p = w.at || S.srvPos || S.fix; if (p && w.at) { S.srvPos = w.at; setFixMarker(); }
  const radius = w.engageRadius || 40; if (ring) ring.setRadius(radius);
  const ids = new Set(w.spawns.map(s => s.id));
  for (const id of Object.keys(S.markers)) if (!ids.has(id)) { map.removeLayer(S.markers[id].m); delete S.markers[id]; }
  for (const s of w.spawns) { const near = s.dist <= radius; const cur = S.markers[s.id]; if (!cur) { const m = L.marker([s.lat, s.lng], { icon: spawnIcon(s, near), riseOnHover: true }).addTo(map); m.on('click', () => openSpawn(s.id)); S.markers[s.id] = { m, near, s }; } else { if (cur.near !== near) { cur.m.setIcon(spawnIcon(s, near)); cur.near = near; } cur.s = s; } }
  const gids = new Set(w.gates.map(g => g.id)); for (const id of Object.keys(S.gateMk)) if (!gids.has(id)) { map.removeLayer(S.gateMk[id]); delete S.gateMk[id]; }
  for (const g of w.gates) if (!S.gateMk[g.id]) { const m = L.marker([g.lat, g.lng], { icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="gate-mk" style="--c:${colorOf(g.rank)}"><span>${g.rankId}</span></div>` }) }).addTo(map); m.on('click', () => openGate(g.id)); S.gateMk[g.id] = m; S.gateMk[g.id].g = g; } else S.gateMk[g.id].g = g;
  const zids = new Set(w.zones.map(z => z.id)); for (const id of Object.keys(S.zoneRects)) if (!zids.has(id)) { map.removeLayer(S.zoneRects[id]); delete S.zoneRects[id]; }
  for (const z of w.zones) { const st = z.color ? { color: z.color, weight: 2, fillColor: z.color, fillOpacity: z.mine ? .3 : .22, dashArray: null } : { color: '#6d5bb0', weight: 1, fillColor: '#000', fillOpacity: 0, dashArray: '4 6' }; if (!S.zoneRects[z.id]) { S.zoneRects[z.id] = L.rectangle([[z.b[0], z.b[1]], [z.b[2], z.b[3]]], { ...st, interactive: false }).addTo(map); } else S.zoneRects[z.id].setStyle(st); S.zoneRects[z.id].z = z; }
  const bids = new Set(w.beacons.map(b => b.code)); for (const id of Object.keys(S.bcMk)) if (!bids.has(id)) { map.removeLayer(S.bcMk[id]); delete S.bcMk[id]; }
  for (const b of w.beacons) if (!S.bcMk[b.code]) { const m = L.marker([b.lat, b.lng], { icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<div class="bc-mk">💠</div>' }) }).addTo(map); m.on('click', () => openSheet(`<h2>💠 ${esc(b.name)}</h2><div class="mut sm">QR beacon · ${fmtD(b.dist)} away · reward ✦ ${b.reward}</div><button class="btn full gap" data-act="beaconCode" data-code="${esc(b.code)}">Check in</button>`)); S.bcMk[b.code] = m; }
  const hs = new Set(w.horns.map(h => h.code)); for (const id of Object.keys(S.hornMk)) if (!hs.has(id)) { map.removeLayer(S.hornMk[id]); delete S.hornMk[id]; }
  for (const h of w.horns) if (!S.hornMk[h.code]) { const m = L.marker([h.lat, h.lng], { icon: L.divIcon({ className: '', iconSize: [0, 0], html: '<div class="horn-mk">📯</div>' }) }).addTo(map); m.on('click', () => openSheet(`<h2>📯 ${esc(h.host)} blew the raid horn!</h2><div class="mut sm">${h.rank}-rank gate · ${fmtD(h.dist)} away. Get within 150 m of the gate to join.</div><button class="btn full gap" data-act="joinRaid" data-code="${esc(h.code)}">Join raid</button>`)); S.hornMk[h.code] = m; toast(`📯 ${h.host} is raiding a ${h.rank}-rank gate — join!`, '', 5000); }
  renderHud(); if (S.sheet && S.sheet.refresh) S.sheet.refresh();
}
setInterval(() => { // despawn locally when timers run out
  if (!S.world) return; const now = Date.now(); for (const id of Object.keys(S.markers)) if (S.markers[id].s.expires < now) { map.removeLayer(S.markers[id].m); delete S.markers[id]; if (S.sheet && S.sheet.spawnId === id) closeSheet(); }
  if (S.sheet && S.sheet.tick) S.sheet.tick(); if (S.lockedUntil && S.lockedUntil > now) renderHud();
}, 1000);
// ---------- gps / demo ----------
function startGPS() {
  if (gpsWatch != null || !navigator.geolocation) { if (!navigator.geolocation) renderHud(); return; }
  gpsWatch = navigator.geolocation.watchPosition(p => { S.realFix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy || 20, t: Date.now() }; if (S.demo) return; onFix(p.coords.latitude, p.coords.longitude, p.coords.accuracy || 20, p.coords.speed); }, err => { if (!S.demo) { $('#chips').innerHTML = '<span class="pill bad">GPS unavailable — enable location, or try Demo 🚶</span>'; toast('Location: ' + (err.code === 1 ? 'permission denied — allow location or use Demo mode' : 'cannot get a GPS fix'), 'bad', 5000); } }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}
function onFix(lat, lng, acc, speed) { S.fix = { lat, lng, acc, t: Date.now() }; if (speed != null && isFinite(speed)) S.speed = speed; if (!S.srvPos && map) { map.setView([lat, lng], 17); } sendPos(); }
async function sendPos(force) {
  if (!S.fix || posBusy || !S.token) return; const now = Date.now(); const moved = S.lastSentPos ? dist(S.lastSentPos, S.fix) : 999;
  if (!force && moved < 2.5 && now - S.lastSent < 8000) return; if (now - S.lastSent < 1000) return;
  posBusy = true; S.lastSent = now; S.lastSentPos = { lat: S.fix.lat, lng: S.fix.lng };
  try {
    const r = await api('pos', { lat: S.fix.lat, lng: S.fix.lng, acc: S.fix.acc, demo: S.demo ? 1 : 0 });
    S.lockedUntil = r.lockedUntil || null; S.softCap = !!r.softCap;
    if (r.accepted) { if (r.relocated) toast('Welcome to a new area — 5 minute arrival cooldown before you can engage.', 'warn', 5000); applyWorld(r.world); if (r.ach && r.ach.length) r.ach.forEach(a => toast('🏅 ' + a.name, 'ok')); if (S.me) S.me.me.todayWalk = r.dayWalk; }
    else if (r.reason === 'too_fast') { toast(r.message || 'Movement too fast — ignored', 'bad', 4500); if (r.pos && r.pos.lat != null) { S.srvPos = r.pos; setFixMarker(); } if (S.demo) { S.fix.lat = r.pos.lat; S.fix.lng = r.pos.lng; S.target = null; } renderHud(); }
  } catch (e) { if (e.status !== 401) toast(e.message, 'bad'); } finally { posBusy = false; }
}
function demoMove(dt) {
  if (!S.fix) return; const speed = 6; let d = { x: 0, y: 0 };
  if (S.dir) { d = { n: { x: 0, y: 1 }, s: { x: 0, y: -1 }, e: { x: 1, y: 0 }, w: { x: -1, y: 0 } }[S.dir] || d; }
  else if (S.target) { const dd = dist(S.fix, S.target); if (dd < 3) { S.target = null; if (targetMk) { map.removeLayer(targetMk); targetMk = null; } return; } const k = Math.min(1, speed * dt / dd); S.fix.lat += (S.target.lat - S.fix.lat) * k; S.fix.lng += (S.target.lng - S.fix.lng) * k; S.speed = speed; sendPos(true); return; }
  if (!d.x && !d.y) { S.speed = 0; return; } const m = speed * dt; S.fix.lat += d.y * m / 111320; S.fix.lng += d.x * m / (111320 * Math.cos(S.fix.lat * Math.PI / 180)); S.speed = speed; sendPos(true);
}
async function setDemo(on) {
  if (on && S.cfg && !S.cfg.demoAllowed) return toast('Demo mode is switched off by the admin', 'bad');
  S.demo = on; $('#fDemo').classList.toggle('on', on); $('#dpad').hidden = !on; clearInterval(demoTimer); demoTimer = null;
  if (on) { if (!S.fix) { S.fix = S.srvPos ? { ...S.srvPos, acc: 5 } : { ...DEMO_DEFAULT, acc: 5 }; } else S.fix.acc = Math.min(S.fix.acc, 5); S.speed = 0; if (map) map.setView([S.fix.lat, S.fix.lng], 17); S.follow = true; toast('Demo mode: hold the arrows or tap the map to walk. Rewards are reduced.', '', 4500); demoTimer = setInterval(() => demoMove(1.2), 1200); sendPos(true); }
  else { S.target = null; S.dir = null; if (targetMk) { map.removeLayer(targetMk); targetMk = null; } S.fix = S.realFix ? { ...S.realFix } : null; S.speed = 0; toast('Back to real GPS'); if (S.fix) sendPos(true); }
  renderHud();
}
// ---------- sheets / panels ----------
function openSheet(html, hooks) { const sh = $('#sheet'); sh.innerHTML = html; sh.hidden = false; S.sheet = hooks || {}; }
function closeSheet() { $('#sheet').hidden = true; S.sheet = null; }
function openSpawn(id) {
  const rend = () => { const c = S.markers[id]; if (!c) return closeSheet(); const s = c.s, rad = (S.world && S.world.engageRadius) || 40; const near = s.dist <= rad;
    $('#sheet').innerHTML = `<div class="row"><div style="width:84px;flex:none">${AHArt.svg({ shape: s.shape, hue: s.hue, eyes: s.eyes, horns: s.horns, r: s.r, size: 84 })}</div><div class="t sp"><h2>${esc(s.name)}</h2><span class="badge" style="--c:${colorOf(s.r)}">${RID[s.r]} · ${RN[s.r]}</span> <span class="mut sm">Lv ${s.level}</span><div class="mut sm gap">${s.phase === 'night' ? '🌙 night-born' : s.phase === 'day' ? '☀ day-born' : '🌆 twilight'} · fades in <b id="spT">${fmtT(s.expires - Date.now())}</b></div></div></div>
    <div class="row gap"><div class="sp">${near ? '<span class="pill ok">In range — ready!</span>' : `<span class="pill warn">${fmtD(s.dist)} away — need ≤ ${rad} m</span>`}</div></div>
    <button class="btn full gap" data-act="engage" data-id="${esc(id)}" ${near ? '' : 'disabled'}>${near ? '⚔ Engage' : 'Walk closer to engage'}</button>`; };
  openSheet('', { spawnId: id, refresh: rend, tick: () => { const c = S.markers[id]; const e = $('#spT'); if (e && c) e.textContent = fmtT(c.s.expires - Date.now()); } }); rend();
}
function closeOverlay() { $('#overlay').hidden = true; $('#overlay').innerHTML = ''; S.fightOpen = false; }
function switchTab(t) { S.tab = t; $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t)); closeSheet(); if (t === 'map') { $('#panel').hidden = true; setTimeout(() => map && map.invalidateSize(), 50); } else { $('#panel').hidden = false; renderPanel(); } }
async function renderPanel() { const p = $('#panel'); const t = S.tab; const fn = { legion: pLegion, quests: pQuests, guild: pGuild, ranks: pRanks, me: pMe }[t]; if (!fn) return; const keep = p.scrollTop; try { p.innerHTML = await fn(); } catch (e) { p.innerHTML = `<div class="err">${esc(e.message)}</div>`; } p.scrollTop = keep; }
const shadowCard = (s) => `<div class="sc" style="--c:${colorOf(s.r)}" data-act="shadow" data-id="${s.id}"><span class="rb">${s.rarity}</span>${s.fav ? '<span class="fv">★</span>' : ''}${AHArt.svg({ shape: s.shape, hue: s.hue, eyes: s.eyes, horns: s.horns, r: s.r, size: 78 })}<div class="n">${esc(s.nick || s.name)}</div><div class="m">Lv ${s.level}${s.stage > 1 ? ' · ★' + s.stage : ''} · ⚡${s.power}</div></div>`;

// ---------- panels ----------
async function pLegion() {
  const [a, inv] = await Promise.all([api('army'), api('inventory')]); S.army = a.army;
  const pl = a.player; const eq = inv.relics.filter(r => r.equipped);
  return `<h2>Your Legion</h2><div class="kv"><div><b>${a.army.length}</b><span>shadows</span></div><div><b>⚡${a.legionPower}</b><span>top-5 power</span></div><div><b>✦ ${inv.essence}</b><span>essence</span></div></div>
  <div class="card gap"><div class="row"><b>Hunter stats</b><span class="sp"></span><span class="mut sm">HP ${pl.hp} · ATK ${pl.atk} · DEF ${pl.def} · Luck ${Math.round(pl.luck * 100)}%</span></div></div>
  <div class="card gap"><div class="row"><h3 class="sp">Relics &amp; crafting</h3><span class="mut sm">💎 ${inv.shards} shards</span></div>${inv.relics.length ? inv.relics.map(r => `<div class="li" style="margin:8px 0 0"><div class="t"><b>${esc(r.name)}</b><span class="mut sm">${r.slot} · ${Object.entries(r.bonus).map(([k, v]) => '+' + v + (k === 'luck' ? '% luck' : ' ' + k)).join(', ')}</span></div><button class="btn sm ${r.equipped ? 'sec' : ''}" data-act="equip" data-id="${r.id}" data-off="${r.equipped ? 1 : 0}">${r.equipped ? 'Unequip' : 'Equip'}</button></div>`).join('') : '<div class="mut sm gap">No relics yet. Dungeons and rare shadows drop relic shards.</div>'}
  <button class="btn full gap" data-act="craft" ${inv.shards >= inv.cost.shards && inv.essence >= inv.cost.essence ? '' : 'disabled'}>Craft relic · ${inv.cost.shards} 💎 + ${inv.cost.essence} ✦</button></div>
  <h3 class="gap" style="margin-top:14px">Shadows (${a.army.length})</h3>${a.army.length ? `<div class="grid">${a.army.map(shadowCard).join('')}</div>` : '<div class="card c mut">Your Legion is empty. Walk to a shadow on the map, defeat it, and extract it.</div>'}`;
}
function shadowSheet(id) {
  const s = (S.army || []).find(x => x.id === id); if (!s) return;
  openSheet(`<div class="row"><div style="width:96px;flex:none">${AHArt.svg({ shape: s.shape, hue: s.hue, eyes: s.eyes, horns: s.horns, r: s.r, size: 96 })}</div><div class="sp"><h2>${esc(s.nick || s.name)}</h2><div class="mut sm">${esc(s.name)} · ${esc(s.ab)}</div><span class="badge" style="--c:${colorOf(s.r)}">${s.rarity} · ${RN[s.r]}</span> <span class="mut sm">Lv ${s.level}/${s.maxLevel} · stage ${s.stage}</span></div></div>
  <div class="kv gap"><div><b>${s.stats.hp}</b><span>HP</span></div><div><b>${s.stats.atk}</b><span>ATK</span></div><div><b>${s.stats.def}</b><span>DEF</span></div></div>
  <div class="row gap"><button class="btn sp" data-act="lvl" data-id="${s.id}" ${s.levelCost ? '' : 'disabled'}>${s.levelCost ? 'Level up · ' + s.levelCost + ' ✦' : s.stage < 3 ? 'Evolve to raise cap' : 'Max level'}</button><button class="btn sp ${s.canEvolve ? '' : 'sec'}" data-act="evolve" data-id="${s.id}" ${s.canEvolve ? '' : 'disabled'}>Evolve${s.evolveCost ? ' · ' + s.evolveCost + ' ✦' : ''}</button></div>
  <div class="row gap"><button class="btn sec sm" data-act="fav" data-id="${s.id}">${s.fav ? '★ Unfavourite' : '☆ Favourite'}</button><button class="btn sec sm" data-act="rename" data-id="${s.id}">Rename</button><span class="sp"></span><button class="btn bad sm" data-act="release" data-id="${s.id}">Release +${s.value} ✦</button></div>${s.traded ? '<div class="mut sm gap">Traded shadow</div>' : ''}<button class="btn sec full gap" data-act="closeSheet">Close</button>`);
}
async function pQuests() {
  const m = await refreshMeQuiet(); const q = m.quests, me = m.me; const done = q.filter(x => x.done).length;
  const tr = await api('territories').catch(() => ({ mine: [], board: [], total: 0 }));
  return `<h2>Daily Quests</h2><div class="card"><div class="row"><div style="font-size:30px">🔥</div><div class="sp"><b>${me.streak}-day streak</b><div class="mut sm">Best ${me.bestStreak} · finish any quest daily to keep it</div></div><span class="pill">${done}/3 done</span></div><div class="strip gap">${m.strip.map(d => `<i class="${d.done ? 'on' : ''}" title="${d.day}"></i>`).join('')}</div></div>
  <div class="gap">${q.map(x => `<div class="q ${x.done ? 'done' : ''}"><div class="row"><b class="sp">${esc(x.title)}</b><span class="mut sm">+${x.xp} XP · +${x.essence} ✦</span></div><div class="bar gap"><i style="width:${100 * x.progress / x.target}%"></i></div><div class="row gap"><span class="mut sm">${x.progress}/${x.target}</span><span class="sp"></span>${x.claimed ? '<span class="pill ok">Claimed</span>' : `<button class="btn sm" data-act="claim" data-id="${x.id}" ${x.done ? '' : 'disabled'}>Claim</button>`}</div></div>`).join('')}</div>
  <div class="card gap"><div class="row"><div style="width:60px">${m.bounty.shape ? AHArt.svg({ shape: m.bounty.shape, hue: m.bounty.hue, r: 2, size: 60 }) : ''}</div><div class="sp"><h3>Shadow Hunt of the Day</h3><b>${esc(m.bounty.name)}</b><div class="mut sm">${m.bounty.done ? '✔ Done today' : 'Extract it for double XP &amp; essence'}</div></div></div></div>
  <div class="card gap"><h3>QR Beacon check-in</h3><div class="mut sm">Shops and events can display a beacon code or QR. Enter it for a daily essence bonus.</div><div class="row gap"><input id="bcIn" placeholder="Beacon code" maxlength="24" autocapitalize="characters"><button class="btn" data-act="beaconGo">Check in</button></div>${'BarcodeDetector' in window ? '<button class="btn sec full gap" data-act="scan">📷 Scan QR</button>' : ''}</div>
  <div class="card gap"><h3>Territory (this week)</h3><div class="mut sm">You hold ${tr.mine.length} zone${tr.mine.length === 1 ? '' : 's'}. Zones decay ${tr.decayPerDay}%/day and reset every Monday.</div>${tr.board.map((b, i) => `<div class="row sm gap"><span class="rk">${i + 1}</span><span class="sp">${esc(b.name)}</span><b>${b.zones} zones</b></div>`).join('') || '<div class="mut sm gap">No zones claimed yet — stand in a zone and challenge its guardian.</div>'}</div>
  <h3 class="gap" style="margin-top:14px">Achievements (${m.achievements.filter(a => a.at).length}/${m.achievements.length})</h3>${m.achievements.map(a => `<div class="li" style="opacity:${a.at ? 1 : .5}"><div style="font-size:22px">${a.at ? '🏅' : '🔒'}</div><div class="t"><b>${esc(a.name)}</b><span class="mut sm">${esc(a.desc)}</span></div></div>`).join('')}`;
}
async function refreshMeQuiet() { const m = await api('me', { tz: -new Date().getTimezoneOffset() }); S.me = m; renderHud(); return m; }
async function pGuild() {
  const g = await api('guild_info');
  if (!g.guild) { const l = await api('guild_list', {}); return `<h2>Hunter Guilds</h2><div class="mut sm">Join forces: every member chips away at a weekly guild boss, and guild-coloured zones show your banner on the map.</div>
  <div class="card gap"><h3>Found a guild (hunter level 3+)</h3><div class="fld"><input id="gnName" placeholder="Guild name" maxlength="24"></div><div class="row"><input id="gnTag" placeholder="TAG" maxlength="4" style="width:90px;text-transform:uppercase"><button class="btn sp" data-act="gCreate">Create guild</button></div></div>
  <h3 class="gap" style="margin-top:14px">Open guilds</h3>${l.guilds.map(x => `<div class="li"><span class="badge" style="--c:${x.color}">${esc(x.tag)}</span><div class="t"><b>${esc(x.name)}</b><span class="mut sm">${x.members} members · led by ${esc(x.leader || '?')}</span></div><button class="btn sm" data-act="gJoin" data-id="${x.id}" ${x.full ? 'disabled' : ''}>Join</button></div>`).join('') || '<div class="mut sm">No guilds yet — be the first.</div>'}`; }
  const b = g.boss;
  return `<div class="row"><span class="badge" style="--c:${g.guild.color}">${esc(g.guild.tag)}</span><h2 class="sp" style="margin:0">${esc(g.guild.name)}</h2><button class="btn sec sm" data-act="gLeave">Leave</button></div>
  <div class="card gap c"><h3>Weekly Guild Boss</h3><div class="stage"><div style="width:130px;height:130px">${AHArt.svg({ shape: b.shape, hue: b.hue, eyes: b.eyes, horns: b.horns, r: 4, size: 130 })}</div></div><b>${esc(b.name)}</b> <span class="mut sm">Lv ${b.level}</span>
  <div class="bar hp gap"><i style="width:${100 * b.hp / b.max}%"></i></div><div class="mut sm">${b.hp.toLocaleString()} / ${b.max.toLocaleString()} HP${b.defeated ? ' — DEFEATED' : ''}</div>
  <div class="row gap"><button class="btn sp" data-act="gAttack" ${b.defeated || !g.attacksLeft ? 'disabled' : ''}>⚔ Attack (${g.attacksLeft} left today)</button>${g.canClaim ? '<button class="btn sp" data-act="gClaim">🎁 Claim reward</button>' : ''}</div></div>
  <h3 class="gap" style="margin-top:14px">Members — damage this week</h3>${g.members.map((m, i) => `<div class="li ${m.me ? 'me' : ''}"><span class="rk">${i + 1}</span><div class="t"><b>${esc(m.username)}${m.id === g.guild.leader ? ' 👑' : ''}</b><span class="mut sm">Lv ${m.level}</span></div><b>${m.dmg.toLocaleString()}</b></div>`).join('')}`;
}
async function pRanks() {
  const scope = S.rankScope || 'global'; const r = await api('leaderboard', { scope });
  const seg = `<div class="seg">${[['global', 'Global'], ['weekly', 'This week'], ['guilds', 'Guilds']].map(([k, n]) => `<button data-act="rankScope" data-k="${k}" class="${scope === k ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  if (scope === 'guilds') return `<h2>Leaderboards</h2>${seg}${r.rows.map(x => `<div class="li ${x.mine ? 'me' : ''}"><span class="rk">${x.rank}</span><span class="badge" style="--c:${x.color}">${esc(x.tag)}</span><div class="t"><b>${esc(x.name)}</b><span class="mut sm">${x.members} members · ${x.zones} zones</span></div><b>${x.dmg.toLocaleString()}</b></div>`).join('') || '<div class="mut">No guilds yet.</div>'}`;
  return `<h2>Leaderboards</h2>${seg}<div class="mut sm" style="margin-bottom:8px">${scope === 'weekly' ? 'Weekly XP — resets every Monday.' : 'All-time XP.'}${r.me && r.me.pos ? ' You are #' + r.me.pos + '.' : ''}</div>${r.rows.map(x => `<div class="li ${x.me ? 'me' : ''}"><span class="rk">${x.rank}</span><div class="lvl" style="width:34px;height:34px;font-size:13px">${x.level}</div><div class="t"><b>${esc(x.username)}</b><span class="mut sm">${x.rankId}-rank${x.caught != null ? ' · ' + x.caught + ' shadows' : ''}</span></div><b>${x.score.toLocaleString()}</b></div>`).join('') || '<div class="mut">Nobody here yet — go hunt!</div>'}`;
}
async function pMe() {
  const m = S.me.me; const [fr, tr] = await Promise.all([api('friend_list'), api('trade_list')]);
  const pend = tr.trades.filter(t => t.status === 'pending' && t.incoming);
  return `<h2>${esc(m.username)}</h2><div class="row"><span class="badge" style="--c:${RC[Math.min(5, 'EDCBAS'.indexOf(m.rank))]}">${m.rankTitle}</span><span class="mut sm">Level ${m.level} · ${m.xp} XP</span></div>
  <div class="kv gap"><div><b>${m.caught}</b><span>shadows</span></div><div><b>${(m.walked / 1000).toFixed(1)} km</b><span>walked</span></div><div><b>${m.gates}</b><span>gates</span></div><div><b>${m.wins}</b><span>fights won</span></div><div><b>${m.zones}</b><span>zones claimed</span></div><div><b>${m.streak}</b><span>day streak</span></div></div>
  <div class="card gap"><h3>Friends &amp; trading</h3><div class="row"><div class="sp mut sm">Your friend code</div><b style="letter-spacing:.12em">${esc(m.friendCode)}</b><button class="btn sec sm" data-act="copyCode">Copy</button></div><div class="row gap"><input id="frCode" placeholder="Friend’s code" maxlength="8" autocapitalize="characters"><button class="btn" data-act="addFriend">Add</button></div>
  ${pend.map(t => `<div class="li gap"><div class="t"><b>${esc(t.from)} offers ${esc(t.give ? t.give.name : '?')} Lv${t.give ? t.give.level : '?'}</b><span class="mut sm">${t.want ? 'for your ' + esc(t.want.name) + ' Lv' + t.want.level : 'a gift'}</span></div><button class="btn sm" data-act="tradeYes" data-id="${t.id}">Accept</button><button class="btn sec sm" data-act="tradeNo" data-id="${t.id}">No</button></div>`).join('')}
  ${fr.friends.map(f => `<div class="li gap"><div class="lvl" style="width:34px;height:34px;font-size:13px">${f.level}</div><div class="t"><b>${esc(f.username)}</b><span class="mut sm">${f.nearby ? '📍 nearby' : f.dist != null ? fmtD(f.dist) + ' away' : 'location unknown'}</span></div><button class="btn sm ${f.nearby ? '' : 'sec'}" data-act="tradeWith" data-id="${f.id}" data-name="${esc(f.username)}" ${f.nearby ? '' : 'disabled'}>Trade / gift</button></div>`).join('') || '<div class="mut sm gap">No friends yet. Swap codes — you can trade and gift shadows when you stand within 120 m.</div>'}</div>
  <div class="card gap"><h3>Profile colour (your zones on the map)</h3><div class="swatches">${['#b46bff', '#ff4d6d', '#5aa9ff', '#6bd0a0', '#ffb347', '#ff7ad9', '#f2e55c', '#4de1d2'].map(c => `<button data-act="color" data-c="${c}" style="background:${c}" class="${m.color === c ? 'on' : ''}"></button>`).join('')}</div></div>
  <div class="card gap"><h3>Play safe</h3><div class="mut sm">Today: ${(m.todayWalk / 1000).toFixed(2)} km walked (reminder at ${S.me.softCapKm} km). Stay aware, stay off roads, respect private property.</div><button class="btn sec full gap" data-act="safe">Read the safety rules</button></div>
  <div class="card gap"><h3>Tools</h3><div class="row"><button class="btn sec sp" data-act="demo">${S.demo ? 'Stop demo walking' : '🚶 Demo / simulate walking'}</button><button class="btn sec sp" data-act="mute">${S.mute ? '🔇 Sound off' : '🔊 Sound on'}</button></div><div class="mut sm gap">Demo mode lets you test the game without GPS; rewards are reduced.</div><button class="btn sec full gap" data-act="logout">Log out</button></div>
  <div class="mut sm c gap">AdiHunt v${esc((S.cfg && S.cfg.version) || '')} · Map data © OpenStreetMap contributors</div>`;
}
// ---------- fights ----------
let fightCtl = null;
function enemyArt(e, size) { return AHArt.svg({ shape: e.shape, hue: e.hue, eyes: e.eyes, horns: e.horns, r: e.r, size, label: e.name }); }
function openFight(f, resumed) {
  closeSheet(); S.fightOpen = true; const ov = $('#overlay'); ov.hidden = false; let busy = false, last = f, cur = 0;
  const intents = { attack: ['Preparing to strike', ''], heavy: ['⚠ Winding up a HEAVY attack — guard!', 'heavy'], charge: ['Gathering darkness…', 'charge'] };
  const render = () => { const e = last.enemy, it = intents[last.intent] || intents.attack, canBind = last.ehp / last.emax <= 0.4;
    ov.innerHTML = `<div class="row"><span class="badge" style="--c:${colorOf(e.r)}">${e.rarity}</span><b class="sp">${esc(e.name)} <span class="mut sm">Lv ${e.level}</span></b><span class="mut sm">turn ${last.turn + 1}</span></div>
    <div class="stage"><div class="big" id="fArt" style="position:relative">${enemyArt(e, 210)}</div><div class="intent ${it[1]}">${it[0]}</div></div>
    <div class="bar hp gap"><i style="width:${100 * last.ehp / last.emax}%"></i></div><div class="mut sm c">${last.ehp}/${last.emax}${canBind ? ' · weak enough to BIND' : ''}</div>
    <div class="log">${last.log.slice(-4).map(l => '<div>' + esc(l) + '</div>').join('')}</div>
    <div class="row sm"><b class="sp">You</b><span class="mut">${last.php}/${last.pmax} HP</span></div><div class="bar hp me"><i style="width:${100 * last.php / last.pmax}%"></i></div>
    <div class="meter" id="meter"><i id="cursor"></i></div><div class="mut sm c" style="margin-top:-4px">Tap Strike when the marker is in the centre for bonus damage</div>
    <div class="acts gap"><button class="btn" data-fa="strike">⚔ Strike</button><button class="btn" data-fa="power">💥 Power (75%)</button><button class="btn sec" data-fa="guard">🛡 Guard</button><button class="btn ${canBind ? '' : 'sec'}" data-fa="bind" ${canBind ? '' : 'disabled'}>🕸 Bind</button></div><button class="btn sec full gap" data-fa="flee">Flee</button>`; };
  const tickMeter = () => { const c = $('#cursor'); if (!c || !S.fightOpen) return; const x = (Math.sin(performance.now() / 380) + 1) / 2; c.style.left = (x * 96 + 2) + '%'; cur = x; requestAnimationFrame(tickMeter); };
  ov.onclick = async (ev) => { const b = ev.target.closest('[data-fa]'); if (!b || busy) return; const action = b.dataset.fa; if (action === 'flee' && !confirm('Flee this fight?')) return; busy = true; const tb = action === 'strike' ? 1 - Math.abs(cur - 0.5) * 2 : 0;
    try { const j = await api('encounter_act', { id: f.id, action, tb: Math.max(0, tb) }); const prevE = last.ehp, prevP = last.php; last = j.fight; (action === 'power' || action === 'bind') ? sfx.big() : sfx.hit(); if (last.ehp < prevE) { const fa = $('#fArt'); if (fa) { fa.classList.add('hit'); const d = document.createElement('div'); d.className = 'dmg'; d.textContent = '-' + (prevE - last.ehp); d.style.left = '45%'; fa.appendChild(d); } } if (j.fight.status !== 'active') { finishFight(j, f); return; } const keepA = last.ehp < prevE; render(); const fa2 = $('#fArt'); if (fa2 && keepA) { fa2.classList.add('flash'); } if (last.php < prevP) ov.classList.add('hit'), setTimeout(() => ov.classList.remove('hit'), 350); requestAnimationFrame(tickMeter); }
    catch (e) { toast(e.message, 'bad'); if (e.status === 410 || e.status === 404) { closeOverlay(); } } finally { busy = false; } };
  render(); requestAnimationFrame(tickMeter); if (resumed) toast('Resumed your fight');
}
function levelUpToast(l) { if (l) { toast(`⬆ Level ${l.to}!${l.newRank ? ' New rank: ' + l.rank + '-Rank Hunter' : ''}`, 'ok', 5000); sfx.win(); } }
async function finishFight(j, f) {
  const ov = $('#overlay'), r = j.result || { outcome: j.fight.status }, e = j.fight.enemy; const won = ['won', 'captured'].includes(j.fight.status);
  if (won) sfx.win(); else sfx.lose();
  let body;
  if (j.fight.status === 'fled') body = '<h2>You retreated</h2><div class="mut">The shadow lingers…</div>';
  else if (j.fight.status === 'lost') body = '<h2>Defeated 💀</h2><div class="mut">You were knocked out. Level up your Legion and try again — the shadow is still there.</div>';
  else if (f.kind === 'zone' || r.outcome === 'claimed' || r.outcome === 'reinforced') body = `<h2>${r.outcome === 'reinforced' ? 'Zone reinforced 🛡' : 'Zone claimed ⚑'}</h2><div class="mut">The guardian falls. This zone now flies your colours until it decays or someone takes it.</div><div class="card"><b>+${r.xp} XP</b> · <b>+${r.essence} ✦</b>${r.shards ? ' · +' + r.shards + ' 💎' : ''}</div>`;
  else body = `<h2>${r.outcome === 'extracted' ? 'Shadow extracted!' : 'Victory'}</h2>${r.shadow ? `<div class="pop" style="width:150px;margin:6px auto">${AHArt.svg({ shape: r.shadow.shape, hue: r.shadow.hue, eyes: r.shadow.eyes, horns: r.shadow.horns, r: r.shadow.r, size: 150 })}</div><b>${esc(r.shadow.name)}</b> <span class="badge" style="--c:${colorOf(r.shadow.r)}">${r.shadow.rarity}</span><div class="mut sm">joins your Legion · Lv ${r.shadow.level}</div>` : '<div class="mut">The shadow dissolved before you could extract it.</div>'}<div class="card"><b>+${r.xp} XP</b> · <b>+${r.essence} ✦</b>${r.shards ? ' · +' + r.shards + ' 💎' : ''}${r.bounty ? '<div class="sm" style="color:#fbbf24">★ Hunt of the Day bonus ×2</div>' : ''}</div>`;
  ov.onclick = null; ov.innerHTML = `<div class="res" style="padding-top:12vh">${body}<button class="btn full gap" id="fDone">Continue</button></div>`; $('#fDone').onclick = async () => { closeOverlay(); await refreshMe().catch(() => { }); sendPos(true); }; if (r.levelUp) levelUpToast(r.levelUp); (r.ach || []).forEach(a => toast('🏅 ' + a.name, 'ok'));
}
async function engage(id) { const j = await guard(() => api('encounter_start', { spawnId: id })); if (j) openFight(j.fight, j.resumed); }

// ---------- gates / dungeons ----------
function openGate(id) {
  const m = S.gateMk[id]; if (!m) return; const rend = () => { const cur = S.gateMk[id]; if (!cur) return closeSheet(); const g = cur.g; const near = g.dist <= 60;
    $('#sheet').innerHTML = `<div class="row"><div class="gate-mk" style="position:relative;transform:none;--c:${colorOf(g.rank)};flex:none"><span>${g.rankId}</span></div><div class="sp"><h2>${g.rankId}-Rank Dungeon Gate</h2><div class="mut sm">4 waves + boss · timed · solo or co-op raid (up to 4)</div><div class="mut sm">closes in <b id="gT">${fmtT(g.expires - Date.now())}</b> · ${fmtD(g.dist)} away</div></div></div>
    <button class="btn full gap" data-act="enterGate" data-id="${esc(id)}" ${near ? '' : 'disabled'}>${near ? '🌀 Enter the gate' : 'Walk up to the gate (≤ 60 m)'}</button>
    <div class="row gap"><input id="raidCode" placeholder="Raid code from a friend" maxlength="8" style="text-transform:uppercase"><button class="btn sec" data-act="joinRaidInput">Join raid</button></div>`; };
  openSheet('', { refresh: rend, tick: () => { const e = $('#gT'), c = S.gateMk[id]; if (e && c) e.textContent = fmtT(c.g.expires - Date.now()); } }); rend();
}
function openGateList() { const gs = (S.world && S.world.gates) || []; if (!gs.length) return openSheet('<h2>🌀 Dungeon Gates</h2><div class="mut">No gates within 2.5 km right now. Gates open for a few hours in random places — keep exploring. Friends can also invite you to a raid with a horn 📯.</div><div class="row gap"><input id="raidCode" placeholder="Raid code" maxlength="8" style="text-transform:uppercase"><button class="btn sec" data-act="joinRaidInput">Join raid</button></div>'); openSheet(`<h2>🌀 Dungeon Gates nearby</h2>${gs.sort((a, b) => a.dist - b.dist).slice(0, 8).map(g => `<div class="li" data-act="gateFocus" data-id="${g.id}"><div class="gate-mk" style="position:relative;transform:none;width:38px;height:38px;font-size:13px;--c:${colorOf(g.rank)}"><span>${g.rankId}</span></div><div class="t"><b>${g.rankId}-rank gate</b><span class="mut sm">${fmtD(g.dist)} · closes in ${fmtT(g.expires - Date.now())}</span></div><span>›</span></div>`).join('')}`); }
let dunPoll = null;
function openDungeon(run) {
  closeSheet(); S.fightOpen = true; const ov = $('#overlay'); ov.hidden = false; let cur = run, busy = false, meter = 0; const id = run.id; sfx.gate();
  const render = () => { const r = cur, alive = r.enemies.filter(e => e.hp > 0), me = r.members.find(m => m.me) || { hp: 0, max: 1 };
    if (r.status === 'cleared') { const rw = r.reward; ov.innerHTML = `<div class="res" style="padding-top:8vh"><h2>🌀 Gate cleared!</h2><div class="mut">The boss is down. ${r.members.length > 1 ? 'Your party shares the spoils.' : ''}</div>${rw ? `${rw.shadow ? `<div class="pop" style="width:140px;margin:8px auto">${AHArt.svg({ shape: rw.shadow.shape, hue: rw.shadow.hue, eyes: rw.shadow.eyes, horns: rw.shadow.horns, r: rw.shadow.r, size: 140 })}</div><b>${esc(rw.shadow.name)}</b> extracted!` : '<div class="mut">The boss shadow slipped away.</div>'}<div class="card"><b>+${rw.xp} XP</b> · <b>+${rw.essence} ✦</b> · <b>+${rw.shards} 💎</b></div>` : '<div class="card mut">Collecting rewards…</div>'}<button class="btn full gap" id="dDone">Continue</button></div>`; clearInterval(dunPoll); $('#dDone').onclick = () => { closeOverlay(); refreshMe().catch(() => { }); sendPos(true); }; if (rw && rw.levelUp) levelUpToast(rw.levelUp); sfx.win(); return; }
    if (r.status === 'failed') { ov.innerHTML = `<div class="res" style="padding-top:14vh"><h2>Gate lost 💀</h2><div class="mut">${cur.log.slice(-1)[0] || ''}</div><div class="mut sm gap">The gate is still open until it closes — you can try again.</div><button class="btn full gap" id="dDone">Back to map</button></div>`; clearInterval(dunPoll); $('#dDone').onclick = () => { closeOverlay(); }; sfx.lose(); return; }
    ov.innerHTML = `<div class="row"><span class="badge" style="--c:${colorOf(RID.indexOf(r.rank))}">${r.rank}</span><b class="sp">Dungeon · wave ${Math.min(r.wave + 1, r.waves)}/${r.waves}${r.wave === r.waves - 1 ? ' — BOSS' : ''}</b><span class="pill ${r.deadline - Date.now() < 120000 ? 'bad' : ''}" id="dTimer">⏱ ${fmtT(r.deadline - Date.now())}</span></div>
    <div class="enemy-row gap">${r.enemies.map(e => `<div class="en ${e.hp <= 0 ? 'dead' : ''}">${AHArt.svg({ shape: e.shape, hue: e.hue, eyes: 2, horns: e.boss ? 6 : 2, r: e.boss ? 5 : 2, size: e.boss ? 90 : 70 })}<div class="sm"><b>${esc(e.name)}</b>${e.boss ? ' 👑' : ''}</div><div class="bar hp"><i style="width:${100 * Math.max(0, e.hp) / e.max}%"></i></div><div class="mut sm">${Math.max(0, e.hp)}/${e.max}</div></div>`).join('')}</div>
    <div class="log gap">${r.log.slice(-5).map(l => '<div>' + esc(l) + '</div>').join('')}</div>
    <div class="card"><h3>Party</h3>${r.members.map(m => `<div class="row sm" style="margin-top:6px"><b style="width:90px;overflow:hidden;text-overflow:ellipsis">${esc(m.name)}${m.me ? ' (you)' : ''}</b><div class="bar hp me sp" style="${m.down ? 'opacity:.3' : ''}"><i style="width:${100 * m.hp / m.max}%"></i></div><span class="mut" style="width:46px;text-align:right">${m.hp}</span><span class="mut" style="width:52px;text-align:right">⚔${m.dmg}</span></div>`).join('')}${!r.started && r.host ? `<div class="row gap"><span class="pill">Raid code <b style="letter-spacing:.1em">${esc(r.code)}</b></span><button class="btn sec sm" data-da="horn">📯 Blow raid horn</button></div><div class="mut sm">Friends/guildmates nearby are alerted. They must stand within 150 m of the gate. The raid begins with your first move (party size is fixed then).</div>` : !r.started ? '<div class="mut sm gap">Waiting for the host to begin…</div>' : ''}</div>
    ${me.hp <= 0 ? '<div class="notice gap">You are down — your party fights on.</div>' : `<div class="meter" id="meter"><i id="cursor"></i></div><div class="acts"><button class="btn" data-da="strike">⚔ Strike</button><button class="btn" data-da="power">💥 Power</button><button class="btn sec" data-da="guard">🛡 Guard</button><button class="btn sec" data-da="leave">Leave</button></div>`}`; };
  const tm = () => { const c = $('#cursor'); if (c && S.fightOpen) { const x = (Math.sin(performance.now() / 380) + 1) / 2; c.style.left = (x * 96 + 2) + '%'; meter = x; } const t = $('#dTimer'); if (t) t.textContent = '⏱ ' + fmtT(cur.deadline - Date.now()); if (S.fightOpen && cur.status === 'active') requestAnimationFrame(tm); };
  ov.onclick = async (ev) => { const b = ev.target.closest('[data-da]'); if (!b || busy) return; const a = b.dataset.da; if (a === 'leave') { clearInterval(dunPoll); closeOverlay(); return; } busy = true;
    try { if (a === 'horn') { const j = await api('gate_horn', { id }); toast('📯 Horn sounded! Code ' + j.code, 'ok'); } else { const j = await api('dungeon_act', { id, action: a, tb: a === 'strike' ? 1 - Math.abs(meter - 0.5) * 2 : 0 }); cur = j.run; if (j.result) cur.reward = j.result; a === 'power' ? sfx.big() : sfx.hit(); render(); if (cur.status === 'active') requestAnimationFrame(tm); } } catch (e) { toast(e.message, 'bad'); } finally { busy = false; } };
  render(); requestAnimationFrame(tm); clearInterval(dunPoll); dunPoll = setInterval(async () => { if (!S.fightOpen || busy) return; try { const j = await api('dungeon_state', { id }); if (JSON.stringify(j.run.log) !== JSON.stringify(cur.log) || j.run.members.length !== cur.members.length || j.run.status !== cur.status) { cur = j.run; render(); requestAnimationFrame(tm); } } catch { } }, 3000);
}
// ---------- zones, beacons, trail ----------
function zoneHere() { const p = S.srvPos || S.fix; if (!p || !S.world) return null; const zs = S.world.zones; return zs.find(z => p.lat >= z.b[0] && p.lat < z.b[2] && p.lng >= z.b[1] && p.lng < z.b[3]) || null; }
function openZone() { const z = zoneHere(); if (!z) return toast('Waiting for GPS…'); const mine = z.mine, owned = !!z.owner;
  openSheet(`<h2>⚑ Territory zone</h2><div class="mut sm">${owned ? `Held by <b>${esc(z.owner)}</b>${mine ? ' (you)' : ''} · power ${Math.round(z.power)}% — decays daily, resets weekly` : 'Unclaimed zone'}</div><div class="card gap"><div class="sm">Defeat the zone guardian to ${mine ? 'reinforce (reset power to 100%)' : 'claim it'}. Stronger zones have tougher guardians.</div></div><button class="btn full gap" data-act="zoneGo">⚔ Challenge the guardian</button>`); }
async function beacon(code) { const j = await guard(() => api('beacon_checkin', { code })); if (j) { toast(`💠 ${j.name}: +${j.essence} ✦ +${j.xp} XP`, 'ok', 4500); levelUpToast(j.levelUp); (j.ach || []).forEach(a => toast('🏅 ' + a.name, 'ok')); await refreshMe().catch(() => { }); } }
async function scanQR() {
  try { const det = new BarcodeDetector({ formats: ['qr_code'] }); const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); const v = document.createElement('video'); v.srcObject = stream; v.setAttribute('playsinline', ''); await v.play();
    const box = document.createElement('div'); box.style.cssText = 'position:absolute;inset:0;z-index:900;background:#000;display:flex;flex-direction:column'; v.style.cssText = 'flex:1;object-fit:cover'; const x = document.createElement('button'); x.className = 'btn'; x.textContent = 'Cancel'; x.style.margin = '12px'; box.append(v, x); document.body.appendChild(box); let stop = false; const fin = () => { stop = true; stream.getTracks().forEach(t => t.stop()); box.remove(); }; x.onclick = fin;
    const loop = async () => { if (stop) return; try { const r = await det.detect(v); if (r.length) { const raw = r[0].rawValue || ''; const m = /beacon=([A-Za-z0-9_-]+)/.exec(raw) || [null, raw.trim()]; fin(); return beacon(m[1]); } } catch { } setTimeout(loop, 300); }; loop();
  } catch (e) { toast('Camera unavailable — type the beacon code instead', 'bad'); }
}
let ghost = null;
async function showTrail() { const j = await guard(() => api('trail')); if (!j) return; if (j.points.length < 2) return toast('Walk a bit first — your ghost trail records the last 24 hours.'); if (S.trail) { map.removeLayer(S.trail); S.trail = null; } if (ghost) { map.removeLayer(ghost); ghost = null; }
  const ll = j.points.map(p => [p[0], p[1]]); S.trail = L.polyline(ll, { color: '#c4b5fd', weight: 3, opacity: .7, dashArray: '2 6' }).addTo(map); map.fitBounds(S.trail.getBounds(), { padding: [40, 40], maxZoom: 18 }); S.follow = false;
  ghost = L.marker(ll[0], { icon: L.divIcon({ className: '', html: '<div style="font-size:26px;transform:translate(-50%,-50%);filter:drop-shadow(0 0 8px #a78bfa)">👻</div>', iconSize: [0, 0] }) }).addTo(map); let i = 0; const step = Math.max(1, Math.ceil(ll.length / 120)); toast('👻 Replaying your trail…'); const iv = setInterval(() => { i += step; if (i >= ll.length) { clearInterval(iv); setTimeout(() => { if (ghost) { map.removeLayer(ghost); ghost = null; } if (S.trail) { map.removeLayer(S.trail); S.trail = null; } }, 4000); return; } ghost.setLatLng(ll[i]); }, 70);
}
// ---------- trading ----------
async function tradeWith(fid, name) { const [a, fa] = await Promise.all([api('army'), api('friend_army', { id: fid }).catch(() => ({ army: [] }))]); const mine = a.army.filter(s => !s.fav);
  if (!mine.length) return toast('You have no shadows to trade (favourites are locked).', 'bad');
  openSheet(`<h2>Trade with ${esc(name)}</h2><div class="fld"><label>You give</label><select id="trGive">${mine.map(s => `<option value="${s.id}">${esc(s.nick || s.name)} · Lv${s.level} · ${s.rarity}</option>`).join('')}</select></div><div class="fld"><label>You want (optional — leave empty to gift)</label><select id="trWant"><option value="">Nothing — it’s a gift</option>${fa.army.map(s => `<option value="${s.id}">${esc(s.name)} · Lv${s.level} · ${s.rarity}</option>`).join('')}</select></div><button class="btn full" data-act="tradeSend" data-id="${fid}">Send offer</button><div class="mut sm gap">You both need to stay within 120 m of each other. Offers expire after an hour.</div>`); }
// ---------- actions ----------
const ACT = {
  async safeOk() { await guard(() => api('safe_ack')); S.me.me.safeAck = true; closeSheet(); },
  safe() { safeNotice(false); }, closeSheet() { closeSheet(); }, engage(el) { engage(el.dataset.id); },
  shadow(el) { shadowSheet(el.dataset.id); },
  async lvl(el) { const j = await guard(() => api('army_level', { id: el.dataset.id })); if (j) { toast('Level up!', 'ok'); await renderPanel(); S.army = (await api('army')).army; shadowSheet(el.dataset.id); refreshMe(); } },
  async evolve(el) { const j = await guard(() => api('army_evolve', { id: el.dataset.id })); if (j) { toast('✨ Evolved!', 'ok'); sfx.win(); S.army = (await api('army')).army; renderPanel(); shadowSheet(el.dataset.id); refreshMe(); } },
  async fav(el) { await guard(() => api('army_fav', { id: el.dataset.id })); S.army = (await api('army')).army; renderPanel(); shadowSheet(el.dataset.id); },
  async rename(el) { const n = prompt('Nickname (max 20 characters)'); if (n == null) return; await guard(() => api('army_rename', { id: el.dataset.id, nick: n })); S.army = (await api('army')).army; renderPanel(); shadowSheet(el.dataset.id); },
  async release(el) { if (!confirm('Release this shadow for essence? This cannot be undone.')) return; const j = await guard(() => api('army_release', { id: el.dataset.id })); if (j) { toast('Released +' + j.gained + ' ✦', 'ok'); closeSheet(); renderPanel(); refreshMe(); } },
  async craft() { const j = await guard(() => api('relic_craft')); if (j) { toast('🔨 Crafted ' + j.relic.name, 'ok'); (j.ach || []).forEach(a => toast('🏅 ' + a.name, 'ok')); renderPanel(); refreshMe(); } },
  async equip(el) { await guard(() => api('relic_equip', { id: el.dataset.id, off: el.dataset.off === '1' })); renderPanel(); },
  async claim(el) { const j = await guard(() => api('quest_claim', { qid: el.dataset.id })); if (j) { toast(`+${j.xp} XP, +${j.essence} ✦${j.shards ? ', +' + j.shards + ' 💎' : ''}`, 'ok'); levelUpToast(j.levelUp); (j.ach || []).forEach(a => toast('🏅 ' + a.name, 'ok')); sfx.win(); renderPanel(); refreshMe(); } },
  beaconGo() { const v = $('#bcIn').value.trim(); if (v) beacon(v); }, beaconCode(el) { closeSheet(); beacon(el.dataset.code); }, scan() { scanQR(); },
  async gCreate() { const j = await guard(() => api('guild_create', { name: $('#gnName').value, tag: $('#gnTag').value })); if (j) { toast('Guild founded!', 'ok'); renderPanel(); } },
  async gJoin(el) { const j = await guard(() => api('guild_join', { id: el.dataset.id })); if (j) { toast('Joined ' + j.guild.name, 'ok'); renderPanel(); refreshMe(); } },
  async gLeave() { if (!confirm('Leave this guild?')) return; await guard(() => api('guild_leave')); renderPanel(); refreshMe(); },
  async gAttack() { const j = await guard(() => api('guild_boss_attack')); if (j) { toast(`⚔ ${j.damage} damage!${j.defeated ? ' THE BOSS FALLS!' : ''}`, 'ok'); sfx.big(); renderPanel(); } },
  async gClaim() { const j = await guard(() => api('guild_boss_claim')); if (j) { toast(`🎁 +${j.xp} XP, +${j.essence} ✦, +${j.shards} 💎`, 'ok'); levelUpToast(j.levelUp); renderPanel(); refreshMe(); } },
  rankScope(el) { S.rankScope = el.dataset.k; renderPanel(); },
  copyCode() { navigator.clipboard && navigator.clipboard.writeText(S.me.me.friendCode).then(() => toast('Code copied', 'ok')).catch(() => toast(S.me.me.friendCode)); },
  async addFriend() { const j = await guard(() => api('friend_add', { code: $('#frCode').value })); if (j) { toast('Added ' + j.friend.username, 'ok'); renderPanel(); } },
  tradeWith(el) { tradeWith(el.dataset.id, el.dataset.name); },
  async tradeSend(el) { const j = await guard(() => api('trade_offer', { to: el.dataset.id, give: $('#trGive').value, want: $('#trWant').value || null })); if (j) { toast(j.gift ? 'Gift offered — waiting for your friend' : 'Trade offered', 'ok'); closeSheet(); } },
  async tradeYes(el) { const j = await guard(() => api('trade_respond', { id: el.dataset.id, accept: true })); if (j) { toast('Trade complete!', 'ok'); sfx.win(); renderPanel(); } },
  async tradeNo(el) { await guard(() => api('trade_respond', { id: el.dataset.id, accept: false })); renderPanel(); },
  async color(el) { await guard(() => api('set_color', { color: el.dataset.c })); S.me.me.color = el.dataset.c; renderPanel(); },
  demo() { setDemo(!S.demo); renderPanel(); }, mute() { S.mute = !S.mute; localStorage.setItem('ah_mute', S.mute ? '1' : '0'); renderPanel(); },
  async logout() { await api('logout').catch(() => { }); logoutLocal(); },
  async enterGate(el) { const j = await guard(() => api('gate_start', { gateId: el.dataset.id })); if (j) openDungeon(j.run); },
  async joinRaid(el) { const j = await guard(() => api('gate_join', { code: el.dataset.code })); if (j) { openDungeon(j.run); } },
  async joinRaidInput() { const j = await guard(() => api('gate_join', { code: $('#raidCode').value })); if (j) openDungeon(j.run); },
  gateFocus(el) { const m = S.gateMk[el.dataset.id]; if (m) { switchTab('map'); map.setView(m.getLatLng(), 17); S.follow = false; openGate(el.dataset.id); } },
  async zoneGo() { const j = await guard(() => api('zone_challenge')); if (j) openFight(j.fight, j.resumed); },
};
function init() {
  $('#tabLogin').onclick = () => setAuthMode('login'); $('#tabSignup').onclick = () => setAuthMode('signup'); $('#auGo').onclick = doAuth; $('#auPass').addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); }); $('#auUser').addEventListener('keydown', e => { if (e.key === 'Enter') $('#auPass').focus(); });
  document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && ACT[el.dataset.act]) { e.preventDefault(); sfx.tap(); ACT[el.dataset.act](el); } });
  $$('#tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.t));
  $('#hSafe').onclick = () => safeNotice(false); $('#fCenter').onclick = () => { S.follow = true; $('#fCenter').classList.add('on'); const p = S.srvPos || S.fix; if (p && map) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16)); };
  $('#fDemo').onclick = () => setDemo(!S.demo); $('#fZone').onclick = openZone; $('#fGate').onclick = openGateList; $('#fTrail').onclick = showTrail;
  $$('#dpad button').forEach(b => { const d = b.dataset.d; const on = (e) => { e.preventDefault(); S.target = null; S.dir = d === 'x' ? null : d; $$('#dpad button').forEach(x => x.classList.toggle('on', x === b && d !== 'x')); }; const off = (e) => { e.preventDefault(); S.dir = null; b.classList.remove('on'); }; b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off); });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !window.AH_ANDROID) navigator.serviceWorker.register('sw.js').catch(() => { });
  setInterval(() => { if (!S.demo && S.fix && S.token && !document.hidden) sendPos(true); }, 8000);   // heartbeat keeps position/speed fresh while standing still
  window.__ah = { S, api, ACT, getMap: () => map, demoTo(lat, lng) { S.fix = { lat, lng, acc: 5, t: Date.now() }; return sendPos(true); }, boot };
  boot();
}
init();
})();
