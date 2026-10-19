"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function refuse(rule, message) {
  const e = new Error(message);
  e.rule = rule;
  throw e;
}

// Project-controlled names are always relative to a known directory. Check existing
// ancestors as well: a symlink must not turn a valid relative name into an escape.
function within(root, ...names) {
  const base = path.resolve(root);
  for (const name of names) {
    if (
      typeof name !== "string" ||
      !name ||
      /[\x00-\x1f<>:"|?*]/.test(name) ||
      path.isAbsolute(name) ||
      name.split(/[\\/]/).some((p) => p === ".." || p === "." || !p)
    )
      refuse(
        "invalid_path",
        "Asset names must be relative paths without empty, dot, parent, drive, or control segments",
      );
  }
  const target = path.resolve(base, ...names);
  if (target === base || !target.startsWith(base + path.sep))
    refuse("invalid_path", "Path leaves the project directory");
  let ancestor = target;
  while (!fs.existsSync(ancestor) && ancestor !== base)
    ancestor = path.dirname(ancestor);
  if (fs.existsSync(base) && fs.existsSync(ancestor)) {
    const realBase = fs.realpathSync(base),
      realAncestor = fs.realpathSync(ancestor);
    if (
      realAncestor !== realBase &&
      !realAncestor.startsWith(realBase + path.sep)
    )
      refuse(
        "invalid_path",
        "Asset path follows a link outside the project directory",
      );
  }
  return target;
}

function atomicWrite(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return file;
}

const writeJSON = (file, value) =>
  atomicWrite(file, JSON.stringify(value, null, 2) + "\n");
const readJSON = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function hashCel(cel) {
  return crypto.createHash("sha256").update(cel.toGrid()).digest("hex");
}
function stableJSON(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJSON).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stableJSON(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}

module.exports = {
  within,
  atomicWrite,
  writeJSON,
  readJSON,
  hashCel,
  refuse,
  stableJSON,
};
