#!/usr/bin/env python3
"""Build every Gastos icon from the two drawings in ./source/.

Run:  python3 docs/design/app-icon/build-icon.py [size]
Needs `rsvg-convert` (brew install librsvg). Scratch files go to ./out/.

Running it WRITES the shipped icons in place (see SHIPPED below) — iOS, the
Watch, the web's manifest, apple-touch and favicon icons, the in-app marks on
both platforms and the repo's own icon.png. That is deliberate: the web PNGs
were hand-made separately once and quietly kept an old drawing for three weeks
after the mark was fixed, because nothing tied them to it. One generator, one
command, no drift.

The drawings (`icon-light.svg`, `icon-dark.svg`) are the designed artwork,
kept verbatim on a 512 grid: a rounded field, the budget gauge, and the house
with the heart. Nothing here redraws them. What this adds is only placement:

- **Centring.** The art sits 40 units above the canvas centre in the source
  (gauge top 83, house floor 350), which left a band of empty field under the
  house. Every output moves it down by SHIFT, a touch short of geometric
  centre because a shape that is heavier at the top reads as low when it is
  centred exactly.
- **Full bleed for Apple.** iOS and watchOS want a square with NO alpha and no
  corners of their own: the system applies the mask, and an icon carrying its
  own rounding gets rounded twice. So the field's `rx` and the light field's
  hairline edge are dropped there and kept everywhere the tile is shown as is.
- **Safe areas.** The watch crops to a circle and a maskable web icon to an
  80% circle, so the art is scaled in for those two.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "out"
REPO = HERE.resolve().parents[2]

# Downward nudge of the art, in 512 units. Exact centring would be 39.5.
SHIFT = 32


def load(theme: str) -> tuple[str, str, str]:
    """(field rect, field colour, art) out of a source drawing.

    The field is the first <rect>; everything after it is the art.
    """
    text = (HERE / "source" / f"icon-{theme}.svg").read_text()
    body = text.split(">", 1)[1].rsplit("</svg>", 1)[0]
    field = re.search(r"<rect\b[^>]*/>", body)
    assert field, f"icon-{theme}.svg: no field <rect>"
    colour = re.search(r'fill="(#[0-9A-Fa-f]{6})"', field.group(0))
    assert colour, f"icon-{theme}.svg: the field has no fill"
    art = body[field.end():]
    # Comments describe the source, not the output.
    art = re.sub(r"\s*<!--.*?-->", "", art, flags=re.S).strip()
    art = re.sub(r">\s+<", "><", art)
    return field.group(0), colour.group(1), art


def placed(art: str, scale: float = 1.0) -> str:
    """The art moved down by SHIFT, then scaled about the canvas centre."""
    if scale == 1.0:
        return f'<g transform="translate(0 {SHIFT})">{art}</g>'
    return (
        f'<g transform="translate(256 256) scale({scale}) '
        f'translate(-256 {-256 + SHIFT})">{art}</g>'
    )


def tile(theme: str) -> str:
    """The rounded tile, as designed — field, edge and all."""
    field, _, art = load(theme)
    return field + placed(art)


def bleed(theme: str, scale: float = 1.0) -> str:
    """A square field with no corners and no edge, for a system that masks."""
    _, colour, art = load(theme)
    return f'<rect width="512" height="512" fill="{colour}"/>' + placed(art, scale)


def document(inner: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" '
        f'viewBox="0 0 512 512">{inner}</svg>\n'
    )


def favicon_svg() -> str:
    """Both appearances in one file, switched by the browser's own scheme.

    That is the OS/browser setting, not the app's manual theme toggle: a
    favicon is a separate document and cannot see the page's data-theme.
    """
    return document(
        "<style>.d{display:none}"
        "@media (prefers-color-scheme:dark){.l{display:none}.d{display:inline}}"
        "</style>"
        f'<g class="l">{tile("light")}</g><g class="d">{tile("dark")}</g>'
    )


# The farthest point of the art from the canvas centre, once shifted: the
# gauge's outer tip at (36, 335 + SHIFT) — sqrt(220² + 111²) ≈ 246.
REACH = 246.4

VARIANTS = {
    # The tile as designed: web "any" icons, the favicon, the repo's icon.png.
    "tile-light": lambda: document(tile("light")),
    "tile-dark": lambda: document(tile("dark")),
    # iOS, light and dark appearance, and the apple-touch icon.
    "bleed-light": lambda: document(bleed("light")),
    "bleed-dark": lambda: document(bleed("dark")),
    # watchOS crops to the inscribed circle (radius 256); 0.92 leaves the
    # gauge's tips ~30 units clear of it instead of ~10.
    "watch": lambda: document(bleed("light", scale=0.92)),
    # Maskable web icon: the whole art inside the 80% safe circle (204.8).
    "maskable": lambda: document(bleed("light", scale=round(200 / REACH, 3))),
}

# variant -> [(size, path relative to the repo root), ...]
SHIPPED = {
    "bleed-light": [
        (1024, "apps/ios/Gastos/Resources/Assets.xcassets/AppIcon.appiconset/appicon-1024.png"),
        (180, "apps/web/src/app/apple-icon.png"),
    ],
    "bleed-dark": [
        (1024, "apps/ios/Gastos/Resources/Assets.xcassets/AppIcon.appiconset/appicon-dark-1024.png"),
    ],
    "watch": [
        (1024, "apps/ios/GastosWatch/Assets.xcassets/AppIcon.appiconset/appicon-1024.png"),
    ],
    "tile-light": [
        (192, "apps/web/public/icons/icon-192.png"),
        (512, "apps/web/public/icons/icon-512.png"),
        (512, "icon.png"),
    ],
    "maskable": [
        (512, "apps/web/public/icons/icon-maskable-512.png"),
    ],
}

# Vector copies, written as SVG text rather than rendered.
#
# The iOS marks are the full-bleed art: SwiftUI clips them with a continuous
# corner, the same squircle the home screen puts on the icon, which a plain
# SVG `rx` is not. The dark one is a second appearance of the same image set,
# so the app and the widget follow the system without code.
VECTORS = {
    "apps/web/src/app/icon.svg": favicon_svg,
    "apps/ios/Gastos/Resources/Assets.xcassets/AppMark.imageset/app-mark-light.svg": lambda: document(bleed("light")),
    "apps/ios/Gastos/Resources/Assets.xcassets/AppMark.imageset/app-mark-dark.svg": lambda: document(bleed("dark")),
    "apps/ios/GastosWidget/Assets.xcassets/AppMark.imageset/app-mark-light.svg": lambda: document(bleed("light")),
    "apps/ios/GastosWidget/Assets.xcassets/AppMark.imageset/app-mark-dark.svg": lambda: document(bleed("dark")),
}

IMAGESET = """{
  "images" : [
    {
      "filename" : "app-mark-light.svg",
      "idiom" : "universal"
    },
    {
      "appearances" : [
        {
          "appearance" : "luminosity",
          "value" : "dark"
        }
      ],
      "filename" : "app-mark-dark.svg",
      "idiom" : "universal"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  },
  "properties" : {
    "preserves-vector-representation" : true
  }
}
"""

CATALOG = """{
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
"""

# The web's in-app mark (components/brand.tsx) inlines the art rather than
# loading a file: it is the loading screen on every cold start, and offline an
# <img> the service worker has not cached yet is a broken image there.
WEB_ART = "apps/web/src/components/app-mark-art.ts"


def web_art() -> str:
    return (
        "// GENERATED by docs/design/app-icon/build-icon.py from\n"
        "// docs/design/app-icon/source/ — edit the drawings and re-run it.\n"
        "// The rounded tile, light and dark, on a 512 viewBox.\n"
        f"export const APP_MARK_LIGHT = {json.dumps(tile('light'))};\n"
        f"export const APP_MARK_DARK = {json.dumps(tile('dark'))};\n"
    )


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
ICO = ("tile-light", [16, 32, 48, 128], "apps/web/public/favicon.ico")


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


def render(name: str, size: int) -> Path:
    src = OUT / f"{name}.svg"
    src.write_text(VARIANTS[name]())
    png = OUT / f"{name}-{size}.png"
    subprocess.run(
        ["rsvg-convert", "-w", str(size), "-h", str(size), "-o", str(png), str(src)],
        check=True,
    )
    return png


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    # Any argument renders previews only, without touching the shipped files.
    if len(sys.argv) > 1:
        for name in VARIANTS:
            print(f"  {render(name, int(sys.argv[1])).name}")
        return

    for name in VARIANTS:
        for size, dest in SHIPPED.get(name, [(1024, None)]):
            png = render(name, size)
            if dest is None:
                print(f"  {png.name} (preview only)")
                continue
            (REPO / dest).write_bytes(png.read_bytes())
            print(f"  {size:>4}  {dest}")

    for dest, build in VECTORS.items():
        target = REPO / dest
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(build())
        print(f"   svg  {dest}")
        if target.parent.suffix == ".imageset":
            (target.parent / "Contents.json").write_text(IMAGESET)
            catalog = target.parent.parent / "Contents.json"
            if not catalog.exists():
                catalog.write_text(CATALOG)

    (REPO / WEB_ART).write_text(web_art())
    print(f"    ts  {WEB_ART}")

    name, sizes, dest = ICO
    packed = ico([(s, render(name, s).read_bytes()) for s in sizes])
    (REPO / dest).write_bytes(packed)
    print(f"  {'+'.join(map(str, sizes))}  {dest}")


if __name__ == "__main__":
    main()
