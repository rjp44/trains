"""Extract the Lake District panel's published trips from regional BODS GTFS and NaPTAN."""
import argparse
import csv
import io
import json
import math
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from zipfile import ZipFile

LINES = {'505', '508', '516', '555', '599', 'X4', 'X5', 'X6'}
# The winter feed splits 555 workings at central Kendal (54.33 N). The other X4 is in Lancaster.
MIN_ENDPOINT_LAT = {'555': 54.32, 'X4': 54.55}
WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


def seconds(value):
    h, m, s = map(int, value.split(':'))
    return h * 3600 + m * 60 + s


def distance(a, b):
    return math.hypot((a[0] - b[0]) * 65000, (a[1] - b[1]) * 111200)


def pair_opposite_stops(groups, stops, official, routes_at):
    # Some opposing poles have different names. Require a shared route, locality and street,
    # opposing pole bearings and a mutually nearest neighbour within 120 metres.
    compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    singles = [g['refs'][0] for g in groups if len(g['refs']) == 1]
    nearest = {}
    for a in singles:
        left = official.get(a, {})
        if not left.get('Street') or left.get('Bearing') not in compass:
            continue
        candidates = []
        for b in singles:
            right = official.get(b, {})
            if (left['Street'].casefold() != right.get('Street','').casefold()
                or left['LocalityName'] != right.get('LocalityName') or right.get('Bearing') not in compass
                or not routes_at[a].intersection(routes_at[b])):
                continue
            diff = abs(compass.index(left['Bearing']) - compass.index(right['Bearing']))
            metres = distance(stops[a]['point'], stops[b]['point'])
            if diff in (3, 4, 5) and metres <= 120:
                candidates.append((metres, b))
        if candidates:
            nearest[a] = min(candidates)[1]
    for a, b in nearest.items():
        if a < b and nearest.get(b) == a:
            first, other = groups[stops[a]['group']], groups[stops[b]['group']]
            first['name'] += ' / ' + other['name']
            first['refs'].append(b)
            other['refs'].clear()
    groups[:] = [g for g in groups if g['refs']]
    for i, g in enumerate(groups):
        for ref in g['refs']:
            stops[ref]['group'] = i


