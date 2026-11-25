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
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import mapbox_vector_tile
import numpy as np
from PIL import Image
from shapely.geometry import LineString, Point, box, shape
from shapely.ops import transform, unary_union

OUT = Path(__file__).resolve().parents[1] / 'public/data'
CACHE = Path(sys.argv[1])
CACHE.mkdir(parents=True, exist_ok=True)
WEST, NORTH, UNIT, WIDTH, HEIGHT = -3.34, 54.707, 1030, 480, 748
# Keep the whole service area in view on phones in either orientation and on widescreen monitors.
BLEED_X, BLEED_Y = 700, 240
ASPECT = math.cos(math.radians(54.35))
LINES = ('505', '508', '516', '555', '599')
STATIONS = ('WDM', 'SVL', 'BUD', 'KEN', 'OXN')


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
    archive = get('stagecoach.zip', 'https://opendata.stagecoachbus.com/stagecoach-sccu-route-schedule-data-transxchange_2_4.zip')
    paths = {n: set() for n in LINES}
    with ZipFile(BytesIO(archive)) as source:
        for name in source.namelist():
            number = name.rsplit('_', 1)[-1].removesuffix('.xml')
            if number not in LINES:
                continue
            root = ET.fromstring(source.read(name))
            for link in root.findall('.//{*}RouteLink'):
                points = [project(float(p.findtext('{*}Longitude')), float(p.findtext('{*}Latitude')))
                          for p in link.findall('{*}Track/{*}Mapping/{*}Location')]
                if len(points) < 2:
                    raise ValueError('Missing road geometry in ' + name)
                simplified = tuple(tuple(p) for p in coords(LineString(points).simplify(.09)))
                paths[number].add(min(simplified, simplified[::-1]))
    return {line: sorted(parts) for line, parts in paths.items()}


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


def railway(segments, stations):
    # Join shared tile-edge vertices and trace the branch between station coordinates.
    graph = defaultdict(dict)
    for line in segments:
        vertices = [(round(x, 2), round(y, 2)) for x, y in line.coords]
        for a, b in zip(vertices, vertices[1:]):
            if a != b:
                graph[a][b] = graph[b][a] = math.dist(a, b)
    # Vector tiles can end a few metres apart at a boundary.
    ends = [p for p, neighbours in graph.items() if len(neighbours) == 1]
    for p in ends:
        for q in graph:
            dist = math.dist(p, q)
            if 0 < dist < .19:
                graph[p][q] = graph[q][p] = dist
    origin, destination = stations[0]['point'], stations[-1]['point']
    first = min(graph, key=lambda p: math.dist(p, origin))
    queue, distance, previous = [(0, first)], {first: 0}, {}
    while queue:
        cost, point = heappop(queue)
        if cost != distance[point]:
            continue
        # The rail endpoint on platform 3 is about 105 m from Oxenholme’s station centroid.
        if math.dist(point, destination) < 1.05:
            path = [point]
            while path[-1] != first:
                path.append(previous[path[-1]])
            track = LineString(path[::-1])
            if max(track.distance(Point(s['point'])) for s in stations) > 1.05:
                raise ValueError('Branch does not pass each station')
            return coords(track.simplify(.035))
        for neighbour, length in graph[point].items():
            new = cost + length
            if new < distance.get(neighbour, math.inf):
                distance[neighbour] = new
                previous[neighbour] = point
                heappush(queue, (new, neighbour))
    raise ValueError('No connected Windermere branch found')


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
station_by_code = {f['properties']['crs']: f for f in geo['features'] if f['properties'].get('crs') in STATIONS}
stations = [{'code': code, 'name': station_by_code[code]['properties']['name'],
             'point': list(project(*station_by_code[code]['geometry']['coordinates']))} for code in STATIONS]
water, roads, rail = [], [], []
with ThreadPoolExecutor(max_workers=4) as pool:
    for tile, layers in pool.map(vector_tile, tiles(bounds, 10)):
        if 'water' in layers:
            water.extend(geom for _, geom in features(tile, layers['water']) if geom.area > .4)
        if 'transportation' in layers:
            roads.extend(geom for props, geom in features(tile, layers['transportation'])
                         if props['class'] in ('motorway','trunk','primary','secondary') and geom.geom_type.endswith('LineString'))
    for tile, layers in pool.map(vector_tile, tiles([-2.93,54.29,-2.70,54.395], 12)):
        if 'transportation' in layers:
            for props, geom in features(tile, layers['transportation']):
                if props['class']=='rail':
                    rail.extend(parts(geom))
clip = box(-BLEED_X, -BLEED_Y, WIDTH+BLEED_X, HEIGHT+BLEED_Y)
lakes = unary_union(water).intersection(clip).simplify(.12)
road = unary_union(roads).intersection(clip).simplify(.22)
map_data = {
    'frame': {'width':WIDTH, 'height':HEIGHT, 'west':WEST, 'north':NORTH, 'units':UNIT, 'aspect':ASPECT, 'bleedX':BLEED_X, 'bleedY':BLEED_Y},
    'routes': route_links(), 'stations': stations, 'rail': railway(rail, stations),
    'lakes': [[coords(p.exterior)] + [coords(r) for r in p.interiors] for p in parts(lakes) if p.geom_type=='Polygon' and p.area>.7],
    'roads': [coords(p) for p in parts(road) if p.geom_type=='LineString' and p.length>1],
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT/'map.json').write_text(json.dumps(map_data, separators=(',', ':'))+'\n')
relief(bounds)
print('Route links', {r: len(v) for r,v in map_data['routes'].items()}, 'rail vertices', len(map_data['rail']))
