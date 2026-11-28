import {watchStations,atStation,watchArrivals} from '../../public/rail-watch.mjs';
import {withStationReports} from '../../rail.mjs';
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
const { project, fingerprint,markers } = createProjection(layout);
const markerIndex=new Map(markers.map((b,i)=>[b.id,i]));
const schedules = scheduleCache((html) => parseHTML(html).document.documentElement, formatDay);
const encode = encoder(fingerprint, true);
export const start = () => feed.start();
export function status() {
  const { status, error } = feed.snapshot();
  return error ? status + ' (' + error + ')' : status;
}
const stations=watchStations(layout), stationEvents=watchArrivals(), pending=new Map();
let watch=regional?'@legacy':'HML';
export function watchStation(id) {
  if(watch===id) return;
  watch=id; stationEvents.reset(); pending.clear();
}
let visibleHeads = '';
export function freshAreas() {
  const state=feed.snapshot();
  return Object.keys(state.areaStatus).filter(a=>state.areaStatus[a]==='Live').concat(state.abbey?.available && Date.now()-state.abbey.checked<90000 ? ['AB']:[]).join(' ');
}
export const cardHeads = () => visibleHeads;
export function packet(force) {
  const raw = feed.snapshot(), now = Date.now();
  let entries = arrivals.take(regional ? Object.values(raw.areaStatus).includes('Live') : raw.areaStatus.R1 === 'Live', now,
    head => schedules.lookup(raw.services['R1/' + head], false)?.booked);
  if (!raw.observed) return '';
  schedules.expire(now);
  const view = project(raw, !regional && watch==='HML' ? schedules.lookup : ()=>null, true, now);
  if(watch!=='@legacy' && (regional || watch!=='HML')) {
    entries='';
    const s=stations.find(s=>s.id===watch), board=regional?raw:withStationReports(raw);
    const fresh=area=>area==='AB' ? board.abbey?.available && now-board.abbey.checked<90000 : board.areaStatus?.[area]==='Live';
    const trains=atStation(s,board,fresh);
    stationEvents.sample(trains,s,fresh,t=>{
      const key=t.service?.id || t.berth.slice(0,2)+'/'+t.head;
      pending.set(key,{t,at:now});
    });
    for(const t of trains) if(t.service) schedules.lookup(t.service,true,s.location);
    for(const [key,{t,at}] of pending) {
      const call=t.service && schedules.lookup(t.service,true,s.location);
      if(call?.pending && now-at<9000) continue;
      if(fresh(t.berth.slice(0,2)) && now-at<15000) {
        const d=t.direction>0?'D':'U';
        entries+=call?.booked || t.service?.station===s.id && t.service?.action ? d.toLowerCase():d;
      }
      pending.delete(key);
    }
    entries=entries.slice(0,8);
    // The device cards share the service row with the inspector.
    for(const train of trains) {
      const call=train.service && schedules.lookup(train.service,false,s.location);
      const index=markerIndex.get(train.berth);
      if(index!=null && call && !call.pending) view.rows[index][5]=[call.booked?'Booked '+call.booked.replace('½','H'):'Passing',view.rows[index][5]].join(' | ').slice(0,94);
    }
  }
  visibleHeads = view.cards.map((c) => c[0]).filter(Boolean).join(' ');
  return encode(view, { Live: 1, Partial: 2, Stale: 3 }[raw.status] || 0,
    !!force, force ? '' : entries);
}
