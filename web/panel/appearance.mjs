const locations = {
  hemel: ['Hemel Hempstead', 51.75, -0.47],
  lakes: ['Windermere', 54.38, -2.9],
};
const londonDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const londonTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
});

export function readSetting(key, fallback = null) {
  try {
    return JSON.parse(localStorage.getItem('transport.' + key)) ?? fallback;
  } catch {
    return fallback;
  }
}
export function saveSetting(key, value) {
  try {
    localStorage.setItem('transport.' + key, JSON.stringify(value));
  } catch {}
}
export function solarDays(daily) {
  const rise = daily?.sunrise,
    set = daily?.sunset;
  if (!Array.isArray(rise) || !Array.isArray(set) || rise.length !== 7 || set.length !== 7) return [];
  const days = rise.map((r, i) => [r * 1000, set[i] * 1000]);
  return days.every(
    ([r, s], i) =>
      Number.isSafeInteger(rise[i]) &&
      Number.isSafeInteger(set[i]) &&
      r >= 1700000000000 &&
      s > r &&
      s - r < 86400000 &&
      s < 4102444800000 &&
      (!i || Math.abs(r - days[i - 1][0] - 86400000) < 3600000),
  )
    ? days
    : [];
}
export function dayAt(days, now) {
  return days.find(([rise]) => londonDay.format(rise) === londonDay.format(now));
}
export function mapAppearance(id, initial, apply, report) {
  const [place, latitude, longitude] = locations[id];
  let theme = readSetting(id + '.theme', initial);
  if (theme !== 'light' && theme !== 'dark') theme = initial;
  let auto = readSetting('sunAuto', false) === true;
  const key = id + '.sun';
  let cached = readSetting(key),
    days = solarDays(cached?.daily);
  let busy = false,
    retryAt = 0,
    painted;
  function paint(value) {
    theme = value;
    if (readSetting(id + '.theme') !== value) saveSetting(id + '.theme', value);
    if (painted !== value) {
      apply(value);
      painted = value;
    }
  }
  async function tick() {
    const time = Date.now();
    const today = dayAt(days, time);
    if (auto && today) paint(time >= today[0] && time < today[1] ? 'light' : 'dark');
    report(
      auto ? 'auto' : theme,
      auto
        ? place +
            (today
              ? ' · Sunrise ' +
                londonTime.format(today[0]) +
                ' · Sunset ' +
                londonTime.format(today[1]) +
                ' (UK time)'
              : navigator.onLine
                ? ' · Waiting for sunrise times'
                : ' · Waiting for a connection')
        : '',
    );
    if (
      !auto ||
      busy ||
      !navigator.onLine ||
      time < retryAt ||
      (today && time >= cached.fetched && time - cached.fetched < 86400000)
    )
      return;
    busy = true;
    try {
      const query = new URLSearchParams({
        latitude,
        longitude,
        daily: 'sunrise,sunset',
        timezone: 'Europe/London',
        timeformat: 'unixtime',
        forecast_days: '7',
      });
      const response = await fetch('https://api.open-meteo.com/v1/forecast?' + query, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw Error();
      const { daily } = await response.json();
      const next = solarDays(daily);
      if (!dayAt(next, Date.now())) throw Error();
      days = next;
      cached = { daily, fetched: Date.now() };
      saveSetting(key, cached);
    } catch {
      retryAt = Date.now() + 300000;
    } finally {
      busy = false;
    }
    tick();
  }
  paint(theme);
  tick();
  setInterval(() => {
    if (!document.hidden) tick();
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) tick();
  });
  window.addEventListener('online', () => {
    retryAt = 0;
    tick();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'transport.sunAuto' || event.key === 'transport.' + id + '.theme') {
      auto = readSetting('sunAuto', false) === true;
      if (!auto) paint(readSetting(id + '.theme', initial));
      tick();
    }
  });
  return function choose(value) {
    auto = value === 'auto';
    saveSetting('sunAuto', auto);
    if (!auto) paint(value === 'toggle' ? (theme === 'light' ? 'dark' : 'light') : value);
    tick();
  };
}
