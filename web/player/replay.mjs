export function seek(p, ms) {
  let frame,
    berth,
    track,
    entry = null;
  for (const f of p.replay.frames) {
    if (f.at > ms) break;
    const b = p.scene.berths.find((b) => b.id === f.berth);
    track = p.scene.tracks.find((t) => t.id === b?.track);
    if (frame && b && b !== berth && b.stage === 'station')
      entry = { at: f.at, direction: track.direction, booked: Boolean(f.matched) };
    frame = f;
    berth = b;
  }
  const card = berth?.stage === 'station' || (berth?.stage === 'approach' && Boolean(frame.matched));
  return { frame, berth, track, card, entry };
}
export function draw(p, s, g) {
  const { station, tracks, berths, card: c } = p.scene,
    { service } = p.replay;
  const bg = '#112827',
    ink = '#e5f0e6',
    muted = '#abc3b6',
    rail = '#79938b',
    amber = '#ffcb65';
  g.rect(0, 0, 1024, 600, bg);
  g.text(22, 16, station.name, ink, 550);
  g.text(798, 16, 'Recorded movement', muted, 215);
  const top = Math.min(...tracks.map((t) => t.y)),
    bottom = Math.max(...tracks.map((t) => t.y));
  g.rect(station.x - 15, top - 40, 30, bottom - top + 64, '#254b44');
  g.text(station.x - 22, top - 72, station.id, ink, 65);
  for (const t of tracks) {
    g.text(16, t.y - 10, t.name, ink, 103);
    g.rect(115, t.y - 1, 890, 3, rail);
    g.rect(station.x - 17, t.y + 8, 35, 4, muted);
    for (const b of berths.filter((b) => b.track === t.id))
      g.rect(station.x + b.offsetX - 1, t.y - 7, 3, 15, rail);
  }
  if (s.berth) {
    const x = station.x + s.berth.offsetX,
      y = s.track.y;
    g.rect(x - 24, y - 14, 49, 27, amber);
    g.text(x - 20, y - 11, service.head, bg, 44);
  }
  if (!s.card) return;
  g.rect(c.x, c.y, c.width, c.height, '#21433e');
  g.rect(c.x, c.y, 4, c.height, amber);
  const x = c.x + 13,
    width = c.width - 22,
    step = Math.floor((c.height - 6) / 3);
  g.text(x, c.y + 2, service.head + '   ' + s.track.name + ' | ' + s.berth.context, amber, width);
  if (s.frame.matched) {
    g.text(x, c.y + 2 + step, service.route, ink, width);
    g.text(x, c.y + 2 + 2 * step, s.frame.timing, muted, width);
  } else g.text(x, c.y + 2 + step, 'Service details unavailable', muted, width);
}
