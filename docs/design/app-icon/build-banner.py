#!/usr/bin/env python3
"""Draw the README banner from the SAME mark the app ships.

Run:  python3 docs/design/app-icon/build-banner.py [variant ...]
Needs `rsvg-convert` (brew install librsvg). Writes into ./out/.

The mark is imported from build-icon.py rather than redrawn. That script exists
because the web PNGs were once made separately and kept a stale snout for three
weeks; a banner traced by hand would be the same defect with a new file name.

The wordmark is Outfit — the app's own typeface, loaded from the repo copy the
iOS target bundles, so the banner cannot drift from what the app renders either.
It is converted to paths at build time: an SVG on GitHub is served as an image
and never loads a webfont, so text that stays text renders in whatever the
viewer happens to have.
"""

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_icon import CONTENT, CORAL, CORAL_DEEP, CREAM, INK, mark  # noqa: E402

OUT = Path(__file__).parent / "out"
FONT = Path(__file__).parents[3] / "apps/ios/Gastos/Resources/Fonts/Outfit-Variable.ttf"

H = 256  # banner height; the mark is inset from it
PAD = 34


def wordmark(text: str, fill: str, size: float, x: float, y: float) -> str:
    """`text` as filled paths, so no font has to exist where it is viewed."""
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.ttLib import TTFont

    font = TTFont(FONT, fontNumber=0)
    # The variable font's default instance is Thin; the app uses the 600 cut.
    if "fvar" in font:
        from fontTools.varLib.instancer import instantiateVariableFont

        font = instantiateVariableFont(font, {"wght": 600}, inplace=False)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upem = font["head"].unitsPerEm
    s = size / upem
    out, pen_x = [], 0.0
    for ch in text:
        name = cmap.get(ord(ch))
        if name is None:
            continue
        pen = SVGPathPen(glyphs)
        glyphs[name].draw(pen)
        d = pen.getCommands()
        if d:
            out.append(
                f'<path d="{d}" fill="{fill}" '
                f'transform="translate({x + pen_x * s:.2f} {y:.2f}) scale({s:.5f} {-s:.5f})"/>'
            )
        pen_x += glyphs[name].width
    return "\n  ".join(out), pen_x * s


def ink_box() -> dict:
    """Where the mark's INK actually falls on the 96 grid, measured.

    `CONTENT` in build-icon.py is the mark's geometry — "tail to snout" — and
    the tail is a 4.2-wide stroke with round caps, so the drawing reaches about
    five units further left than the box says. Laying out from `CONTENT` gave a
    left inset of 27px against 47 top and bottom: tight on one side, and for a
    reason nothing in the numbers showed.
    """
    import tempfile

    s = 8.1
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
        f'viewBox="0 0 1024 1024">{mark(CREAM, CORAL, s)}</svg>'
    )
    with tempfile.TemporaryDirectory() as d:
        Path(d, "m.svg").write_text(svg)
        subprocess.run(
            ["rsvg-convert", "-w", "1024", f"{d}/m.svg", "-o", f"{d}/m.png"], check=True
        )
        px = subprocess.run(
            ["magick", f"{d}/m.png", "-trim", "-format", "%[fx:page.x] %w %[fx:page.y] %h", "info:"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.split()
    x, w, y, h = (float(v) for v in px)
    cx = (CONTENT["x0"] + CONTENT["x1"]) / 2
    cy = (CONTENT["y0"] + CONTENT["y1"]) / 2
    # `mark` puts the CONTENT centre at 512,512 and scales by `s`; invert that.
    return {
        "x0": cx + (x - 512) / s,
        "x1": cx + (x + w - 512) / s,
        "y0": cy + (y - 512) / s,
        "y1": cy + (y + h - 512) / s,
    }


def banner(variant: str) -> str:
    """Three shapes, one mark. See the README of this directory for the choice."""
    # Every inset is stated, not inherited, and measured rather than assumed.
    ink = ink_box()
    box = H - 2 * PAD
    cw = ink["x1"] - ink["x0"]
    ch = ink["y1"] - ink["y0"]
    scale = min(box / ch, box / cw)
    mw = cw * scale
    # `mark` centres its CONTENT box on 512,512; the ink's centre sits elsewhere,
    # so the offset between the two is what has to be taken out.
    cx = (CONTENT["x0"] + CONTENT["x1"]) / 2
    cy = (CONTENT["y0"] + CONTENT["y1"]) / 2
    drift_x = ((ink["x0"] + ink["x1"]) / 2 - cx) * scale
    drift_y = ((ink["y0"] + ink["y1"]) / 2 - cy) * scale
    place = (
        f"translate({PAD + mw / 2 - 512 - drift_x:.2f} {H / 2 - 512 - drift_y:.2f})"
    )
    tile = f'<g transform="{place}">{mark(*MARKS[variant], scale)}</g>'
    GAP = PAD  # between mark and word, same as the edges

    text_x = PAD + mw + GAP
    baseline = H / 2 + 46

    if variant == "a":  # coral field, cream mark and word — the app icon, widened
        text, w = wordmark("Gastos", CREAM, 132, text_x, baseline)
        total = text_x + w + PAD
        return _svg(
            total,
            f'<rect width="{total}" height="{H}" rx="{H / 5:.0f}" fill="url(#bg)"/>',
            tile + "\n  " + text,
            bg=(CORAL, CORAL_DEEP),
        )

    if variant == "b":  # transparent field, coral mark, ink word
        text, w = wordmark("Gastos", INK, 132, text_x, baseline)
        return _svg(text_x + w, "", tile + "\n  " + text, bg=None)

    # "c": rounded coral tile beside an ink word, on nothing
    text, w = wordmark("Gastos", INK, 132, text_x, baseline)
    tile_bg = f'<rect width="{H}" height="{H}" rx="{H * 0.2237:.1f}" fill="url(#bg)"/>'
    return _svg(text_x + w, "", tile_bg + "\n  " + tile + "\n  " + text, bg=(CORAL, CORAL_DEEP))


MARKS = {
    "a": (CREAM, CORAL),
    "b": (CORAL, CREAM),
    "c": (CREAM, CORAL),
}


def _svg(width: float, field: str, body: str, bg) -> str:
    defs = ""
    if bg:
        defs = f"""
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{bg[0]}"/>
      <stop offset="1" stop-color="{bg[1]}"/>
    </linearGradient>"""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width:.0f}" height="{H}" viewBox="0 0 {width:.0f} {H}">
  <defs>{defs}
  </defs>
  {field}
  {body}
</svg>
"""


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for v in sys.argv[1:] or ["a", "b", "c"]:
        svg_path = OUT / f"banner-{v}.svg"
        svg_path.write_text(banner(v))
        png = OUT / f"banner-{v}.png"
        subprocess.run(
            ["rsvg-convert", "-h", "160", str(svg_path), "-o", str(png)], check=True
        )
        print(f"  {svg_path.relative_to(Path.cwd())}  +  {png.name}")


if __name__ == "__main__":
    main()
