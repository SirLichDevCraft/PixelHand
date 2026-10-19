"use strict";

// One contract is shared by MCP, CLI help, and the standalone inference runner.
// Nested art recipes remain extensible; command names and top-level fields do not
// have to be guessed from a prose description anymore.
const str = { type: "string", minLength: 1 };
const num = { type: "number" };
const int = { type: "integer" };
const bool = { type: "boolean" };
const obj = { type: "object", additionalProperties: true };
const arr = (items = obj) => ({ type: "array", items });
const tuple = (n, item = num) => ({
  type: "array",
  items: item,
  minItems: n,
  maxItems: n,
});
const choice = (...values) => ({ type: "string", enum: values });
const json = {
  type: ["object", "array", "string", "number", "boolean", "null"],
};
const index = { type: ["integer", "string"] };
const dir = choice(
  "down",
  "down-right",
  "right",
  "up-right",
  "up",
  "up-left",
  "left",
  "down-left",
);
const point = tuple(2, int);
const box = {
  type: "object",
  properties: {
    x: int,
    y: int,
    w: { ...int, minimum: 1 },
    h: { ...int, minimum: 1 },
    x0: int,
    y0: int,
    x1: int,
    y1: int,
  },
  additionalProperties: false,
  anyOf: [
    { required: ["x", "y", "w", "h"] },
    { required: ["x0", "y0", "x1", "y1"] },
  ],
};
const coordinate = {
  type: "object",
  properties: {
    id: str,
    projection: str,
    art_scale: { ...int, minimum: 1 },
    palette_size: { ...int, minimum: 2, maximum: 93 },
    temperature: str,
    edge_policy: str,
    shading: str,
    detail: str,
    motion: str,
    mood: str,
  },
  required: [
    "id",
    "projection",
    "art_scale",
    "palette_size",
    "temperature",
    "edge_policy",
    "shading",
    "detail",
    "motion",
    "mood",
  ],
  additionalProperties: true,
};

const types = {};
function names(type, list) {
  for (const name of list.split(" ")) types[name] = type;
}
names(
  str,
  "id name game root cel sprite cel_key palette style ramp material into clip rig skin pose key snapshot axis option note reason subject plain_language path file from to a b layer template curve event group query tool expected_hash mask asset stage brief verdict reviewer evidence field checkpoint perspective scene slot outline color_role kind direction_source depth_toward depth_mode toward ambient_name",
);
names(
  num,
  "z density amount strength lean headBob weight phase stride fps duration lightWeight depth_weight falloff gamma tolerance amplitude distance eye focal near far unit horizon height value hue saturation min_step_delta",
);
names(
  int,
  "x y w h steps frame baseline contact_row cols pad tile zoom radius count max_results limit seed at_row band index frame_a frame_b line_width max_calls max_rounds max_tokens timeout_ms",
);
names(
  bool,
  "capture apply force no_faces preserve_structure flood flipX flipY allow_disconnected approved protect include_grid",
);
names(str, "asset_class pattern policy edge");
names(num, "hueShift length scale gaitStride ground_row");
names(bool, "hueLock silhouette");
names(int, "labelEvery");
names(obj, "ground assignments place");
names(arr(num), "durations");
names(arr(str), "poses");
types.footprint = tuple(2, int);
types.dir = str;
names(
  obj,
  "bible spec design coordinate anchor anchors zOrder limbWidth gaitParts partJoints overrides mapping masks normal targets projection joints chains camera contact audit_policy options accepted rejected vocabulary decided_by_agent params arguments config motion_parts recipe defs",
);
names(
  arr(),
  "subjects assets members placed layers faces edges depth_regions repeats bands tiles variants parts frames notes findings operations annotations contacts foot_contacts",
);
names(
  arr(str),
  "directions sprites cels order clips targets_list expectedParts questions constraints palette_entries",
);
Object.assign(types, {
  w: { ...int, minimum: 1, maximum: 2048 },
  h: { ...int, minimum: 1, maximum: 2048 },
  zoom: { ...int, minimum: 1, maximum: 40 },
  direction: dir,
  directions: arr(dir),
  region: box,
  p0: point,
  p1: point,
  offset: point,
  at: point,
  light: tuple(2),
  light_vector: tuple(2),
  canvas: {
    anyOf: [
      tuple(2, int),
      {
        type: "object",
        properties: { w: types.w, h: types.h },
        required: ["w", "h"],
        additionalProperties: false,
      },
    ],
  },
  map: { anyOf: [str, arr({ type: "string" })] },
  grid: str,
  cells: { anyOf: [str, arr(obj)] },
  notes: { anyOf: [str, arr(obj)] },
  idx: index,
  from: { anyOf: [str, arr(str), num] },
  to: index,
  colors: arr({ anyOf: [str, tuple(3)] }),
  source: arr(arr(tuple(3))),
  rows: arr(arr(str)),
  shape: obj,
  opacity: { ...num, minimum: 0, maximum: 1 },
  tier: choice("hero", "support", "background", "system"),
  provenance: {
    type: "object",
    properties: { origin: str, source: str, license: str },
    required: ["origin"],
    additionalProperties: true,
  },
  options: arr(obj),
  subjects: arr(obj),
  targets: arr(str),
  out: str,
  image: str,
  slot: str,
  score: { ...num, minimum: 0, maximum: 1 },
});

