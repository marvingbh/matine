#!/usr/bin/env python3
"""Generate the Matinê icons: the name as the logo, like the streaming apps' tiles. "Matinê"
in Inter ExtraBold (the app's own typeface, a heavier weight), warm cream on a deep plum
gradient, which stands apart from Netflix red, Max and Prime blue and Disney navy; a short
amber-to-rose bar under the word, the sunrise of a matinê. No scenery.

Sizes (each drawn for its own shape):
  icon.png              512x423, 24-bit RGB, full bleed: Samsung's TV app icon spec
                        (developer.samsung.com, "App Icons and Screenshots"). The TV may
                        round the corners with a squircle mask, so the word stays inside.
  webos/icon.png        80x80   LG launcher icon (webos/appinfo.json "icon")
  webos/largeIcon.png   130x130 LG large icon ("largeIcon")

Needs Pillow (pip install pillow). Drawn at 4x and scaled down for smooth edges.
The font is tools/fonts/inter-latin-800-normal.woff (Inter, SIL Open Font License 1.1, see
fonts/OFL.txt; from the Fontsource package @fontsource/inter 5.1.0). It is used only here,
never packaged with the app.
`python3 tools/make_icon.py --preview DIR` also writes previews into DIR."""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

S = 4                                   # supersampling factor
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONT = os.path.join(ROOT, 'tools', 'fonts', 'inter-latin-800-normal.woff')
WORD = 'Matinê'

TOP = (84, 30, 98)                      # plum, top left
BOTTOM = (40, 14, 54)                   # deep plum, bottom right
TEXT = (255, 233, 204)                  # warm cream
BAR = [(255, 178, 74), (240, 92, 112)]  # amber to rose


def lerp(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(round(a[k] + (b[k] - a[k]) * t)) for k in range(3))


def fitted_font(text, width):
    """Inter ExtraBold at the size where `text` is `width` pixels wide."""
    size = 100
    f = ImageFont.truetype(FONT, size)
    l, _, r, _ = f.getbbox(text)
    return ImageFont.truetype(FONT, max(8, int(size * width / (r - l))))


def draw(W, H):
    """The icon at W x H (drawn at S times that, then scaled down)."""
    w, h = W * S, H * S
    # A diagonal gradient, with a faint warm light low on the right (depth, no scenery).
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(0, w, 1):
            t = (x / w * 0.45 + y / h * 0.55)
            c = lerp(TOP, BOTTOM, t)
            dx, dy = (x - w * 0.85) / w, (y - h * 0.95) / h
            warm = max(0.0, 1.0 - (dx * dx + dy * dy) * 4.5) * 0.22
            px[x, y] = lerp(c, (196, 70, 96), warm)
    d = ImageDraw.Draw(img)

    # The word: 84% of the width (72% on the wide Samsung icon, so it stays
    # inside the squircle mask), letters pulled slightly together.
    square = abs(W - H) < 2
    target = w * (0.84 if square else 0.72)
    track = -0.012                      # tracking, as a fraction of the font size
    font = fitted_font(WORD, target)
    widths = [font.getlength(ch) for ch in WORD]
    total = sum(widths) + track * font.size * (len(WORD) - 1)
    font = ImageFont.truetype(FONT, int(font.size * target / total))
    widths = [font.getlength(ch) for ch in WORD]
    total = sum(widths) + track * font.size * (len(WORD) - 1)
    asc, _ = font.getmetrics()
    _, top, _, bottom = font.getbbox(WORD)          # the circumflex included
    bar_h = max(S * 2, int(font.size * 0.075))
    gap = int(font.size * 0.16)
    block = (bottom - top) + gap + bar_h
    y0 = (h - block) / 2 - top - h * 0.01
    x = (w - total) / 2
    for ch, cw in zip(WORD, widths):
        d.text((x, y0), ch, font=font, fill=TEXT)
        x += cw + track * font.size

    # The bar: short and centred under the word, amber to rose.
    bw = total * 0.34
    bx, by = (w - bw) / 2, y0 + bottom + gap
    bar = Image.new('RGB', (int(bw), bar_h))
    bd = ImageDraw.Draw(bar)
    for i in range(int(bw)):
        bd.line([(i, 0), (i, bar_h)], fill=lerp(BAR[0], BAR[1], i / bw))
    mask = Image.new('L', bar.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, bar.size[0] - 1, bar_h - 1], radius=bar_h // 2, fill=255)
    img.paste(bar, (int(bx), int(by)), mask)
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


def previews(out_dir, name='icon-matine-v2'):
    os.makedirs(out_dir, exist_ok=True)
    draw(512, 423).save(os.path.join(out_dir, name + '.png'))
    label = ImageFont.truetype(FONT, 26)
    for tone, bg, fg in (('dark', (16, 17, 21), (235, 235, 240)), ('light', (236, 236, 240), (30, 30, 36))):
        canvas = Image.new('RGB', (1200, 520), bg)
        x = 60
        for size, rad in (((400, 330), 0.12), ((200, 200), 0.22), ((130, 130), 0.22), ((80, 80), 0.22), ((48, 48), 0.22)):
            icon = rounded(draw(*size), rad)
            canvas.paste(icon, (x, 60 + (330 - size[1]) // 2), icon)
            x += size[0] + 60
        ImageDraw.Draw(canvas).text((60, 440), '512x423 (Samsung) · 200 · 130 (LG large) · 80 (LG) · 48', fill=fg, font=label)
        canvas.save(os.path.join(out_dir, '%s-on-%s.png' % (name, tone)))
    print('previews in', out_dir)


if __name__ == '__main__':
    if '--preview' in sys.argv:
        previews(sys.argv[sys.argv.index('--preview') + 1])
        sys.exit(0)
    save(draw(512, 423), 'icon.png')
    save(draw(80, 80), 'webos/icon.png')
    save(draw(130, 130), 'webos/largeIcon.png')
