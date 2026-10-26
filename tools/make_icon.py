#!/usr/bin/env python3
"""Generate icon.png: a valley at dusk (warm sun low between two mountain ranges under
an indigo sky), in the colours of the default background photo.

512x423, 24-bit RGB, full bleed: Samsung's TV app icon spec (developer.samsung.com,
"App Icons and Screenshots"). The TV may round the corners with a squircle mask, so
the sun and the peaks stay well inside the edges.

Needs Pillow (pip install pillow). Drawn at 4x and scaled down for smooth edges.

Also writes the LG webOS launcher icons, webos/icon.png (80x80) and webos/largeIcon.png
(130x130): a centred square crop of icon.png. `python3 tools/make_icon.py --webos` makes
only those, from the existing icon.png."""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

W, H = 512, 423
S = 4                                   # supersampling factor
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'icon.png')


def webos_icons(src):
    """Square centre crop of the Samsung icon, scaled to LG's 80x80 and 130x130."""
    w, h = src.size
    side = min(w, h)
    sq = src.crop(((w - side) // 2, (h - side) // 2, (w - side) // 2 + side, (h - side) // 2 + side))
    os.makedirs(os.path.join(ROOT, 'webos'), exist_ok=True)
    for name, size in (('icon.png', 80), ('largeIcon.png', 130)):
        sq.resize((size, size), Image.LANCZOS).save(os.path.join(ROOT, 'webos', name), optimize=True)


if '--webos' in sys.argv:
    webos_icons(Image.open(OUT).convert('RGB'))
    sys.exit(0)

SKY = [(0.00, (20, 20, 56)),            # deep indigo at the top
       (0.34, (82, 48, 128)),           # violet
       (0.56, (196, 88, 110)),          # rose
       (0.70, (250, 150, 88))]          # orange glow at the horizon
SUN = (255, 222, 160)
BACK = (92, 58, 112)                    # far range, hazy purple
MID = (60, 38, 78)                      # middle range
FRONT = (26, 19, 40)                    # near range, almost black


def lerp(a, b, t):
    return tuple(int(round(a[k] + (b[k] - a[k]) * t)) for k in range(3))


def sky_colour(t):
    for (t0, c0), (t1, c1) in zip(SKY, SKY[1:]):
        if t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0))
    return SKY[-1][1]


def pts(points):
    return [(x * S, y * S) for x, y in points]


w, h = W * S, H * S
img = Image.new('RGB', (w, h))
d = ImageDraw.Draw(img)
for y in range(h):
    d.line([(0, y), (w, y)], fill=sky_colour(y / h))

# Sun with a soft glow: a blurred disc on its own mask, blended over the sky.
sun_c, sun_r = (238, 262), 50
glow = Image.new('L', (w, h), 0)
g = ImageDraw.Draw(glow)
g.ellipse([(sun_c[0] - 130) * S, (sun_c[1] - 130) * S, (sun_c[0] + 130) * S, (sun_c[1] + 130) * S], fill=120)
glow = glow.filter(ImageFilter.GaussianBlur(60 * S))
img = Image.composite(Image.new('RGB', (w, h), (255, 170, 110)), img, glow)
d = ImageDraw.Draw(img)
d.ellipse([(sun_c[0] - sun_r) * S, (sun_c[1] - sun_r) * S, (sun_c[0] + sun_r) * S, (sun_c[1] + sun_r) * S], fill=SUN)

# Far range: low ridges with a Half Dome-like rounded peak right of the sun.
d.polygon(pts([
    (0, 292), (48, 270), (96, 284), (140, 266), (186, 290), (232, 296),
    (274, 290), (302, 262), (318, 230), (336, 214), (356, 212), (370, 222),
    (374, 252), (404, 276), (448, 266), (512, 286), (512, 423), (0, 423)]), fill=BACK)

# Middle range: a softer layer that sets the valley floor.
d.polygon(pts([
    (0, 318), (70, 300), (150, 316), (230, 330), (310, 322), (390, 306),
    (460, 312), (512, 304), (512, 423), (0, 423)]), fill=MID)

# Near range: steep walls framing the valley (El Capitan on the left).
d.polygon(pts([
    (0, 214), (30, 196), (72, 190), (98, 200), (114, 236), (138, 300),
    (176, 350), (236, 374), (300, 372), (356, 352), (396, 318), (424, 280),
    (452, 258), (486, 250), (512, 256), (512, 423), (0, 423)]), fill=FRONT)

img = img.resize((W, H), Image.LANCZOS)
img.save(OUT, optimize=True)
print('wrote', os.path.normpath(OUT), os.path.getsize(OUT), 'bytes')
webos_icons(img)
