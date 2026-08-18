#!/usr/bin/env python3
"""Build the Claude Design *design-system* pages from this repo's own tokens.

Run:  python3 docs/design/design-system/build.py
Writes standalone HTML into ./out/, ready for the DesignSync tool to upload.

Why generated and not hand-written: the app icon spent three weeks showing an
old drawing because the web PNGs were made by hand and nothing tied them to the
mark. A design system that is a COPY of the code drifts from it the same way and
is worse than none, because it looks authoritative. So every value on every page
below is parsed out of the files the apps actually compile:

  apps/web/src/app/globals.css   the 60-odd CSS variables, light and dark
  shared/categories.json         the eight category colours, both appearances

Re-run it and the pages are current by construction. Nothing here is typed twice.
"""
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
OUT = Path(__file__).parent / "out"
CSS = REPO / "apps/web/src/app/globals.css"
CATEGORIES = REPO / "shared/categories.json"
THEME = REPO / "apps/ios/GastosDiarios/Design/Theme.swift"
WEB_SRC = REPO / "apps/web/src"

sys.path.insert(0, str(REPO / "design-system"))
import usage  # noqa: E402  — the counting lives in the package, not here
import components as comp  # noqa: E402

FONT = ("https://fonts.googleapis.com/css2?"
        "family=Outfit:wght@400;600;700&display=swap")


def token_blocks(css: str) -> tuple[dict[str, str], dict[str, str]]:
    """The light block, and the dark one — with the duplication checked.

    globals.css carries the dark tokens TWICE (a media query for system dark and
    an attribute selector for the manual override) because CSS cannot share a
    block between the two. A comment there asks whoever edits them to keep both
    identical. Parsing both and comparing turns that comment into something that
    actually fails when it stops being true.
    """
    def parse(block: str) -> dict[str, str]:
        return dict(re.findall(r"(--[\w-]+):\s*([^;]+);", block))

    light = parse(css[css.index(":root {"):css.index("/* ── Dark")])
    # The two selectors are :root:not([data-theme="light"]) inside the media
    # query, and :root[data-theme="dark"] at the top level.
    darks = [parse(css[m.end():css.index("}", css.index("--key-shadow", m.end()))])
             for m in re.finditer(r':root(?::not\(\[data-theme="light"\]\)|\[data-theme="dark"\])\s*\{', css)]
    if len(darks) != 2:
        sys.exit(f"expected 2 dark token blocks in globals.css, found {len(darks)}")
    if darks[0] != darks[1]:
        differing = sorted(set(darks[0]) ^ set(darks[1]) |
                           {k for k in set(darks[0]) & set(darks[1]) if darks[0][k] != darks[1][k]})
        sys.exit("the two dark token blocks in globals.css have drifted apart: "
                 + ", ".join(differing))
    # Dark overrides only some tokens; the rest fall through from light.
    return light, {**light, **darks[0]}


def ios_theme() -> dict[str, tuple[str, str]]:
    """The iOS palette, as (light, dark) hex pairs.

    Only the entries WITHOUT an alpha override: those spell a colour outright.
    The ones carrying lightAlpha/darkAlpha are ink-at-N%, a different encoding
    of the same idea, and comparing their hex against a web rgba() would be
    comparing two spellings rather than two colours.
    """
    swift = THEME.read_text()
    return {
        m.group(1): (m.group(2).lower(), m.group(3).lower())
        for m in re.finditer(
            r'static let (\w+) = Color\.hex\(light: "(#[0-9A-Fa-f]{6})", dark: "(#[0-9A-Fa-f]{6})"\)',
            swift)
    }


# Swift name -> CSS token, for the pairs that mean the same thing.
PARITY = {
    "bg": "--bg", "surface": "--surface", "ink": "--ink",
    "inkSecondary": "--ink-secondary", "inkTertiary": "--ink-tertiary",
    "green": "--good", "greenText": "--good-text", "amberText": "--warn-text",
    "avatarBlue": "--member-blue", "avatarPink": "--member-pink",
}


def used(pattern: str, cast=float) -> list[tuple[float, int]]:
    """Every value matching `pattern` in the web source, with how often it is used.

    Read off the code rather than off the spec prose. The two are not the same
    thing — the written spec says cards are radius 20-24, and the radius the
    components reach for most is 18 — and when they disagree it is the code that
    ships. A scale page that quietly restates the doc would hide that.
    """
    counts: dict[float, int] = {}
    for f in list(WEB_SRC.rglob("*.tsx")) + list(WEB_SRC.rglob("*.ts")):
        for m in re.findall(pattern, f.read_text()):
            counts[cast(m)] = counts.get(cast(m), 0) + 1
    return sorted(counts.items(), key=lambda kv: -kv[1])


