#!/usr/bin/env python3
"""Generate mock/bd-0.jpg ... bd-7.jpg: abstract "cinematic" placeholder backdrops for the
browser preview (js/mock-data.js). They are only used without window.tizen; the packaging
command in README.md leaves mock/ out of the .wgt.

Each palette matches a poster gradient in css/style.css (.poster--p0 ... p7): a sky
gradient, a soft light source, two or three layered ridges and a little grain.
Needs Pillow (pip install pillow)."""
import os, random
from PIL import Image, ImageDraw, ImageFilter

W, H = 1280, 720
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'mock')

# (top, bottom, glow, ridge) per palette
PALETTES = [
    ((10, 34, 48), (58, 118, 136), (200, 240, 255), (6, 18, 26)),     # 0 ice / teal
    ((26, 10, 46), (112, 40, 124), (255, 128, 214), (16, 6, 28)),     # 1 violet / magenta
    ((40, 24, 14), (140, 92, 58), (255, 216, 160), (22, 13, 8)),      # 2 sepia
    ((40, 22, 6), (186, 104, 32), (255, 210, 120), (24, 12, 4)),      # 3 amber
    ((30, 5, 9), (124, 22, 36), (255, 120, 110), (16, 3, 5)),         # 4 red
    ((44, 28, 12), (196, 140, 76), (255, 232, 176), (30, 18, 8)),     # 5 sand
    ((6, 32, 26), (32, 108, 82), (184, 255, 216), (3, 18, 14)),       # 6 emerald
    ((7, 11, 28), (36, 54, 94), (160, 184, 255), (3, 5, 14)),         # 7 midnight
]

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def ridge(draw, rnd, base_y, amp, color):
    pts = [(0, H)]
    x = 0
    y = base_y
    while x <= W:
        pts.append((x, y))
        x += rnd.randint(40, 110)
        y = max(base_y - amp, min(base_y + amp // 2, y + rnd.randint(-amp // 3, amp // 3)))
    pts += [(W, y), (W, H)]
    draw.polygon(pts, fill=color)

def make(i, pal):
    top, bottom, glow, dark = pal
    rnd = random.Random(1000 + i)
    im = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(im)
    for y in range(H):
        d.line([(0, y), (W, y)], fill=lerp(top, bottom, min(1, (y / H) ** 1.3 * 1.25)))
    # light source
    g = Image.new('L', (W, H), 0)
    gd = ImageDraw.Draw(g)
    cx, cy = rnd.randint(int(W * 0.45), int(W * 0.8)), rnd.randint(int(H * 0.3), int(H * 0.55))
    gd.ellipse([cx - 260, cy - 200, cx + 260, cy + 200], fill=150)
    gd.ellipse([cx - 60, cy - 60, cx + 60, cy + 60], fill=255)
    g = g.filter(ImageFilter.GaussianBlur(90))
    im = Image.composite(Image.new('RGB', (W, H), glow), im, g)
    d = ImageDraw.Draw(im)
    # ridges, far to near
    for k, (by, amp, t) in enumerate([(int(H * 0.62), 120, 0.55), (int(H * 0.74), 90, 0.8), (int(H * 0.88), 60, 1.0)]):
        ridge(d, rnd, by, amp, lerp(lerp(bottom, top, 0.5), dark, t))
    im = im.filter(ImageFilter.GaussianBlur(1.2))
    noise = Image.effect_noise((W, H), 18).convert('RGB')
    im = Image.blend(im, noise, 0.04)
    im.save(os.path.join(OUT, 'bd-%d.jpg' % i), 'JPEG', quality=72, optimize=True, progressive=True)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for i, p in enumerate(PALETTES):
        make(i, p)
    print('wrote', len(PALETTES), 'backdrops to', os.path.normpath(OUT))