const contracts = {};
function define(name, fields, group, required = [], overrides = {}, example) {
  const properties = {};
  for (const token of fields.split(" ").filter(Boolean)) {
    const field = token.replace(/!$/, "");
    if (!types[field] && !overrides[field])
      throw new Error(`No schema for ${name}.${field}`);
    properties[field] = overrides[field] || types[field];
    if (token.endsWith("!")) required.push(field);
  }
  contracts[name] = {
    group,
    inputSchema: {
      type: "object",
      properties,
      required: [...new Set(required)],
      additionalProperties: false,
    },
    examples: example ? [example] : [],
  };
}
const defs = (group, entries) => {
  for (const [name, fields] of Object.entries(entries))
    define(name, fields, group);
};

defs("project", {
  project_init: "root game! style! canvas directions fps",
  project_open: "root!",
  style_list: "",
  style_load: "id!",
  style_create: "id! bible!",
  assert_style: "cel! sprite cel_key style asset_class",
  sprite_create:
    "id! w! h! palette! style! anchor layers rig directions clips tier asset_class design",
  sprite_info: "id!",
  sprite_list: "",
  sprite_delete: "id!",
  tools_list: "",
  resize_canvas: "id! w! h!",
  layer_add: "id! layer! z",
  layer_remove: "id! layer!",
  layer_reorder: "id! order!",
  layer_opacity: "opacity!",
  save_cel: "cel! sprite! cel_key",
  provenance: "sprite",
  session_stats: "",
  coverage_report: "",
});
defs("style", {
  style_options: "axis! subjects! count stage palette zoom",
  style_pick: "axis! option! note coordinate",
  style_reject: "axis! reason! option",
  style_translate: "plain_language!",
  review_pack: "subject! options! stage palette style light",
  style_signature: "style bible palette",
  taste_read: "",
  taste_write: "accepted rejected vocabulary decided_by_agent style",
  compare: "a! b!",
  annotate: "cel! notes!",
  sketch_analyse: "path! provenance!",
  palette_get: "id!",
  palette_set: "id! spec colors",
  create_ramp: "hue saturation value steps gamma hueShift hueLock",
  ramp_between: "from! to! steps",
  quantise_to_palette: "source rows palette! name",
  gradient_map: "cel! from! to! mapping",
  palette_audit: "id! sprites min_step_delta",
});
defs("drawing", {
  get_pixel_map: "cel! sprite cel_key region",
  draw_pixel_map: "cel! map! x y region expected_hash",
  put: "cel! cells! expected_hash",
  fill_region: "cel! idx! region at flood expected_hash",
  draw_line: "cel! p0! p1! idx! line_width expected_hash",
  draw_shape: "cel! shape! idx! expected_hash",
  stroke_shape: "cel! shape! idx! expected_hash",
  paint_form: "cel! ramp material region light expected_hash",
  aa_pass: "cel! region strength expected_hash",
  dither_pass: "cel! region density pattern from to expected_hash",
  outline_pass: "cel! policy color_role outline region expected_hash",
  specular_pass: "cel! region ramp material light expected_hash",
  contact_shadow: "cel! ramp at_row steps region expected_hash",
  cast_shadow: "cel! ramp light length region expected_hash",
  glow: "cel! ramp at radius falloff expected_hash",
  shift_along_ramp: "cel! steps! region expected_hash",
  replace_color: "cel! from! to! region expected_hash",
  erase: "cel! region expected_hash",
  mirror: "cel! axis into",
  transform: "cel! into offset flipX flipY scale",
  cel_copy: "cel! into!",
  cel_offset: "cel! offset! baseline",
  cel_link: "clip! direction! a! b!",
  cel_set_opacity: "cel! opacity!",
  undo: "cel!",
  redo: "cel!",
  snapshot: "cel!",
  restore: "key snapshot",
  cel_list: "",
  cel_new: "cel! w! h! palette!",
  cel_from_grid: "cel! grid! palette!",
  cel_to_grid: "cel!",
});
defs("animation", {
  rig_create:
    "id! canvas! baseline! anchors! zOrder! partJoints limbWidth gaitStride gaitParts",
  pose_define: "name! spec! clip",
  skin_pose: "skin! rig! pose! direction! name spec style",
  clip_create: "id! template! directions fps sprite",
  clip_set_frames: "clip! direction! frames! sprite",
  timing_apply: "clip! curve durations fps",
  direction_derive: "skin! from! to!",
  loop_validate: "clip! poses",
  motion_report: "clip! direction",
  smear_frame: "clip! direction! frame! amount",
  hit_flash: "clip! direction! frame! ramp",
  impact_squash: "clip! direction! frame! amount axis",
  event_add: "clip! direction! frame! event!",
  clip_info: "clip!",
  clip_list: "",
  skin_define: "id! palette! parts! sprite",
});
defs("review", {
  view: "cel! sprite cel_key style zoom region labelEvery",
  chunk: "cel! region! style zoom",
  contact_sheet: "clip direction cels palette zoom baseline",
  contact_grid: "clip! palette zoom silhouette",
  onion: "clip! direction! frame! zoom",
  play: "clip! direction zoom",
  silhouette: "cel! zoom style",
  squint: "cel! zoom style",
  value_map: "cel! zoom style",
  game_scale: "cel! zoom style ground",
  diff: "a! b! zoom",
  heatmap: "cel! zoom style",
  audit:
    "cel! style tier light perspective place depth_regions depth_toward edges no_faces allow_disconnected",
  craft_metrics: "cel! light",
  craft_targets: "cel! style",
  regression_check: "id! image! capture",
  export_gate: "style! palette! clips",
});
defs("export", {
  import_png: "path file provenance! palette! name",
  export_sheet: "style! palette! clips cels sprite cols pad duration out image",
  export_manifest: "dir targets",
  export_gif: "clip! direction name zoom",
  export_indexed_png: "cel! name out",
  export_tileset: "tiles! palette! tile name out",
  export_harness: "scene! name out",
});
defs("world", {
  part_add: "id! cel! slot! style! palette! anchor",
  part_list: "",
  assemble: "name! assignments! palette! style! canvas",
  family_audit: "members! style palette",
  batch_relint: "assets! palette! style!",
  tier_policy: "tier",
  material_define: "id! spec!",
  autotile_index: "",
  tile_edge_check: "a! b! edge!",
  variant_lint: "variants! palette! style",
  tileset_audit: "tiles! palette! style!",
  tile_repeat: "tiles! palette!",
  structure: "id! tiles! footprint! contact_row! palette style",
  scene_create: "id! spec",
  scene_place: "scene! kind! cel! at! footprint contact_row id",
  scene_review: "scene! palette",
  ambient_rederive: "palette! scene! id",
  perspective_declare: "id! spec!",
  perspective_list: "",
  depth_slice: "palette! ramp! bands! toward perspective",
  depth_shade: "cel! ramp! z! region! bands! toward perspective",
  faces_declare: "cel! ramp! faces! light bands toward lightWeight",
  face_shade: "cel! ramp!",
  face_audit: "cel! ramp light",
  shadow_cast: "cel! light ground_row height ramp apply",
  depth_audit:
    "cel! perspective! edges faces depth_regions placed repeats light zoom",
  occlusion_sort: "placed scene",
  parallax_plan: "layers! perspective",
});
// Extension recipe fields are still typed and discoverable, even when the
// mathematical engine owns detailed semantic validation.
contracts.project_init.inputSchema.properties.style = coordinate;
contracts.project_init.inputSchema.properties.id = str;
contracts.project_init.inputSchema.required = ["style"];
contracts.project_init.inputSchema.anyOf = [
  { required: ["game"] },
  { required: ["id"] },
];
contracts.style_create.inputSchema.properties.bible = coordinate;
contracts.cel_link.inputSchema.properties.a = { ...int, minimum: 0 };
contracts.cel_link.inputSchema.properties.b = { ...int, minimum: 0 };
contracts.cel_link.examples = [{ clip: "walk", direction: "down", a: 0, b: 1 }];
contracts.palette_set.inputSchema.anyOf = [
  { required: ["spec"] },
  { required: ["colors"] },
];
contracts.restore.inputSchema.anyOf = [
  { required: ["key"] },
  { required: ["snapshot"] },
];
contracts.import_png.inputSchema.anyOf = [
  { required: ["path"] },
  { required: ["file"] },
];
contracts.quantise_to_palette.inputSchema.anyOf = [
  { required: ["source"] },
  { required: ["rows"] },
];
contracts.contact_sheet.inputSchema.anyOf = [
  { required: ["clip"] },
  { required: ["cels", "palette"] },
];
contracts.style_signature.inputSchema.anyOf = [
  { required: ["style"] },
  { required: ["bible"] },
];
contracts.occlusion_sort.inputSchema.anyOf = [
  { required: ["placed"] },
  { required: ["scene"] },
];
Object.assign(contracts.draw_pixel_map, {
  examples: [
    {
      cel: "lantern.base",
      map: ["..!!..", ".!##!.", ".!##!.", "..!!.."],
      x: 2,
      y: 2,
    },
  ],
});
contracts.put.examples = [{ cel: "lantern.base", cells: "4,3,metal.2" }];
contracts.project_open.examples = [{ root: "/path/to/game" }];
contracts.cel_new.examples = [
  { cel: "lantern.base", w: 16, h: 16, palette: "items" },
];
contracts.view.examples = [{ cel: "lantern.base", style: "items", zoom: 12 }];