def type_usage() -> list[tuple[float, dict[int, int]]]:
    """Every text size, and the weights it is used at.

    Size alone is not the step — the Stock team's report made that point and it
    is right: 13px is used at weight 600 far more than at 400, so a system that
    lists "13px / 400" sends the next app to the wrong place. Counted together.
    """
    seen: dict[float, dict[int, int]] = {}
    for f in list(WEB_SRC.rglob("*.tsx")):
        text = f.read_text()
        for m in re.finditer(r'text-\[([0-9.]+)px\]([^"\n]*)', text):
            size, rest = float(m.group(1)), m.group(2)
            weight = (700 if "font-bold" in rest else
                      600 if "font-semibold" in rest else
                      500 if "font-medium" in rest else 400)
            seen.setdefault(size, {}).setdefault(weight, 0)
            seen[size][weight] += 1
    return sorted(seen.items(), key=lambda kv: -sum(kv[1].values()))


def page(title: str, group: str, subtitle: str, body: str, width: int = 900) -> str:
    """One design-system card. The first-line marker is what the pane indexes."""
    return f"""<!-- @dsCard group="{group}" name="{title}" subtitle="{subtitle}" width="{width}" -->
<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{FONT}">
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; padding: 28px; font-family: Outfit, system-ui, sans-serif; }}
  h1 {{ font-size: 22px; font-weight: 700; margin: 0 0 4px; }}
  .lede {{ font-size: 13px; margin: 0 0 22px; opacity: .62; max-width: 62ch; line-height: 1.5; }}
  h2 {{ font-size: 11px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .07em; opacity: .5; margin: 26px 0 10px; }}
  .grid {{ display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }}
  .sw {{ border-radius: 14px; padding: 11px 13px; border: 1px solid rgba(128,128,128,.22); }}
  .chip {{ height: 42px; border-radius: 10px; margin-bottom: 9px; }}
  .name {{ font-size: 12.5px; font-weight: 700; }}
  .val {{ font-size: 11px; font-variant-numeric: tabular-nums; opacity: .58; margin-top: 1px; }}
  .pair {{ display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }}
  .pane {{ border-radius: 18px; padding: 18px; border: 1px solid rgba(128,128,128,.2); }}
  .paneTitle {{ font-size: 11px; font-weight: 700; text-transform: uppercase;
                letter-spacing: .07em; opacity: .55; margin-bottom: 12px; }}
</style></head>
<body>{body}</body></html>
"""


def swatches(tokens: dict[str, str], keys: list[str]) -> str:
    out = []
    for k in keys:
        if k not in tokens:
            continue
        out.append(f'<div class="sw"><div class="chip" style="background:{tokens[k]}"></div>'
                   f'<div class="name">{k}</div><div class="val">{tokens[k]}</div></div>')
    return f'<div class="grid">{"".join(out)}</div>'


def appearance_pane(label: str, tokens: dict[str, str], keys: list[str]) -> str:
    return (f'<div class="pane" style="background:{tokens["--bg"]};color:{tokens["--ink"]}">'
            f'<div class="paneTitle">{label}</div>{swatches(tokens, keys)}</div>')


CORE = ["--bg", "--surface", "--ink", "--ink-secondary", "--ink-tertiary",
        "--accent", "--accent-strong", "--accent-soft", "--fill", "--track",
        "--line-card", "--line-pill", "--line-soft"]
STATES = ["--good", "--good-text", "--good-bg", "--warn", "--warn-text", "--warn-bg",
          "--over", "--over-text", "--over-bg", "--over-track"]
MEMBERS = ["--member-blue", "--member-pink"]


