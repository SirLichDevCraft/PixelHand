// Collaboration round 1, take 2.
// Take 1 failed: all three silhouettes read as funnels, not pistols. Diagnosis:
//   - the "slide" was 9-11px thick, so barrel and grip merged into one wedge
//   - no distinct horizontal barrel bar
//   - guard "holes" were 2-3px specks, invisible at silhouette level
//   - shapes were taller than wide, which reads as a funnel, not a firearm
// Fix: barrel is a THIN horizontal bar (5-6px), grip hangs below-and-behind it,
// guard is a real loop with a >=4px hole, overall shape is wide-not-tall.
// Shapes are authored as per-row run lists (how a pixel artist actually thinks),
// not procedural primitives.
const { encodePNG } = require('./png.js');
const fs = require('fs');

const W = 32, H = 32;

// variant = { row: [[x0,x1], ...] } inclusive spans
const A = { // barrel-forward: heavy tall slide, exaggerated muzzle face, short grip
  7:  [[10,11],[27,29]],
  8:  [[8,29]], 9: [[8,29]], 10: [[8,29]], 11: [[8,29]], 12: [[8,29]],
  13: [[8,29]], 14: [[8,29]], 15: [[8,29]], 16: [[8,29]], 17: [[9,29]],
  18: [[10,15],[19,22]],
  19: [[10,15],[21,22]],
  20: [[10,14],[21,22]],
  21: [[10,14],[20,21]],
  22: [[9,14]],
  23: [[9,13]],
  24: [[9,13]],
  25: [[8,13]],
};

const B = { // grip-forward: slim barrel, small muzzle, large grip
  9:  [[11,12],[24,25]],
  10: [[11,12],[24,25]],
  11: [[10,29]], 12: [[10,29]], 13: [[10,29]], 14: [[10,29]], 15: [[10,29]],
  16: [[9,19],[22,23]],
  17: [[9,19],[22,23]],
  18: [[8,19],[22,23]],
  19: [[8,18],[21,23]],
  20: [[8,18],[20,22]],
  21: [[8,18]],
  22: [[8,17]],
  23: [[8,17]],
  24: [[8,17]],
  25: [[8,16]],
  26: [[8,16]],
  27: [[8,16]],
};

const C = { // accurate: 6px barrel bar, muzzle face, angled 7px grip, guard loop with a real hole
  8:  [[9,10],[23,24]],
  9:  [[9,10],[23,24],[27,28]],
  10: [[8,28]], 11: [[8,28]], 12: [[8,28]], 13: [[8,28]], 14: [[8,28]], 15: [[8,27]],
  16: [[9,13],[17,22]],
  17: [[9,13],[17,17],[22,22]],
  18: [[9,12],[17,17],[21,21]],
  19: [[9,12],[17,21]],
  20: [[9,12]],
  21: [[8,12]],
  22: [[8,12]],
  23: [[8,12]],
  24: [[8,12]],
  25: [[8,12]],
  26: [[8,12]],
  27: [[8,12]],
  28: [[8,12]],
};

const variants = [
  { id: 'A', name: 'BARREL-FORWARD', spec: A, exaggerates: 'slide mass + muzzle face' },
  { id: 'B', name: 'GRIP-FORWARD',   spec: B, exaggerates: 'grip mass; slim barrel' },
  { id: 'C', name: 'ACCURATE',       spec: C, exaggerates: 'nothing - proportionally correct' },
];

function toMask(spec) {
  const m = Array.from({ length: H }, () => new Array(W).fill(0));
  for (const [y, spans] of Object.entries(spec))
    for (const [x0, x1] of spans) for (let x = x0; x <= x1; x++) m[+y][x] = 1;
  return m;
}

function measure(m) {
  const px = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y][x]) px.push([x, y]);
  const xs = px.map(p => p[0]), ys = px.map(p => p[1]);
  const bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const bw = bb.x1 - bb.x0 + 1, bh = bb.y1 - bb.y0 + 1;
  // A part-robust measure: the barrel is the band of rows that span most of the bbox width.
  // (Naive vertical/horizontal runs get contaminated where the guard joins the barrel.)
  const rowRun = y => { let best = 0, cur = 0; for (let x = bb.x0; x <= bb.x1; x++) { cur = m[y][x] ? cur + 1 : 0; if (cur > best) best = cur; } return best; };
  const isBarrelRow = y => rowRun(y) >= bw * 0.6;
  let barrel = 0, run = 0;
  let barrelBottom = bb.y0;
  for (let y = bb.y0; y <= bb.y1; y++) {
    run = isBarrelRow(y) ? run + 1 : 0;
    if (run > barrel) { barrel = run; barrelBottom = y; }
  }
  let grip = 0;                                 // widest row below the barrel band
  for (let y = barrelBottom + 1; y <= bb.y1; y++) grip = Math.max(grip, rowRun(y));
  const gripRows = (() => { let n = 0; for (let y = barrelBottom + 1; y <= bb.y1; y++) if (rowRun(y) > 0) n++; return n; })();
  const mid = barrelBottom;
  // enclosed air: air cells inside the bbox that are reachable from neither edge
  const seen = Array.from({ length: H }, () => new Array(W).fill(false));
  const stack = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    if ((y === 0 || y === H - 1 || x === 0 || x === W - 1) && !m[y][x]) stack.push([x, y]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H || m[y][x] || seen[y][x]) continue;
    seen[y][x] = true;
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
  }
  let enclosed = 0;
  for (let y = bb.y0; y <= bb.y1; y++) for (let x = bb.x0; x <= bb.x1; x++)
    if (!m[y][x] && !seen[y][x]) enclosed++;
  const openAir = (bw * bh) - px.length - enclosed;
  return { area: px.length, bbox: `${bw}x${bh}`, aspect: (bw / bh).toFixed(2),
           barrel, grip, gripRows, ratio: (barrel / grip).toFixed(2), enclosed,
           openAir: Math.round(openAir / (bw * bh) * 100) + '%' };
}

