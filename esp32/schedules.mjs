import { schedulePath, readHemelScheduleRoot } from '../public/hemel.mjs';

export function scheduleCache(root, formatDay) {
  const schedules = new Map();
  function lookup(service, canRequest) {
    const path = service && schedulePath(service, undefined, formatDay);
    if (!path) return null;
    const key = service.id + path;
    let entry = schedules.get(key);
    if (!entry && canRequest) {
      entry = { retry: 0 };
      schedules.set(key, entry);
    }
    if (!entry) return null;
    entry.used = Date.now();
    if (canRequest && entry.used >= entry.retry) {
      entry.retry = Infinity;
      entry.pending = true;
      fetch('https://openrail.railcam.uk/rail/livetrain/' + path.split('/').slice(-4).join('/'), {
        signal: AbortSignal.timeout(8000),
      })
        .then(async (res) =>
          res.ok
            ? readHemelScheduleRoot(root(await res.text()), service, path)
            : null,
        )
        .then((call) => {
          if (call) entry.call = call;
        })
        .catch(() => {})
        .finally(() => {
          entry.pending = false;
          if (!entry.call || (entry.call.booked && !Number.isFinite(entry.call.delay)))
            entry.retry = Date.now() + 45000;
        });
    }
    return entry.call ?? (entry.pending ? { pending: true } : null);
  }
  function expire(now) {
    for (const [key, value] of schedules) if (now - value.used > 900000) schedules.delete(key);
  }
  return { lookup, expire };
}