def build() -> dict[str, str]:
    css = CSS.read_text()
    light, dark = token_blocks(css)
    cats = json.loads(CATEGORIES.read_text())["categories"]
    pages: dict[str, str] = {}

    # ── Colours: core, side by side, because every one of these is a PAIR ──
    pages["colors/palette.html"] = page(
        "Paleta", "Colors", "Superficies, tinta y acento · claro y oscuro",
        f'''<h1>Paleta</h1>
<p class="lede">Los dos clientes implementan estos valores exactamente; no se inventan colores.
El acento <strong>conserva su identidad</strong> en ambas apariencias, ajustando luminosidad si el fondo lo exige. El coral no necesita ajuste (5.96:1 sobre el fondo oscuro); un acento más oscuro sí — el verde <code>#2E9E5B</code> de otra app baja a 5.26:1, que pasa AA pero con poco margen. Todos los demás colores del sistema ya se aclaran en oscuro (<code>--good</code> va de #2E9E5B a #40BE74), así que la excepción era el acento, no la regla.</p>
<div class="pair">{appearance_pane("Claro", light, CORE)}{appearance_pane("Oscuro", dark, CORE)}</div>''',
        980)

    # ── Budget states: the one place colour carries meaning, not decoration ──
    pages["colors/budget-states.html"] = page(
        "Estados del presupuesto", "Colors", "Van bien · Queda poco · Se pasaron",
        f'''<h1>Estados del presupuesto</h1>
<p class="lede">Los únicos colores que significan algo en vez de decorar. El umbral de aviso
es gastado ≥ 85 % del presupuesto, y "se pasaron" cuando lo supera — la regla vive en
<code>shared/period-test-vectors.json</code> (<code>budgetState</code>) y la corren las dos
implementaciones.</p>
<div class="pair">{appearance_pane("Claro", light, STATES)}{appearance_pane("Oscuro", dark, STATES)}</div>''',
        980)

    # ── Categories: from the shared contract both apps read ──
    def cat_row(mode: str) -> str:
        alpha = "14%" if mode == "light" else "16%"
        bg = light["--bg"] if mode == "light" else dark["--bg"]
        ink = light["--ink"] if mode == "light" else dark["--ink"]
        cells = []
        for c in cats:
            colour = c["color"][mode]
            cells.append(
                f'<div style="text-align:center">'
                f'<div style="width:50px;height:50px;border-radius:999px;margin:0 auto 7px;'
                f'background:color-mix(in srgb,{colour} {alpha},transparent);'
                f'display:flex;align-items:center;justify-content:center">'
                f'<div style="width:19px;height:19px;border-radius:5px;background:{colour}"></div></div>'
                f'<div style="font-size:11.5px;font-weight:600">{c["id"]}</div>'
                f'<div style="font-size:10px;opacity:.55;font-variant-numeric:tabular-nums">{colour}</div>'
                f'</div>')
        return (f'<div class="pane" style="background:{bg};color:{ink}">'
                f'<div class="paneTitle">{"Claro" if mode == "light" else "Oscuro"} · círculo al {alpha}</div>'
                f'<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">'
                f'{"".join(cells)}</div></div>')

    pages["colors/categories.html"] = page(
        "Categorías", "Colors", f"{len(cats)} categorías semilla · claro y oscuro",
        f'''<h1>Categorías</h1>
<p class="lede">Las {len(cats)} categorías semilla, desde <code>shared/categories.json</code> — el mismo
archivo que leen iOS y la web, con el ícono de Material para web y su equivalente SF Symbols
para iOS. El círculo lleva el color de la categoría al 14 % (claro) / 16 % (oscuro) y el ícono
al 100 %.</p>
<div style="display:grid;gap:18px">{cat_row("light")}{cat_row("dark")}</div>''',
        980)

    # ── Members ──
    pages["colors/members.html"] = page(
        "Personas", "Colors", "Los dos avatares del hogar",
        f'''<h1>Personas</h1>
<p class="lede">Un hogar son exactamente dos personas y cada gasto muestra quién lo cargó,
así que estos dos colores sólo tienen que distinguirse entre sí.</p>
<div class="pair">{appearance_pane("Claro", light, MEMBERS)}{appearance_pane("Oscuro", dark, MEMBERS)}</div>''',
        760)

    # ── Type: both clients, because the step is not the same on each ──
    web_t, ios_t = usage.type_steps(), usage.ios_type_steps()
    ios_by_size = {sz: ws for sz, ws in ios_t}
    web_by_size = {sz: ws for sz, ws in web_t}
    tot = lambda ws: sum(ws.values())
    sizes = sorted(set(web_by_size) | set(ios_by_size),
                   key=lambda z: -(tot(web_by_size.get(z, {})) + tot(ios_by_size.get(z, {}))))

    def cell(ws):
        if not ws:
            return f'<span style="color:{light["--ink-tertiary"]};opacity:.5">—</span>'
        top = max(ws, key=ws.get)
        return (f'<strong>{top}</strong> ×{ws[top]}'
                + (f' <span style="opacity:.5">+{tot(ws) - ws[top]}</span>' if tot(ws) > ws[top] else ""))

    rows = "".join(
        f'<tr><td style="padding:7px 10px;font-variant-numeric:tabular-nums">{sz:g}px</td>'
        f'<td style="padding:7px 10px">{cell(web_by_size.get(sz))}</td>'
        f'<td style="padding:7px 10px">{cell(ios_by_size.get(sz))}</td>'
        f'<td style="padding:7px 10px;font-size:{min(sz, 24)}px;'
        f'font-weight:{max(web_by_size.get(sz) or ios_by_size.get(sz), key=(web_by_size.get(sz) or ios_by_size.get(sz)).get)}">'
        f'Gastos de la semana</td></tr>'
        for sz in sizes[:12])

    pages["type/scale.html"] = page(
        "Tipografía", "Type", f"web e iOS · {len(sizes)} peldaños contados con su peso",
        f'''<h1>Tipografía</h1>
<p class="lede">Outfit en los dos clientes. Los importes SIEMPRE llevan cifras tabulares
(<code>tabular-nums</code> / <code>.monospacedDigit()</code>).</p>
<p class="lede">Cada peldaño se cuenta con su <strong>peso</strong>, porque el par es el
peldaño, y por <strong>plataforma</strong>, porque no son el mismo. La fila mide
<strong>14 en web</strong> y <strong>14.5 en iOS</strong>; el título ya era 22 y 18. Eso no es
un defecto —un teléfono a distancia de brazo no es una ventana de navegador— pero un sistema
que afirmara un solo número sería falso en una de las dos.</p>
<table style="border-collapse:collapse;width:100%;font-size:12.5px">
<thead><tr style="text-align:left;opacity:.55;font-size:11px;text-transform:uppercase;letter-spacing:.06em">
<th style="padding:7px 10px">Tamaño</th><th style="padding:7px 10px">web</th>
<th style="padding:7px 10px">iOS</th><th style="padding:7px 10px">Muestra</th></tr></thead>
<tbody>{rows}</tbody></table>
<p class="lede" style="margin-top:16px">El conteo normaliza las utilidades nombradas de
Tailwind antes de agrupar (<code>text-sm</code> → 14, <code>text-xs</code> → 12,
<code>text-base</code> → 16). Sin eso quedaban 66 usos invisibles y el sistema documentaba
14.5 (5 usos en web) mientras omitía 14 (25).</p>''', 900)

    # ── Spacing: absent from the system until the Stock report asked for it ──
    pads = usage.padding_x()
    gaps = usage.gaps()
    def bars(items, colour):
        return "".join(
            f'<div style="display:flex;align-items:center;gap:10px;padding:4px 0">'
            f'<div style="width:46px;font-size:11.5px;font-variant-numeric:tabular-nums;'
            f'color:{light["--ink-tertiary"]}">{v:g}px</div>'
            f'<div style="height:13px;width:{v * 4}px;border-radius:3px;background:{colour}"></div>'
            f'<div style="font-size:11px;color:{light["--ink-tertiary"]}">×{n}</div></div>'
            for v, n in items[:7])
    pages["foundations/spacing.html"] = page(
        "Espaciado", "Foundations", "Padding y separaciones que el código realmente usa",
        f'''<h1>Espaciado</h1>
<p class="lede">El sistema no decía nada de espaciado hasta que la segunda app lo pidió — y
sin esto, dos apps con los mismos colores igual se ven distintas. El padding horizontal de
card es 18 y el de pantalla 20; ninguno de los dos estaba escrito en ningún lado.</p>
<div class="pane" style="background:{light["--bg"]};color:{light["--ink"]}">
  <h2 style="margin-top:0">Padding horizontal</h2>{bars(pads, light["--accent"])}
  <h2>Separación entre elementos</h2>{bars(gaps, light["--ink-tertiary"])}
</div>''', 620)

    # ── Shape: the radii the components actually reach for ──
    radii = usage.radii()
    chips = "".join(
        f'<div style="text-align:center"><div style="width:74px;height:56px;border-radius:{r}px;'
        f'background:{light["--surface"]};border:1px solid {light["--line-card"]}"></div>'
        f'<div class="val">{r:g}px · ×{n}</div></div>'
        for r, n in radii[:8])
    full_n = usage.full_radius_uses()
    pages["foundations/shape.html"] = page(
        "Forma y elevación", "Foundations", f"{len(radii)} radios explícitos + rounded-full",
        f'''<h1>Forma y elevación</h1>
<p class="lede">Las tarjetas no llevan sombra: se separan del fondo por un borde de 1px. La
única sombra fuerte del sistema es la del CTA primario, y es de color — coral al 35 %, no
negro.</p>
<p class="lede">Los radios salen de contar el código, no de la especificación, y ahí aparece
una diferencia que vale la pena saber: el documento dice que las tarjetas van entre 20 y 24,
y el radio que más usan los componentes es 18. Cuando los dos no coinciden, el que se
publica es el código.</p>
<h2>Radios en uso</h2>
<div style="display:flex;gap:14px;flex-wrap:wrap;background:{light["--bg"]};padding:20px;border-radius:18px">
  {chips}
  <div style="text-align:center"><div style="width:74px;height:56px;border-radius:999px;
       background:{light["--surface"]};border:1px solid {light["--line-card"]}"></div>
       <div class="val">full · ×{full_n}</div></div>
</div>
<h2>Elevación</h2>
<div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-end;background:{light["--bg"]};padding:22px;border-radius:18px">
  <div><div style="height:56px;padding:0 26px;border-radius:999px;background:{light["--accent"]};color:#fff;display:flex;align-items:center;font-weight:700;font-size:15px;box-shadow:0 8px 20px rgba(255,92,57,.35)">Guardar gasto</div>
       <div class="val">CTA primario · única sombra fuerte · coral 35 %</div></div>
  <div><div style="width:64px;height:52px;border-radius:14px;background:{light["--surface"]};box-shadow:0 1px 2px rgba(36,26,16,.06);display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:600;color:{light["--ink"]}">7</div>
       <div class="val">Tecla · sombra apenas perceptible</div></div>
</div>''', 900)

    # ── Parity: the two clients, per token, divergence made loud ──
    ios = ios_theme()
    rows, diverged = [], 0
    for sw, css in PARITY.items():
        if sw not in ios or css not in light:
            continue
        il, idk = ios[sw]
        wl, wd = light[css].strip().lower(), dark[css].strip().lower()
        same = (il, idk) == (wl, wd)
        diverged += 0 if same else 1
        mark = ("<span style=\'color:#2e9e5b;font-weight:700\'>=</span>" if same
                else "<span style=\'color:#e5484d;font-weight:700\'>≠</span>")
        def cell(hexv):
            return (f'<span style="display:inline-flex;align-items:center;gap:6px">'
                    f'<span style="width:15px;height:15px;border-radius:4px;background:{hexv};'
                    f'border:1px solid rgba(128,128,128,.3)"></span>'
                    f'<code style="font-size:11.5px">{hexv}</code></span>')
        bg = "" if same else ' style="background:rgba(229,72,77,.07)"'
        rows.append(
            f'<tr{bg}><td style="padding:8px 10px"><code>{css}</code></td>'
            f'<td style="padding:8px 10px">{cell(wl)}</td><td style="padding:8px 10px">{cell(il)}</td>'
            f'<td style="padding:8px 10px">{cell(wd)}</td><td style="padding:8px 10px">{cell(idk)}</td>'
            f'<td style="padding:8px 10px;text-align:center">{mark}</td></tr>')

    verdict = ("Los dos clientes coinciden en todos." if not diverged
               else f"<strong>{diverged} de {len(rows)} divergen</strong> — la fila marcada es un bug, no una decisión.")
    pages["foundations/parity.html"] = page(
        "Paridad entre clientes", "Foundations",
        f"web vs iOS · {len(rows)} tokens comparados",
        f'''<h1>Paridad entre clientes</h1>
<p class="lede">Los mismos tokens leídos de las DOS implementaciones —
<code>globals.css</code> para la web y <code>Theme.swift</code> para iOS— y comparados.
Esta página existe porque un design system que lee una sola plataforma esconde
exactamente el tipo de divergencia que debería mostrar. {verdict}</p>
<table style="border-collapse:collapse;width:100%;font-size:12.5px">
<thead><tr style="text-align:left;opacity:.55;font-size:11px;text-transform:uppercase;letter-spacing:.06em">
<th style="padding:8px 10px">Token</th><th style="padding:8px 10px">web claro</th>
<th style="padding:8px 10px">iOS claro</th><th style="padding:8px 10px">web oscuro</th>
<th style="padding:8px 10px">iOS oscuro</th><th style="padding:8px 10px"></th></tr></thead>
<tbody>{"".join(rows)}</tbody></table>
<p class="lede" style="margin-top:18px">Las 8 categorías no aparecen acá: las dos apps las
leen del mismo <code>shared/categories.json</code>, así que no pueden divergir por
construcción.</p>''', 900)

    # ── Components ──────────────────────────────────────────────────────
    # The one layer that is NOT generated end to end. Anatomy measured, rules
    # written — every page below says which is which, because a spec can go
    # stale in a way the tokens no longer can.
    ana = comp.anatomy()
    DISCLAIMER = (
        '<p class="lede" style="border-left:3px solid ' + light["--accent"] + ';padding-left:12px">'
        '<strong>Anatomía medida, reglas escritas.</strong> Los números de abajo son la '
        'combinación que los componentes más repiten en el código, no una elección hecha '
        'al redactar esto. Las reglas, en cambio, son criterio leído del código: ninguna '
        'herramienta las deriva. Si un spec y el código no coinciden, <em>el spec es el '
        'bug</em>.</p>')

    def spec(title, group, subtitle, intro, demo, classes, uses, rules, width=760):
        rule_items = "".join(f"<li style=\"margin-bottom:7px\">{r}</li>" for r in rules)
        return page(title, group, subtitle, f'''<h1>{title}</h1>
<p class="lede">{intro}</p>
{DISCLAIMER}
<h2>Ejemplo</h2>
<div style="background:{light["--bg"]};padding:24px;border-radius:18px">{demo}</div>
<h2>Anatomía medida · {uses} usos</h2>
<pre style="background:{light["--fill"]};padding:12px 14px;border-radius:12px;font-size:11.5px;
     overflow-x:auto;margin:0"><code>{classes}</code></pre>
<h2>Reglas</h2>
<ul style="font-size:12.5px;line-height:1.55;padding-left:20px;margin:0">{rule_items}</ul>''', width)

    card_cls, card_n = ana["card"]
    pages["components/card.html"] = spec(
        "Card", "Components", "El contenedor de todo",
        "Todo en las dos apps vive dentro de una card. No llevan sombra: se separan del fondo "
        "por un borde de 1px, que es lo que deja el fondo cálido a la vista en vez de taparlo.",
        f'''<div style="border-radius:18px;border:1px solid {light["--line-card"]};
             background:{light["--surface"]};padding:16px 18px">
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;
       color:{light["--ink-tertiary"]};margin-bottom:10px">Presupuesto</div>
  <div style="font-size:34px;font-weight:700;font-variant-numeric:tabular-nums;
       color:{light["--ink"]}">$ 823,60</div>
  <div style="border-top:1px solid {light["--line-soft"]};margin-top:14px;padding-top:12px;
       font-size:11.5px;color:{light["--ink-tertiary"]}">Quedan 4 días</div>
</div>''',
        card_cls, card_n,
        ["Radio <strong>18px</strong>. El documento viejo decía 20–24; el código dice 18 y el código es el que se publica.",
         "Padding <strong>18px horizontal, 16px vertical</strong> (<code>px-[18px] py-4</code>).",
         "Borde de 1px en <code>--line-card</code>. <strong>Nunca sombra</strong> — la única sombra del sistema es la del CTA primario.",
         "La variante ancha de dashboard usa radio 22 y <code>px-5 py-5 lg:px-6</code>. Es la excepción, no una segunda card.",
         "El encabezado es <code>.section-label</code>: 11px/700, mayúsculas, +0.07em, tinta terciaria. Vive como clase en <code>globals.css</code>, no como utilidad.",
         "El pie va separado por <code>border-t border-soft</code>, nunca por un margen.",
         "En iOS es <code>Card { }</code> con el mismo radio y padding — ver <code>Design/Card.swift</code>."])

    rows, divs = comp.row_padding(), comp.dividers()
    # NOT presented as "the row padding". A bare `py-*` count cannot be
    # attributed to rows: of the 63 uses of py-2 in this app, 19 sit on pills
    # and buttons. The rule is what transfers; the count is evidence for it and
    # is labelled as the class frequency it actually is.
    pill_py2 = comp.pill_padding_share()
    pages["components/row.html"] = spec(
        "Fila de lista", "Components",
        "El padding sigue a la altura del contenido",
        "Una fila es la unidad de todo listado: un gasto, un servicio, un cargo del banco. "
        "Lo que la define no es su contenido sino dos cosas que se copian mal — cuándo lleva "
        "divisor, y de qué depende su padding.",
        f'''<div style="border-radius:18px;border:1px solid {light["--line-card"]};
             background:{light["--surface"]};padding:6px 18px">
  {"".join(f'''<div style="display:flex;align-items:center;gap:11px;padding:8px 0;
      {"border-top:1px solid " + light["--line-soft"] if i else ""}">
    <div style="width:34px;height:34px;border-radius:999px;
         background:color-mix(in srgb,{light["--cat-groceries"]} 14%,transparent);flex:none"></div>
    <div style="flex:1"><div style="font-size:14px;font-weight:600;color:{light["--ink"]}">{n}</div>
      <div style="font-size:11.5px;color:{light["--ink-tertiary"]}">Súper</div></div>
    <div style="font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;
         color:{light["--ink"]}">$ {v}</div></div>'''
    for i, (n, v) in enumerate([("Coles", "63,90"), ("Café", "12,50")]))}
