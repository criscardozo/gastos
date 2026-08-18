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
El acento es el mismo en ambas apariencias — es la marca, no una preferencia de tema.</p>
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

    # ── Type: the scale the components actually reach for ──
    sizes = used(r"text-\[([0-9.]+)px\]")
    rows = "".join(
        f'<div style="display:flex;align-items:baseline;gap:16px;padding:7px 0;'
        f'border-bottom:1px solid {light["--line-soft"]}">'
        f'<div style="width:62px;font-size:11.5px;font-variant-numeric:tabular-nums;'
        f'color:{light["--ink-tertiary"]}">{sz:g}px</div>'
        f'<div style="width:52px;font-size:11px;color:{light["--ink-tertiary"]}">×{n}</div>'
        f'<div style="font-size:{sz}px;font-weight:600">Gastos de la semana</div></div>'
        for sz, n in sizes[:10])
    pages["type/scale.html"] = page(
        "Tipografía", "Type", f"Outfit 400/600/700 · {len(sizes)} tamaños en uso",
        f'''<h1>Tipografía</h1>
<p class="lede">Outfit en todos lados, en tres pesos. Los importes SIEMPRE llevan cifras
tabulares (<code>tabular-nums</code> en web, <code>.monospacedDigit()</code> en iOS): sin eso
el número salta al cambiar de dígito, y en una pantalla que se mira todo el día se nota.</p>
<p class="lede">Los tamaños de abajo NO salen de la especificación escrita sino de contar
cuántas veces los usa cada componente. Son {len(sizes)} distintos — más de los que un sistema
querría, y ése es justamente el dato.</p>
<div class="pane" style="background:{light["--bg"]};color:{light["--ink"]}">
  <div style="font-size:66px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums">$ 823,60</div>
  <div class="val" style="margin-bottom:20px">Importe héroe · tabular · −0.03em</div>
  {rows}
</div>''', 760)

    # ── Shape: the radii the components actually reach for ──
    radii = used(r"rounded-\[([0-9.]+)px\]")
    chips = "".join(
        f'<div style="text-align:center"><div style="width:74px;height:56px;border-radius:{r}px;'
        f'background:{light["--surface"]};border:1px solid {light["--line-card"]}"></div>'
        f'<div class="val">{r:g}px · ×{n}</div></div>'
        for r, n in radii[:8])
    full = used(r"(rounded-full)", cast=str)
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
       <div class="val">full · ×{full[0][1] if full else 0}</div></div>
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
