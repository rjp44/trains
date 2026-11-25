"""Pack the PWA's terrain, water, roads and vehicle art into a flash-mapped indexed image and sprites."""
from pathlib import Path
from io import BytesIO
import json, re, subprocess
from PIL import Image, ImageDraw, ImageFont

here = Path(__file__).resolve().parent
public = here.parent / 'public'
out = here / 'generated'
out.mkdir(exist_ok=True)
m = json.loads((public / 'data/map.json').read_text())
f = m['frame']
# Include the margins revealed by a different panel orientation, with 1.5 pixels per map unit.
x0, y0, scale = -450, -220, 1.5
w, h = int((f['width']-2*x0)*scale), int((f['height']-2*y0)*scale)
relief = Image.open(public / 'data/relief.webp').convert('RGB')
bounds = ((x0+f['bleedX'])*2, (y0+f['bleedY'])*2,
          (f['width']-x0+f['bleedX'])*2, (f['height']-y0+f['bleedY'])*2)
base = relief.resize((w,h),Image.Resampling.BILINEAR,box=bounds)
mask = Image.new('1',(w,h))
d = ImageDraw.Draw(mask)
def points(line):
    return [((x-x0)*scale,(y-y0)*scale) for x,y in line]
for exterior,*holes in m['lakes']:
    d.polygon(points(exterior), fill=1)
    for hole in holes:
        d.polygon(points(hole),fill=0)
base.paste('#a7cdce', (0,0,w,h), mask)
d = ImageDraw.Draw(base)
for road in m['roads']:
    d.line(points(road),fill='#b6bba9',width=1)
base = base.quantize(colors=128)
(out/'terrain.bin').write_bytes(base.tobytes())
def rgb565(r,g,b):
    return ((r>>3)<<11)|((g>>2)<<5)|(b>>3)
def arr(ctype,name,vals):
    return 'static constexpr '+ctype+' '+name+'[] = {\n'+','.join(map(str,vals))+'\n};\n'
pal = base.getpalette()
colors = list(zip(pal[::3],pal[1::3],pal[2::3]))
data = f'static constexpr int rasterW={w}, rasterH={h}, rasterX={x0}, rasterY={y0};\nstatic constexpr float rasterScale={scale}f;\n'
data += arr('uint16_t','dayPalette',[rgb565(*c) for c in colors])
def dark(r,g,b):
    if b>r+15: return rgb565(48,91,104)
    s=(r+g+b)/3
    return rgb565(int(s*.20),int(s*.25),int(s*.20))
data += arr('uint16_t','nightPalette',[dark(*c) for c in colors])
# Pillow's bundled Aileron font provides a reproducible, antialiased UI alphabet.
font = ImageFont.load_default(size=17)
coverage, glyphs=[],[]
for i in range(32,127):
    ch=chr(i)
    glyph=Image.new('L',(19,23))
    ImageDraw.Draw(glyph).text((0,0),ch,fill=255,font=font)
    glyphs.append(max(4,round(font.getlength(ch))))
    coverage.extend(glyph.tobytes())
data+=arr('uint8_t','advances',glyphs)+arr('uint8_t','fontMask',coverage)
defs=re.search(r'<defs>.*?</defs>',(public/'index.html').read_text(),re.S)[0]
ids=['single-side','closed-decker-side','open-decker-side','northern-carriage','single-front','closed-decker-front','open-decker-front']
sprites=[]
for icon in ids:
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="48" height="48" viewBox="-22 -22 44 44">{defs}<use xlink:href="#{icon}" color="#25434c"/></svg>'
    svg=svg.replace('<use href=', '<use xlink:href=')
    png=subprocess.run(['rsvg-convert'],input=svg.encode(),stdout=subprocess.PIPE,check=True).stdout
    im=Image.open(BytesIO(png)).convert('RGBA')
    sprites.extend(rgb565(r,g,b) or 1 if a>=110 else 0 for r,g,b,a in im.getdata())
data+=arr('uint16_t','sprites',sprites)
(out/'art.inc').write_text(data)
