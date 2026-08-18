#!/usr/bin/env python3
"""One-time: read the tokens out of both apps and write tokens.json.

This runs ONCE, to bootstrap the source of truth from the code that currently
holds it in two places. After that tokens.json is the source and the emitters
run the other way — see README.md.

It also reports where the two platforms disagree, because that is the whole
reason for doing this: a value written twice is a value that will eventually be
written differently, and the app has already proved it twice (--warn-text in
dark was under the AA contrast floor, --track in dark differs by 0.01).
"""
import json
import re
from collections import OrderedDict
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CSS = REPO / "apps/web/src/app/globals.css"
SWIFT = REPO / "apps/ios/GastosDiarios/Design/Theme.swift"
OUT = Path(__file__).parent / "tokens.json"

# CSS token -> (Swift name, human note). Order is the order they appear on disk.
CORE = OrderedDict([
    ("--bg",             ("bg",           "App background")),
    ("--surface",        ("surface",      "Cards and sheets")),
    ("--ink",            ("ink",          "Primary text")),
    ("--ink-secondary",  ("inkSecondary", "Secondary text")),
    ("--ink-tertiary",   ("inkTertiary",  "Tertiary text, section labels")),
    ("--accent",         (None,           "Brand coral")),
    ("--accent-strong",  (None,           "Coral for text on light surfaces")),
])
# Tokens spelled as ink-at-N% rather than as their own colour.
ALPHA = OrderedDict([
    ("--line-card", ("border",     "Card border")),
    ("--line-pill", ("borderPill", "Pill and chip border")),
    ("--line-soft", ("separator",  "Hairline between rows")),
    ("--fill",      ("fill",       "Inset fills")),
    ("--track",     ("track",      "Progress track")),
])
STATES = OrderedDict([
    ("--good",      ("green",     "On track")),
    ("--good-text", ("greenText", "On-track text")),
    ("--warn",      (None,        "Running low")),
    ("--warn-text", ("amberText", "Running-low text")),
    ("--over",      (None,        "Over budget")),
    ("--over-text", (None,        "Over-budget text")),
])
MEMBERS = OrderedDict([
    ("--member-blue", ("avatarBlue", "Member C")),
    ("--member-pink", ("avatarPink", "Member N")),
])


def css_blocks() -> tuple[dict[str, str], dict[str, str]]:
    """Light and dark, with the two dark blocks checked against each other."""
    css = CSS.read_text()
    parse = lambda b: dict(re.findall(r"(--[\w-]+):\s*([^;]+);", b))
    light = parse(css[css.index(":root {"):css.index("/* ── Dark")])
    darks = [parse(css[m.end():css.index("}", css.index("--key-shadow", m.end()))])
             for m in re.finditer(
                 r':root(?::not\(\[data-theme="light"\]\)|\[data-theme="dark"\])\s*\{', css)]
    assert len(darks) == 2 and darks[0] == darks[1], "the two dark blocks disagree"
    return light, {**light, **darks[0]}


def swift_tokens() -> dict[str, tuple]:
    """Swift name -> (light, dark) hex, or (light, dark, lightAlpha, darkAlpha)."""
    text = SWIFT.read_text()
    out: dict[str, tuple] = {}
    for m in re.finditer(
        r'static let (\w+) = Color\.hex\(light: "(#[0-9A-Fa-f]{6})", dark: "(#[0-9A-Fa-f]{6})"'
        r'(?:, lightAlpha: ([0-9.]+), darkAlpha: ([0-9.]+))?\)', text
    ):
        name, l, d, la, da = m.groups()
        out[name] = (l.lower(), d.lower()) if la is None else (l.lower(), d.lower(), float(la), float(da))
    return out


def rgba_parts(value: str) -> tuple[str, float] | None:
    """rgba(36, 26, 16, 0.08) -> ("#241a10", 0.08)."""
    m = re.match(r"rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)", value.strip())
    if not m:
        return None
    r, g, b, a = m.groups()
    return f"#{int(r):02x}{int(g):02x}{int(b):02x}", float(a)


def main() -> None:
    light, dark = css_blocks()
    ios = swift_tokens()
    conflicts: list[str] = []

    def colour(css_key: str, swift_name: str | None, note: str) -> dict:
        """One token as DTCG, and a complaint if the platforms disagree."""
        wl, wd = light[css_key].strip().lower(), dark[css_key].strip().lower()
        entry = {"$type": "color", "$description": note,
                 "$value": {"light": wl, "dark": wd}}
        if swift_name and swift_name in ios and len(ios[swift_name]) == 2:
            il, idk = ios[swift_name]
            if (il, idk) != (wl, wd):
                conflicts.append(f"{css_key}: web {wl}/{wd} vs iOS {il}/{idk}")
        if swift_name:
            entry["$extensions"] = {"gastos.swift": swift_name}
        return entry

    def alpha_colour(css_key: str, swift_name: str, note: str) -> dict:
        """A token spelled base-colour + opacity, which is how iOS holds it."""
        wl, wd = rgba_parts(light[css_key]), rgba_parts(dark[css_key])
        entry = {"$type": "color", "$description": note,
                 "$value": {"light": {"base": wl[0], "alpha": wl[1]},
                            "dark": {"base": wd[0], "alpha": wd[1]}},
                 "$extensions": {"gastos.swift": swift_name}}
        if swift_name in ios and len(ios[swift_name]) == 4:
            il, idk, ila, ida = ios[swift_name]
            if (il, ila) != (wl[0], wl[1]) or (idk, ida) != (wd[0], wd[1]):
                conflicts.append(
                    f"{css_key}: web {wl[0]}@{wl[1]}/{wd[0]}@{wd[1]} "
                    f"vs iOS {il}@{ila}/{idk}@{ida}")
        return entry

    tokens = {
        "$description": "Gastos Diarios design tokens. Source of truth; the web CSS "
                        "and the iOS theme are generated from this file.",
        "color": {
            "core":    {k.removeprefix("--"): colour(k, sw, n) for k, (sw, n) in CORE.items()},
            "line":    {k.removeprefix("--"): alpha_colour(k, sw, n) for k, (sw, n) in ALPHA.items()},
            "state":   {k.removeprefix("--"): colour(k, sw, n) for k, (sw, n) in STATES.items()},
            "member":  {k.removeprefix("--"): colour(k, sw, n) for k, (sw, n) in MEMBERS.items()},
        },
    }
    OUT.write_text(json.dumps(tokens, indent=2) + "\n")
    n = sum(len(v) for v in tokens["color"].values())
    print(f"  {n} tokens -> {OUT.relative_to(REPO)}")
    if conflicts:
        print(f"\n  {len(conflicts)} divergencias entre plataformas:")
        for c in conflicts:
            print(f"    · {c}")
    else:
        print("  las dos plataformas coinciden en todo")


if __name__ == "__main__":
    main()
