"use strict";
const path = require("path");
const { execute, listTools } = require("./execute.js");

/** A synchronous, project-scoped facade. Calls use the same validation and
 * durable recovery as MCP and CLI; separate processes coordinate via a writer lock. */
function createEngine(root) {
  if (typeof root !== "string" || !root.trim())
    throw new Error("An explicit project root is required");
  const directory = path.resolve(root);
  return Object.freeze({
    root: directory,
    call: (name, args = {}) => execute(name, { ...args, root: directory }),
    tools: (profile = "core") => listTools(profile),
  });
}
module.exports = {
  createEngine,
  listTools,
  version: require("../package.json").version,
};
