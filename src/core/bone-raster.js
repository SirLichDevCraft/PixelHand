"use strict";

// Nearest-neighbour inverse sampling of an authored segment. Only its length is
// projected; its width stays in authored pixels. No new colour or alpha is made.
function* bonePixels(part, start, end, canvas) {
  const bind = part.bindVector,
    offset = part.anchorOffset || [0, 0];
  if (!Array.isArray(bind) || bind.length !== 2 || !bind.every(Number.isFinite))
    throw Object.assign(
      new Error(
        "A bone-attached part needs bind: [dx,dy] in its authored facing",
      ),
      { rule: "bone_bind" },
    );
  const bindLength = Math.hypot(...bind),
    target = [end[0] - start[0], end[1] - start[1]],
    targetLength = Math.hypot(...target);
  if (bindLength < 1e-6 || targetLength < 1e-6)
    throw Object.assign(
      new Error(
        "A projected bone collapsed; select an authored foreshortened pose variant",
      ),
      { rule: "bone_foreshortened" },
    );
  const u = bind.map((v) => v / bindLength),
    v = [-u[1], u[0]],
    t = target.map((n) => n / targetLength),
    q = [-t[1], t[0]],
    ratio = targetLength / bindLength;
  const pivot = [-offset[0], -offset[1]],
    source = part.cel;
  const transform = (x, y) => {
    const rx = x - pivot[0],
      ry = y - pivot[1],
      along = (rx * u[0] + ry * u[1]) * ratio,
      across = rx * v[0] + ry * v[1];
    return [
      start[0] + t[0] * along + q[0] * across,
      start[1] + t[1] * along + q[1] * across,
    ];
  };
  const corners = [
    transform(-0.5, -0.5),
    transform(source.w - 0.5, -0.5),
    transform(-0.5, source.h - 0.5),
    transform(source.w - 0.5, source.h - 0.5),
  ];
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0])))),
    x1 = Math.min(
      canvas[0] - 1,
      Math.ceil(Math.max(...corners.map((p) => p[0]))),
    );
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1])))),
    y1 = Math.min(
      canvas[1] - 1,
      Math.ceil(Math.max(...corners.map((p) => p[1]))),
    );
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const rx = x - start[0],
        ry = y - start[1],
        along = (rx * t[0] + ry * t[1]) / ratio,
        across = rx * q[0] + ry * q[1];
      const sx = Math.round(pivot[0] + u[0] * along + v[0] * across),
        sy = Math.round(pivot[1] + u[1] * along + v[1] * across);
      const index = source.get(sx, sy);
      if (index >= 0) yield { x, y, index };
    }
}
module.exports = { bonePixels };
