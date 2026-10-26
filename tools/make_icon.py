#!/usr/bin/env python3
"""Generate the Matinê icons: a warm sun rising behind a low ridge (Belo Horizonte's
"beautiful horizon"), under a sky that goes from deep night blue to rose and amber. The
dark ground under the horizon is a film strip: a row of perforations runs along its top
edge, so the horizon line doubles as the edge of a film. Flat with depth, tvOS style: a
soft glow round the sun, a thin warm rim light on the horizon. No text.

Sizes (each drawn for its own shape, not cropped):
  icon.png              512x423, 24-bit RGB, full bleed: Samsung's TV app icon spec
                        (developer.samsung.com, "App Icons and Screenshots"). The TV may
                        round the corners with a squircle mask, so everything important
                        stays well inside the edges.
  webos/icon.png        80x80   LG launcher icon (webos/appinfo.json "icon")
  webos/largeIcon.png   130x130 LG large icon ("largeIcon")

Needs Pillow (pip install pillow). Drawn at 4x and scaled down for smooth edges.
`python3 tools/make_icon.py --preview DIR` also writes previews into DIR."""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

S = 4                                   # supersampling factor
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

SKY = [(0.00, (10, 14, 44)),            # deep night blue at the top
       (0.32, (34, 34, 96)),            # indigo
       (0.52, (122, 60, 128)),          # plum
       (0.62, (226, 102, 112)),         # rose
       (0.66, (255, 168, 90))]          # amber at the horizon
SUN = (255, 226, 166)
SUN_EDGE = (255, 186, 112)
RIDGE = (58, 36, 86)                    # the low ridge in front of the sun
GROUND = (16, 18, 44)                   # the film strip
HOLE = (52, 50, 100)                    # its perforations, a little lighter
RIM = (255, 196, 128)                   # the warm line on the horizon


def lerp(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(round(a[k] + (b[k] - a[k]) * t)) for k in range(3))


def sky_colour(t):
    for (t0, c0), (t1, c1) in zip(SKY, SKY[1:]):
        if t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0))
    return SKY[-1][1]


def draw(W, H):
    """The icon at W x H (drawn at S times that, then scaled down)."""
    w, h = W * S, H * S
    m = min(w, h)
    horizon = 0.70 * h
    img = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=sky_colour(y / horizon * 0.66))

    # The sun: a soft glow, then the disc with a warmer lower half, half risen.
    cx, r = w / 2, 0.25 * m
    cy = horizon + 0.02 * h
    glow = Image.new('L', (w, h), 0)
    ImageDraw.Draw(glow).ellipse([cx - 1.7 * r, cy - 1.5 * r, cx + 1.7 * r, cy + 1.5 * r], fill=150)
    glow = glow.filter(ImageFilter.GaussianBlur(0.6 * r))
    img = Image.composite(Image.new('RGB', (w, h), (255, 150, 110)), img, glow)
    sun = Image.new('RGB', (w, h))
    sd = ImageDraw.Draw(sun)
    for y in range(int(cy - r), int(cy + r) + 1):
        sd.line([(0, y), (w, y)], fill=lerp(SUN, SUN_EDGE, (y - (cy - r)) / (1.3 * r)))
    disc = Image.new('L', (w, h), 0)
    ImageDraw.Draw(disc).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    img = Image.composite(sun, img, disc)
    d = ImageDraw.Draw(img)

    # A low ridge in front of the sun: gentle, like the Serra do Curral.
    ridge = [(0, horizon - 0.045 * h), (0.12 * w, horizon - 0.07 * h), (0.24 * w, horizon - 0.05 * h),
             (0.33 * w, horizon - 0.035 * h), (0.42 * w, horizon - 0.015 * h), (0.58 * w, horizon - 0.012 * h),
             (0.70 * w, horizon - 0.04 * h), (0.80 * w, horizon - 0.075 * h), (0.90 * w, horizon - 0.06 * h),
             (w, horizon - 0.05 * h), (w, h), (0, h)]
    d.polygon(ridge, fill=RIDGE)

    # The ground is a film strip: a warm rim on the horizon, then a row of perforations.
    band = horizon + 0.035 * h
    d.rectangle([0, band, w, h], fill=GROUND)
    d.rectangle([0, band, w, band + max(S, 0.008 * h)], fill=RIM)
    hole_w, hole_h = 0.085 * m, 0.075 * m
    gap = hole_w * 0.8
    step = hole_w + gap
    n = int(w // step) + 2
    x0 = (w - (n * step - gap)) / 2
    top = band + (h - band - hole_h) * 0.42
    for i in range(n):
        x = x0 + i * step
        d.rounded_rectangle([x, top, x + hole_w, top + hole_h], radius=hole_h * 0.28, fill=HOLE)

    # Depth: the strip darkens towards the bottom.
    shade = Image.new('L', (w, h), 0)
    sh = ImageDraw.Draw(shade)
    for y in range(int(band), h):
        sh.line([(0, y), (w, y)], fill=int(70 * (y - band) / (h - band)))
    img = Image.composite(Image.new('RGB', (w, h), (6, 7, 18)), img, shade)
    return img.resize((W, H), Image.LANCZOS)


def save(img, rel):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)
    print('wrote', rel, img.size, os.path.getsize(path), 'bytes')


def rounded(img, radius_frac):
    """The icon with rounded corners, as a launcher shows it (previews only)."""
    w, h = img.size
    mask = Image.new('L', (w * S, h * S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w * S - 1, h * S - 1], radius=int(min(w, h) * radius_frac * S), fill=255)
    out = img.convert('RGBA')
    out.putalpha(mask.resize((w, h), Image.LANCZOS))
    return out


def previews(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    big = draw(512, 423)
    big.save(os.path.join(out_dir, 'icon-matine.png'))
    for name, bg, fg in (('dark', (16, 17, 21), (235, 235, 240)), ('light', (236, 236, 240), (30, 30, 36))):
        canvas = Image.new('RGB', (1200, 560), bg)
        x = 60
        for size, rad in (((400, 330), 0.12), ((200, 200), 0.22), ((130, 130), 0.22), ((80, 80), 0.22), ((48, 48), 0.22)):
            icon = rounded(draw(*size), rad)
            y = 60 + (330 - size[1]) // 2
            canvas.paste(icon, (x, y), icon)
            x += size[0] + 60
        try:
            from PIL import ImageFont
            font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 28)
        except (IOError, OSError):
            font = None
        ImageDraw.Draw(canvas).text((60, 440), 'Matinê  ·  512x423 (Samsung), 200, 130 (LG large), 80 (LG), 48', fill=fg, font=font)
        canvas.save(os.path.join(out_dir, 'icon-matine-on-%s.png' % name))
    print('previews in', out_dir)


if __name__ == '__main__':
    if '--preview' in sys.argv:
        previews(sys.argv[sys.argv.index('--preview') + 1])
        sys.exit(0)
    save(draw(512, 423), 'icon.png')
    save(draw(80, 80), 'webos/icon.png')
    save(draw(130, 130), 'webos/largeIcon.png')