function amend(name, properties, required) {
  Object.assign(contracts[name].inputSchema.properties, properties);
  if (required) contracts[name].inputSchema.required = required;
}
amend("motion_report", { expected_parts: arr(str) });
amend("smear_frame", { palette: str, ramp: str, trail: num });
amend("hit_flash", { palette: str }, ["clip", "direction", "frame", "palette"]);
amend("event_add", { data: obj });
amend("view", {
  mode: str,
  name: str,
  asset_class: str,
  light: tuple(2),
  label_every: int,
  legend: bool,
});
amend("chunk", { asset_class: str });
amend("contact_sheet", { mode: str, stamp: str, name: str }, ["cels"]);
delete contracts.contact_sheet.inputSchema.anyOf;
amend("contact_grid", { label_w: int, mode: str, stamp: str }, [
  "clip",
  "palette",
]);
amend("onion", { cels: arr(str), palette: str, index: int }, []);
contracts.onion.inputSchema.anyOf = [
  { required: ["clip", "direction"] },
  { required: ["cels"] },
];
amend("play", { directions: arr(dir), palette: str }, ["clip", "palette"]);
amend("game_scale", { ambient: str, tile: int });
define("diff", "before after expect zoom", "review", ["before", "after"], {
  before: str,
  after: str,
  expect: obj,
});
amend("export_sheet", { skip_gate: bool });
amend("export_gif", { cels: arr(str), palette: str }, ["palette"]);
contracts.export_gif.inputSchema.anyOf = [
  { required: ["clip"] },
  { required: ["cels"] },
];
amend("export_harness", { dir: str });
amend("part_add", { part: str, anchor_offset: point, tags: arr(str) }, [
  "part",
  "cel",
  "slot",
  "anchor",
]);
amend(
  "assemble",
  {
    w: types.w,
    h: types.h,
    anchors: obj,
    z_order: arr(str),
    into: str,
    id: str,
    parts: obj,
  },
  ["parts"],
);
amend("family_audit", { assets: arr(obj), family: str }, ["assets", "family"]);
amend("tile_edge_check", { cel: str, palette: str }, ["cel", "palette"]);
amend("tile_repeat", { cel: str, n: { ...int, minimum: 1, maximum: 16 } }, [
  "cel",
]);
amend("structure", { cel: str, tile: int }, ["cel"]);
amend(
  "scene_create",
  {
    cols: { ...int, minimum: 1, maximum: 128 },
    rows: { ...int, minimum: 1, maximum: 128 },
    tile: { ...int, minimum: 1, maximum: 128 },
    palette: str,
    ambient: { anyOf: [str, obj] },
  },
  ["id", "cols", "rows", "palette"],
);
amend("ambient_rederive", { ambient: { anyOf: [str, obj] } }, [
  "palette",
  "ambient",
]);
amend(
  "perspective_declare",
  {
    style: str,
    allow_parallel: bool,
    bands_n: int,
    projection: str,
    horizon: num,
    vanishing: point,
    focal: num,
    eye: num,
    near: num,
    far: num,
    unit: num,
  },
  ["id", "projection", "horizon", "vanishing", "focal", "eye"],
);
amend("depth_slice", { bands_n: int }, ["palette", "ramp"]);
amend("depth_shade", { bands_n: int, band_index: int }, [
  "cel",
  "ramp",
  "region",
]);
amend("faces_declare", { depth: obj }, ["cel", "faces"]);
amend("face_shade", { faces: arr(obj), light: tuple(2) }, ["cel"]);
amend(
  "material_define",
  { hue: num, saturation: num, value: num, steps: int, colors: types.colors },
  ["id"],
);
amend("create_ramp", {
  base: { anyOf: [str, tuple(3)] },
  shadowHueShift: num,
  lightHueShift: num,
});
amend("create_ramp", {
  colors: types.colors,
  value: tuple(2),
  steps: { ...int, minimum: 1, maximum: 93 },
  satCurve: tuple(2),
  warmEnd: choice("lit", "shadow"),
});
contracts.create_ramp.inputSchema.anyOf = [
  { required: ["colors"] },
  { required: ["base", "steps"] },
];
contracts.create_ramp.examples = [
  { base: "#597c72", steps: 4, value: [0.15, 0.8], hueShift: 12 },
];
amend("draw_pixel_map", { origin: point });
amend("get_pixel_map", { format: choice("map", "json") });
amend("fill_region", { flood: point, boundary: index });
amend("draw_line", { slope_policy: choice("cluster", "bresenham") });
amend("draw_shape", {
  shape: { anyOf: [str, obj] },
  x: int,
  y: int,
  w: types.w,
  h: types.h,
  coverage_warn: num,
});
amend("stroke_shape", {
  shape: { anyOf: [str, obj] },
  x: int,
  y: int,
  w: types.w,
  h: types.h,
});
amend("paint_form", {
  seed: int,
  form: choice("sphere", "box", "cylinder", "cloth"),
  contrast: num,
  onlyMaterial: bool,
  steps: tuple(2, int),
});
amend("aa_pass", { max_per_edge: int });
amend("dither_pass", { on_edge: bool });
amend("outline_pass", { light: tuple(2) });
amend("contact_shadow", {
  row: int,
  spread: { ...int, minimum: 0, maximum: 32 },
});
amend("cast_shadow", {
  idx: index,
  shear: num,
  length: { ...int, minimum: 1, maximum: 2048 },
});
amend("shift_along_ramp", { roles: arr(str) });
amend("transform", { flip: choice("x", "y") });
amend("export_gif", { delay: { ...num, minimum: 1 } });
amend("export_gate", { allow_imported: bool, assetClass: str });
amend("export_sheet", { allow_imported: bool, assetClass: str });
amend("clip_set_frames", {
  frames: {
    type: "array",
    minItems: 1,
    maxItems: 256,
    items: {
      type: "object",
      properties: {
        cel: str,
        pose: str,
        duration: { ...num, minimum: 1 },
        events: arr(json),
      },
      required: ["cel", "duration"],
      additionalProperties: false,
    },
  },
});
contracts.timing_apply.inputSchema.anyOf = [
  { required: ["curve"] },
  { required: ["durations"] },
  { required: ["fps"] },
];
contracts.timing_apply.inputSchema.properties.curve = choice(
  "even",
  "walk-stride",
  "heavy-walk",
  "attack-weighted",
  "attack-heavy",
  "run-sprint",
  "idle-breathe",
  "hurt-snap",
  "death-fall",
);