def extract(archive, naptan, winter_end, cache):
    def rows(table):
        with archive.open(table + '.txt') as source:
            yield from csv.DictReader(io.TextIOWrapper(source, encoding='utf-8-sig'))

    feed = next(rows('feed_info'))
    start = date.fromisoformat(feed['feed_start_date'])
    end = min(winter_end, date.fromisoformat(feed['feed_end_date']))
    if end < start:
        raise ValueError('Feed starts after this map edition ends')
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    agencies = {r['agency_id'] for r in rows('agency') if r['agency_noc'] == 'SCCU'}
    routes = {r['route_id']: r['route_short_name'] for r in rows('routes')
              if r['agency_id'] in agencies and r['route_short_name'] in LINES}
    if set(routes.values()) != LINES:
        raise ValueError('Missing Stagecoach routes')
    trips = {r['trip_id']: r for r in rows('trips') if r['route_id'] in routes}
    services = {r['service_id'] for r in trips.values()}
    calendars = {s: ['0'] * len(days) for s in services}
    for r in rows('calendar'):
        if r['service_id'] in services:
            for i, day in enumerate(days):
                if r['start_date'] <= day.strftime('%Y%m%d') <= r['end_date']:
                    calendars[r['service_id']][i] = r[WEEK[day.weekday()]]
    for r in rows('calendar_dates'):
        if r['service_id'] in services:
            i = (date.fromisoformat(r['date']) - start).days
            if 0 <= i < len(days):
                calendars[r['service_id']][i] = '1' if r['exception_type'] == '1' else '0'
    calendars = {s: ''.join(bits) for s, bits in calendars.items() if '1' in bits}
    trips = {k: r for k, r in trips.items() if r['service_id'] in calendars}
    calls = defaultdict(list)
    # The regional stop_times file has millions of rows. Read the trip ID first.
    with archive.open('stop_times.txt') as raw:
        reader = csv.reader(io.TextIOWrapper(raw, encoding='utf-8-sig'))
        header = next(reader)
        key = header.index('trip_id')
        for values in reader:
            if values[key] in trips:
                r = dict(zip(header, values))
                calls[values[key]].append((int(r['stop_sequence']), r['stop_id'],
                    seconds(r['arrival_time']), seconds(r['departure_time']), r['pickup_type'] != '1',
                    r['timepoint'] != '0', r['drop_off_type'] != '1'))
    if set(calls) != set(trips):
        raise ValueError('Missing stop times for selected trip')
    stop_rows = {r['stop_id']: r for r in rows('stops')}
    endpoints = defaultdict(set)
    for key, t in list(trips.items()):
        line = routes[t['route_id']]
        if line not in MIN_ENDPOINT_LAT:
            continue
        seq = sorted(calls[key])
        ends = [seq[0][1], seq[-1][1]]
        if any(float(stop_rows[ref]['stop_lat']) < MIN_ENDPOINT_LAT[line] for ref in ends):
            del trips[key], calls[key]
        else:
            endpoints[line].update(ends)

    # Export the actual road traces of the retained trips, including shorter and seasonal variants.
    shape_lines = defaultdict(set)
    for t in trips.values():
        shape_lines[t['shape_id']].add(routes[t['route_id']])
    points = defaultdict(list)
    with archive.open('shapes.txt') as raw:
        reader = csv.reader(io.TextIOWrapper(raw, encoding='utf-8-sig'))
        header = next(reader)
        key, seq, lon, lat = [header.index(k) for k in ('shape_id', 'shape_pt_sequence', 'shape_pt_lon', 'shape_pt_lat')]
        for row in reader:
            if row[key] in shape_lines:
                points[row[key]].append((int(row[seq]), round(float(row[lon]), 6), round(float(row[lat]), 6)))
    shapes = {line: [] for line in sorted(LINES)}
    for shape_id, lines in shape_lines.items():
        if len(points[shape_id]) < 2:
            raise ValueError('Missing road trace ' + shape_id)
        trace = [(lon, lat) for _, lon, lat in sorted(points[shape_id])]
        for line in lines:
            shapes[line].append(trace)
    cache.mkdir(parents=True, exist_ok=True)
    (cache / 'bus-shapes.json').write_text(json.dumps(shapes, separators=(',', ':')))
    coverage = {}
    for line, traces in shapes.items():
        xs, ys = zip(*(p for trace in traces for p in trace))
        # Allow about a kilometre for location uncertainty and short diversions.
        coverage[line] = {'bounds': [round(min(xs)-.016, 5), round(min(ys)-.01, 5),
                                     round(max(xs)+.016, 5), round(max(ys)+.01, 5)]}
        if line in endpoints:
            coverage[line]['endpoints'] = sorted(endpoints[line])
    (Path(__file__).resolve().parents[1] / 'bus-coverage.json').write_text(json.dumps(coverage, indent=2) + '\n')
    used = {call[1] for trip in calls.values() for call in trip}
    official = {r['ATCOCode']: r for r in csv.DictReader(naptan) if r['ATCOCode'] in used}
    stops, groups = {}, []
    by_name = defaultdict(list)
    for r in sorted(stop_rows.values(), key=lambda r: r['stop_id']):
        ref = r['stop_id']
        if ref not in used:
            continue
        n = official.get(ref, {})
        name, town = n.get('CommonName') or r['stop_name'], n.get('LocalityName', '')
        point = [round(float(r['stop_lon']), 6), round(float(r['stop_lat']), 6)]
        # Combine nearby opposing poles and stands with the same official name and locality.
        candidates = by_name[(name.casefold(), town.casefold())]
        group = next((i for i in candidates if all(distance(point, stops[s]['point']) <= 220
                     for s in groups[i]['refs'])), None)
        if group is None:
            group = len(groups)
            groups.append(dict(name=name, town=town, refs=[]))
            candidates.append(group)
        groups[group]['refs'].append(ref)
        indicator = n.get('Indicator', '')
        side = ' · '.join(filter(None, [indicator if indicator.lower() not in ('at','by','opp','near','adj') else '',
                                        n.get('Bearing', '')]))
        stops[ref] = dict(group=group, point=point, side=side, name=name)
    if set(stops) != used:
        raise ValueError('Missing location for a scheduled stop')
    patterns, indexes, journeys = [], {}, []
    routes_at = defaultdict(set)
    for key, t in trips.items():
        seq = sorted(calls[key])
        for call in seq:
            routes_at[call[1]].add(routes[t['route_id']])
        departure = seq[0][3]
        pattern = tuple((s, a-departure, d-departure, int(p), int(tp), int(alight))
                        for _, s, a, d, p, tp, alight in seq)
        if pattern not in indexes:
            indexes[pattern] = len(patterns)
            patterns.append(pattern)
        journeys.append(dict(route=routes[t['route_id']], service=t['service_id'], start=departure,
                             pattern=indexes[pattern], destination=t['trip_headsign']))
    pair_opposite_stops(groups, stops, official, routes_at)
    return dict(start=start.isoformat(), end=end.isoformat(), version=feed['feed_version'],
                calendars=calendars, trips=journeys, patterns=patterns, stops=stops, groups=groups)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('regional_gtfs', type=Path)
    parser.add_argument('naptan_csv', type=Path)
    parser.add_argument('--until', required=True, type=date.fromisoformat, help='Last day of map edition')
    parser.add_argument('--map-cache', required=True, type=Path, help='Source cache for build-map.py')
    args = parser.parse_args()
    with ZipFile(args.regional_gtfs) as z, args.naptan_csv.open(encoding='utf-8-sig') as n:
        result = extract(z, n, args.until, args.map_cache)
    target = Path(__file__).resolve().parents[1] / 'public/data/timetable.json'
    target.write_text(json.dumps(result, separators=(',', ':'), ensure_ascii=False) + '\n')
    print(f"{len(result['trips'])} trips, {len(result['stops'])} stops, {len(result['groups'])} stop groups")
