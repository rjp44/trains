// Ordered north/west to south/east. Running lines keep their corridor ordinate.
// Other roads end at the edge of their labelled approach or at a buffer stop.
// Signal-to-road references are listed in web/corridor/README.md.
export const mainY = { DS: 140, DF: 198, UF: 256, US: 314 };
const approaches = {
  WRGTNBQ: {
    before: { name: 'Dallam Junction', main: { DS: ['WA0181'], DF: ['WA0182'], US: ['WA0176'] } },
  },
  WIGANNW: {
    before: { name: 'Wigan North Junction', main: { DF: ['WA0008'], UF: ['WA0011'] } },
    after: { name: 'Wigan South / Springs Branch', main: { DF: ['WA0052'], UF: ['WA0056'] } },
  },
  CREWE: {
    before: { name: 'Crewe North Junction', main: { UF: ['CE0144'], US: ['CE0146'] },
      branches: [
        ['Up Chester', ['CE0142']], ['Down Manchester', ['CE0148']], ['Up Manchester', ['CE0150']],
        ['Manchester loop', ['CE0152']], ['EMU siding', ['CE0566'], 'buffer'],
      ] },
    after: { name: 'Crewe South Junction', main: { DS: ['CE0105'], DF: ['CE0107'] },
      branches: [
        ['Shed 1', ['CE0535'], 'buffer'], ['Shed 2', ['CE0537'], 'buffer'],
        ['Down siding', ['CE0531'], 'buffer'], ['South Yard', ['CE0543']],
      ] },
  },
  BHAMNWS: {
    before: { name: 'New Street west approaches',
      main: { UF: ['NS9185', 'NS4182'], DF: ['NS4187'] },
      branches: [['Five Ways · in', ['NS3506']], ['Five Ways · out', ['NS3503']]] },
    after: { name: 'Proof House Junction',
      main: { UF: ['PJ0149', 'NS9145'], DF: ['NS4141'] },
      branches: [['Derby line', ['NS9931']], ['Derby line', ['NS4929']]] },
  },
  STECHFD: {
    before: { name: 'Aston approach', branches: [['From Aston', ['PJ4608']], ['To Aston', ['PJ4609']]] },
  },
  BHAMINT: {
    before: { name: 'Marston Green approach', main: { DF: ['PJ4115'] } },
    after: { name: 'Towards Hampton-in-Arden', main: { UF: ['PJ4092'], DF: ['PJ4097'] } },
  },
};

export function stationApproaches(id) {
  return approaches[id] ?? {};
}

export function approachRoadName(station, id) {
  for (const zone of Object.values(stationApproaches(station))) {
    for (const [key, ids] of Object.entries(zone.main ?? {})) {
      if (!ids.includes(id)) continue;
      const four = station === 'CREWE' || (station === 'WRGTNBQ' && zone === approaches.WRGTNBQ.before);
      return (key[0] === 'D' ? 'Down ' : 'Up ') + (four ? (key[1] === 'S' ? 'Slow' : 'Fast') : 'Main');
    }
    for (const [name, ids] of zone.branches ?? []) if (ids.includes(id)) return name;
  }
  return '';
}
