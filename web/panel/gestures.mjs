// Keep a tap on its original SVG target. Capture only after movement, since map redraws replace markers.
export function mapGestures(svg, { drag, pinch, finish }) {
  const points = new Map();
  let start,
    previous,
    pair,
    multi,
    moved = false;
  function geometry() {
    const [a, b] = points.values();
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, span: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || points.has(e.pointerId)) return;
    const p = { x: e.clientX, y: e.clientY };
    if (!points.size) {
      start = previous = p;
      multi = moved = false;
    }
    points.set(e.pointerId, p);
    if (points.size === 2) {
      pair = geometry();
      multi = moved = true;
      for (const id of points.keys()) svg.setPointerCapture(id);
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!points.has(e.pointerId)) return;
    const p = { x: e.clientX, y: e.clientY };
    points.set(e.pointerId, p);
    if (points.size === 2) {
      const next = geometry();
      if (pair && pair.span > 0 && pinch(pair, next)) pair = next;
    } else if (!multi && (moved || Math.hypot(p.x - start.x, p.y - start.y) > 5)) {
      moved = true;
      svg.setPointerCapture(e.pointerId);
      drag(previous, p);
      previous = p;
    }
  });
  const end = (e) => {
    if (!points.delete(e.pointerId)) return;
    if (points.size === 2) pair = geometry();
    if (!points.size && moved) finish?.();
  };
  for (const name of ['pointerup', 'pointercancel']) window.addEventListener(name, end);
  svg.addEventListener('lostpointercapture', (e) => {
    if (e.target === svg) end(e);
  });
  svg.addEventListener(
    'click',
    (e) => {
      if (moved && e.detail !== 0) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );
}
