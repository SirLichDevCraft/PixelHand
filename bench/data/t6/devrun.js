// Dev harness for the T6 coverage module: mirrors bench/gate8-coverage.js for one id.
// Used while other coverage modules in bench/coverage/ are mid-write by concurrent agents —
// the real aggregator requires every .js in the directory, so a half-written sibling module
// breaks `node bench/gate8-coverage.js T6` for everyone. This touches nothing outside out/.
"use strict";
const fs = require("fs"), path = require("path");
process.env.PIXELHAND_TRACE = process.env.PIXELHAND_TRACE || "1";
const { TOOLS, W } = require("../../../src/tools.js");
const id = (process.argv[2] || "t6").toUpperCase();
const m = require(path.join(__dirname, "..", "..", "..", "bench", "coverage", id.toLowerCase() + ".js"));
const ROOT = path.join(__dirname, "..", "..", "..");
const OUT = path.join(ROOT, "gate8", id.toLowerCase());
const pre = (d) => new Set(fs.existsSync(d) ? fs.readdirSync(d).map(f => f.replace(/\.json$/, "")) : []);
let r;
try {
  r = m.run({ T: TOOLS, W, OUT, ROOT: OUT, say: (s) => console.log("    " + s), preexistingStyles: pre(path.join(ROOT, "art", "styles")), preexistingPalettes: pre(path.join(ROOT, "art", "palettes")) });
} catch (e) {
  console.log("THREW: " + e.message); console.log(e.stack); process.exit(1);
}
const returned = new Set((r.claims || []).map(c => c.claim));
for (const c of r.claims) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.claim}\n      ${c.evidence}`);
for (const c of (m.claims || []).filter(c => !returned.has(c))) console.log(`UNANSWERED  ${c}`);
for (const n of r.notes || []) console.log("note   " + n);
console.log("\nartifacts:\n  " + (r.artifacts || []).join("\n  "));