</div>''',
        "  ·  ".join(f"{c} ({n})" for c, n in rows[:4])
        + f"\n\n  Ojo: es la frecuencia de la CLASE, no un censo de filas. De los {pill_py2[1]}"
          f" usos de py-2, {pill_py2[0]} están en pills y botones.",
        rows[0][1],
        ["<strong>El padding sigue a la altura del contenido, no a una constante.</strong> "
         "8px para una fila de texto + importe; <strong>12px cuando hay avatar, control o dos "
         "líneas</strong>. Una fila con un badge de 36px y un stepper apretada a 8 hace que el "
         "badge toque los divisores.",
         "Corroborado por una segunda app: en Stock, las filas de texto + valor usan 10–12px y "
         "las que llevan control usan 12 fijo. <strong>Ninguna baja de 10.</strong> Que acá el "
         "número frecuente sea 8 dice más sobre esta app —cuyas filas son casi todas texto + "
         "importe— que sobre el sistema.",
         f"<strong>Divisor entre filas de una misma lista</strong>: <code>{divs[1][0]}</code> en "
         f"el contenedor ({divs[1][1]} usos). Nunca entre la última fila y el borde.",
         f"<strong>Divisor para separar secciones dentro de una card</strong>: "
         f"<code>{divs[0][0]}</code> ({divs[0][1]} usos). Es un rol distinto, no el mismo divisor.",
         "El divisor es <code>--line-soft</code> (6 %), más tenue que el borde de la card (8 %): "
         "separa sin competir con el contorno.",
         "El importe va a la derecha, 700, con cifras tabulares. Siempre.",
         "La fila mide <strong>14px en web y 14.5 en iOS</strong> — ver Tipografía."])

    prim_cls, prim_n = ana["primary"]
    sec_cls, sec_n = ana["secondary"]
    pages["components/button.html"] = spec(
        "Botones", "Components", "Primario, secundario y la única sombra del sistema",
        "Hay exactamente dos pesos de botón, y la diferencia entre ellos es la que le dice a "
        "alguien qué acción es la que se espera que haga.",
        f'''<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
  <div style="height:56px;padding:0 26px;border-radius:999px;background:{light["--accent"]};
       color:#fff;display:flex;align-items:center;font-weight:700;font-size:15px;
       box-shadow:0 8px 20px rgba(255,92,57,.35)">Guardar gasto</div>
  <div style="border-radius:999px;background:{light["--accent"]};color:#fff;padding:7px 16px;
       font-size:13px;font-weight:700">Asignar</div>
  <div style="border-radius:999px;border:1px solid {light["--line-pill"]};
       background:{light["--surface"]};color:{light["--ink"]};padding:8px 16px;
       font-size:13px;font-weight:700">Cerrar y abrir</div>
  <div style="color:{light["--ink-secondary"]};font-size:12.5px;font-weight:600">Descartar</div>
