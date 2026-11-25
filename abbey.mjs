// Railinfo's per-service calling points carry explicit arrived/departed states.
// Match the timetable at both ends before attaching a report to a relay train ID.
let day;
function londonDay(time) {
  day ??= new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return day.format(time);
}
const crs = new Map([
  ['WATFORD JUNCTION', 'WFJ'],
  ['ST ALBANS ABBEY', 'SAA'],
]);
export function abbeyCandidates(catalogue, now) {
  return [...catalogue].filter(
    ([, s]) =>
      crs.has(s.ol) &&
      crs.has(s.dl) &&
      s.ol !== s.dl &&
      !s.f &&
      !s.c &&
      s.st <= now + 120000 &&
      s.st >= now - 5400000 &&
      /^\d{4}$/.test(s.od),
  );
}
export const serviceLookup = 'https://api.railinfo.uk/services/lookup';
export function lookupParameters(s, formatDay = londonDay) {
  return { crs: crs.get(s.ol), dep: s.od, date: formatDay(s.st) };
}
export function lookupURL(s, endpoint = serviceLookup) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams(lookupParameters(s));
  return url;
}
export function stationReport([id, s], journey, stations) {
  const calls = journey.calls;
  if (
    journey.cancelled ||
    !Array.isArray(calls) ||
    calls.at(0)?.crs !== crs.get(s.ol) ||
    calls.at(-1)?.crs !== crs.get(s.dl) ||
    journey.summary?.dep?.replace(':', '') !== s.od
  )
    return null;
  const call = calls.findLast(
    (c) => stations.has(c.crs) && ['departed', 'arrived'].includes(c.status) && c.cancelled !== true,
  );
  if (!call) return null;
  return {
    id,
    head: (s.tic || s.ti).slice(2, 6),
    origin: s.ol,
    destination: s.dl,
    departure: s.od,
    arrival: s.da,
    operator: s.tc,
    uid: s.sk?.slice(0, 6),
    delay: call.variation_min,
    station: call.crs,
    action: call.status,
    at: call.expected || null,
  };
}
