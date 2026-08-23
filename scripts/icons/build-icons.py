#!/usr/bin/env python3
"""
B10 job 1 — THE ICON RECIPE.

OG1 job 0's pattern: the RECIPE is the artefact, not the files. A binary
committed with no way to regenerate it is a dead end the next session
cannot reason about; a script that reproduces it byte-for-byte from the
source art can be read, argued with and re-run when the art changes.
Verification is PIXEL-DIFF against the nodded renders, never a checksum —
a checksum tells you something moved, a pixel-diff tells you what.

SHIPPED, by Cat's ruling of 24 Aug: SPLASH B ("keyed") — the penguins
lifted onto the cream — and NOT the gold tile. The faint gold shadow pool
that survives under each penguin was seen and accepted at the nod; if it
reads wrong on a real device a cleanup pass follows, and it is cheap
precisely because this file regenerates deterministically.

SOURCE OF TRUTH: assets/images/icon.png — the real penguin art, 1024x1024,
two penguins on flat #F4C84B. Measured, not assumed: 100% of border pixels
are exactly (244,200,75) at tolerance 2, so the background is perfectly
flat and a border-connected flood fill separates it cleanly.

THE TRAP THIS RECIPE AVOIDS, and it is why the fill is connectivity-based
rather than a colour key: THE PENGUINS ARE PARTLY GOLD THEMSELVES — beaks,
feet and both scarves. A global "remove everything near #F4C84B" would eat
them. Flooding inward from the border only ever removes background that is
actually connected to the border, so interior gold is untouchable.

USAGE (needs Pillow; deliberately NOT a repo dependency — it is a
build-time tool, and adding it to package.json would move the eas
fingerprint for no runtime reason):
    python3 scripts/icons/build-icons.py --out assets/images
    python3 scripts/icons/build-icons.py --out /tmp/preview --previews
"""

import argparse
import os
from PIL import Image, ImageDraw, ImageFilter

SRC = 'assets/images/icon.png'
GOLD = (244, 200, 75)
CREAM = (242, 241, 236)          # app.json splash backgroundColor #F2F1EC
CANVAS = 1024

# Android's adaptive icon is 108dp with only the inner 72dp guaranteed
# visible under ANY mask (circle, squircle, rounded square, teardrop).
# 72/108 = 0.6667, so on a 1024 canvas the safe circle is ~683px across.
# An unpadded maskable is exactly the mis-shape OG1's audit flagged, so
# this number is load-bearing rather than decorative.
SAFE_FRACTION = 72.0 / 108.0
SAFE_DIAMETER = int(CANVAS * SAFE_FRACTION)   # 682

# THE ART'S WHOLE BOUNDING BOX IS INSCRIBED IN THE SAFE CIRCLE — its
# DIAGONAL is fitted to the diameter, not its width.
#
# Corrected after measuring, because the first version of this recipe
# fitted the WIDTH and argued in this comment that fitting the diagonal
# would shrink the art to ~70% and leave it looking timid. Both halves of
# that were wrong. Fitting the width put 0.81% of the opaque art — the
# outer wing tips — OUTSIDE the guaranteed-visible circle, which is the
# unpadded-maskable mis-shape OG1's audit flagged, just subtler. And the
# real cost of doing it properly is 84% of the safe diameter, not 70%: the
# pair goes from 682px wide to 572px, which is a change you have to be
# told about to notice. Measured, not reasoned: 0.00% overflow after.


def load_source():
    im = Image.open(SRC).convert('RGBA')
    assert im.size == (CANVAS, CANVAS), f'unexpected source size {im.size}'
    return im