</div>''',
        f"primario   {prim_cls}\nsecundario {sec_cls}", prim_n + sec_n,
        ["<strong>CTA de pantalla</strong>: 54–58px de alto, radio completo, <code>bg-accent</code>, texto blanco 700, y la sombra <code>0 8px 20px rgba(255,92,57,.35)</code> — de color, no negra. Es la única sombra fuerte del sistema.",
         f"<strong>Primario en línea</strong> (dentro de una card): <code>px-4 py-[7px] text-[13px]</code>, sin sombra. {prim_n} usos.",
         f"<strong>Secundario</strong>: <code>border border-pill bg-surface</code>, misma altura, texto <code>--ink</code>. {sec_n} usos.",
         "<strong>Terciario</strong>: texto pelado en <code>--ink-2</code>, sin borde ni fondo. Para lo que se puede ignorar (Descartar, Cancelar).",
         "Deshabilitado es <code>disabled:opacity-40</code> — nunca un color distinto.",
         "Una acción importante pero infrecuente va <strong>secundaria</strong>, no primaria: la prominencia sigue a la frecuencia. Cerrar un resumen se hace una vez por mes y es secundaria."])

    field_cls, field_n = ana["field"]
    pages["components/field.html"] = spec(
        "Campos", "Components", "Y el piso de 16px que no es estético",
        "Un campo se distingue de la card que lo contiene por el fondo, no por la sombra: "
        "va en <code>--bg</code> sobre <code>--surface</code>, o sea hundido.",
        f'''<div style="display:flex;flex-direction:column;gap:12px;max-width:320px">
  <div style="border-radius:12px;border:1px solid {light["--line-card"]};background:{light["--bg"]};
       padding:10px 12px;font-size:14px;color:{light["--ink-tertiary"]}">Nota (opcional)</div>
  <div style="border-radius:12px;border:1px solid {light["--accent"]};background:{light["--bg"]};
       padding:10px 12px;font-size:14px;color:{light["--ink"]}">Coles<span style="opacity:.5">|</span></div>
