# Design system → Claude Design

The foundations of the design system, generated from the code that implements
them, and pushed to the Claude Design **design-system** project
`9037cd2c-5526-4712-aa81-8baceb574abe`
(<https://claude.ai/design/p/9037cd2c-5526-4712-aa81-8baceb574abe>).

```sh
python3 docs/design/design-system/build.py    # writes ./out/, gitignored
```

Then upload `out/` with the `DesignSync` tool (`finalize_plan` → `write_files`).

## Why it is generated

Because a design system that is a *copy* of the code drifts from it, and drifts
silently — it keeps looking authoritative while it goes stale. This project has
already been bitten by exactly that: the web's PWA icons sat three weeks with a
snout the mark no longer had, because they were made by hand and nothing tied
them to it.

So no value on any page is typed twice. Everything is parsed from:

| Source | What comes from it |
|---|---|
| `apps/web/src/app/globals.css` | every colour token, light and dark |
| `shared/categories.json` | the eight category colours, both appearances |

Re-run the script and the pages are current by construction.

## A check that comes free

`globals.css` carries the dark tokens **twice** — once in a `prefers-color-scheme`
media query and once under `:root[data-theme="dark"]` — because CSS cannot share
a block between them. A comment there asks whoever edits them to keep both
identical.

The parser reads both and compares them, so the script now **fails and names the
token** when they drift. That comment used to be the only thing holding the two
in sync.

## What is NOT here

Components. These are foundations only — colour, type, shape. The web's
components are React + Tailwind, and turning each into a standalone HTML preview
is a port, not an export; it would be hand-maintained and so free to drift, which
is the thing this file exists to avoid. Worth doing only if the pane earns it.