def keyed_penguins(im, tolerance=26, feather=1):
    """The penguins on transparent, background flooded away from the border.

    Connectivity, not colour: ImageDraw.floodfill seeded at all four
    corners removes only background REACHABLE from the edge, so the gold
    inside a scarf or a beak survives by construction.

    `tolerance` is set high enough to take the soft drop-shadow band with
    the flat gold (measured shadow samples run down to ~(204,156,60)),
    because a shadow painted for a gold ground reads as dirt on cream.
    """
    work = im.convert('RGB')
    # A sentinel no artwork pixel can collide with, so the mask is exact.
    SENTINEL = (255, 0, 255)
    for seed in ((0, 0), (CANVAS - 1, 0), (0, CANVAS - 1), (CANVAS - 1, CANVAS - 1)):
        ImageDraw.floodfill(work, seed, SENTINEL, thresh=tolerance)

    px = work.load()
    mask = Image.new('L', (CANVAS, CANVAS), 255)
    mpx = mask.load()
    for y in range(CANVAS):
        for x in range(CANVAS):
            if px[x, y] == SENTINEL:
                mpx[x, y] = 0
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))

    out = im.copy()
    out.putalpha(mask)
    return out


def content_bbox(rgba):
    a = rgba.getchannel('A')
    return a.getbbox()


def fit_into(art, target_w):
    """Scale art so its VISIBLE content is target_w wide, centred on a
    transparent 1024 canvas."""
    bbox = content_bbox(art)
    cropped = art.crop(bbox)
    w, h = cropped.size
    scale = target_w / float(w)
    new = cropped.resize((max(1, int(round(w * scale))), max(1, int(round(h * scale)))), Image.LANCZOS)
    canvas = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(new, ((CANVAS - new.size[0]) // 2, (CANVAS - new.size[1]) // 2), new)
    return canvas


def rounded_tile(im, radius_frac=0.2237):
    """The art kept on its own gold ground, with an iOS-style continuous-ish
    corner. 0.2237 is Apple's superellipse corner ratio for app icons; we
    use a plain rounded rect, which is indistinguishable at 200pt."""
    r = int(CANVAS * radius_frac)
    mask = Image.new('L', (CANVAS, CANVAS), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, CANVAS - 1, CANVAS - 1], radius=r, fill=255)
    out = im.copy()
    out.putalpha(mask)
    return out


def build_splash_keyed(im):
    """SPLASH OPTION B — penguins alone on transparent.

    expo-splash-screen renders this at imageWidth 200 with resizeMode
    contain over backgroundColor #F2F1EC, so a transparent PNG puts the
    penguins directly on the app's cream. Padded to ~86% so the pair is
    not jammed to the canvas edge at render size.
    """
    return fit_into(keyed_penguins(im), int(CANVAS * 0.86))


def build_splash_tile(im):
    """SPLASH OPTION A — the app icon itself, rounded, floating on cream.
    Faithful to art drawn WITH its gold ground and its shadow; zero
    keying risk."""
    return fit_into(rounded_tile(im), int(CANVAS * 0.78))


def inscribed_width(art):
    """The width at which `art`'s bounding box fits ENTIRELY inside the
    safe circle: diagonal == SAFE_DIAMETER."""
    import math
    bbox = content_bbox(art)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    return int(round(w * (SAFE_DIAMETER / math.hypot(w, h))))


def build_adaptive(im):
    """ANDROID ADAPTIVE FOREGROUND.

    Full-bleed gold ground with the art scaled to sit inside the 72/108
    safe circle. app.json already sets adaptiveIcon.backgroundColor to the
    same #F4C84B, so what the mask crops at the corners is gold either
    way and the seam cannot show. Keying is not needed here at all —
    which is why this is the one output with no flood fill in its path.
    """
    keyed = keyed_penguins(im)
    art = fit_into(keyed, inscribed_width(keyed))
    ground = Image.new('RGBA', (CANVAS, CANVAS), GOLD + (255,))
    ground.alpha_composite(art)
    return ground


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    # optimize=True + a fixed encoder path keeps regeneration deterministic.
    img.save(path, 'PNG', optimize=True)
    print(f'  wrote {path} ({os.path.getsize(path)} bytes)')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='assets/images')
    ap.add_argument('--previews', action='store_true')
    ap.add_argument('--splash', choices=['tile', 'keyed'], default='keyed')
    # CAT'S RULING, 24 Aug: THE ADAPTIVE ICON IS HELD. It is a hashed
    # fingerprint source on ANDROID ONLY (on iOS only its PATH appears,
    # inside the expoConfig source), so with Android waiting it would enter
    # no binary, could not be tested by the build that shipped it, and would
    # re-number an update lane no installed app has ever served. Writing it
    # is one command the day Android becomes real — which is the whole
    # reason this is a recipe and not a pair of committed binaries.
    ap.add_argument('--with-adaptive', action='store_true',
                    help='also write adaptive-icon.png (HELD by ruling; Android only)')
    a = ap.parse_args()

    im = load_source()
    print(f'source {SRC} {im.size}')

    splash = build_splash_keyed(im) if a.splash == 'keyed' else build_splash_tile(im)
    save(splash, os.path.join(a.out, 'splash-icon.png'))

    adaptive = build_adaptive(im)
    if a.with_adaptive or a.previews:
        save(adaptive, os.path.join(a.out, 'adaptive-icon.png'))
    else:
        print('  adaptive-icon.png HELD by ruling (24 Aug) — pass --with-adaptive to write it')

    if a.previews:
        save(build_splash_tile(im), os.path.join(a.out, 'preview-splash-A-tile.png'))
        save(build_splash_keyed(im), os.path.join(a.out, 'preview-splash-B-keyed.png'))
        _previews(im, adaptive, a.out)


