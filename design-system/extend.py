#!/usr/bin/env python3
"""Add the non-colour tokens to tokens.json, measured from both clients.

Colour could be extracted by reading two declaration blocks. Type, radius and
spacing cannot: they are written inline across the components, so the source of
truth for "what the system is" is what the code reaches for and how often.

That makes the fidelity check a different shape, and a more useful one. For
colour it asks "do both platforms say what the token file says". Here it asks
"does anything in the code use a value the token file does not sanction" — which
catches a one-off slipping in, the thing that actually erodes a scale.
"""
import json
from pathlib import Path

import usage

ROOT = Path(__file__).resolve().parent
TOKENS = ROOT / "tokens.json"

# A step earns its place by being used. Below this it is noise, not a rung, and
# listing it would document the rare and bury the frequent — which is exactly
# what happened when 14.5 (5 uses) was in and 14 (25) was out.
MIN_USES = 8


def main() -> None:
    doc = json.loads(TOKENS.read_text())
    web, ios = usage.type_steps(), usage.ios_type_steps()
    ios_by = {s: w for s, w in ios}
    web_by = {s: w for s, w in web}
    tot = lambda ws: sum(ws.values())

    steps = {}
    for size in sorted(set(web_by) | set(ios_by), key=lambda z: -(tot(web_by.get(z, {})) + tot(ios_by.get(z, {})))):
        w, i = web_by.get(size, {}), ios_by.get(size, {})
        if tot(w) + tot(i) < MIN_USES:
            continue
        entry = {"$type": "dimension", "$value": f"{size:g}px"}
        # The dominant weight is part of the step, not a separate axis.
        weights = {}
        if w: weights["web"] = max(w, key=w.get)
        if i: weights["ios"] = max(i, key=i.get)
        entry["$extensions"] = {
            "gastos.weight": weights,
            "gastos.uses": {"web": tot(w), "ios": tot(i)},
        }
        steps[f"s{size:g}".replace(".", "_")] = entry
    doc["type"] = {
        "$description": "Steps the components actually use, counted with their weight and "
                        "per platform. The row step is 14 on web and 14.5 on iOS, and the "
                        "screen title 22 and 18 — deliberate, so the system names both "
                        "rather than picking one and being wrong on the other client.",
        **steps,
    }

    # Both clients, like the type block above — this read web only, so the two
    # radii iOS reaches for most (14 at 25 uses, 20 at 14) were not in the scale
    # and nothing said so: `coverage()` called `radii()`, which walks `.tsx`.
    # Reported by Kyber. A radius earns its place on the COMBINED count, and the
    # entry records each platform separately, because 14 is the most used radius
    # on one client and near-absent on the other, and a single total would hide
    # exactly that.
    web_r, ios_r = dict(usage.radii()), dict(usage.ios_radii())
    radii = {}
    for r in sorted(set(web_r) | set(ios_r),
                    key=lambda z: -(web_r.get(z, 0) + ios_r.get(z, 0))):
        w, i = web_r.get(r, 0), ios_r.get(r, 0)
        if w + i < MIN_USES:
            continue
        radii[f"r{r:g}"] = {"$type": "dimension", "$value": f"{r:g}px",
                            "$extensions": {"gastos.uses": {"web": w, "ios": i}}}
    doc["radius"] = {
        "$description": "Explicit corner radii in use, counted per platform. `full` is a "
                        "shape rule, not a number — `rounded-full` on web, `Capsule()` "
                        "on iOS.",
        **radii,
        "full": {"$type": "dimension", "$value": "9999px",
                 "$extensions": {"gastos.uses": {"web": usage.full_radius_uses(),
                                                 "ios": usage.ios_full_radius_uses()}}},
    }

    doc["spacing"] = {
        "$description": "Horizontal padding and gaps, normalised across Tailwind's two "
                        "spellings. Card padding is 18 and screen padding 20 — neither was "
                        "written down anywhere before a second app asked.",
        "padding": {f"p{p:g}": {"$type": "dimension", "$value": f"{p:g}px",
                                "$extensions": {"gastos.uses": n}}
                    for p, n in usage.padding_x() if n >= MIN_USES},
        "gap": {f"g{g:g}": {"$type": "dimension", "$value": f"{g:g}px",
                            "$extensions": {"gastos.uses": n}}
                for g, n in usage.gaps() if n >= MIN_USES},
    }

    # `ensure_ascii=False`: the default escapes the em-dashes in the
    # descriptions to `—`, so re-running turned characters the file
    # already had into escapes and produced a diff that was not a value
    # change. A generator that cannot reproduce its own output is one nobody
    # re-runs.
    TOKENS.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")
    print(f"  type: {len(steps)} peldaños · radius: {len(doc['radius']) - 1} + full · "
          f"spacing: {len(doc['spacing']['padding'])} padding, {len(doc['spacing']['gap'])} gaps")


if __name__ == "__main__":
    main()