</div>''',
        field_cls, field_n,
        ["Radio <strong>12px</strong> (<code>rounded-xl</code>), fondo <code>--bg</code>, borde <code>--line-card</code>.",
         "Al foco cambia <strong>el borde a <code>--accent</code></strong> y nada más: sin <code>outline</code>, sin sombra, sin cambiar el fondo.",
         "<strong>Piso de 16px en el tamaño de fuente cuando el puntero es grueso.</strong> No es una decisión estética: Safari en iOS hace zoom sobre cualquier campo enfocado con menos de 16px, y el zoom no se revierte. Vive sin capa en <code>globals.css</code>, a propósito.",
         "El importe usa su propio componente (<code>amount-input</code>) con cifras tabulares y un <code>$</code> apagado — no es un campo de texto con otro tamaño.",
         "Los mensajes de error van debajo, 11.5px/600, en <code>--over</code>. Nunca dentro del campo."])

    rf = comp.rounded_full_breakdown()
    rf_total = sum(rf.values())
    pages["components/pill.html"] = spec(
        "Chips y pills", "Components",
        "Radio completo; un chip con radio numérico es un bug",
        "La geometría más repetida del sistema, y por eso la más fácil de contar mal. Un chip "
        "informa, un pill navega o filtra, y los dos son la misma forma: radio completo con "
        "padding horizontal generoso.",
        f'''<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
  <div style="border-radius:999px;background:{light["--good-bg"]};color:{light["--good-text"]};
       padding:5px 11px;font-size:12px;font-weight:600">Van bien</div>
  <div style="border-radius:999px;background:{light["--warn-bg"]};color:{light["--warn-text"]};
       padding:5px 11px;font-size:12px;font-weight:600">Queda poco</div>
  <div style="border-radius:999px;background:{light["--over-bg"]};color:{light["--over-text"]};
       padding:5px 11px;font-size:12px;font-weight:600">Se pasaron</div>
  <div style="border-radius:999px;border:1px solid {light["--line-pill"]};
       background:{light["--surface"]};color:{light["--ink"]};padding:6px 14px;
       font-size:12.5px;font-weight:700">‹ 14 – 20 ago ›</div>
  <div style="border-radius:999px;background:{light["--accent-soft"]};color:{light["--accent-strong"]};
       padding:5px 11px;font-size:11.5px;font-weight:700">Ajustado</div>
