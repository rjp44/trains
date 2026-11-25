"""Rebuild the compact map from public geographic data. See lakes/README.md."""
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from heapq import heappop, heappush
from pathlib import Path
from io import BytesIO
from urllib.request import Request, urlopen
import gzip
import json
import math
import sys

import mapbox_vector_tile
import numpy as np
from PIL import Image
from shapely.geometry import LineString, Point, box, shape
from shapely.ops import linemerge, transform, unary_union

OUT = Path(__file__).resolve().parents[1] / 'public/data'
CACHE = Path(sys.argv[1])
CACHE.mkdir(parents=True, exist_ok=True)
WEST, NORTH, UNIT, WIDTH, HEIGHT = -3.69, 54.74, 1030, 635, 770
# Keep the whole service area in view on phones in either orientation and on widescreen monitors.
BLEED_X, BLEED_Y = 700, 240
ASPECT = math.cos(math.radians(54.35))
RAIL_ROUTES = {
    'rail': 'WDM SVL BUD KEN OXN'.split(),
    'coast': 'LAN CNF SVR ARN GOS KBK CAK ULV DLT ROO BIF ASK KBF FOX GNR MLM SIC BOC RAV DRI SSC SEL BYS NRT SBS CKL WTH'.split(),
}


def get(key, url):
    path = CACHE / key
    if not path.exists():
        with urlopen(Request(url, headers={'User-Agent': 'LakesTransitMap/0.1 (rjp44/trains)'}), timeout=40) as response:
            data = response.read()
        path.write_bytes(data)
    return path.read_bytes()


def project(lon, lat):
    return (lon - WEST) * UNIT * ASPECT, (NORTH - lat) * UNIT


def coords(line):
    return [[round(x, 2), round(y, 2)] for x, y in line.coords]


def xy_tile(lon, lat, zoom):
    n = 2 ** zoom
    return (lon + 180) * n / 360, (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) * n / 2


def tiles(bounds, zoom):
    x0, y0 = xy_tile(bounds[0], bounds[3], zoom)
    x1, y1 = xy_tile(bounds[2], bounds[1], zoom)
    return [(zoom, x, y) for x in range(int(x0), int(x1)+1) for y in range(int(y0), int(y1)+1)]


def route_links():
    shapes = json.loads((CACHE / 'bus-shapes.json').read_text())
    # A road edge has the same owners in either direction. Merge consecutive edges with
    # the same owners before simplifying, so shared roads get identical dashed overlays.
    owners = defaultdict(set)
    for number, traces in shapes.items():
        for trace in traces:
            points = [tuple(p) for p in trace]
            for a, b in zip(points, points[1:]):
                if a != b:
                    owners[min((a, b), (b, a))].add(number)
    runs = defaultdict(list)
    for (a, b), lines in sorted(owners.items()):
        runs[tuple(sorted(lines))].append([project(*a), project(*b)])
    paths = {number: [] for number in shapes}
    for lines, edges in runs.items():
        for segment in parts(linemerge(edges)):
            points = coords(segment.simplify(.09))
            for line in lines:
                paths[line].append(points)
    return paths


def vector_tile(tile):
    z, x, y = tile
    key = f'vector-{z}-{x}-{y}'
    data = get(key, tile_url.format(z=z, x=x, y=y))
    if data.startswith(b'\x1f\x8b'):
        data = gzip.decompress(data)
    layers = mapbox_vector_tile.decode(data, default_options={'y_coord_down': True})
    return tile, layers


def features(tile, layer):
    z, x, y = tile
    extent = layer['extent']
    def convert(u, v):
        lon = (x + u/extent) / 2**z * 360 - 180
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2*(y+v/extent)/2**z))))
        return project(lon, lat)
    for feature in layer['features']:
        yield feature['properties'], transform(convert, shape(feature['geometry']))


def parts(geometry):
    return geometry.geoms if hasattr(geometry, 'geoms') else [geometry]


