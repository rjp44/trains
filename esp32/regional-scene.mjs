import { directionalScene } from './directional-scene.mjs';
import { slots } from '../public/regional.mjs';
// The whole line runs down each successive column, in timetable order.
export function regionalScene(layout, markers, view) {
  if (layout.diagram === 'directional') return directionalScene(layout,markers,view);
  const focus = layout.tracks.findIndex((t) => t.id === layout.focus);
  const tracks = [layout.tracks, layout.tracks.slice(0, focus + 1), layout.tracks.slice(focus)][view];
  const cols = tracks.length > 15 ? 4 : tracks.length > 8 ? 3 : 2;
  const rows = Math.ceil(tracks.length / cols),
    w = 1000 / cols,
    pitch = 520 / rows;
  const lines = [],
    labels = [],
    placed = [];
  const label = (x, y, width, font, ink, text, preset = 0) =>
    labels.push([Math.round(x), Math.round(y), Math.round(width), font, ink, -1, text, preset]);
  for (let col = 0; col < cols; col++) {
    const stops = tracks.slice(col * rows, (col + 1) * rows);
    if (!stops.length) continue;
    const left = 12 + col * w,
      rail = Math.round(left + 9),
      y0 = 39;
    lines.push([rail, y0, rail, Math.round(y0 + (stops.length - 1) * pitch), 3, 3]);
    if (col) lines.push([Math.round(left - 3), 16, Math.round(left - 3), 550, 8, 1]);
    stops.forEach((t, i) => {
      const y = Math.round(y0 + i * pitch),
        group = layout.tracks.indexOf(t) < focus ? 1 : 2;
      lines.push([rail - 4, y, rail + 4, y, 4, 7]);
      label(left + w / 2 + 6, y, w - 28, 16, 1, t.name, view === 0 ? group : 0);
      const start = markers.findIndex((m) => m.track.id === t.id);
      for (let n = 0; n < slots; n++) {
        const x = Math.round(left + 29 + ((w - 40) * ((n % 4) + 0.5)) / 4);
        const cy = y + 24 + Math.floor(n / 4) * 24;
        placed.push([start + n, x, cy, cy, 0]);
      }
      // Show a selection of individually identified signal indications in the
      // available row. Every signal shown retains its actual address and label.
      const available = t.berths.filter((b) => b.bit);
      const count = Math.min(available.length, Math.floor((w - 30) / 65));
      if (pitch >= 92)
        for (let n = 0; n < count; n++) {
          const x = Math.round(left + 26 + n * 65),
            sy = y + 70;
          placed.push([start + slots + t.berths.indexOf(available[n]), x, sy - 15, sy, 4]);
          label(x + 28, sy, 50, 10, 2, available[n].signal);
        }
    });
  }
  const locCount = tracks.length;
  label(620, 578, 740, 12, 2, locCount + ' reporting locations   |   West Coast Main Line');
  return {
    Lines: lines,
    Labels: labels,
    Markers: placed.sort((a, b) => a[2] - b[2] || a[1] - b[1]),
    Space: [[0, 0, 0, 0], [0, 0, 0, 0], 54, 20],
  };
}
