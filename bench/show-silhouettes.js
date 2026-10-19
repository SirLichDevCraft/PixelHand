// Side-by-side ASCII view of the four Phase 3 silhouettes, for review in a terminal.
"use strict";
const fs = require("fs");
const path = require("path");
const { Cel } = require("../src/core/cel.js");
const { mirror } = require("../src/core/ops.js");

const src = fs.readFileSync(path.join(__dirname, "gate3-character.js"), "utf8");
const block = src.match(/const SILHOUETTE = \{([\s\S]*?)\n\};/)[1];
const rowsOf = (name) => {
  const body = block.match(new RegExp(name + ": \\[([\\s\\S]*?)\\]," + (name === "up" ? "" : "")))[1];
  return body.split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
};
const mk = (rows) => {
  const c = new Cel(16, 32, "p", "x");
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === "#") c.set(x, y, 0); });
  return c;
};

const dirs = { down: mk(rowsOf("down")), right: mk(rowsOf("right")), up: mk(rowsOf("up")), up_b: mk(rowsOf("up_b")) };
dirs.left = mirror(dirs.right, { axis: "x" }).cel;
const order = process.argv.includes('--all') ? ["down", "right", "left", "up", "up_b"] : ["down", "right", "up_b"];

let head = "     ";
for (const d of order) head += d.padEnd(17) + " ";
console.log(head);
console.log("     " + order.map(() => "-".repeat(16) + "  ").join(""));
for (let y = 1; y < 31; y++) {
  let line = String(y).padStart(4) + "  ";
  for (const d of order) {
    let s = "";
    for (let x = 0; x < 16; x++) s += dirs[d].get(x, y) >= 0 ? "#" : ".";
    line += s + "  ";
  }
  console.log(line);
}
