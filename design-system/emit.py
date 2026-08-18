#!/usr/bin/env python3
"""Generate each platform's token declarations from tokens.json.

  python3 design-system/emit.py            print what each platform should say
  python3 design-system/emit.py --verify   compare against the files on disk

`--verify` is the whole point, and it is what decides when this layer is ready
to become the source rather than a mirror: when it emits, character for
character, what two people wrote by hand across two languages, then it provably
contains everything those files say. Until then it is a claim; after that it is
a diff. Wire it into CI and the two can never drift again.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[0]
TOKENS = json.loads((ROOT / "tokens.json").read_text())
CSS = REPO / "apps/web/src/app/globals.css"
SWIFT = REPO / "apps/ios/GastosDiarios/Design/Theme.swift"


def flat() -> list[tuple[str, dict]]:
    """Every token as (css-name, entry), in file order."""
    return [(f"--{name}", entry)
            for group in TOKENS["color"].values()
            for name, entry in group.items()]


def css_value(v) -> str:
    """A token's CSS spelling: a hex, or rgba() when it carries opacity."""
    if isinstance(v, str):
        return v
    r, g, b = (int(v["base"][i:i + 2], 16) for i in (1, 3, 5))
    return f"rgba({r}, {g}, {b}, {v['alpha']})"


def swift_value(entry: dict) -> str | None:
    name = entry.get("$extensions", {}).get("gastos.swift")
    if not name:
        return None
    lv, dv = entry["$value"]["light"], entry["$value"]["dark"]
    if isinstance(lv, str):
        return f'static let {name} = Color.hex(light: "{lv.upper()}", dark: "{dv.upper()}")'
    return (f'static let {name} = Color.hex(light: "{lv["base"].upper()}", '
            f'dark: "{dv["base"].upper()}", lightAlpha: {lv["alpha"]:.2f}, '
            f'darkAlpha: {dv["alpha"]:.2f})')


def emit_css() -> tuple[list[str], list[str]]:
    light, dark = [], []
    for css_name, entry in flat():
        light.append(f"  {css_name}: {css_value(entry['$value']['light'])};")
        dv = css_value(entry["$value"]["dark"])
        if dv != css_value(entry["$value"]["light"]):
            dark.append(f"  {css_name}: {dv};")
    return light, dark


def verify() -> int:
    """Every emitted declaration must appear verbatim in the file it targets."""
    css_text, swift_text = CSS.read_text(), SWIFT.read_text()
    missing = []
    light, dark = emit_css()
    for line in light + dark:
        # The dark blocks are indented one level deeper inside the media query,
        # so compare on the stripped declaration.
        if line.strip() not in css_text:
            missing.append(f"CSS    {line.strip()}")
    for _, entry in flat():
        line = swift_value(entry)
        if line and line not in swift_text:
            missing.append(f"Swift  {line}")
    total = len(light) + len(dark) + sum(1 for _, e in flat() if swift_value(e))
    if missing:
        print(f"  {len(missing)} de {total} declaraciones NO coinciden con el código:")
        for m in missing:
            print(f"    · {m}")
        return 1
    print(f"  las {total} declaraciones emitidas coinciden con el código, carácter por carácter")
    return 0


if __name__ == "__main__":
    if "--verify" in sys.argv:
        sys.exit(verify())
    light, dark = emit_css()
    print("/* light */");  print("\n".join(light))
    print("\n/* dark */"); print("\n".join(dark))
    print("\n// Swift")
    for _, entry in flat():
        if (line := swift_value(entry)):
            print("    " + line)
