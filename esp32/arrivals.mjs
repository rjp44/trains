// Accept only Corridor's admitted TD frames. A full R1 frame always reseeds
// all four berths, including empty addresses omitted by the relay.
import { hemelBerths, isTrainCode } from '../public/hemel.mjs';

export function stationArrivals(layout) {
  const berths = hemelBerths(layout).filter((b) => b.stage === 'station');
  const occupied = new Map();
  let pending = [], seeded = false;
  function reset() {
    occupied.clear();
    pending = [];
    seeded = false;
  }
  function accept(frame) {
    if (frame.area !== 'R1' || !frame.values) return;
    if (frame.full) reset();
    if (!frame.full && !seeded) return;
    for (const { id, direction } of berths) {
      if (!(id in frame.values)) continue;
      const head = frame.values[id] || '';
      if (seeded && isTrainCode(head) && occupied.get(id) !== head) {
        pending.push({ head, time: frame.time, direction: direction === 1 ? 'D' : 'U' });
        if (pending.length > 8) pending.shift();
      }
      occupied.set(id, head);
    }
    seeded = true;
  }
  function take(live, now = Date.now(), isBooked = () => false) {
    const directions = live ? pending.filter((e) => Math.abs(now - e.time) < 6500).map((e) => isBooked(e.head) ? e.direction.toLowerCase() : e.direction).join('') : '';
    pending = [];
    return directions;
  }
  return { accept, reset, take };
}
