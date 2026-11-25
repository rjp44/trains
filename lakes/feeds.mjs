import { busFixes, railFixes } from './public/model.mjs';

export function createVehicleFeed(readBusArchive) {
  const sources = {
    bus: {
      url: 'https://data.bus-data.dft.gov.uk/avl/download/bulk_archive',
      interval: 60_000,
      async decode(res) {
        const data = await readBusArchive(await res.arrayBuffer());
        return { generated: Date.parse(data.updated), vehicles: busFixes(data.rows) };
      },
    },
    rail: {
      url: 'https://api.railinfo.uk/map/trains',
      interval: 30_000,
      async decode(res) {
        const data = await res.json();
        return { generated: Date.parse(data.generated_at), vehicles: railFixes(data) };
      },
    },
  };
  const cache = new Map();
  async function live(type) {
    const old = cache.get(type);
    if (old?.pending) return old.pending;
    if (old && Date.now() - old.value.checked < sources[type].interval) return old.value;
    const entry = { value: old?.value };
    const { url, decode } = sources[type];
    entry.pending = (async () => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'LakesTransitMap/0.1 (rjp44/trains)' },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw Error('HTTP ' + res.status);
        entry.value = { ...(await decode(res)), ok: true, checked: Date.now() };
      } catch (error) {
        entry.value = {
          ...entry.value,
          ok: false,
          checked: Date.now(),
          vehicles: entry.value?.vehicles || [],
        };
        console.warn(type + ' feed unavailable', error.message);
      } finally {
        entry.pending = null;
      }
      return entry.value;
    })();
    cache.set(type, entry);
    return entry.pending;
  }
  return async () => {
    const [bus, rail] = await Promise.all([live('bus'), live('rail')]);
    return { time: Date.now(), bus, rail };
  };
}
