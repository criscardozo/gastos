#!/usr/bin/env python3
"""Draw the Gastos app icon from the design system's own geometry.

Run:  python3 docs/design/app-icon/build-icon.py [size]
Needs `rsvg-convert` (brew install librsvg). Writes SVG + PNG into ./out/.

Running it WRITES the shipped icons in place (see SHIPPED below) — iOS, the
Watch, and the web's manifest + apple-touch icons. That is deliberate: the web
PNGs were hand-made separately once and quietly kept the old snout for three
weeks after the mark was fixed, because nothing tied them to it. One generator,
one command, no drift.

iOS wants a full-bleed square with NO alpha: the system applies the rounded
mask itself, and an icon carrying its own corners gets double-rounded.

The mark is the web's PiggyMark (apps/web/src/components/brand.tsx), laid out on
its 96x96 grid and transformed onto a 1024 canvas. Same drawing as the sidebar,
the widget tile and the iOS app — nothing invented here, only placed.
"""
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).parent / "out"

CORAL = "#FF5C39"
CORAL_DEEP = "#E8492A"
CREAM = "#FAF6EF"
INK = "#241A10"

# The mark's content box on the 96 grid: coin top to legs bottom, tail to snout.
CONTENT = {"x0": 11.0, "y0": 7.7, "x1": 90.0, "y1": 84.0}


def mark(body: str, detail: str, scale: float) -> str:
    """The piggy, on the 96 grid, scaled and centred on a 1024 canvas.

    `body` is a paint reference, so it may be a flat colour or url(#body).
    """
    cx = (CONTENT["x0"] + CONTENT["x1"]) / 2
    cy = (CONTENT["y0"] + CONTENT["y1"]) / 2
    tx = 512 - cx * scale
    ty = 512 - cy * scale
    return f"""  <g transform="translate({tx:.2f} {ty:.2f}) scale({scale:.4f})">
    <!-- tail: an open curl, stroked so it reads at 40px -->
    <path d="M18 54 a6 6 0 1 1 -1.5 -9.5" fill="none" stroke="{body}"
          stroke-width="4.2" stroke-linecap="round"/>
    <!-- legs -->
    <rect x="29" y="70" width="10" height="14" rx="5" fill="{body}"/>
    <rect x="55" y="70" width="10" height="14" rx="5" fill="{body}"/>
    <!-- ear, behind the body -->
    <path d="M54 33.5 Q58 21.5 67 24.5 Q71.5 27.5 64.5 36 Z" fill="{body}"/>
    <!-- body -->
    <ellipse cx="47" cy="56" rx="31" ry="25" fill="{body}"/>
    <!-- snout: wider than tall and clear of the body, with the nostrils side
         by side on the part that protrudes. Stacked vertically on a vertical
         capsule (as it was) reads as a power socket, not a muzzle. -->
    <rect x="70" y="47.5" width="20" height="17" rx="8.5" fill="{body}"/>
    <circle cx="81" cy="56" r="2.3" fill="{detail}"/>
    <circle cx="86.5" cy="56" r="2.3" fill="{detail}"/>
    <!-- eye -->
    <circle cx="60.5" cy="49" r="3" fill="{detail}"/>
    <!-- coin slot: sits ON the back, fully inside the body silhouette -->
    <rect x="36" y="34" width="15" height="4.6" rx="2.3" fill="{detail}"/>
    <!-- the coin going in -->
    <circle cx="43" cy="16.5" r="8.8" fill="{body}"/>
    <rect x="41.2" y="11.8" width="3.6" height="9.4" rx="1.8" fill="{detail}"/>
  </g>"""


