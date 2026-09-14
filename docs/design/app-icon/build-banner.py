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
PAD = 28


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


def banner(variant: str) -> str:
    """Three shapes, one mark. See the README of this directory for the choice."""
    scale = (H - 2 * PAD) / (CONTENT["y1"] - CONTENT["y0"])
    # `mark` centres on a 1024 canvas; re-centre it on a square of side H.
    tile = f'<g transform="translate({-512 + H / 2:.2f} {-512 + H / 2:.2f})">{mark(*MARKS[variant], scale)}</g>'

    if variant == "a":  # coral field, cream mark and word — the app icon, widened
        text, w = wordmark("Gastos", CREAM, 132, H + 8, H / 2 + 46)
        total = H + 8 + w + PAD * 2
        return _svg(
            total,
            f'<rect width="{total}" height="{H}" rx="{H / 5:.0f}" fill="url(#bg)"/>',
            tile + "\n  " + text,
            bg=(CORAL, CORAL_DEEP),
        )

    if variant == "b":  # transparent field, coral mark, ink word
        text, w = wordmark("Gastos", INK, 132, H + 8, H / 2 + 46)
        total = H + 8 + w
        return _svg(total, "", tile + "\n  " + text, bg=None)

    # "c": rounded coral tile beside an ink word, on nothing
    text, w = wordmark("Gastos", INK, 132, H + 24, H / 2 + 46)
    total = H + 24 + w
    tile_bg = f'<rect width="{H}" height="{H}" rx="{H * 0.2237:.1f}" fill="url(#bg)"/>'
    return _svg(total, "", tile_bg + "\n  " + tile + "\n  " + text, bg=(CORAL, CORAL_DEEP))


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
