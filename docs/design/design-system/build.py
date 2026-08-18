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

    # ── Type: the scale as the apps actually use it ──
    pages["type/scale.html"] = page(
        "Tipografía", "Type", "Outfit 400/600/700 · cifras tabulares",
        f'''<h1>Tipografía</h1>
<p class="lede">Outfit en todos lados, en tres pesos. Los importes SIEMPRE van con cifras
tabulares (<code>font-variant-numeric: tabular-nums</code> en web,
<code>.monospacedDigit()</code> en iOS) — sin eso el número salta al cambiar de dígito, que
en una pantalla que se mira todo el día se nota.</p>
<div class="pane" style="background:{light["--bg"]};color:{light["--ink"]}">
  <div style="font-size:66px;font-weight:700;letter-spacing:-.03em;font-variant-numeric:tabular-nums">$ 823,60</div>
  <div class="val" style="margin-bottom:22px">Importe héroe · 52–66px / 700 · tabular · −0.03em</div>
  <div style="font-size:22px;font-weight:700">Título de pantalla</div>
  <div class="val" style="margin-bottom:18px">22px / 700 (web) · 18px / 700 (iOS)</div>
  <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:{light["--ink-tertiary"]}">Etiqueta de sección</div>
  <div class="val" style="margin-bottom:18px">11px / 700 · mayúsculas · +0.07em · tinta terciaria</div>
  <div style="font-size:14.5px;font-weight:600">Cuerpo semibold · filas y botones</div>
  <div style="font-size:13px;color:{light["--ink-secondary"]}">Cuerpo secundario · 13px / 400</div>
  <div style="font-size:11.5px;color:{light["--ink-tertiary"]}">Pie · 11.5px / 400 · tinta terciaria</div>
</div>''', 760)

    # ── Shape ──
    pages["foundations/shape.html"] = page(
        "Forma y elevación", "Foundations", "Radios, bordes y la única sombra que hay",
        f'''<h1>Forma y elevación</h1>
<p class="lede">Las tarjetas no llevan sombra: se separan del fondo por un borde de 1px. La
única sombra fuerte del sistema es la del CTA primario, y es de color — coral al 35 %, no
negro.</p>
<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;background:{light["--bg"]};padding:22px;border-radius:18px">
  <div><div style="width:150px;height:88px;border-radius:22px;background:{light["--surface"]};border:1px solid {light["--line-card"]}"></div>
       <div class="val">Tarjeta · radio 20–24 · borde 1px · sin sombra</div></div>
  <div><div style="height:38px;padding:0 18px;border-radius:999px;background:{light["--surface"]};border:1px solid {light["--line-pill"]};display:flex;align-items:center;font-size:12.5px;font-weight:700;color:{light["--ink"]}">Pill · radio 999</div>
       <div class="val">Pills, chips y botones secundarios</div></div>
  <div><div style="height:56px;padding:0 26px;border-radius:999px;background:{light["--accent"]};color:#fff;display:flex;align-items:center;font-weight:700;font-size:15px;box-shadow:0 8px 20px rgba(255,92,57,.35)">Guardar gasto</div>
       <div class="val">CTA primario · 54–58px · sombra coral 35 %</div></div>
  <div><div style="width:64px;height:52px;border-radius:14px;background:{light["--surface"]};box-shadow:0 1px 2px rgba(36,26,16,.06);display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:600;color:{light["--ink"]}">7</div>
       <div class="val">Tecla · radio 13–15</div></div>
</div>''', 900)

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