// ---- render
const Z = 8, GUT = 8, TOP = 12;
const PW = W * 3 + GUT * 2, PH = H + TOP;
const SW = PW * Z, SH = PH * Z;
const rgb = Buffer.alloc(SW * SH * 3);
const BG = [24,24,30], INK = [236,236,242], SIL = [122,132,148], OUT = [8,8,12], LBL = [205,210,220], DIM = [110,116,128];
function put(x, y, c) { if (x<0||y<0||x>=SW||y>=SH) return; const o=(y*SW+x)*3; rgb[o]=c[0]; rgb[o+1]=c[1]; rgb[o+2]=c[2]; }
function blit(gx, gy, c) { for (let dy=0;dy<Z;dy++) for (let dx=0;dx<Z;dx++) put(gx*Z+dx, gy*Z+dy, c); }
const F = {
 '0':['111','101','101','101','111'],'1':['010','110','010','010','111'],'2':['111','001','111','100','111'],
 '3':['111','001','111','001','111'],'4':['101','101','111','001','001'],'5':['111','100','111','001','111'],
 '6':['111','100','111','101','111'],'7':['111','001','001','001','001'],'8':['111','101','111','101','111'],
 '9':['111','101','111','001','111'],'A':['111','101','111','101','101'],'B':['111','101','111','101','111'],
 'C':['111','100','100','100','111'],'D':['110','101','101','101','110'],'E':['111','100','111','100','111'],
 'F':['111','100','111','100','100'],'G':['111','100','101','101','111'],'H':['101','101','111','101','101'],
 'I':['111','010','010','010','111'],'J':['001','001','001','101','111'],'K':['101','101','110','101','101'],
 'L':['100','100','100','100','111'],'M':['101','111','111','101','101'],'N':['101','111','111','111','101'],
 'O':['111','101','101','101','111'],'P':['111','101','111','100','100'],'Q':['111','101','101','111','001'],
 'R':['111','101','111','110','101'],'S':['111','100','111','001','111'],'T':['111','010','010','010','010'],
 'U':['101','101','101','101','111'],'V':['101','101','101','101','010'],'W':['101','101','111','111','101'],
 'X':['101','101','111','101','101'],'Y':['101','101','111','010','010'],'Z':['111','001','010','100','111'],
 '.':['000','000','000','000','010'],'-':['000','000','111','000','000'],' ':['000','000','000','000','000'],
 ':':['010','000','010','000','010'],
};
function text(sx, sy, s, c, sc=2) {
  let cx = 0;
  for (const ch of String(s).toUpperCase()) { const g = F[ch] || F[' '];
    for (let dy=0;dy<5;dy++) for (let dx=0;dx<5;dx++) if (g[dy][dx]==='1') for (let a=0;a<sc;a++) for (let b=0;b<sc;b++) put(sx+cx*sc+dx*sc+a, sy+dy*sc+b, c);
    cx += 6; }
}
for (let y=0;y<PH;y++) for (let x=0;x<PW;x++) blit(x,y,BG);

const report = [];
variants.forEach((v, i) => {
  const ox = i * (W + GUT), m = toMask(v.spec);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    if (!m[y][x]) continue;
    const up=y>0&&m[y-1][x], dn=y<H-1&&m[y+1][x], lf=x>0&&m[y][x-1], rt=x<W-1&&m[y][x+1];
    blit(ox+x, TOP+y, (up&&dn&&lf&&rt) ? SIL : OUT);   // two-tone only: fill + dark edge
  }
  text((ox+1)*Z, 10, v.id+' '+v.name, LBL, 3);
  for (let x=0;x<W;x+=8) text((ox+x)*Z, 54, String(x), DIM, 2);
  report.push({ id: v.id, name: v.name, exaggerates: v.exaggerates, ...measure(m) });
});
fs.writeFileSync('collab_pistol_round1.png', encodePNG(SW, SH, rgb));

console.log('axis varied: exaggeration_axis (which feature is amplified)');
console.log('stage: silhouette only - unshaded, two-tone, per docs/09 3.1\n');
for (const r of report) {
  console.log(`${r.id}  ${r.name.padEnd(15)}  ${r.exaggerates}`);
  console.log(`    area ${r.area}  bbox ${r.bbox}  aspect ${r.aspect} (wide>1)`);
  console.log(`    barrel band ${r.barrel}px thick  grip ${r.grip}px wide x ${r.gripRows} tall  barrel:grip ${r.ratio}`);
  console.log(`    enclosed air ${r.enclosed}px  open air ${r.openAir}\n`);
}
