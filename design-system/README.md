# Design tokens

`tokens.json` is the source of truth for every colour both apps use. The web's
CSS custom properties and the iOS `Theme` are supposed to say exactly what it
says, and `emit.py --verify` is what proves they do — it runs in CI.

```sh
python3 design-system/emit.py --verify   # CI: do both platforms match the tokens?
python3 design-system/emit.py            # print what each platform should say
python3 design-system/extract.py         # one-time bootstrap, already run
```

## Why this exists

The same 23 hex values were written twice, by hand, in two languages. Twice they
were written *differently*:

- `--warn-text` never got a dark override on the web, so "Queda poco" rendered
  the light-mode amber on a dark card — 4.42:1, under the 4.5:1 WCAG AA wants
  for body text. iOS had brightened it long ago.
- `--track` in dark was 0.08 on the web and 0.09 on iOS.

Neither was caught by a test, a type checker or a review. They were caught by
asking whether the design system matched the code, which is the question this
directory exists to keep answering.

## The state it is in

`emit.py --verify` currently emits **50 of 50** declarations character for
character as they appear in `globals.css` and `Theme.swift`. That is what makes
this layer a faithful mirror rather than a claim: it provably contains
everything those two files say about colour.

Which means the switch — making the two files *generated* rather than
hand-written — is now a mechanical step rather than a migration. Nothing about
the apps changes; the same characters simply arrive from one place instead of
two. It has not been taken yet, on purpose: the mirror should earn a little
mileage first.

## Shape

Kept package-shaped and self-contained — no imports from `apps/` — so extracting
it into its own repo is a `git mv` plus a `package.json` on the day a second app
needs to consume it *in code*. Until then the design layer is already shared
through the Claude Design project, which is how the Stock app consumed it.

Format is DTCG-flavoured (`$value` / `$type` / `$description`), with two local
conventions:

- `$value` is `{light, dark}` rather than a single value, because in this system
  a colour is a pair. A token whose two halves are equal is the exception.
- A colour spelled as opacity over another gets `{base, alpha}`, which is how
  iOS holds it. Storing the flattened `rgba()` would have thrown away the fact
  that `--line-card` and `--fill` are the same ink at different strengths.
