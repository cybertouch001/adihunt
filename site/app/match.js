// AdiHunt v1.1 — Live Match (hide & seek / last survivor). Live = real GPS on a map. Virtual = a 3D arena built from the real place's OSM buildings.
import * as THREE from './vendor/three.module.min.js';
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s); const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const M = { radii: { live: [150, 300, 500, 800], virtual: [60, 100, 150] }, head: [0, 60, 120, 300], time: [10, 15, 20, 30], vis: { none: 'Nobody sees positions', teammates: 'Hiders see each other', friends: 'Friends in the match see each other' } };
const S = { id: null, st: null, mode: 'live', fix: null, lastPost: 0, pos: { x: 0, y: 0 }, heading: 0, input: { fwd: 0, turn: 0 }, leaflet: null, lyr: null, three: null, arena: null, raf: 0, last: 0, loopT: 0, sound: true, token: null, cfg: null, toastT: 0 };
const tok = () => localStorage.getItem('ah_token');
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
async function mapi(method, body = {}) {
  let r; try { r = await fetch((window.AH_API || '') + '/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ah': '1', ...(tok() ? { authorization: 'Bearer ' + tok() } : {}) }, body: JSON.stringify(body) }); } catch (e) { throw Object.assign(new Error('No connection, check your internet'), { status: 0 }); }
  let j = {}; try { j = await r.json(); } catch { } if (!j.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { status: r.status }); return j;
}
function note(msg, kind = '') { const el = $('#mvNote'); if (!el) return; el.textContent = msg; el.className = 'mvNote ' + kind; el.hidden = false; clearTimeout(S.toastT); S.toastT = setTimeout(() => { el.hidden = true; }, 3600); }
function fmt(ms) { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
const nightNow = () => { const h = (new Date().getUTCHours() + 5.5 + 24) % 24; return h >= 19 || h < 5; };

// ---------- DOM ----------
function build() {
  if ($('#matchView')) return;
  const v = document.createElement('div'); v.id = 'matchView'; v.hidden = true;
  v.innerHTML = `
  <div id="mvHome" class="mvPane"></div>
  <div id="mvLobby" class="mvPane" hidden></div>
  <div id="mvRun" class="mvPane" hidden>
    <div id="mvMap" hidden></div>
    <canvas id="mvCanvas" hidden></canvas>
    <div id="mvHud"></div>
    <div id="mvPad" hidden><button data-k="turnL">◀</button><div class="mvPadMid"><button data-k="fwd">▲</button><button data-k="back">▼</button></div><button data-k="turnR">▶</button></div>
    <div id="mvActs"></div>
    <div id="mvNote" class="mvNote" hidden></div>
    <div id="mvRotate">Turn your phone sideways to play the arena in landscape.</div>
  </div>
  <div id="mvEnd" class="mvPane" hidden></div>
  <button id="mvClose" class="mvClose" title="Close">✕</button>`;
  document.body.appendChild(v);
  $('#mvClose').onclick = () => closeMatch();
  v.addEventListener('pointerdown', e => { const b = e.target.closest('[data-k]'); if (!b) return; const k = b.dataset.k; if (k === 'fwd') S.input.fwd = 1; else if (k === 'back') S.input.fwd = -1; else if (k === 'turnL') S.input.turn = -1; else if (k === 'turnR') S.input.turn = 1; });
  v.addEventListener('pointerup', () => { S.input.fwd = 0; S.input.turn = 0; }); v.addEventListener('pointercancel', () => { S.input.fwd = 0; S.input.turn = 0; });
  window.addEventListener('keydown', e => { if (!S.id || S.mode !== 'virtual') return; const k = e.key; if (k === 'ArrowUp') S.input.fwd = 1; else if (k === 'ArrowDown') S.input.fwd = -1; else if (k === 'ArrowLeft') S.input.turn = -1; else if (k === 'ArrowRight') S.input.turn = 1; });
  window.addEventListener('keyup', e => { if (!S.id) return; const k = e.key; if (k === 'ArrowUp' || k === 'ArrowDown') S.input.fwd = 0; if (k === 'ArrowLeft' || k === 'ArrowRight') S.input.turn = 0; });
  window.addEventListener('resize', () => resizeArena());
}
function show(pane) { for (const id of ['mvHome', 'mvLobby', 'mvRun', 'mvEnd']) $('#' + id).hidden = id !== pane; }
async function openMatch() {
  build(); $('#matchView').hidden = false; if (!tok()) { $('#matchView').hidden = true; return; }
  $('#mvHome').innerHTML = '<div class="mvWrap"><p class="mvSub">Loading…</p></div>'; show('mvHome');
  if (!S.cfg) { try { S.cfg = await mapi('config', {}); } catch { } }
  let st = null; try { st = await mapi('match_state', {}); } catch (e) { note(e.message, 'bad'); }
  if (st && st.match && st.match.status !== 'ended') return enter(st);
  if (st && st.match && st.match.status === 'ended') return renderEnd(st);
  return home();
}
function home() {
  stopLoop(); S.id = null; show('mvHome');
  $('#mvHome').innerHTML = `<div class="mvWrap">
    <h2>Hide &amp; seek</h2>
    <p class="mvSub">One player is the <b>Seeker</b>, the rest hide. The safe zone shrinks until the last survivor wins. Real players, not monsters: find the people.</p>
    <div class="mvCard"><b>Host a match</b>
      <div class="mvBtns"><button class="btn" data-go="live">Live map (real GPS)</button><button class="btn sec" data-go="virtual">Virtual arena (3D, landscape)</button></div></div>
    <div class="mvCard"><b>Join with a code</b>
      <div class="mvRow"><input id="mvCode" maxlength="6" autocapitalize="characters" placeholder="ABC123" class="mvIn"><button class="btn" id="mvJoin">Join</button></div></div>
    <div class="mvSafe">Play safe. Watch traffic, stay off private property and out of unsafe places. Your location is shared only while a match is running. At night, keep to lit, public paths. Live-map matches use your real GPS; the virtual arena is a 3D model built from the map of the real place.</div>
  </div>`;
  $('#mvHome').querySelectorAll('[data-go]').forEach(b => b.onclick = () => createForm(b.dataset.go));
  $('#mvJoin').onclick = async () => { try { const st = await mapi('match_join', { code: $('#mvCode').value.trim().toUpperCase() }); enter(st); } catch (e) { note(e.message, 'bad'); } };
}
function createForm(mode) {
  S.mode = mode; show('mvHome');
  const r = M.radii[mode]; const night = nightNow();
  $('#mvHome').innerHTML = `<div class="mvWrap">
    <h2>${mode === 'live' ? 'Live map match' : 'Virtual arena match'}</h2>
    ${night ? '<div class="mvWarn">It is night where you are. Keep to lit, public paths and stay off roads.</div>' : ''}
    <div class="mvCard">
      <label class="mvLbl">Safe zone start radius</label><select id="sRad" class="mvIn">${r.map(x => `<option value="${x}" ${x === (mode === 'live' ? 300 : 100) ? 'selected' : ''}>${x} m</option>`).join('')}</select>
      <label class="mvLbl">Head start for hiders</label><select id="sHead" class="mvIn">${M.head.map(x => `<option value="${x}" ${x === 60 ? 'selected' : ''}>${x ? x / 60 + ' min' : 'none'}</option>`).join('')}</select>
      <label class="mvLbl">Match time limit</label><select id="sTime" class="mvIn">${M.time.map(x => `<option value="${x}" ${x === 15 ? 'selected' : ''}>${x} min</option>`).join('')}</select>
      <label class="mvLbl">Who can see whom live</label><select id="sVis" class="mvIn">${Object.entries(M.vis).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select>
      <div class="mvSmall">The Seeker gets everyone's location every 2 minutes, never live. Tag range: ${mode === 'live' ? '15 m' : 'touch (4 m)'}. Each hider gets 2 decoys, the Seeker 2 radar pings. The host can end the match.</div>
    </div>
    <div class="mvBtns"><button class="btn" id="sGo">Create room</button><button class="btn sec" id="sBack">Back</button></div>
  </div>`;
  $('#sBack').onclick = home;
  $('#sGo').onclick = async () => {
    $('#sGo').disabled = true;
    try {
      const body = { mode, radius: +$('#sRad').value, headStart: +$('#sHead').value, timeLimit: +$('#sTime').value, visibility: $('#sVis').value };
      if (mode === 'virtual') { if (!S.fix) { note('Turn on location first, the arena is built from the map of your real place.', 'bad'); $('#sGo').disabled = false; return; } body.lat = S.fix.lat; body.lng = S.fix.lng; }
      enter(await mapi('match_create', body));
    } catch (e) { note(e.message, 'bad'); $('#sGo').disabled = false; }
  };
  startFix();
}
// ---------- GPS ----------
let watchId = null;
function startFix() {
  if (watchId != null || !navigator.geolocation) return;
  watchId = navigator.geolocation.watchPosition(p => { S.fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; }, () => { }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}
function stopFix() { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }
// ---------- lobby, run, end ----------
function enter(st) {
  S.id = st.match.id; S.st = st; S.mode = st.match.mode; startFix();
  if (st.match.status === 'lobby') { renderLobby(st); } else if (st.match.status === 'running') { show('mvRun'); setupRun(); renderRun(st); }
  else return renderEnd(st);
  startLoop();
}
function renderLobby(st) {
  show('mvLobby'); const m = st.match; const names = st.players;
  const html = `<div class="mvWrap">
    <div class="mvCode">Room code<b>${esc(m.code)}</b></div>
    <p class="mvSub">${m.mode === 'live' ? 'Live map match' : 'Virtual arena match'} · radius ${m.radius0} m · head start ${m.headStart ? m.headStart / 60 + ' min' : 'none'} · ${m.timeLimit} min · ${esc(M.vis[m.visibility] || '')}</p>
    <div class="mvCard"><b>Players (${names.length}/${m.maxPlayers})</b>${names.map(p => `<div class="mvRowP">${esc(p.name)}${p.isMe ? ' (you)' : ''}${p.uid === (m.host) ? ' · host' : ''}</div>`).join('')}
      <div class="mvSmall">Need ${m.minPlayers} players: one Seeker and two or more hiders. Share the code with people near you.</div></div>
    <div class="mvBtns">${st.match.isHost ? `<button class="btn" id="lStart" ${names.length < m.minPlayers ? 'disabled' : ''}>Start match</button><button class="btn sec" id="lEnd">Close room</button>` : `<button class="btn sec" id="lLeave">Leave room</button>`}</div>
    <div class="mvSafe">Your location is shared only while the match runs.</div></div>`;
  if (html !== S.lobHtml) { S.lobHtml = html; $('#mvLobby').innerHTML = html; }
  if ($('#lStart')) $('#lStart').onclick = async () => { try { enter(await mapi('match_start', { match: S.id })); } catch (e) { note(e.message, 'bad'); } };
  if ($('#lEnd')) $('#lEnd').onclick = async () => { try { await mapi('match_end', { match: S.id }); closeToHome(); } catch (e) { note(e.message, 'bad'); } };
  if ($('#lLeave')) $('#lLeave').onclick = async () => { try { await mapi('match_leave', { match: S.id }); closeToHome(); } catch (e) { note(e.message, 'bad'); } };
}
function setupRun() {
  $('#matchView').classList.toggle('virt', S.mode === 'virtual');
  if (S.mode === 'live') { $('#mvMap').hidden = false; $('#mvCanvas').hidden = true; $('#mvPad').hidden = true; if (!S.leaflet && window.L) { S.leaflet = L.map('mvMap', { zoomControl: false, attributionControl: true }).setView([S.st.match.origin.lat, S.st.match.origin.lng], 16); L.tileLayer((S.cfg && S.cfg.tileUrl) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(S.leaflet); S.lyr = L.layerGroup().addTo(S.leaflet); } }
  else { $('#mvMap').hidden = true; $('#mvCanvas').hidden = false; $('#mvPad').hidden = false; try { window.AdiHuntNative && window.AdiHuntNative.orient('landscape'); } catch { } try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => { }); } catch { } if (!S.three) initArena(); else resetArena(); }
}
function renderRun(st) {
  const m = st.match, me = st.me; const now = Date.now();
  const mins = m.endsAt - now;
  $('#mvHud').innerHTML = `<div class="mvTop"><span class="mvChip">${now < m.releaseAt ? 'Head start ' + fmt(m.releaseAt - now) : 'Time ' + fmt(mins)}</span>
    <span class="mvChip ${me.role === 'seeker' ? 'bad' : 'ok'}">${me.role === 'seeker' ? 'You are the Seeker' : me.state === 'alive' ? 'You are hiding' : 'You are out'}</span>
    <span class="mvChip">Zone ${m.zoneStage}/${m.zoneStages}${m.zoneNextAt ? ' · shrinks in ' + fmt(m.zoneNextAt - now) : ''}</span>
    <span class="mvChip">${m.players} players · ${st.players.filter(p => p.state === 'alive').length} alive</span></div>
    ${me.outside ? '<div class="mvWarn">Outside the safe zone. Get back in before the grace time runs out.</div>' : ''}`;
  if (S.mode === 'live') drawLive(st);
  drawActions(st);
  if (S.lastEv !== (st.events.length ? st.events[st.events.length - 1].at : 0)) { S.lastEv = st.events.length ? st.events[st.events.length - 1].at : 0; for (const e of st.events.slice(-1)) { const msg = eventText(e, st); if (msg && now - e.at < 8000) note(msg, e.kind === 'out' ? 'bad' : ''); } }
}
function eventText(e, st) {
  const d = e.data || {};
  if (e.kind === 'start') return `Match started. ${d.seeker} is the Seeker.`;
  if (e.kind === 'ping') return 'Seeker ping: everyone\'s location sent to the Seeker.';
  if (e.kind === 'out') { const n = d.name || 'Someone'; return d.how === 'zone' ? `${n} was caught outside the zone.` : d.how === 'caught' ? `${n} was tagged.` : `${n} is out.`; }
  if (e.kind === 'end') return 'Match over.';
  if (e.kind === 'join') return `${(d || {}).name || 'Someone'} joined.`;
  return null;
}
function drawActions(st) {
  const m = st.match, me = st.me; let h = '';
  const target = st.nearby && st.nearby.length ? st.nearby[0] : (S.mode === 'virtual' ? nearestTag(st) : null);
  if (me.role === 'seeker' && me.state === 'alive') {
    if (target) h += `<button class="btn big bad" data-act="tag" data-uid="${esc(target.uid)}">Tag ${esc(target.name)}</button>`;
    h += `<button class="btn sec" data-act="radar" ${me.radarLeft ? '' : 'disabled'}>Radar (${me.radarLeft})</button>`;
  }
  if (me.role === 'hider' && me.state === 'alive') h += `<button class="btn sec" data-act="decoy" ${me.decoysLeft && !me.decoyActive ? '' : 'disabled'}>${me.decoyActive ? 'Decoy set for next ping' : 'Decoy (' + me.decoysLeft + ')'}</button>`;
  if (m.isHost) h += `<button class="btn sec" data-act="end">End match</button>`;
  h += `<button class="btn sec" data-act="leave">Leave</button>`;
  const key = h; if (S.actKey !== key) { S.actKey = key; $('#mvActs').innerHTML = h; $('#mvActs').querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act, b.dataset.uid)); }
}
function nearestTag(st) {
  if (st.me.role !== 'seeker') return null; const me = st.me; const pme = st.players.find(p => p.isMe); if (!pme || pme.x == null) return null;
  let best = null; for (const p of st.players) { if (p.isMe || p.role !== 'hider' || p.state !== 'alive' || p.x == null) continue; const d = dist2(pme, p); if (d <= st.match.tagRange + 1 && (!best || d < best.d)) best = { uid: p.uid, name: p.name, d }; }
  return best;
}
async function act(a, uid) {
  try {
    if (a === 'tag') { const st = await mapi('match_tag', { match: S.id, uid }); note('Tagged.'); apply(st); }
    else if (a === 'radar') { const st = await mapi('match_radar', { match: S.id }); const r = st.radar; note(r.inRange.length ? `Radar: ${r.inRange.length} hider${r.inRange.length > 1 ? 's' : ''} within 400 m, nearest ${r.inRange[0].dist} m.` : `Radar: no hider within 400 m. ${r.alive} alive.`); apply(st); }
    else if (a === 'decoy') { const st = await mapi('match_decoy', { match: S.id }); note('Decoy set. Your next ping shows a fake spot.'); apply(st); }
    else if (a === 'end') { await mapi('match_end', { match: S.id }); const st = await mapi('match_state', { match: S.id }); renderEnd(st); }
    else if (a === 'leave') { await mapi('match_leave', { match: S.id }); closeToHome(); }
  } catch (e) { note(e.message, 'bad'); }
}
function apply(st) {
  if (!st || !st.match) { if (S.id) { note('The match has ended or you left it.'); closeToHome(); } return; }
  S.st = st;
  if (st.match.status === 'lobby') return renderLobby(st);
  if (st.match.status === 'ended') return renderEnd(st);
  if (!$('#mvRun') || $('#mvRun').hidden) { show('mvRun'); setupRun(); }
  if (st.warning) note(st.warning, 'bad');
  renderRun(st);
}
async function tick() {
  if (!S.id) return;
  try {
    const st = S.st || {}; const running = st.match && st.match.status === 'running';
    let r;
    if (running && S.mode === 'virtual') r = await mapi('match_pos', { match: S.id, x: S.pos.x, y: S.pos.y, heading: S.heading });
    else if (running && S.fix && Date.now() - S.lastPost > 2500) { S.lastPost = Date.now(); r = await mapi('match_pos', { match: S.id, lat: S.fix.lat, lng: S.fix.lng, acc: S.fix.acc || 0 }); }
    else r = await mapi('match_state', { match: S.id });
    if (r) { if (r.match && r.match.status === 'running' && (!S.st || S.st.match.status !== 'running' || !$('#mvRun') || $('#mvRun').hidden)) { S.st = r; show('mvRun'); setupRun(); } apply(r); }
  } catch (e) { if (e.status === 403 || e.status === 404) closeToHome(); else note(e.message, 'bad'); }
  S.loopT = setTimeout(tick, S.mode === 'virtual' ? 1000 : 2000);
}
function startLoop() { clearTimeout(S.loopT); S.loopT = setTimeout(tick, 1000); if (S.mode === 'virtual' && !S.raf) { S.last = performance.now(); S.raf = requestAnimationFrame(frame); } }
function stopLoop() { clearTimeout(S.loopT); S.loopT = 0; cancelAnimationFrame(S.raf); S.raf = 0; stopFix(); try { window.AdiHuntNative && window.AdiHuntNative.orient('portrait'); } catch { } if (S.leaflet) { S.leaflet.remove(); S.leaflet = null; S.lyr = null; } disposeArena(); }
function closeToHome() { S.st = null; stopLoop(); S.id = null; S.actKey = null; try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch { } home(); }
function closeMatch() { $('#matchView').hidden = true; stopLoop(); S.id = null; S.st = null; }
function renderEnd(st) {
  stopLoop(); S.id = null; show('mvEnd'); const m = st.match, r = st.result || {};
  const label = { seeker: 'The Seeker wins: everyone was tagged or caught.', hider: 'A hider wins: the last survivor.', hiders: 'The hiders win: they all survived to the end.', none: 'Match closed without a winner.' }[r.winner] || 'Match over.';
  const reason = { all_caught: 'Everyone hiding was caught.', last_survivor: 'One hider was left standing.', time: 'Time ran out.', seeker_left: 'The Seeker left the match.', host_ended: 'The host ended the match.', host_left: 'The host closed the room.' }[r.reason] || '';
  $('#mvEnd').innerHTML = `<div class="mvWrap"><h2>Match over</h2><div class="mvCard"><b>${esc(label)}</b><div class="mvSmall">${esc(reason)}</div>
    ${(st.players || []).map(p => `<div class="mvRowP">${esc(p.name)}${p.isMe ? ' (you)' : ''} · ${p.role === 'seeker' ? 'Seeker' : 'Hider'} · ${esc(p.state)} · ${p.points} pts</div>`).join('')}</div>
    <div class="mvBtns"><button class="btn" id="eReplay" ${m.mode ? '' : 'disabled'}>Route replay</button><button class="btn sec" id="eHome">Back</button></div>
    <canvas id="eCanvas" width="640" height="640" class="mvReplay" hidden></canvas></div>`;
  $('#eHome').onclick = () => { S.id = null; home(); };
  $('#eReplay').onclick = async () => { try { const rp = await mapi('match_replay', { match: m.id }); drawReplay(rp); } catch (e) { note(e.message, 'bad'); } };
  S.id = m.id; // keep id for replay
}
function drawReplay(rp) {
  const c = $('#eCanvas'); c.hidden = false; const g = c.getContext('2d'); const W = c.width, H = c.height; g.fillStyle = '#0b0a14'; g.fillRect(0, 0, W, H);
  const half = rp.match.arenaHalf || 150; const sc = (W / 2 - 20) / half; const cols = ['#ff7b9c', '#7bd1ff', '#b4ff7b', '#ffd17b', '#c59bff', '#7bffe0'];
  g.strokeStyle = '#3a3360'; g.beginPath(); g.arc(W / 2, H / 2, half * sc, 0, Math.PI * 2); g.stroke();
  rp.players.forEach((p, i) => { g.strokeStyle = cols[i % cols.length]; g.lineWidth = 2; g.beginPath(); p.trail.forEach(([x, y], k) => { const X = W / 2 + x * sc, Y = H / 2 - y * sc; k ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke(); const last = p.trail[p.trail.length - 1]; if (last) { g.fillStyle = cols[i % cols.length]; g.fillText(p.name + (p.role === 'seeker' ? ' (Seeker)' : ''), W / 2 + last[0] * sc + 6, H / 2 - last[1] * sc); } });
  g.fillStyle = '#c8c2e8'; g.font = '14px sans-serif'; g.fillText('Route replay (plane view, north up). Pings: ' + rp.pings.length, 12, 20);
}
// ---------- live map ----------
function drawLive(st) {
  if (!S.leaflet || !st.match.origin) return; const o = st.match.origin; const L_ = window.L;
  const ll = (x, y) => { const k = Math.max(0.01, Math.cos(o.lat * Math.PI / 180)); return [o.lat + y / 110574, o.lng + x / (111320 * k)]; };
  S.lyr.clearLayers();
  if (st.match.zone) { L_.circle(ll(st.match.zone.x, st.match.zone.y), { radius: st.match.zone.r, color: '#8b5cf6', weight: 2, fillOpacity: 0.08 }).addTo(S.lyr); }
  for (const p of st.players) { if (p.x == null || p.state !== 'alive' && !p.isMe) continue; const c = p.isMe ? '#5aa9ff' : p.role === 'seeker' ? '#ff4d6d' : '#6bd0a0'; L_.circleMarker(ll(p.x, p.y), { radius: p.isMe ? 8 : 6, color: '#fff', weight: 1, fillColor: c, fillOpacity: 1 }).bindTooltip(p.name).addTo(S.lyr); }
  if (st.ping) for (const h of st.ping.hiders) if (h.x != null && h.state === 'alive') L_.circleMarker(ll(h.x, h.y), { radius: 4, color: '#ff4d6d', weight: 1, fillOpacity: 0.3 }).addTo(S.lyr);
  if (S.fix && !S.centered) { S.leaflet.setView([S.fix.lat, S.fix.lng], 17); S.centered = true; }
}
// ---------- virtual arena (three.js) ----------
let R3 = null, SC = null, CAM = null, MESHES = {}, ZONE_M = null, ARENA_G = null;
function initArena() {
  const cv = $('#mvCanvas'); R3 = new THREE.WebGLRenderer({ canvas: cv, antialias: true }); R3.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); R3.setClearColor(0x0b0a14, 1);
  SC = new THREE.Scene(); SC.fog = new THREE.Fog(0x0b0a14, 120, 320);
  CAM = new THREE.PerspectiveCamera(60, 1, 0.5, 600); SC.add(new THREE.AmbientLight(0xffffff, 0.75)); const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(60, 120, 40); SC.add(dl);
  S.three = true; resizeArena(); resetArena();
}
function resizeArena() { if (!R3) return; const w = window.innerWidth, h = window.innerHeight; R3.setSize(w, h, false); CAM.aspect = w / h; CAM.updateProjectionMatrix(); }
function resetArena() {
  if (!R3 || !S.st || !S.st.match) return; const m = S.st.match; const half = m.arenaHalf || 140;
  if (S.arena === m.id) return; S.arena = m.id;
  for (const k of Object.keys(MESHES)) { SC.remove(MESHES[k]); } MESHES = {}; if (ARENA_G) { SC.remove(ARENA_G); ARENA_G = null; }
  ARENA_G = new THREE.Group(); SC.add(ARENA_G);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), new THREE.MeshLambertMaterial({ color: 0x2b3a2e })); ground.rotation.x = -Math.PI / 2; ARENA_G.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 8), new THREE.MeshLambertMaterial({ color: 0x3a3a44 })); road.rotation.x = -Math.PI / 2; road.position.y = 0.02; ARENA_G.add(road);
  const seed = m.id; const rnd = mulberry(seed);
  // bushes as hiding spots
  for (let i = 0; i < 26; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(1.2 + rnd() * 1.6, 8, 6), new THREE.MeshLambertMaterial({ color: 0x2f6b3a })); b.position.set((rnd() * 2 - 1) * half * 0.9, 1, (rnd() * 2 - 1) * half * 0.9); ARENA_G.add(b); }
  loadBuildings(m, half).then(() => { }).catch(() => fallbackBlocks(half, rnd));
  ZONE_M = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128), new THREE.MeshBasicMaterial({ color: 0x8b5cf6, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })); ZONE_M.rotation.x = -Math.PI / 2; ZONE_M.position.y = 0.3; ARENA_G.add(ZONE_M);
  S.pos = { x: 0, y: 0 }; S.heading = 0;
  if (S.st.me && S.st.me.x != null) { S.pos = { x: S.st.me.x, y: S.st.me.y }; }
}
function mulberry(a) { let t = 0; return () => { t |= 0; t = t + 0x6D2B79F5 | 0; let x = Math.imul(t ^ t >>> 15, 1 | t); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
function fallbackBlocks(half, rnd) {
  for (let gx = -half + 25; gx < half; gx += 40) for (let gy = -half + 25; gy < half; gy += 40) { if (rnd() < 0.35) continue; const w = 14 + rnd() * 12, d = 14 + rnd() * 12, h = 6 + rnd() * 16; addBox(gx, gy, w, d, h); }
  if (S.st) { const tag = $('#mvHud'); if (tag) tag.dataset.map = 'generated'; }
}
function addBox(x, y, w, d, h) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: 0x5c5f78 })); b.position.set(x, h / 2, -y); ARENA_G.add(b); }
async function loadBuildings(m, half) {
  if (!m.origin) throw new Error('no origin');
  const dLat = half / 110574, dLng = half / (111320 * Math.cos(m.origin.lat * Math.PI / 180));
  const q = `[out:json][timeout:12];(way["building"](${m.origin.lat - dLat},${m.origin.lng - dLng},${m.origin.lat + dLat},${m.origin.lng + dLng}););out geom 400;`;
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 12000);
  let j; try { const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ac.signal }); j = await r.json(); } finally { clearTimeout(to); }
  if (!j || !j.elements || !j.elements.length) throw new Error('no buildings');
  const k = Math.cos(m.origin.lat * Math.PI / 180); let n = 0;
  for (const el of j.elements) {
    if (!el.geometry || el.geometry.length < 3) continue; const pts = el.geometry.map(p => ({ x: (p.lon - m.origin.lng) * 111320 * k, y: (p.lat - m.origin.lat) * 110574 }));
    if (pts.some(p => Math.abs(p.x) > half + 20 || Math.abs(p.y) > half + 20)) { /* keep */ }
    const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, p.y)));
    const levels = +((el.tags || {})['building:levels'] || 0); const hgt = +(((el.tags || {}).height || '').replace(/[^0-9.]/g, '')) || (levels ? levels * 3.2 : 9);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.min(60, hgt), bevelEnabled: false }); geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x6b6e88 })); ARENA_G.add(mesh); n++;
  }
  S.arenaSrc = 'OSM buildings (' + n + ')'; return n;
}
function movePlayers(st) {
  if (!SC || !st) return; const seen = new Set();
  const put = (uid, p, color) => { let g = MESHES[uid]; if (!g) { g = new THREE.Group(); const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.8, 10), new THREE.MeshLambertMaterial({ color })); body.position.y = 0.9; const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshLambertMaterial({ color: 0xffe0c8 })); head.position.y = 2; g.add(body, head); SC.add(g); MESHES[uid] = g; } g.position.set(p.x, 0, -p.y); g.visible = true; seen.add(uid); };
  for (const p of st.players) { if (p.isMe) continue; if (p.x != null) put(p.uid, p, p.role === 'seeker' ? 0xff4d6d : 0x6bd0a0); }
  for (const k of Object.keys(MESHES)) if (!seen.has(k) && k !== 'me') MESHES[k].visible = false;
  if (st.match.zone && ZONE_M) { ZONE_M.position.x = st.match.zone.x; ZONE_M.position.z = -st.match.zone.y; ZONE_M.scale.set(st.match.zone.r, st.match.zone.r, 1); }
}
function frame(t) {
  S.raf = requestAnimationFrame(frame); const dt = Math.min(0.1, (t - (S.last || t)) / 1000); S.last = t;
  if (!R3 || !S.st || !S.st.match || S.st.match.status !== 'running') { if (R3) R3.render(SC, CAM); return; }
  const m = S.st.match; const me = S.st.me; const can = me && me.state === 'alive';
  if (can) { S.heading = (S.heading + S.input.turn * 110 * dt + 360) % 360; const v = S.input.fwd * 4.2 * dt; const h = S.heading * Math.PI / 180; S.pos.x = clampN(S.pos.x + Math.sin(h) * v, -m.arenaHalf, m.arenaHalf); S.pos.y = clampN(S.pos.y + Math.cos(h) * v, -m.arenaHalf, m.arenaHalf); }
  if (MESHES.me || true) { let g = MESHES.me; if (!g) { g = new THREE.Group(); const body = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.8, 10), new THREE.MeshLambertMaterial({ color: 0x5aa9ff })); body.position.y = 0.9; g.add(body); SC.add(g); MESHES.me = g; } g.position.set(S.pos.x, 0, -S.pos.y); }
  const h = S.heading * Math.PI / 180; const fx = Math.sin(h), fz = -Math.cos(h);
  CAM.position.set(S.pos.x - fx * 9, 5.2, -S.pos.y - fz * 9); CAM.lookAt(S.pos.x + fx * 6, 1.4, -S.pos.y + -fz * 6);
  movePlayers(S.st); R3.render(SC, CAM);
  const hud = $('#mvHud'); if (hud && !S.hudRef) S.hudRef = 1;
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
function disposeArena() { if (R3) { try { R3.dispose(); } catch { } R3 = null; } SC = null; CAM = null; MESHES = {}; ZONE_M = null; ARENA_G = null; S.three = null; S.arena = null; }
// expose for tests and the page
window.AHMatch = { open: openMatch, state: () => S.st, id: () => S.id, S };
document.addEventListener('DOMContentLoaded', () => { build(); const b = document.getElementById('fMatch'); if (b) b.onclick = openMatch; });
if (document.readyState !== 'loading') { build(); const b = document.getElementById('fMatch'); if (b) b.onclick = openMatch; }
})();