def rail_graph(segments):
    graph = defaultdict(dict)
    for line in segments:
        # Straight tracks can span a station without an OSM vertex at its platforms.
        vertices = [(round(x, 3), round(y, 3)) for x, y in line.segmentize(.4).coords]
        for a, b in zip(vertices, vertices[1:]):
            if a != b:
                graph[a][b] = graph[b][a] = math.dist(a, b)
    # Join small gaps between neighbouring vector tiles.
    cells = defaultdict(list)
    for x, y in graph:
        cells[(math.floor(x), math.floor(y))].append((x,y))
    for p in [p for p, neighbours in graph.items() if len(neighbours) == 1]:
        u, v = map(math.floor, p)
        for i in range(u-1,u+2):
            for j in range(v-1,v+2):
                for q in cells[i,j]:
                    distance = math.dist(p, q)
                    if 0 < distance < .19:
                        graph[p][q] = graph[q][p] = distance
    return graph


def rail_leg(graph, first, station):
    destination = station['point']
    queue, distance, previous = [(0, first)], {first: 0}, {}
    closest, gap = first, math.inf
    while queue:
        cost, point = heappop(queue)
        if cost != distance[point]:
            continue
        separation = math.dist(point, destination)
        if separation < gap:
            closest, gap = point, separation
        if gap <= .25:
            break
        for neighbour, length in graph[point].items():
            new = cost + length
            if new < distance.get(neighbour, math.inf):
                distance[neighbour] = new
                previous[neighbour] = point
                heappush(queue, (new, neighbour))
    # Station centroids can be up to 110 m from the passenger track, e.g. Oxenholme.
    if gap > 1.05:
        raise ValueError(f"No connected track to {station['code']} (gap {gap:.2f} map units)")
    path = [closest]
    while path[-1] != first:
        path.append(previous[path[-1]])
    return path[::-1]


def railway(graph, stations):
    track = [min(graph, key=lambda p: math.dist(p, stations[0]['point']))]
    stations[0]['vertex'] = 0
    for station in stations[1:]:
        leg = rail_leg(graph, track[-1], station)
        track.extend(coords(LineString(leg).simplify(.035))[1:])
        # Use full precision at connections so the next leg can find the graph node.
        track[-1] = leg[-1]
        station['vertex'] = len(track)-1
    return [[round(x,2), round(y,2)] for x,y in track]


