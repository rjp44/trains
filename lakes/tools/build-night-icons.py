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

# Lens position, beam length, downward slope and intensity in vehicle coordinates.
lamps = {
    'side': [(13.4, 3.55, 13, .32, 1)],
    'oblique': [(13.9, .35, 11, .27, .70), (13.4, 3.4, 13, .36, 1)],
    'roof': [(13.4, -3.4, 13, -.10, .98), (13.4, 3.4, 13, .10, .98)],
    'rail': [(16.2, 3.25, 12, .27, 1)],
    'front': [],  # A missing heading gives no direction for a projected beam.
}

def render(name, view):
    alpha = np.zeros_like(x)
    lenses = []
    for lamp_x, lamp_y, length, slope, power in lamps[view]:
        along = np.maximum(0, (x - lamp_x) / length)
        width = .37 + 2.25 * np.minimum(along, 1)
        across = y - lamp_y - (x - lamp_x) * slope
        core = np.exp(-.5 * (across / width) ** 2)
        spill = np.exp(-.5 * ((across - .65) / (width + .8)) ** 2)
        falloff = np.maximum(0, 1 - along ** 1.65) ** 1.5
        beam = np.where(x >= lamp_x, (.74 * core + .11 * spill) * falloff * power, 0)
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
        render(bus + '-' + view, view)
render('northern-carriage', 'rail')
