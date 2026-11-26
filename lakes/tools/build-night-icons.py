"""Render the dark Lakes vehicle icons from the map's SVG artwork."""
from io import BytesIO
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

public = Path(__file__).resolve().parents[1] / 'public'
output = public / 'icons' / 'night'
output.mkdir(parents=True, exist_ok=True)
defs = ET.fromstring(re.search(r'<defs>.*?</defs>', (public / 'index.html').read_text(), re.S)[0])
outlines = {'white': '#14231f', '#fff': '#14231f', '#d9e4e5': '#57685f', '#f2f5e9': '#57685f'}
paint = {'#edf3e9': '#b6c7bd', '#ecf1f4': '#bdc6cb', '#e7f0e6': '#bccac2'}
for el in defs.iter():
    if el.get('stroke') in outlines:
        el.set('stroke', outlines[el.get('stroke')])
    if el.get('fill') in paint:
        el.set('fill', paint[el.get('fill')])
    if el.get('id') == 'bus-heading':
        del el[:]
    if el.tag == 'use':
        el.set('xlink:href', el.attrib.pop('href'))
art = ET.tostring(defs, encoding='unicode')

# Frames are larger than the day icons to accommodate the beams, at the same scale.
size = 64
pixels_per_unit = 48 / 44
supersample = 4
samples = size * supersample
extent = size / (2 * pixels_per_unit)
yy, xx = np.mgrid[0:samples, 0:samples]
x = (xx + .5 - samples / 2) / (supersample * pixels_per_unit)
y = (yy + .5 - samples / 2) / (supersample * pixels_per_unit)

# Lens position, reach, lower-ray slope (outward splay in plan), intensity, wheel plane.
bus_lamps = {
    'side': [(13.4, 3.55, 15, .53, 1, 7.5)],
    'oblique': [(13.9, .35, 14, .48, .70, 4.2), (13.4, 3.4, 15, .55, 1, 7.15)],
    'roof': [(13.4, -3.4, 14.8, -.10, .98, None), (13.4, 3.4, 14.8, .10, .98, None)],
    'front': [],  # A missing heading gives no direction for a projected beam.
}

def render(name, lamps=()):
    alpha = np.zeros_like(x)
    lenses = []
    for lamp_x, lamp_y, length, slope, power, ground in lamps:
        distance = np.maximum(0, x - lamp_x)
        along = distance / length
        if ground is None:
            width = .45 + 3 * np.minimum(along, 1)
            across = y - lamp_y - distance * slope
            profile = .82 * np.exp(-.5 * (across / width) ** 2)
        else:
            # A level upper cutoff; the lower ray meets the tyres' contact plane.
            # Beyond that intersection the light spreads along the road surface.
            upper = lamp_y - .45
            lower = np.minimum(ground, lamp_y + .45 + distance * slope)
            coverage = np.clip((y - upper + .35) / .75, 0, 1) * np.clip((lower - y + .3) / .8, 0, 1)
            strike = np.exp(-.5 * ((y - ground + .75) / .85) ** 2)
            profile = coverage * (.72 + .24 * strike)
        falloff = np.maximum(0, 1 - along ** 2.4) ** 1.4
        beam = np.where(x >= lamp_x, profile * falloff * power, 0)
        alpha = 1 - (1 - alpha) * (1 - beam)
        lenses.append(f'<ellipse cx="{lamp_x}" cy="{lamp_y}" rx=".85" ry=".67" fill="#fff3c5"/>')
    image = Image.new('RGBA', (samples, samples), (255, 212, 131))
    image.putalpha(Image.fromarray(np.rint(alpha * 255).astype('uint8')))
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
           f'width="{samples}" height="{samples}" viewBox="{-extent} {-extent} {2*extent} {2*extent}">'
           f'{art}<use xlink:href="#{name}"/>{"".join(lenses)}</svg>')
    png = subprocess.run(['rsvg-convert'], input=svg.encode(), stdout=subprocess.PIPE, check=True).stdout
    image.alpha_composite(Image.open(BytesIO(png)).convert('RGBA'))
    pixels = np.array(image.resize((size, size), Image.Resampling.LANCZOS))
    # Store exactly the RGB565 palette and sixteen opacity levels used on the tablet.
    for channel, bits in enumerate((5, 6, 5)):
        levels = pixels[:, :, channel].astype('uint16') >> (8 - bits)
        pixels[:, :, channel] = levels * 255 // ((1 << bits) - 1)
    pixels[:, :, 3] = np.rint(pixels[:, :, 3] / 17) * 17
    pixels[pixels[:, :, 3] == 0] = 0
    Image.fromarray(pixels).save(output / (name + '.png'))

for bus in ('single', 'closed-decker', 'open-decker'):
    for view in ('side', 'oblique', 'roof', 'front'):
        render(bus + '-' + view, bus_lamps[view])
for name in ('northern-carriage', 'northern-carriage-roof', 'northern-carriage-oblique', 'northern-carriage-front'):
    render(name)
