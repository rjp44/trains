// Station roads in cross-section. A bay opens towards one end of the corridor.
// Sources and the limits of the throat schematics are in web/corridor/README.md.
const stations = {
  CREWE: {
    roads: ['12', '11', '10', '9', '8', '7', '6', 'DF', 'UF', '5', '4', '3', '2', '1'],
    northBays: ['9', '10'], southBays: ['2', '3', '4', '7', '8'],
    // The two platformless fast lines pass between platforms 5 and 6.
    positions: { DF: ['CE0153', 'CE0124'], UF: ['CE0155', 'CE0126'] },
  },
  PRST: { roads: ['6', '5', '4', '3', '2', '1'] },
  WIGANNW: { roads: ['6', '5', '4', '3', '1'], southBays: ['3'] },
  STAFFRD: { roads: ['6', '5', '4', '3', 'DF', 'UF', '1'], positions: { UF: ['R33584'] } },
  WVRMPTN: { roads: ['6', '5', '1', '2', '3', '4'], northBays: ['6'], southBays: ['5'] },
  STECHFD: { roads: ['3', '2', '1'] },
  BHAMNWS: {
    roads: ['1', '2', '3', '4', '4C', '5', 'S1', '6', '7', 'S2', '8', '9', 'S3', '10', '11', '12'],
    northBays: ['4C'],
    positions: {
      '4C': ['NS5114'], '11': ['NS6211'],
      S1: ['NS7321', 'NS8241'], S2: ['NS7322', 'NS8442'], S3: ['NS7323', 'NS8843'],
    },
    // Pairs of platform roads reached at each end of the centre siding.
    sidings: { S1: ['6', '5'], S2: ['8', '8'], S3: ['9', '9'] },
  },
  BHAMINT: { roads: ['5', '4', '3', '2', '1'] },
};

export function platformScene(station) {
  const plan = stations[station.id];
  if (!plan) return null;
  const rows = plan.roads.map((key, i) => {
    const berths = station.berths.filter((b) =>
      plan.positions?.[key]?.includes(b.id) ||
      (b.platform === key && !(station.id === 'BHAMNWS' && !b.id.startsWith('NS'))));
    // In route order the Down exit is at the north/west end, the Up exit
    // at the south/east end. Reports sharing an end are schematic positions.
    const order = (b) => ({ down: 0, both: 1, up: 2 })[b.direction];
    berths.sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
    if (key === 'DF' || key === 'UF')
      berths.sort((a, b) => plan.positions?.[key]?.indexOf(a.id) - plan.positions?.[key]?.indexOf(b.id));
    const pitch = Math.min(58, 420 / (plan.roads.length - 1));
    const y = Math.round(328 + (i - (plan.roads.length - 1) / 2) * pitch);
    const siding = plan.sidings?.[key];
    return { key, berths, y, siding, north: !siding && !plan.southBays?.includes(key), south: !siding && !plan.northBays?.includes(key) };
  });
  const gap = 144, margin = 150;
  const longest = Math.max(...rows.map((r) => r.berths.length), 2);
  const width = 2 * margin + (longest + 1) * gap;
  const centre = width / 2;
  const points = [];
  rows.forEach((row, i) => {
    // Stagger neighbouring rows so a signal cannot cover a train on the next track.
    const stagger = i % 2 ? gap / 4 : -gap / 4;
    row.berths.forEach((berth, j) => {
      const dx = (j - Math.floor(row.berths.length / 2)) * gap + stagger;
      points.push({ berth, dx, y: row.y });
    });
  });
  return { station, rows, points, width, centre };
}