def svg(
    bg_from: str,
    bg_to: str,
    body: str,
    detail: str,
    scale: float,
    body_to: str | None = None,
) -> str:
    """`body_to` puts a gradient on the MARK rather than only on the field.

    That is what the dark appearance needs: Apple's own dark icons drop the
    coloured field and let the glyph carry both the brand colour and the
    gradient (compare the App Store icon in light and dark). A flat mark on a
    dark field reads as a different app, not the same one at night.
    """
    body_paint = "url(#body)" if body_to else body
    body_def = (
        f"""
    <linearGradient id="body" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="{body}"/>
      <stop offset="1" stop-color="{body_to}"/>
    </linearGradient>"""
        if body_to
        else ""
    )
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{bg_from}"/>
      <stop offset="1" stop-color="{bg_to}"/>
    </linearGradient>{body_def}
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
{mark(body_paint, detail, scale)}
</svg>"""


VARIANTS = {
    # Cream mark on the brand coral — how the sidebar and the widget wear it.
    "a-cream-on-coral": dict(bg_from=CORAL, bg_to=CORAL_DEEP, body=CREAM, detail=CORAL, scale=8.1),
    # Inverted: the app's paper as the field, the mark in coral.
    "b-coral-on-cream": dict(bg_from=CREAM, bg_to="#F1EADF", body=CORAL, detail=CREAM, scale=8.1),
    # Dark appearance. NOT the app's own night paper (a warm brown) and NOT a
    # cream mark: on a dark field a cream pig carried none of the brand colour,
    # so at night this stopped being "the orange app". Apple's own icons make
    # the opposite move — compare the App Store icon in light and dark — and
    # let the GLYPH carry both the colour and the gradient.
    #
    # The field greys are MEASURED off a screenshot of the App Store icon on
    # this phone, not guessed: a neutral vertical ramp, #303030 at the top,
    # #232323 through the middle, #151515 at the bottom. Warm browns were tried
    # first and read as a different app sitting next to it.
    # Maskable web icon: the same coral-on-cream, pulled in so the whole mark
    # survives a circular crop. At scale 6.6 the content's half-diagonal is
    # ~362 of the 409.6 the 80% safe circle allows on a 1024 canvas.
    "d-maskable": dict(bg_from=CREAM, bg_to="#F1EADF", body=CORAL, detail=CREAM, scale=6.6),
    "c-dark": dict(
        bg_from="#303030", bg_to="#151515",
        body="#FF7A52", body_to=CORAL_DEEP, detail="#1E1E1E", scale=8.1,
    ),
}


REPO = Path(__file__).resolve().parents[3]

# variant -> [(size, path relative to the repo root), ...]
SHIPPED = {
    "a-cream-on-coral": [
        (1024, "apps/ios/Gastos/Resources/Assets.xcassets/AppIcon.appiconset/appicon-1024.png"),
        (1024, "apps/ios/GastosWatch/Assets.xcassets/AppIcon.appiconset/appicon-1024.png"),
    ],
    "c-dark": [
        (1024, "apps/ios/Gastos/Resources/Assets.xcassets/AppIcon.appiconset/appicon-dark-1024.png"),
    ],
    # The web wears the inverse: coral mark on the app's paper, matching the
    # manifest's own background_color (#FAF6EF) and the favicon in
    # apps/web/src/app/icon.svg.
    "b-coral-on-cream": [
        (192, "apps/web/public/icons/icon-192.png"),
        (512, "apps/web/public/icons/icon-512.png"),
        (180, "apps/web/src/app/apple-icon.png"),
    ],
    # Maskable: Android and friends crop this to a circle, so the mark has to
    # sit inside the 80%-diameter safe area. Same drawing, more air.
    "d-maskable": [
        (512, "apps/web/public/icons/icon-maskable-512.png"),
    ],
}


# The one raster that is not a PNG. `/favicon.ico` was a 404 in production:
# this app only ever offered an SVG favicon plus an apple-touch icon, and the
# crawlers that build site icons — 1Password's asks for a 120px PNG — start at
# `/favicon.ico` and do not read SVG. Browsers do not need it; crawlers and
# anything older than SVG favicons do.
#
# Several sizes in one file because an ICO is a container: a 16 for the tab, a
# 32 for the bookmark bar, and a 128 so whoever wants a big one is not scaling
# up a 32.
#
# In `public/`, not in `app/`. Next treats an `app/favicon.ico` as a metadata
# file and decodes it, and its ICO decoder refuses anything that is not RGBA —
# `rsvg-convert` writes 8-bit RGB for an opaque drawing, so the build failed
# with "The PNG is not in RGBA format!". From `public/` the file is served
# byte for byte and nothing parses it, which is what a favicon wants: the
# `<link rel="icon">` in the HTML still comes from `app/icon.svg`, and this is
# for whoever asks for `/favicon.ico` without reading any HTML.
ICO = ("b-coral-on-cream", [16, 32, 48, 128], "apps/web/public/favicon.ico")


def ico(pngs: list[tuple[int, bytes]]) -> bytes:
    """Pack rendered PNGs into an ICO, without a second system dependency.

    ImageMagick would do this in one line and is installed on this machine,
    which is the argument against it: the script says it needs `rsvg-convert`
    and that stays true. An ICO may carry PNG data directly (Vista onwards),
    so the container is a 6-byte header plus a 16-byte entry each, and that is
    the whole format. The trade is readers older than that, which want BMP —
    written down rather than discovered, and not a trade this project pays for.
    """
    import struct

    header = struct.pack("<HHH", 0, 1, len(pngs))
    offset = len(header) + 16 * len(pngs)
    entries, blobs = b"", b""
    for size, data in pngs:
        # 0 means 256 in this field, which is why it is a single byte.
        entries += struct.pack(
            "<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset
        )
        blobs += data
        offset += len(data)
    return header + entries + blobs


def render(name: str, kwargs: dict, size: int) -> Path:
    src = OUT / f"{name}.svg"
    src.write_text(svg(**kwargs))
    png = OUT / f"{name}-{size}.png"
    subprocess.run(
        ["rsvg-convert", "-w", str(size), "-h", str(size), "-o", str(png), str(src)],
        check=True,
    )
    return png


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Any argument renders previews only, without touching the shipped files.
    preview_only = len(sys.argv) > 1
    for name, kwargs in VARIANTS.items():
        if preview_only:
            print(f"  {render(name, kwargs, int(sys.argv[1])).name}")
            continue
        for size, dest in SHIPPED.get(name, [(1024, None)]):
            png = render(name, kwargs, size)
            if dest is None:
                print(f"  {png.name} (preview only)")
                continue
            target = REPO / dest
            target.write_bytes(png.read_bytes())
            print(f"  {size:>4}  {dest}")

    if preview_only:
        return
    name, sizes, dest = ICO
    packed = ico([(s, render(name, VARIANTS[name], s).read_bytes()) for s in sizes])
    (REPO / dest).write_bytes(packed)
    print(f"  {'+'.join(map(str, sizes))}  {dest}")


if __name__ == "__main__":
    main()