def _previews(im, adaptive, out):
    """Renders for the nod: what each icon actually looks like in situ."""
    # Splash at true render size on the real cream background.
    for name, img in (('A-tile', build_splash_tile(im)), ('B-keyed', build_splash_keyed(im))):
        card = Image.new('RGBA', (760, 420), CREAM + (255,))
        shown = img.resize((200, 200), Image.LANCZOS)   # imageWidth: 200
        card.alpha_composite(shown, (60, 110))
        big = img.resize((300, 300), Image.LANCZOS)
        card.alpha_composite(big, (380, 60))
        d = ImageDraw.Draw(card)
        d.text((60, 70), f'splash {name} - left: true 200pt render, right: 300px', fill=(60, 60, 60))
        save(card, os.path.join(out, f'preview-splash-{name}-insitu.png'))

    # Adaptive under the three masks that actually ship, plus the safe ring.
    card = Image.new('RGBA', (1000, 380), (255, 255, 255, 255))
    x = 40
    for label, maker in (
        ('circle', lambda m: ImageDraw.Draw(m).ellipse([0, 0, 255, 255], fill=255)),
        ('squircle', lambda m: ImageDraw.Draw(m).rounded_rectangle([0, 0, 255, 255], radius=70, fill=255)),
        ('rounded sq', lambda m: ImageDraw.Draw(m).rounded_rectangle([0, 0, 255, 255], radius=40, fill=255)),
    ):
        small = adaptive.resize((256, 256), Image.LANCZOS)
        mask = Image.new('L', (256, 256), 0)
        maker(mask)
        masked = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
        masked.paste(small, (0, 0), mask)
        card.alpha_composite(masked, (x, 80))
        ImageDraw.Draw(card).text((x, 50), label, fill=(60, 60, 60))
        x += 300
    # safe-zone ring drawn over the last one
    d = ImageDraw.Draw(card)
    cx, cy = x - 300 + 128, 80 + 128
    r = int(128 * SAFE_FRACTION)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(220, 40, 40), width=3)
    d.text((40, 350), 'red ring = the 72/108 safe zone; art must sit inside it', fill=(150, 30, 30))
    save(card, os.path.join(out, 'preview-adaptive-masks.png'))


if __name__ == '__main__':
    main()
