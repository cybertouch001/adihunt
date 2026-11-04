#!/usr/bin/env node
// Build the hosted site: node build.mjs <outDir> [apkPath]
//  - bundles server/worker.js + rules.js into <outDir>/_worker.js with config (version, admin bootstrap HASH, apk name)
//  - copies site/ (landing page, web app) and the APK into <outDir>
const { build } = await import(process.env.ESBUILD_PATH || 'esbuild');   // npm i esbuild (or set ESBUILD_PATH)
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
const here = path.dirname(new URL(import.meta.url).pathname); const [out, apk] = process.argv.slice(2);
const VERSION = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).version;
const boot = JSON.parse(fs.readFileSync(process.env.AH_BOOT || path.join(here, 'private', 'admin-boot.json'), 'utf8'));
if (!/^pbkdf2-sha256\$100000\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(boot.pw)) throw new Error('boot pw must be a hash');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(here, 'site'), out, { recursive: true, filter: s => !s.endsWith('index.template.html') });
let APK = null, size = '', sha = '';
if (apk) { const name = `AdiHunt-${VERSION}.apk`; fs.mkdirSync(path.join(out, 'files'), { recursive: true }); fs.copyFileSync(apk, path.join(out, 'files', name)); const b = fs.readFileSync(apk); sha = crypto.createHash('sha256').update(b).digest('hex'); size = (b.length / 1048576).toFixed(1) + ' MB'; APK = { name, sha256: sha, bytes: b.length }; }
const tpl = fs.readFileSync(path.join(here, 'site', 'index.template.html'), 'utf8');
fs.writeFileSync(path.join(out, 'index.html'), tpl.replaceAll('__VER__', VERSION).replaceAll('__APKBTN__', APK ? `<a class="btn sec" href="/download/${APK.name}">⬇ Android APK</a>` : '').replaceAll('__APKBLOCK__', APK ? `<h2>Android app</h2><div class="c"><p><a class="btn" href="/download/${APK.name}">⬇ Download ${APK.name}</a> (${size})</p><p>SHA-256: <code>${sha}</code></p><ol><li>Open the file on your phone and allow “install unknown apps” for your browser when asked.</li><li>Open AdiHunt, allow Location (“While using the app”), sign in and hunt.</li></ol><p style="font-size:13px;color:#a89cd6">Version ${VERSION} · package bot.tab.sites.adihunt · min Android 7.</p></div>` : ''));
fs.writeFileSync(path.join(here, 'server', 'config.js'), `export const VERSION = ${JSON.stringify(VERSION)};\nexport const ADMIN_BOOT = ${JSON.stringify({ username: boot.username, pw: boot.pw })};\nexport const APK = ${JSON.stringify(APK)};\n`);
await build({ entryPoints: [path.join(here, 'server', 'worker.js')], bundle: true, format: 'esm', outfile: path.join(out, '_worker.js'), platform: 'neutral', target: 'es2022', logLevel: 'warning' });
fs.writeFileSync(path.join(here, 'server', 'config.js'), `export const VERSION = ${JSON.stringify(VERSION)};\nexport const ADMIN_BOOT = null;\nexport const APK = null;\n`);
fs.writeFileSync(path.join(out, 'tab-site.json'), JSON.stringify({ kind: 'worker', entry: '_worker.js', bindings: [{ type: 'd1', name: 'DB' }], worker: { compatibility_date: '2026-08-01', compatibility_flags: ['nodejs_compat'], html_handling: 'auto-trailing-slash', not_found_handling: 'none' } }));
console.log(JSON.stringify({ out, version: VERSION, apk: APK }));
