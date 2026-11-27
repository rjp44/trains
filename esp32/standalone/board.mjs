import { locationArrivals } from '../../public/regional.mjs';
import { parseHTML } from 'linkedom/worker';
import layout from '../../public/data/corridor.json';
import { createLiveFeed } from '../../live.mjs';
import { lookupParameters, serviceLookup } from '../../abbey.mjs';
import { stationArrivals } from '../arrivals.mjs';
import { createProjection, encoder } from '../projection.mjs';
import { scheduleCache } from '../schedules.mjs';
import * as platform from './platform.mjs';

Object.assign(globalThis, {
  WebSocket: platform.RelaySocket, setTimeout: platform.timeout, clearTimeout: platform.clear,
  setInterval: platform.interval, clearInterval: platform.clear, fetch: platform.get,
  AbortController: platform.Controller, AbortSignal: platform.Signal,
});
export const { opened, message, closed, tick, request, response } = platform;
const regional = layout.profile === 'regional';
const arrivals = regional ? locationArrivals(layout) : stationArrivals(layout);
// The native binding formats the UK civil date with the GMT/BST timezone rule.
const formatDay = (time) => globalThis.londonDate(time);
function abbeyURL(service) {
  const params = lookupParameters(service, (time) => {
    const [dd, mm, yy] = formatDay(time).split('/');
    return '20' + yy + '-' + mm + '-' + dd;
  });
  return serviceLookup + '?crs=' + params.crs + '&dep=' + params.dep + '&date=' + params.date;
}
const feed = createLiveFeed(layout, { abbeyURL, onFrame: arrivals.accept, onReset: arrivals.reset });
const { project, fingerprint } = createProjection(layout);
const schedules = scheduleCache((html) => parseHTML(html).document.documentElement, formatDay);
const encode = encoder(fingerprint);
export const start = () => feed.start();
export function status() {
  const { status, error } = feed.snapshot();
  return error ? status + ' (' + error + ')' : status;
}
let visibleHeads = '';
export const cardHeads = () => visibleHeads;
export function packet(force) {
  const raw = feed.snapshot(), now = Date.now();
  const entries = arrivals.take(regional ? Object.values(raw.areaStatus).includes('Live') : raw.areaStatus.R1 === 'Live', now,
    head => schedules.lookup(raw.services['R1/' + head], false)?.booked);
  if (!raw.observed) return '';
  schedules.expire(now);
  const view = project(raw, schedules.lookup, true, now);
  visibleHeads = view.cards.map((c) => c[0]).filter(Boolean).join(' ');
  return encode(view, { Live: 1, Partial: 2, Stale: 3 }[raw.status] || 0,
    !!force, force ? '' : entries);
}
