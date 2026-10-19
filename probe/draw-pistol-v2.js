// Draft 2, driven entirely by the diagnosis of draft 1.
// Draft 1's failures were DESIGN, not mechanics: no negative space, grip too wide
// and too vertical, frame band merged the slide into an 8px brick, sights read as
// blobs, no readable muzzle, trigger guard was a lump with no hole.
"use strict";
const fs = require("fs");
const { encodePNG, upscaleNearest } = require("./png.js");

const W = 32, H = 32;
const P = {
  "1": [20, 19, 26], "2": [58, 63, 82], "3": [90, 99, 121], "4": [138, 147, 168],
  "5": [185, 194, 212], "6": [226, 232, 242], "7": [74, 47, 34], "8": [122, 78, 51],
  "9": [168, 112, 74], "A": [107, 74, 30], "B": [185, 138, 52], "C": [232, 197, 107],
};
const KEYS = Object.keys(P);
const buf = new Int16Array(W * H).fill(-1);
const set = (x, y, k) => { if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = KEYS.indexOf(k); };
const rect = (x0, x1, y0, y1, k) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, k); };

// SLIDE: one clean horizontal mass, 5 tall. This is the gun's primary read.
rect(6, 28, 9, 13, "4");
for (let x = 6; x <= 28; x++) { set(x, 9, "6"); set(x, 10, "5"); set(x, 13, "3"); }
for (const sx of [8, 10, 12]) for (let y = 10; y <= 12; y++) set(sx, y, "3"); // serrations, rear third only
// MUZZLE: a face that turns away from the light, plus a dark bore so it reads as a barrel
for (let y = 10; y <= 12; y++) set(28, y, "2");
set(27, 11, "1");
// SIGHTS: 1px nubs, not blocks
set(7, 8, "3"); set(8, 8, "3"); set(25, 8, "3"); set(26, 8, "3");
// FRAME: thin, only under the rear half of the slide
rect(8, 21, 14, 15, "4");
for (let x = 8; x <= 21; x++) set(x, 15, "2");
// GRIP: 7 wide, angled back ~20deg, ending well below the frame
const grip = [[9,15,14],[9,15,15],[8,14,16],[8,14,17],[8,14,18],[7,13,19],[7,13,20],
              [7,13,21],[6,12,22],[6,12,23],[6,12,24],[5,11,25]];
for (const [x0, x1, y] of grip) for (let x = x0; x <= x1; x++) set(x, y, "8");
for (const [x0, x1, y] of grip) { set(x0, y, "9"); set(x1, y, "7"); }
// TRIGGER GUARD: a loop with a real hole, separated from the grip by 3px of air
rect(18, 21, 16, 16, "3");
rect(19, 22, 17, 18, "3");
rect(18, 21, 19, 19, "3");
rect(17, 19, 20, 20, "3");
// TRIGGER
set(16, 16, "C"); set(17, 16, "B"); set(16, 17, "B"); set(17, 17, "A");
// grip texture: 2px clusters only
set(10, 19, "7"); set(11, 19, "7"); set(9, 23, "7"); set(10, 23, "7");
// bevels, 1px, ramp-adjacent
set(6, 13, "2"); set(28, 9, "5"); set(21, 15, "3"); set(6, 9, "5");

const filled = (x, y) => x >= 0 && y >= 0 && x < W && y < H && buf[y * W + x] >= 0;
const out = new Int16Array(buf);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (buf[y * W + x] >= 0) continue;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if ((dx || dy) && filled(x + dx, y + dy)) { out[y * W + x] = 0; break; }
  }
}
const counts = new Map(); let sil = 0, lone = 0;
const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? -2 : out[y * W + x];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const v = at(x, y); if (v < 0) continue; sil++; counts.set(v, (counts.get(v) || 0) + 1);
  if (at(x-1,y) !== v && at(x+1,y) !== v && at(x,y-1) !== v && at(x,y+1) !== v) lone++;
}
// bounding box + fill ratio: how much of the canvas the design actually uses
let x0=99,x1=-1,y0=99,y1=-1;
for (let y=0;y<H;y++) for (let x=0;x<W;x++) if (at(x,y)>=0){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
console.log(`silhouette ${sil}  colours ${counts.size}  lone ${lone}  bbox ${x1-x0+1}x${y1-y0+1}  fill ${(sil/((x1-x0+1)*(y1-y0+1))*100).toFixed(0)}%`);

const Z = 20, GUT = 44, RW = W * Z + GUT, RH = H * Z + GUT;
const img = Buffer.alloc(RW * RH * 3);
const px = (x, y, c) => { if (x >= 0 && y >= 0 && x < RW && y < RH) { const o = (y * RW + x) * 3; img[o]=c[0]; img[o+1]=c[1]; img[o+2]=c[2]; } };
const box = (a, b, w, h, c) => { for (let y=b;y<b+h;y++) for (let x=a;x<a+w;x++) px(x,y,c); };
box(0,0,RW,RH,[30,30,38]);
for (let y=0;y<H;y++) for (let x=0;x<W;x++){ const v=out[y*W+x]; box(GUT+x*Z,GUT+y*Z,Z,Z, v<0?[46,46,56]:P[KEYS[v]]); }
for (let i=0;i<=W;i++) box(GUT+i*Z-1,GUT,2,H*Z,[12,12,16]);
for (let i=0;i<=H;i++) box(GUT,GUT+i*Z-1,W*Z,2,[12,12,16]);
const F={"0":".###.|#...#|#..##|#.#.#|##..#|#...#|.###.","1":"..#..|.##..|..#..|..#..|..#..|..#..|.###.","2":".###.|#...#|....#|...#.|..#..|.#...|#####","3":"####.|....#|....#|.###.|....#|....#|####.","4":"#..#.|#..#.|#..#.|####.|...#.|...#.|...#.","5":"#####|#....|#....|####.|....#|....#|####.","6":"..##.|.#...|#....|####.|#...#|#...#|.###.","7":"#####|....#|...#.|..#..|.#...|.#...|.#...","8":".###.|#...#|#...#|.###.|#...#|#...#|.###.","9":".###.|#...#|#...#|.####|....#|...#.|.##.."};
const g=(ch,a,b,c)=>{const r=(F[ch]||F["0"]).split("|");for(let y=0;y<7;y++)for(let x=0;x<5;x++)if(r[y][x]==="#")box(a+x*5,b+y*5,5,5,c);};
const n=(v,a,b,c)=>{const s=String(v);for(let i=0;i<s.length;i++)g(s[i],a+i*25,b,c);};
for(let i=0;i<W;i+=4) n(i,GUT+i*Z+6,8,[255,255,255]);
for(let i=0;i<H;i+=4) n(i,4,GUT+i*Z+8,[255,255,255]);
fs.writeFileSync(require("path").join(__dirname, "draw_pistol_v2.png"), encodePNG(RW,RH,img));
console.log("wrote draw_pistol_v2.png");

// Exported so the craft layer can measure this draft directly rather than re-reading its PNG.
module.exports = { W, H, out, KEYS, P };
