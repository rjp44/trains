import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { atStation, locateFollow, watchArrivals, watchStations } from '../public/rail-watch.mjs';
import { hemelCall } from '../public/hemel.mjs';

const layout = file => JSON.parse(readFileSync(new URL(file, import.meta.url)));
const station = { berths: [['AA01', 1], ['AA02', 1], ['BB01', -1]] };
const ids = station.berths.map(([id]) => id);

test('both regional endpoints and all Hemel stations have watchable reports', () => {
  for (const [id, first, last] of [
    ['preston-crewe', 'PRST', 'CREWE'],
    ['crewe-birmingham', 'CREWE', 'BHAMINT'],
  ]) {
    const stops = watchStations(layout('../apps/' + id + '/data/corridor.json'));
    assert.equal(stops[0].id, first);
    assert.equal(stops.at(-1).id, last);
    assert(stops.every(s => s.berths.length && s.location));
  }
  const stops = watchStations(layout('../public/data/corridor.json'));
  assert.equal(new Set(stops.map(s => s.id)).size, stops.length);
  assert(stops.every(s => s.berths.length && s.location));
  assert(stops.find(s => s.id === 'SAA').berths.some(([id]) => id === 'ABSAA'));
});

test('watch sounds for a new train and seeds silently after Follow and reconnect', () => {
  const events = watchArrivals(), sounds = [], board = { values: {}, services: {} };
  let live = true;
  const sample = () => events.sample(atStation(station,board,()=>live),station,()=>live,t=>sounds.push(t.head));
  board.values.AA01='1A01';sample();
  board.values.BB01='2B02';sample();
  board.values.AA02='1A01';sample();
  live=false;sample();board.values.BB01='3C03';live=true;sample();
  events.reset();board.values.AA01='4D04';sample();
  assert.deepEqual(sounds,['2B02']);
});

test('follow uses the identified service as it crosses areas and ends when another train reuses its code', () => {
  const s={id:'service-1'}, other={id:'service-2'}, target={head:'1A01',berth:'AA01'};
  const board={values:{AA01:'1A01'},services:{'AA/1A01':s}};
  assert.equal(locateFollow(target,ids,board).service,s);
  board.values={AA02:'1A01',BB01:'1A01'};board.services={'AA/1A01':other,'BB/1A01':s};
  assert.equal(locateFollow(target,ids,board).berth,'BB01');
  delete board.values.BB01;
  assert.equal(locateFollow(target,ids,board),null);
  assert.equal(locateFollow({head:'1A01',berth:'AA99'},ids,{values:{AA01:'1A01',AA02:'1A01'},services:{}}),null);
});

test('a confirmed call at the watched location can qualify for the stopping horn', () => {
  const blank={public:'',working:'',actual:''};
  const rows=[
    {location:'CREWE',activity:'Train begins',arrival:blank,departure:{...blank,public:'10:01'},pass:''},
    {location:'WVRMPTN',activity:'',arrival:blank,departure:blank,pass:'10:45'},
    {location:'BHAMINT',activity:'Train finishes',arrival:{...blank,public:'11:05'},departure:blank,pass:''},
  ];
  assert.equal(hemelCall(rows,'CREWE').booked,'10:01');
  assert(hemelCall(rows,'WVRMPTN').passing);
  assert.equal(hemelCall(rows,'BHAMINT').booked,'11:05');
});