const CEL_SELECTOR = {
  anyOf: [{ required: ["cel"] }, { required: ["sprite", "cel_key"] }],
};
function attach(registry) {
  for (const [name, tool] of Object.entries(registry)) {
    const c = contracts[name];
    if (!c) throw new Error(`Tool ${name} has no input contract`);
    // Existing file-based cel selectors remain an alternative to warm-state IDs.
    if (
      c.inputSchema.properties.cel &&
      c.inputSchema.required.includes("cel")
    ) {
      c.inputSchema.properties.palette ||= str;
      c.inputSchema.properties.sprite ||= str;
      c.inputSchema.properties.cel_key ||= str;
      c.inputSchema.required = c.inputSchema.required.filter(
        (k) => k !== "cel",
      );
      c.inputSchema.anyOf = CEL_SELECTOR.anyOf;
    }
    for (const [field, schema] of Object.entries(c.inputSchema.properties)) {
      if (!schema.description)
        c.inputSchema.properties[field] = {
          ...schema,
          description:
            {
              cel: "Warm cel ID, or sprite/key for saved art",
              palette: "Previously declared palette ID",
              style: "Previously declared style ID",
              map: "Rows of palette-index characters; dot means transparent",
              expected_hash:
                "Hash returned by get_pixel_map for stale-edit detection",
              region: "Integer rectangle in native art pixels",
              root: "Absolute art project root containing art/project.json",
              clip: "Declared animation clip ID",
              spec: "Structured recipe; engine validates its semantics",
              asset: "Saved art workflow ID",
            }[field] || field.replaceAll("_", " "),
        };
    }
    Object.assign(tool, c);
  }
}

