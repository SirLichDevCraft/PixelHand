"use strict";
const fs = require("fs");
const path = require("path");
const { Cel } = require("./cel.js");
const { Pose, Skin, registerPalette } = require("./rig.js");
const { Clip, Frame } = require("./clip.js");
const { Scene } = require("./scene.js");
const { PartLibrary, MaterialLibrary } = require("./parts.js");
const { Palette } = require("./palette.js");
const { writeJSON, readJSON, refuse, within } = require("./storage.js");
const { createHash } = require("crypto");

function diskRecords(W) {
  const records = {};
  for (const [spriteId, sprite] of W.project?.sprites || [])
    for (const [key, relative] of Object.entries(sprite.cels)) {
      const file = require("./storage.js").within(
        path.join(W.root, "art", "sprites", spriteId),
        relative,
      );
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file);
      records[`${spriteId}/${key}`] = {
        hash: createHash("sha256").update(raw).digest("hex"),
        name: raw
          .toString("utf8")
          .match(/^# name (.*)$/m)?.[1]
          ?.replace(/\r$/, ""),
      };
    }
  return records;
}

function capture(W) {
  const storedIds = new Map([...W.store.cels].map(([id, cel]) => [cel, id]));
  const inlineIds = new Map();
  const encodeCel = (c) => {
    if (!c) return null;
    if (!storedIds.has(c) && !inlineIds.has(c))
      inlineIds.set(c, `inline:${inlineIds.size}`);
    return {
      ref: storedIds.get(c) || inlineIds.get(c),
      from_store: storedIds.has(c),
      name: c.name,
      grid: c.toGrid?.() || null,
    };
  };
  return JSON.parse(
    JSON.stringify({
      version: 1,
      revision: W.sessionRevision || 0,
      project: W.project?.doc.id ?? null,
      disk: diskRecords(W),
      cels: [...W.store.cels].map(([id, c]) => [id, c.toGrid()]),
      undo: [...W.store.undo],
      redo: [...W.store.redo],
      snapshots: [...W.store.snapshots].map(([key, s]) => [
        key,
        { id: s.id, grid: s.cel.toGrid() },
      ]),
      poses: [...W.poses],
      production: W.production || { assets: {}, masks: {}, skeletons: {} },
      rigs: [...W.rigs],
      skins: [...W.skins].map(([id, s]) => [
        id,
        {
          palette: s.paletteId,
          parts: [...s.parts].map(([key, p]) => [
            key,
            { ...p, cel: encodeCel(p.cel) },
          ]),
        },
      ]),
      clips: [...W.clips].map(([id, c]) => [
        id,
        {
          template: c.template,
          directions: c.directions,
          fps: c.fps,
          sprite: c.sprite,
          notes: c.notes,
          frames: [...c.framesByDirection].map(([d, frames]) => [
            d,
            frames.map((f) => ({
              ...f,
              pose: undefined,
              cel: encodeCel(f.cel),
            })),
          ]),
        },
      ]),
      scenes: [...(W.scenes || [])].map(([id, s]) => [
        id,
        {
          cols: s.cols,
          rows: s.rows,
          tile: s.tile,
          ambient: s.ambient,
          palette: s.basePalette.id,
          grid: s.grid.map((row) => row.map(encodeCel)),
          props: s.props.map((p) => ({ ...p, cel: encodeCel(p.cel) })),
          characters: s.characters.map((p) => ({
            ...p,
            cel: encodeCel(p.cel),
          })),
        },
      ]),
      faces: [...W.faces],
      faceRecipes: [...W.faceRecipes],
      selection: W.selection,
      parts: W.parts
        ? [...W.parts.parts].map(([id, p]) => [
            id,
            { ...p, cel: encodeCel(p.cel) },
          ])
        : null,
      materials: W.materials ? [...W.materials.materials] : null,
      transientPalettes: [...(W.project?.palettes || [])]
        .filter(
          ([id]) =>
            !fs.existsSync(path.join(W.root, "art", "palettes", `${id}.json`)),
        )
        .map(([id, p]) => [id, p.entries]),
      calls: W.calls,
      authoredPixels: W.authoredPixels,
    }),
  );
}
function restore(W, state) {
  if (state.version !== 1)
    refuse("session_version", `Unsupported recovery version ${state.version}`);
  // Construct before replacing live state so a corrupt record cannot partially load.
  const cels = new Map(
    state.cels.map(([id, text]) => [id, Cel.fromGrid(text)]),
  );
  for (const [id, entries] of state.transientPalettes || [])
    if (!W.project.palettes.has(id))
      W.project.palettes.set(id, new Palette(id, entries));
  for (const c of cels.values()) {
    const p = W.project?.palette_get(c.paletteId);
    if (!p)
      refuse(
        "session_palette",
        `Recovery cel '${c.name}' references missing palette '${c.paletteId}'`,
      );
    for (const i of c.idx)
      if (i < -1 || i >= p.size)
        refuse(
          "session_palette",
          `Recovery cel '${c.name}' contains an invalid palette index`,
        );
  }
  W.store.cels = cels;
  W.store.undo = new Map(state.undo || []);
  W.store.redo = new Map(state.redo || []);
  W.store.snapshots = new Map(
    (state.snapshots || []).map(([key, s]) => [
      key,
      { id: s.id, cel: Cel.fromGrid(s.grid) },
    ]),
  );
  W.poses = new Map(
    (state.poses || []).map(([id, spec]) => [id, new Pose(id, spec)]),
  );
  W.production = state.production || { assets: {}, masks: {}, skeletons: {} };
  W.calls = state.calls || 0;
  W.authoredPixels = state.authoredPixels || 0;
  W.sessionRevision = state.revision || 0;
  const byName = new Map([...cels.values()].map((c) => [c.name, c]));
  const inline = new Map();
  const decodeCel = (encoded) => {
    if (!encoded) return null;
    if (encoded.from_store && cels.has(encoded.ref))
      return cels.get(encoded.ref);
    if (encoded.ref && inline.has(encoded.ref)) return inline.get(encoded.ref);
    const cel =
      (!encoded.ref && byName.get(encoded.name)) ||
      (encoded.grid ? Cel.fromGrid(encoded.grid) : { name: encoded.name });
    if (encoded.ref) inline.set(encoded.ref, cel);
    return cel;
  };
  if (state.rigs) W.rigs = new Map(state.rigs);
  if (state.skins)
    W.skins = new Map(
      state.skins.map(([id, s]) => {
        const skin = new Skin(id, s.palette);
        registerPalette(W.project.palette_get(s.palette));
        skin.parts = new Map(
          s.parts.map(([key, p]) => [key, { ...p, cel: decodeCel(p.cel) }]),
        );
        return [id, skin];
      }),
    );
  if (state.clips)
    W.clips = new Map(
      state.clips.map(([id, s]) => {
        const clip = new Clip(id, s);
        clip.sprite = s.sprite;
        for (const [d, frames] of s.frames)
          clip.setFrames(
            d,
            frames.map((f) => {
              const frame = new Frame(decodeCel(f.cel), {
                ...f,
                pose: W.poses.get(f.poseName),
              });
              frame.diskKey = f.diskKey;
              return frame;
            }),
          );
        return [id, clip];
      }),
    );
  if (state.scenes)
    W.scenes = new Map(
      state.scenes.map(([id, s]) => {
        const scene = new Scene(id, {
          ...s,
          palette: W.project.palette_get(s.palette),
        });
        scene.grid = s.grid.map((row) => row.map(decodeCel));
        scene.props = s.props.map((p) => ({ ...p, cel: decodeCel(p.cel) }));
        scene.characters = s.characters.map((p) => ({
          ...p,
          cel: decodeCel(p.cel),
        }));
        return [id, scene];
      }),
    );
  W.faces = new Map(state.faces || []);
  W.faceRecipes = new Map(state.faceRecipes || []);
  W.selection = state.selection || null;
  W.parts = null;
  W.materials = null;
  if (state.parts) {
    W.parts = new PartLibrary();
    W.parts.parts = new Map(
      state.parts.map(([id, p]) => [id, { ...p, cel: decodeCel(p.cel) }]),
    );
  }
  if (state.materials) {
    W.materials = new MaterialLibrary();
    W.materials.materials = new Map(state.materials);
  }
}
function file(W) {
  return within(W.root, ".pixelhand", "session.json");
}
function persist(W) {
  if (!W.project) return;
  const state = capture(W);
  state.revision++;
  writeJSON(file(W), state);
  W.sessionRevision = state.revision;
}
function recover(W) {
  if (!fs.existsSync(file(W))) return false;
  const state = readJSON(file(W));
  if (state.project !== W.project.doc.id)
    refuse(
      "session_project",
      "Recovery belongs to a different project; move .pixelhand/session.json aside before reopening",
    );
  restore(W, state);
  const disk = diskRecords(W);
  W.recoveryWarnings = [];
  for (const [canonical, old] of Object.entries(state.disk || {})) {
    if (disk[canonical]?.hash === old.hash) continue;
    const [sprite, ...parts] = canonical.split("/");
    const current = W.project.readCel(sprite, parts.join("/"));
    if (current) W.store.cels.set(canonical, current);
    for (const [id, cel] of W.store.cels)
      if (id === canonical || cel.name === old.name) {
        if (current) W.store.cels.set(id, current);
        else W.store.cels.delete(id);
        W.store.undo.delete(id);
        W.store.redo.delete(id);
        for (const [key, snapshot] of W.store.snapshots)
          if (snapshot.id === id) W.store.snapshots.delete(key);
      }
    W.recoveryWarnings.push({
      rule: "external_cel_edit",
      cel: canonical,
      message:
        "Used the grid edited on disk and cleared stale undo history for this cel",
    });
  }
  // Clip frames should reference recovered buffers rather than stale disk cels.
  for (const clip of W.clips.values())
    for (const frames of clip.framesByDirection.values())
      for (const frame of frames) {
        const recovered =
          W.store.cels.get(`${clip.sprite}/${frame.diskKey}`) ||
          [...W.store.cels.values()].find((c) => c.name === frame.cel?.name);
        if (recovered) frame.cel = recovered;
      }
  return true;
}
module.exports = { capture, restore, persist, recover };
