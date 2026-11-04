/* AdiHunt creature art — procedural SVG shadows (no external assets). window.AHArt.svg({shape,hue,eyes,horns,r,size}) */
(function () {
  let uidn = 0;
  const RC = ['#9aa0b4', '#6bd0a0', '#5aa9ff', '#b46bff', '#ffb347', '#ff4d6d'];
  const hsl = (h, s, l, a) => `hsl(${h} ${s}% ${l}%${a != null ? ' / ' + a : ''})`;
  // each shape: body markup (uses fill url(#b) stroke var), head anchor for horns {x,y,w}, eye anchor {x,y,gap}
  const SH = {
    wisp: { body: '<path d="M50 8C66 26 80 48 72 68C66 82 56 90 50 90C44 90 34 82 28 68C20 48 34 26 50 8Z"/><path d="M30 80C24 88 18 90 14 96C26 94 34 90 40 86Z M70 80C76 88 82 90 86 96C74 94 66 90 60 86Z"/>', head: { x: 50, y: 22, w: 14 }, eye: { x: 50, y: 56, gap: 9 } },
    imp: { body: '<ellipse cx="50" cy="62" rx="22" ry="24"/><circle cx="50" cy="36" r="17"/><path d="M33 30L22 16L38 26Z M67 30L78 16L62 26Z"/><path d="M70 74C84 74 88 62 82 54C90 60 92 76 74 82Z"/><path d="M36 82L32 94L44 86Z M64 82L68 94L56 86Z"/>', head: { x: 50, y: 22, w: 12 }, eye: { x: 50, y: 37, gap: 8 } },
    spider: { body: '<ellipse cx="50" cy="62" rx="20" ry="18"/><circle cx="50" cy="38" r="12"/><g fill="none" stroke-width="3.2" stroke-linecap="round"><path d="M38 58L16 44L8 56M38 64L12 66L8 80M40 70L22 86L24 96M44 54L26 32L14 34"/><path d="M62 58L84 44L92 56M62 64L88 66L92 80M60 70L78 86L76 96M56 54L74 32L86 34"/></g>', head: null, eye: { x: 50, y: 38, gap: 5, multi: true } },
    hound: { body: '<path d="M22 20L34 36L66 36L78 20L80 46C80 62 70 76 62 84L50 92L38 84C30 76 20 62 20 46Z"/><path d="M40 64L50 70L60 64L58 76L50 80L42 76Z" fill="#000" fill-opacity=".5"/>', head: { x: 50, y: 30, w: 22 }, eye: { x: 50, y: 50, gap: 11 } },
    bat: { body: '<path d="M50 40C42 28 24 20 4 30C12 34 14 42 12 52C20 46 26 50 28 60C34 52 40 56 44 66C46 58 48 52 50 52C52 52 54 58 56 66C60 56 66 52 72 60C74 50 80 46 88 52C86 42 88 34 96 30C76 20 58 28 50 40Z"/><ellipse cx="50" cy="52" rx="10" ry="16"/><path d="M42 40L38 26L48 36Z M58 40L62 26L52 36Z"/>', head: null, eye: { x: 50, y: 46, gap: 6 } },
    moth: { body: '<path d="M48 50C36 24 12 18 6 30C2 44 14 62 40 60C30 64 26 80 38 88C46 90 48 76 48 60Z M52 50C64 24 88 18 94 30C98 44 86 62 60 60C70 64 74 80 62 88C54 90 52 76 52 60Z"/><ellipse cx="50" cy="56" rx="6" ry="20"/><path d="M47 38C42 26 36 20 30 16M53 38C58 26 64 20 70 16" fill="none" stroke-width="2.5"/>', head: null, eye: { x: 50, y: 46, gap: 4 } },
    owl: { body: '<path d="M50 14L62 24C78 28 84 46 82 64C80 82 66 92 50 92C34 92 20 82 18 64C16 46 22 28 38 24Z"/><path d="M30 20L22 8L40 18Z M70 20L78 8L60 18Z"/><path d="M26 66C34 72 40 80 50 86C60 80 66 72 74 66" fill="#000" fill-opacity=".35"/>', head: null, eye: { x: 50, y: 44, gap: 14, big: true } },
    serpent: { body: '<path d="M16 88C4 70 20 56 40 60C60 64 74 48 56 36C44 28 52 16 66 18" fill="none" stroke="%C1%" stroke-width="17" stroke-linecap="round"/><path d="M16 88C4 70 20 56 40 60C60 64 74 48 56 36C44 28 52 16 66 18" fill="none" stroke="%C2%" stroke-width="13" stroke-linecap="round"/><path d="M58 8C70 6 84 12 86 22C82 28 72 30 64 26C56 22 52 14 58 8Z"/>', head: { x: 70, y: 12, w: 10 }, eye: { x: 70, y: 17, gap: 6, shift: true } },
    stag: { body: '<path d="M32 40L68 40L72 62C72 76 62 88 50 94C38 88 28 76 28 62Z"/><path d="M38 44L50 50L62 44" fill="#000" fill-opacity=".4"/>', head: { x: 50, y: 40, w: 20, antlers: true }, eye: { x: 50, y: 58, gap: 10 } },
    wraith: { body: '<path d="M50 8C70 8 78 26 76 44C76 56 84 66 90 76L80 74L82 88L70 80L66 94L56 82L50 96L44 82L34 94L30 80L18 88L20 74L10 76C16 66 24 56 24 44C22 26 30 8 50 8Z"/><ellipse cx="50" cy="40" rx="15" ry="17" fill="#000" fill-opacity=".7"/>', head: { x: 50, y: 12, w: 14 }, eye: { x: 50, y: 40, gap: 8 } },
    golem: { body: '<path d="M14 40L30 28L70 28L86 40L84 62L72 64L72 90L28 90L28 64L16 62Z"/><rect x="38" y="12" width="24" height="20" rx="4"/><path d="M34 52L66 52M50 52L50 88" stroke="#000" stroke-opacity=".5" stroke-width="2" fill="none"/>', head: { x: 50, y: 14, w: 14 }, eye: { x: 50, y: 22, gap: 6 } },
    knight: { body: '<path d="M30 22C30 10 70 10 70 22L72 46L62 50L66 90L34 90L38 50L28 46Z"/><path d="M12 40L30 34L32 54L18 58Z M88 40L70 34L68 54L82 58Z"/><path d="M36 22L64 22L62 32L38 32Z" fill="#000" fill-opacity=".75"/><path d="M50 8L50 2" stroke-width="3"/>', head: { x: 50, y: 12, w: 14 }, eye: { x: 50, y: 27, gap: 7 } },
    drake: { body: '<path d="M52 44C40 28 16 24 4 34C16 38 18 50 14 58C24 52 32 56 36 64C40 60 46 60 50 66L60 60C70 62 74 54 72 48Z"/><path d="M48 50C48 66 62 80 80 78C92 76 96 66 92 58C88 66 80 68 72 62C62 56 60 44 66 34C72 26 70 14 82 12C74 8 62 12 58 22C54 32 52 40 48 50Z"/><path d="M36 64L28 92L44 74Z"/>', head: { x: 80, y: 14, w: 8 }, eye: { x: 80, y: 18, gap: 4, shift: true } },
  };
  function horns(a, n, hue) {
    if (!a || !n) return ''; n = Math.min(10, n); const pairs = Math.max(1, Math.round(n / 2)); let o = '';
    if (a.antlers) { for (let i = 0; i < pairs + 1; i++) { const y = a.y - 4 - i * 6, dx = 10 + i * 5; o += `<path d="M${a.x - 6} ${a.y} L${a.x - dx} ${y - 8} M${a.x + 6} ${a.y} L${a.x + dx} ${y - 8}" fill="none" stroke-width="3.2" stroke-linecap="round"/>`; } return o; }
    for (let i = 0; i < pairs; i++) { const sp = a.w + i * 6, h = 14 + i * 5, y = a.y - i * 3; o += `<path d="M${a.x - a.w * 0.5} ${y} Q${a.x - sp} ${y - h * 0.4} ${a.x - sp - 2} ${y - h}  Q${a.x - sp + 6} ${y - h * 0.6} ${a.x - a.w * 0.2} ${y}Z M${a.x + a.w * 0.5} ${y} Q${a.x + sp} ${y - h * 0.4} ${a.x + sp + 2} ${y - h}  Q${a.x + sp - 6} ${y - h * 0.6} ${a.x + a.w * 0.2} ${y}Z"/>`; }
    return o;
  }
  function eyes(e, n, col, r) {
    n = Math.max(1, Math.min(8, n)); let o = ''; const rad = e.big ? 6.5 : (e.multi ? 2.6 : 3.6);
    const pts = []; if (e.multi) { const rows = n > 4 ? 2 : 1; for (let i = 0; i < n; i++) { const row = n > 4 ? (i < Math.ceil(n / 2) ? 0 : 1) : 0, cnt = n > 4 ? (row === 0 ? Math.ceil(n / 2) : Math.floor(n / 2)) : n, idx = n > 4 ? (row === 0 ? i : i - Math.ceil(n / 2)) : i; pts.push([e.x + (idx - (cnt - 1) / 2) * 7, e.y + row * 7 - 3]); } }
    else if (e.shift) { pts.push([e.x, e.y]); if (n > 2) pts.push([e.x + 6, e.y - 3]); if (n > 4) pts.push([e.x - 6, e.y + 3]); }
    else { pts.push([e.x - e.gap / 2, e.y], [e.x + e.gap / 2, e.y]); if (n === 3) pts.push([e.x, e.y - 8]); if (n >= 4) { pts.push([e.x - e.gap / 2 - 2, e.y - 8], [e.x + e.gap / 2 + 2, e.y - 8]); } if (n >= 6) { pts.push([e.x - e.gap / 2 - 4, e.y + 8], [e.x + e.gap / 2 + 4, e.y + 8]); } }
    pts.slice(0, n).forEach(p => { o += `<circle cx="${p[0]}" cy="${p[1]}" r="${rad + 2}" fill="${col}" opacity=".35" filter="url(#g%ID%)"/><ellipse cx="${p[0]}" cy="${p[1]}" rx="${rad}" ry="${rad * (e.big ? 1 : 0.8)}" fill="${col}"/><circle cx="${p[0]}" cy="${p[1]}" r="${rad * 0.4}" fill="#fff"/>`; });
    return o;
  }
  function svg(o) {
    const id = ++uidn; const sh = SH[o.shape] || SH.wisp; const h = ((o.hue == null ? 280 : o.hue) % 360 + 360) % 360, r = o.r || 0; const size = o.size || 96;
    const aura = RC[r]; const eyeCol = [hsl(h, 100, 82), hsl(h + 40, 100, 78), hsl(h - 30, 100, 76), '#c9a2ff', '#ffd27a', '#ff6b86'][r];
    const bodyM = sh.body.replaceAll('%C1%', hsl(h, 80, 48)).replaceAll('%C2%', hsl(h, 45, 11)); const body = `<g fill="url(#b${id})" stroke="${hsl(h, 80, 48)}" stroke-width="1.4" stroke-linejoin="round">${bodyM}${horns(sh.head, o.horns, h)}</g>`;
    const ey = eyes(sh.eye, o.eyes || 2, eyeCol, r).replaceAll('%ID%', id);
    const auraBlur = 2 + r * 0.9; const wisps = r >= 3 ? `<g fill="none" stroke="${aura}" stroke-opacity=".5" stroke-width="1.2"><path d="M8 70C20 50 8 30 22 12"/><path d="M92 70C80 50 92 30 78 12"/>${r >= 5 ? '<circle cx="50" cy="50" r="46" stroke-dasharray="3 5"/>' : ''}</g>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 112 112" width="${size}" height="${size}" role="img" aria-label="${o.label || 'shadow'}"><defs><linearGradient id="b${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hsl(h, 38, 17)}"/><stop offset="1" stop-color="${hsl(h, 55, 5)}"/></linearGradient><filter id="g${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.4"/></filter><filter id="a${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${auraBlur}"/></filter></defs><g filter="url(#a${id})" opacity=".85" fill="${aura}" stroke="${aura}" stroke-width="3">${bodyM}</g>${wisps}${body}${ey}</svg>`;
  }
  window.AHArt = { svg, shapes: Object.keys(SH), RC };
})();
