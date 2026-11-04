# AdiHunt

A real-world, GPS-based shadow-hunting game. Walk around your city, find shadows on a live OpenStreetMap map, fight them in
short turn-based battles, extract them into your Legion, clear Dungeon Gates, join guilds and claim territory.

* Web / PWA: installs from the browser (`/app/`)
* Android: a thin WebView shell around the same app (`android/`), needs internet and location permission
* Backend: one Cloudflare Worker + D1 (SQLite), no third-party services, no paid APIs
* Original art (procedural SVG) and sound (WebAudio synth). English UI. No tracking, no ads.

## v1.1: Live Match (hide & seek)
Host a room with a 6-letter code. One player is the **Seeker**, the rest hide. Players in the room share a safe zone that shrinks in
steps until the last survivor wins (or the Seeker tags everyone, or time runs out). The Seeker receives everyone's location every
2 minutes (a ping), a radar readout (distance and bearing) twice per match, and tags a hider within reach (15 m live, touch in the arena).
Hiders get 2 decoys (a fake spot for the next ping). Two modes:
* **Live map**: real GPS on an OpenStreetMap map (Leaflet).
* **Virtual arena**: a 3D model of the real place built from the OpenStreetMap buildings around the host's location (three.js, bundled),
  played in landscape with an on-screen D-pad (keyboard arrows on desktop). The Seeker sees only hiders inside a 60-degree field of view, 35 m.
Post-match: scoreboard, ranks (Bronze to Diamond from match points) and a route replay for the players of that match.

## How to play
1. Sign up (username + password), read the safe-play notice, allow location.
2. Shadows appear on the map around you and despawn after a while. Walk within 40 m of one and tap it.
3. Fight: Strike, Power (charge it with the timing meter), Guard, and Bind when it is weak. Bound shadows join your Legion.
4. Level up shadows with essence, evolve them, craft relics, finish 3 daily quests, keep your streak, climb the ranks (E to S).
5. Gates (portals) are dungeons: 4 waves and a boss, solo or with up to 3 friends (co-op raid + horn). Guilds fight a weekly guild boss.
   Zones can be claimed by defeating the guardian; territory decays and resets weekly.

## Features
Accounts and sessions, live map (Leaflet, OSM tiles with attribution), deterministic spawns with 6 rarities and despawn timers,
adaptive density (more players in an area -> more shadows, admin hot zones), day/night cycle from local solar time, 40 m encounter radius,
server-side turn-based fights (hidden seed, cannot be rerolled), Legion with levels/evolution, daily quests, streaks, global and weekly
leaderboards, achievements, Dungeon Gates (solo/co-op), guilds with a guild boss, territory claim, trading by friend code,
safe-play notices and a soft daily distance cap, admin-toggled events.
Extras: relic crafting, Hunt of the Day bounty, QR beacon check-ins (admin-created, optional geo-lock), ghost-trail replay, co-op raid horn.
Admin panel: separate login, ban/unban/delete, spawn tuning, events, custom creatures, map hot/no-play zones, beacons, announcements, audit log.

## Anti-cheat (server side)
Speed limit (9 m/s + 30 m slack), teleport detection with a long relocation gap and arrival cooldown, strikes -> temporary lock, rate limits,
accuracy and speed required to engage, fight state and RNG seed kept on the server, demo mode earns reduced rewards.

## Layout
* `server/` Worker (rules.js pure game logic, matchrules.js + match.js Live Match, game.js, social.js, admin.js, db.js, worker.js)
* `site/` landing page, PWA (`site/app`), vendored Leaflet, QR code library and three.js (MIT, see vendor/THREE-LICENSE.txt)
* `android/` WebView wrapper (package `bot.tab.sites.adihunt`)
* `test/` unit tests, API tests, Playwright browser tests, balance simulation
* `build.mjs` bundles the Worker with esbuild and assembles the static site

## Build and run locally
```
npm i -D esbuild wrangler
AH_BOOT=test-boot.json node build.mjs out-local        # test-boot.json = {"username":"admin","salt":"..","hash":".."} (PBKDF2)
cd localdev && npx wrangler dev -c wrangler.toml --port 8801    # wrangler.toml: assets=../out-local, D1 binding DB
node --test test/rules.test.mjs
BASE=http://127.0.0.1:8801 ADMIN_PW=... node test/api.test.mjs
python test/pw_game.py http://127.0.0.1:8801 ADMIN_PW shots/     # needs playwright
```
The admin account is created from a PBKDF2 hash injected at build time (never commit it). Android: `AH_SIGNING_PROPS=... ./gradlew assembleRelease`.

## Notes
* Map tiles come from tile.openstreetmap.org under the OSM tile usage policy: attribution is always shown, tiles are not bulk-downloaded.
  For heavy use set `tileUrl` in the admin settings to your own tile provider.
* Play safe: watch your surroundings, stay out of traffic, private property and unsafe places. You are responsible for your own safety.
* Untested in this release: real-device GPS accuracy/battery, background behaviour, and tile load at scale; the Android build has not been run on a device.

MIT licence.
