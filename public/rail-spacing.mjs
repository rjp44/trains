// A knot is a position along the original railway. Everything at that position
// moves together. Constraints describe the clear width between pairs of knots.
export function corridorSpacing(routeWidth, footprints, spans) {
  const clearance = 4;
  const knots = new Set([0, routeWidth]);
  for (const f of footprints) knots.add(f.x);
  for (const [a, b] of spans) { knots.add(a); knots.add(b); }
  const source = [...knots].sort((a, b) => a - b);
  const last = source.length - 1;
  const index = new Map(source.map((x, i) => [x, i]));
  const edges = source.map(() => new Map());
  function separate(i, j, distance) {
    if (i < j && distance > (edges[i].get(j) ?? 0)) edges[i].set(j, distance);
  }
  // Keep the projection invertible even between two otherwise empty knots.
  for (let i = 0; i < last; i++) separate(i, i + 1, Math.min(0.5, source[i + 1] - source[i]));
  for (const [a, b, distance] of spans) separate(index.get(a), index.get(b), distance);

  // Only objects sharing a horizontal strip compete for its width. Combine
  // objects at the same knot before comparing them with the next occupied knot.
  const rows = new Map();
  for (const f of footprints) {
    const i = index.get(f.x);
    separate(0, i, clearance - f.left);
    separate(i, last, clearance + f.right);
    for (let y = Math.floor(f.top); y < Math.ceil(f.bottom); y++) {
      if (!rows.has(y)) rows.set(y, new Map());
      const row = rows.get(y), bounds = row.get(i);
      if (bounds) {
        bounds[0] = Math.min(bounds[0], f.left);
        bounds[1] = Math.max(bounds[1], f.right);
      } else row.set(i, [f.left, f.right]);
    }
  }
  for (const row of rows.values()) {
    let previous;
    for (const [i, [left, right]] of [...row].sort(([a], [b]) => a - b)) {
      if (previous) separate(previous.i, i, previous.right + clearance - left);
      previous = { i, right };
    }
  }

  // The two passes give the earliest and latest legal position of each knot
  // within the minimum width. Their midpoint keeps unconstrained branches centred.
  const earliest = source.map(() => 0), remaining = source.map(() => 0);
  for (let i = 0; i < last; i++)
    for (const [j, gap] of edges[i]) earliest[j] = Math.max(earliest[j], earliest[i] + gap);
  for (let i = last - 1; i >= 0; i--)
    for (const [j, gap] of edges[i]) remaining[i] = Math.max(remaining[i], remaining[j] + gap);
  const minimum = earliest[last];
  const tight = earliest.map((left, i) => (left + minimum - remaining[i]) / 2);
  const normalWidth = Math.max(routeWidth, minimum);
  // Restore spare space first to the stretches that had it in the source diagram.
  const spare = [0];
  for (let i = 1; i <= last; i++)
    spare.push(spare[i - 1] + Math.max(0, source[i] - source[i - 1] - (tight[i] - tight[i - 1])));
  const minZoom = minimum / normalWidth;
  return {
    minZoom,
    normalWidth,
    at(requestedZoom) {
      const zoom = Math.max(minZoom, requestedZoom);
      const width = normalWidth * zoom;
      const slack = Math.min(width, normalWidth) - minimum;
      const extra = Math.max(0, width - normalWidth);
      const positions = tight.map((x, i) => x + slack * (spare[last] ? spare[i] / spare[last] : 0)
        + extra * source[i] / routeWidth);
      return {
        zoom, width,
        project: (x) => interpolate(x, source, positions),
        unproject: (x) => interpolate(x, positions, source),
      };
    },
  };
}

function interpolate(x, from, to) {
  let lo = 0, hi = from.length - 1;
  if (x <= from[lo]) return to[lo];
  if (x >= from[hi]) return to[hi];
  while (hi - lo > 1) {
    const mid = (hi + lo) >> 1;
    if (from[mid] <= x) lo = mid;
    else hi = mid;
  }
  return to[lo] + (to[hi] - to[lo]) * (x - from[lo]) / (from[hi] - from[lo]);
}

// Lay out a whole station band, including off-screen stops. Required signs
// have space reserved by the track layout. Optional signs may use either row
// wherever they fit without displacing a required sign.
export function placeRailSigns(signs, routeWidth) {
  const gap = 4, tolerance = 0.01;
  function place(items) {
    const ends = [-Infinity, -Infinity], result = [];
    for (const sign of items) {
      const left = sign.x - sign.width / 2, right = sign.x + sign.width / 2;
      if (left < gap - tolerance || right > routeWidth - gap + tolerance) return null;
      const row = ends.findIndex(end => end + gap <= left + tolerance);
      if (row < 0) return null;
      ends[row] = right;
      result.push({...sign, row});
    }
    return result;
  }
  const sorted = [...signs].sort((a, b) => (a.x - a.width / 2) - (b.x - b.width / 2));
  const all = place(sorted);
  if (all) return all;
  const kept = new Set(sorted.filter(s => !s.optional));
  let placed = place([...kept]);
  if (!placed) return null;
  for (const sign of sorted) {
    if (!sign.optional) continue;
    const trial = place(sorted.filter(s => s === sign || kept.has(s)));
    if (trial) { kept.add(sign); placed = trial; }
  }
  return placed;
}

// At the sector overview every track must fit. First exhaust empty space at
// normal symbol size. If the infrastructure still needs more room, shrink uniformly,
// including the frozen legend, until the complete drawing fits the panel.
export function railViewProjection(spacing, request, viewport, margin, fitSector) {
  const tight = spacing.normalWidth * spacing.minZoom;
  const crowded = viewport < tight + margin;
  const minZoom = crowded
    ? spacing.minZoom * (fitSector ? viewport / (tight + margin) : 1)
    : (viewport - margin) / spacing.normalWidth;
  const zoom = Math.max(minZoom, request);
  const axis = spacing.at(zoom);
  return {axis, zoom, minZoom, scale: zoom / axis.zoom};
}
