// All dimensions are SVG units. Keep two rows for station signs above the
// highest signal, with a separate row on either side for junction captions.
const signRows = [59, 32];
const captionRows = { section: 10, approach: 80 };
const gap = 4;

export function stationLabelSpans(width, labels) {
  const signs = labels.filter(l => l.kind === 'station').sort((a, b) => a.x - b.x);
  const spans = [];
  for (const [i, sign] of signs.entries()) {
    spans.push([0, sign.x, gap - sign.left], [sign.x, width, gap + sign.right]);
    // This guarantees that all names can fit in two rows at minimum zoom.
    // Actual rows are chosen afresh from the screen positions at every zoom.
    if (i >= 2) {
      const previous = signs[i - 2];
      spans.push([previous.x, sign.x, previous.right + gap - sign.left]);
    }
  }
  return spans;
}

export function placeStationLabels(axis, labels) {
  const items = labels.map(l => {
    const x = axis.project(l.x);
    return { label: l, left: x + l.left, right: x + l.right };
  }).sort((a, b) => a.left - b.left);

  function pack(includeJunctions) {
    const positions = new Map();
    const ends = new Map();
    for (const { label, left, right } of items) {
      if (!includeJunctions && label.kind !== 'station') continue;
      if (left < gap - 0.01 || right > axis.width - gap + 0.01) return null;
      const rows = label.kind in captionRows ? [captionRows[label.kind]] : signRows;
      const y = rows.find(row => left >= (ends.get(row) ?? -Infinity) + gap - 0.01);
      if (y === undefined) return null;
      ends.set(y, right);
      positions.set(label, y);
    }
    return positions;
  }
  // Try the entire named view, including off-screen locations, as one set.
  // Hidden junctions then use no space and panning cannot change visibility.
  return pack(true) ?? pack(false);
}