function validate(schema, value, at = "arguments") {
  const errors = [];
  if (
    schema.anyOf &&
    !schema.anyOf.some((s) => validate(s, value, at).length === 0)
  )
    errors.push(`${at}: must match one of the documented alternatives`);
  if (schema.enum && !schema.enum.includes(value))
    errors.push(`${at}: expected one of ${schema.enum.join(", ")}`);
  const actual =
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const types = schema.type ? [schema.type].flat() : [];
  if (
    types.length &&
    !types.some(
      (t) =>
        t === actual ||
        (t === "integer" && actual === "number" && Number.isInteger(value)),
    )
  )
    return [...errors, `${at}: expected ${types.join(" or ")}`];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(`${at}: expected a finite number`);
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${at}: minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${at}: maximum ${schema.maximum}`);
  }
  if (
    typeof value === "string" &&
    schema.minLength &&
    value.length < schema.minLength
  )
    errors.push(`${at}: cannot be empty`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      errors.push(`${at}: requires at least ${schema.minItems} entries`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      errors.push(`${at}: allows at most ${schema.maxItems} entries`);
    if (schema.items)
      value.forEach((v, i) =>
        errors.push(...validate(schema.items, v, `${at}[${i}]`)),
      );
  } else if (value && typeof value === "object") {
    for (const key of schema.required || [])
      if (!Object.hasOwn(value, key)) errors.push(`${at}.${key}: required`);
    for (const [key, v] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        errors.push(`${at}.${key}: reserved key`);
      else if (schema.properties?.[key])
        errors.push(...validate(schema.properties[key], v, `${at}.${key}`));
      else if (schema.additionalProperties === false)
        errors.push(`${at}.${key}: unknown field`);
      else if (
        schema.additionalProperties &&
        typeof schema.additionalProperties === "object"
      )
        errors.push(
          ...validate(schema.additionalProperties, v, `${at}.${key}`),
        );
    }
  }
  return errors;
}

module.exports = {
  attach,
  contracts,
  define,
  validate,
  types,
  str,
  num,
  int,
  bool,
  obj,
  arr,
  tuple,
  choice,
  json,
  dir,
  point,
  box,
  coordinate,
};