</div>''',
        f"rounded-full + px-2.5…px-4 + py-1…py-2\n\n"
        f"  De los {rf_total} usos de rounded-full en la app, sólo {rf['chip']} son chips:\n"
        f"    {rf['chip']:>3}  chip / pill\n"
        f"    {rf['primary']:>3}  botón primario  ← tiene su propio spec\n"
        f"    {rf['circle']:>3}  círculo, avatar o punto\n"
        f"    {rf['wide-button']:>3}  botón ancho\n"
        f"    {rf['bar']:>3}  barra",
        rf["chip"],
        ["Radio siempre <strong>completo</strong>. Un chip con radio numérico es un bug.",
         "<strong>Chip de estado</strong>: fondo <code>--*-bg</code> (color al 12–16 %), texto "
         "<code>--*-text</code>. El par siempre junto: el fondo tenue nunca lleva el color pleno "
         "como texto.",
         "<strong>Pill de navegación</strong>: <code>border-pill</code> sobre <code>--surface</code>, texto 700.",
         "<strong>Badge de acento</strong>: <code>accent-soft</code> de fondo con "
         "<code>accent-strong</code> de texto — nunca <code>accent</code> pleno, que no contrasta "
         "sobre su propio tinte.",
         "Padding horizontal entre 10 y 16px según el peso del chip; vertical entre 4 y 8.",
         "Un chip no se toca salvo que navegue. Si tiene acción, es un botón secundario.",
         f"<strong>Sobre el conteo:</strong> <code>rounded-full</code> no discrimina — lo comparten "
         f"chips, botones, avatares y barras. Los {rf['primary']} usos que son el botón primario "
         f"están contados en <em>su</em> spec, no acá. Sumar los dos números daría el doble de lo "
         f"que hay."])

    return pages


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for path, html in build().items():
        target = OUT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(html)
        print(f"  {path}")


if __name__ == "__main__":
    main()