def relief(bounds):
    # Terrarium encodes elevation in the three colour channels (metres).
    zoom = 10
    grid = tiles(bounds, zoom)
    min_x, min_y = min(t[1] for t in grid), min(t[2] for t in grid)
    mosaic = Image.new('RGB', ((max(t[1] for t in grid)-min_x+1)*256, (max(t[2] for t in grid)-min_y+1)*256))
    def image_tile(tile):
        z, x, y = tile
        data = get(f'dem-{z}-{x}-{y}', f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png')
        return x, y, Image.open(BytesIO(data)).convert('RGB')
    with ThreadPoolExecutor(max_workers=4) as pool:
        for x, y, img in pool.map(image_tile, grid):
            mosaic.paste(img, ((x-min_x)*256, (y-min_y)*256))
    w, h = (WIDTH+2*BLEED_X)*2, (HEIGHT+2*BLEED_Y)*2
    tx, ty = xy_tile(bounds[0] + (np.arange(w)+.5)/(2*UNIT*ASPECT), bounds[3] - (np.arange(h)+.5)/(2*UNIT), zoom)
    raster = np.asarray(mosaic)[np.floor((ty-min_y)*256).astype(int)[:,None], np.floor((tx-min_x)*256).astype(int)].astype(float)
    elevation = raster[:,:,0]*256 + raster[:,:,1] + raster[:,:,2]/256 - 32768
    dy, dx = np.gradient(elevation, 54)
    shade = np.clip(12*dx + 18*dy, -27, 24) - np.clip(elevation, 0, 950)/110
    # A quiet relief and 100 m contours keep vehicles legible at small panel sizes.
    contour = np.where(np.abs(np.mod(elevation+50,100)-50) < 3, -5, 0)
    rgb = np.clip(np.array([229,232,213]) + (shade+contour)[:,:,None], 0, 255)
    Image.fromarray(rgb.astype('uint8')).save(OUT/'relief.webp', quality=84)


bounds = [WEST-BLEED_X/(UNIT*ASPECT), NORTH-(HEIGHT+BLEED_Y)/UNIT, WEST+(WIDTH+BLEED_X)/(UNIT*ASPECT), NORTH+BLEED_Y/UNIT]
tile_url = json.loads(get('tile-source.json','https://tiles.openfreemap.org/planet'))['tiles'][0]
geo = json.loads(get('stations.json', 'https://api.railinfo.uk/stations/geo'))
station_by_code = {f['properties']['crs']: f for f in geo['features'] if f['properties'].get('crs')}
railways = {key: {'stations': [{'code': code, 'name': station_by_code[code]['properties']['name'],
                               'point': list(project(*station_by_code[code]['geometry']['coordinates']))}
                              for code in codes]} for key, codes in RAIL_ROUTES.items()}
water, roads, rail = [], [], []
with ThreadPoolExecutor(max_workers=4) as pool:
    for tile, layers in pool.map(vector_tile, tiles(bounds, 10)):
        if 'water' in layers:
            water.extend(geom for _, geom in features(tile, layers['water']) if geom.area > .4)
        if 'transportation' in layers:
            roads.extend(geom for props, geom in features(tile, layers['transportation'])
                         if props['class'] in ('motorway','trunk','primary','secondary') and geom.geom_type.endswith('LineString'))
    for tile, layers in pool.map(vector_tile, tiles([-3.635,54.022,-2.69,54.573], 12)):
        if 'transportation' in layers:
            for props, geom in features(tile, layers['transportation']):
                if props['class']=='rail':
                    rail.extend(parts(geom))
clip = box(-BLEED_X, -BLEED_Y, WIDTH+BLEED_X, HEIGHT+BLEED_Y)
lakes = unary_union(water).intersection(clip).simplify(.12)
road = unary_union(roads).intersection(clip).simplify(.22)
# The winter vector tiles omit Bransty Tunnel during its engineering closure.
# Use its surveyed OSM centreline to show the physical railway through to Whitehaven.
tunnel = json.loads(get('bransty-way.json', 'https://api.openstreetmap.org/api/0.6/way/5940205/full.json'))['elements']
nodes = {e['id']: project(e['lon'], e['lat']) for e in tunnel if e['type'] == 'node'}
way = next(e for e in tunnel if e['type'] == 'way' and e['id'] == 5940205)
rail.append(LineString([nodes[n] for n in way['nodes']]))
graph = rail_graph(rail)
for line in railways.values():
    line['track'] = railway(graph, line['stations'])
map_data = {
    'frame': {'width':WIDTH, 'height':HEIGHT, 'west':WEST, 'north':NORTH, 'units':UNIT, 'aspect':ASPECT, 'bleedX':BLEED_X, 'bleedY':BLEED_Y},
    'routes': route_links(),
    'lakes': [[coords(p.exterior)] + [coords(r) for r in p.interiors] for p in parts(lakes) if p.geom_type=='Polygon' and p.area>.7],
    'roads': [coords(p) for p in parts(road) if p.geom_type=='LineString' and p.length>1],
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT/'rail.json').write_text(json.dumps({'frame': map_data['frame'], 'lines': railways}, separators=(',', ':'))+'\n')
(OUT/'map.json').write_text(json.dumps(map_data, separators=(',', ':'))+'\n')
relief(bounds)
print('Route links', {r: len(v) for r,v in map_data['routes'].items()}, 'rail vertices', {key: len(line['track']) for key,line in railways.items()})
