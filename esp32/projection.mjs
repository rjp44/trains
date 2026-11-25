// The asset packer and live bridge must agree on the marker index and its meaning.
import { crc32 } from 'node:zlib';
import { corridorTracks, withStationReports } from '../rail.mjs';
import {
  cardCandidates,
  describeCard,
  hemelBerths,
  hemelTrains,
  isTrainCode,
  operators,
  stationName,
} from '../public/hemel.mjs';

const plain = (s, max = 128) =>
  String(s ?? '')
    .replaceAll(' → ', ' to ')
    .replaceAll(' · ', ' | ')
    .replaceAll('½', '.5')
    .replaceAll('…', '...')
    .replace(/[^ -~]/g, ' ')
    .slice(0, max);
const clock = (s) =>
  /^\d{4}H?$/.test(s) ? s.slice(0, 2) + ':' + s.slice(2, 4) + (s.endsWith('H') ? '.5' : '') : '';

function detail(service) {
  if (!service?.id) return ['', service?.ambiguous ? 'Several services share this headcode' : '', ''];
  const times = [clock(service.departure), clock(service.arrival)].filter(Boolean).join(' to ');
  const delay = !Number.isFinite(service.delay)
    ? ''
    : service.delay === 0
      ? 'On time'
      : Math.abs(service.delay) + ' min ' + (service.delay > 0 ? 'late' : 'early');
  return [
    plain(service.id, 24),
    plain(stationName(service.origin) + ' to ' + stationName(service.destination)),
    plain([operators[service.operator] || service.operator, times, delay].filter(Boolean).join(' | ')),
  ];
}

export function createProjection(layout) {
  const markers = corridorTracks(layout).flatMap((track) => track.berths.map((b) => ({ ...b, track })));
  const fingerprint = crc32(markers.map((b) => [b.id, b.bit || ''].join('/')).join(','));
  const berths = hemelBerths(layout);
  function project(board, lookup, live = false, now = Date.now()) {
    const state = withStationReports(board);
    const fresh = (area) =>
      area === 'AB'
        ? state.abbey?.available && (!live || now - state.abbey.checked < 90000)
        : live
          ? state.areaStatus?.[area] === 'Live'
          : Boolean(state.areaTimes[area]);
    const rows = markers.map((b) => {
      const area = b.id.slice(0, 2),
        head = plain(state.values[b.id], 12),
        current = fresh(area);
      const aspect = current ? ({ on: 1, off: 2 }[state.values[b.bit]] ?? 0) : 0;
      const kind = !head ? 0 : !current ? 3 : isTrainCode(head) ? 1 : 2;
      return [aspect, kind, head, ...detail(head && state.services[area + '/' + head])];
    });
    const groups = fresh('R1') ? hemelTrains(berths, state, fresh) : { fast: [], slow: [] };
    const cards = Object.values(groups).flatMap((trains) => {
      const choices = cardCandidates(trains, lookup);
      return [0, 1].map((i) => {
        const train = choices[i];
        if (!train) return ['', '', '', '', 0];
        const d = describeCard(train);
        return [
          plain(d.head, 12),
          plain(d.context),
          plain(d.route),
          plain([d.company, d.timing].filter(Boolean).join(' · ')),
          crc32([train.track, train.head, train.service?.id, train.stage].join('/')) || 1,
        ];
      });
    });
    return { rows, cards, observed: Math.floor((state.observed || 0) / 1000) };
  }
  return { markers, fingerprint, project };
}

// Each packet is an atomic full snapshot or a delta against the previous sequence.
// A periodic snapshot also repairs a one-way serial link without a return channel.
export function encoder(fingerprint) {
  let sequence = 0,
    previous;
  return ({ rows, cards, observed }, status, forceFull = false) => {
    const full = forceFull || !previous || sequence % 10 === 0;
    sequence = sequence === 0xffffffff ? 1 : sequence + 1;
    const lines = [];
    const changed = (a, b) => a.some((v, i) => v !== b[i]);
    rows.forEach((r, i) => {
      if (full ? r[0] || r[1] : changed(r, previous.rows[i])) lines.push(['M', i, ...r].join('\t'));
    });
    cards.forEach((c, i) => {
      if (full ? c[4] : changed(c, previous.cards[i])) lines.push(['C', i, ...c].join('\t'));
    });
    previous = { rows, cards };
    const body =
      [`@H1\t${fingerprint}\t${sequence}\t${full ? 'F' : 'D'}\t${status}\t${observed}`, ...lines].join('\n') +
      '\n';
    return body + '!' + crc32(body) + '\n';
  };
}
