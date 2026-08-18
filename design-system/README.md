# Design tokens

`tokens.json` is the source of truth. The web's CSS custom properties and the
iOS `Theme` are **generated from it**, so the two cannot say different things.

```sh
python3 emit.py --write     # rewrite both platforms from tokens.json
python3 emit.py --verify    # anatomy checks (attributable, representative)
```

CI regenerates and fails if anything changed, which is stronger than comparing
text: it proves the files can be rebuilt, not merely that they currently match.

## Why

The same 23 hex values were written twice, by hand, in two languages. Twice they
were written *differently*, and neither was caught by a test, a type checker or
a review:

- `--warn-text` never got a dark override on the web, so "Queda poco" rendered
  the light amber on a dark card — 4.42:1, under the 4.5:1 AA wants for body
  text. iOS had brightened it long ago.
- `--track` in dark was 0.08 on the web and 0.09 on iOS.

Now a token exists once. Change `--bg`'s dark value and one command rewrites the
Swift *and both* CSS dark blocks — the file carries them twice because CSS
cannot share a block between a media query and an attribute selector, and
keeping those two in step used to be a comment asking nicely.

## What is generated, and what is not

Only the token VALUES. Comments, ordering, the category palette, `--visa`,
`--key-shadow` and everything else in those files is hand-written and left
exactly where its author put it — the rewrite is line-level, not block-level.

## Extracting this into its own repo

`tokens.json` is portable today: 7.4 KB of data, no dependencies, nothing
imported from `apps/`. Any app can read it.

The TOOLING is not, and saying otherwise would be wrong: `emit.py`, `usage.py`,
`components.py` and `extract.py` all carry Gastos' own paths, because their job
is to write into Gastos' files and to measure Gastos' components. So the split
is not one `git mv`:

- `tokens.json` moves out, plus a generic emitter that takes its targets as
  configuration instead of constants.
- The measuring scripts stay with the app they measure, or grow a config too.

One design note for that emitter, from the Stock team hitting it first: it needs
each platform's NAME per token, not a naming convention. Measured here, 8 of the
15 mapped tokens are not derivable from the CSS name by any rule —
`--line-card` is `border`, `--good` is `green`, `--member-blue` is `avatarBlue`.
The two platforms did not spell the same role differently, they *named* it
differently. Which is why `$extensions."gastos.swift"` stores the exact
identifier rather than deriving it: a kebab-to-camel emitter would have been
wrong on more than half of them.

The Stock app measured the same thing and found 3 of 16 — `--ink-secondary` is
`ink2`, and no rule takes "secondary" to "2". Their read of why is better than
"this repo grew untidily": Stock is newer, written by one person in one pass,
and it has them anyway. The platforms name differently because they are read
differently. `ink2` is short because a view writes it fifty times; and
`--ink-secondary` is explicit because a token file is read, not typed.

Note which of the two numbers is the more dangerous. A convention failing 8 of
15 announces itself on the first build. One failing 3 of 16 looks like it works
until the fourth token.

Worth doing when a second app needs to generate its theme from the file. Until
then the design layer is already shared through the Claude Design project,
which is how the Stock app consumed it — and consumed it well enough to send
back five defects in this system's own pages.

## Format

DTCG-flavoured (`$value` / `$type` / `$description`), with two local
conventions:

- `$value` is `{light, dark}` rather than one value, because in this system a
  colour is a pair. A token whose halves are equal is the exception.
- A colour spelled as opacity over another gets `{base, alpha}`, which is how
  iOS holds it. Flattening to `rgba()` would throw away the fact that
  `--line-card` and `--fill` are the same ink at different strengths.

Type, radius and spacing carry `gastos.uses` — how often the code reaches for
them — and type also carries the platform, because the row step is 14 on web
and 14.5 on iOS and a single number would be false on one of them.
