import { unzipSync } from 'fflate';
import { SaxesParser } from 'saxes';
import { routes } from './public/model.mjs';

const fields = {
  VehicleActivity: { RecordedAtTime: 'time' },
  MonitoredVehicleJourney: {
    LineRef: 'line',
    PublishedLineName: 'route',
    OperatorRef: 'operator',
    VehicleRef: 'id',
    Monitored: 'monitored',
    Bearing: 'bearing',
    DestinationName: 'destination',
    OriginRef: 'origin',
    DestinationRef: 'terminus',
    OriginAimedDepartureTime: 'departure',
  },
  VehicleLocation: { Longitude: 'lon', Latitude: 'lat' },
  FramedVehicleJourneyRef: { DataFrameRef: 'serviceDate' },
};

// SAX keeps just the current activity while processing the national SIRI document.
export function readBusArchive(buffer) {
  const files = unzipSync(new Uint8Array(buffer), {
    filter: (f) => f.name === 'siri.xml' && f.originalSize <= 150_000_000,
  });
  const xml = files['siri.xml'];
  if (!xml) throw Error('Missing or oversized SIRI document');
  const rows = [],
    stack = [],
    parser = new SaxesParser();
  let row, updated, field, value;
  parser.on('opentag', (tag) => {
    const name = tag.name.split(':').pop();
    const parent = stack.at(-1);
    stack.push(name);
    if (name === 'VehicleActivity') row = {};
    field = row
      ? fields[parent]?.[name]
      : !updated && name === 'ResponseTimestamp' && parent === 'ServiceDelivery'
        ? 'updated'
        : null;
    value = '';
  });
  const append = (part) => {
    if (field) value += part;
  };
  parser.on('text', append);
  parser.on('cdata', append);
  parser.on('closetag', () => {
    if (field === 'updated') updated = value.trim();
    else if (field && row) row[field] = value.trim();
    field = null;
    if (stack.pop() !== 'VehicleActivity') return;
    row.route ||= row.line;
    if (
      row.operator === 'SCCU' &&
      row.monitored !== 'false' &&
      row.route !== 'rail' &&
      Object.hasOwn(routes, row.route) &&
      row.id &&
      row.lon &&
      row.lat
    )
      rows.push(row);
    row = null;
  });
  const decoder = new TextDecoder();
  for (let i = 0; i < xml.length; i += 65536)
    parser.write(decoder.decode(xml.subarray(i, i + 65536), { stream: true }));
  parser.write(decoder.decode()).close();
  if (!Number.isFinite(Date.parse(updated))) throw Error('Invalid SIRI delivery time');
  return { rows, updated };
}
