#!/usr/bin/env python3
"""The machinery both consumers' token emitters were writing twice.

Each consumer keeps its own `tokens.json` — a palette is product identity and
never travels — and its own `design-system/emit.py`, which stays because what
a destination's declaration LOOKS like is that project's business: one wraps a
Swift line past a measured column, the other does not; one omits a dark CSS
line that would repeat the light one, the other writes both because every
token appears three times in its stylesheet. Those are not the same file with
different constants, so they are not extracted.

What is extracted is everything underneath: walking the token document,
spelling a value, rewriting a declaration WHERE IT ALREADY SITS, and the
verify/write pair with its reporting. Both had written all of it, separately,
down to the same reasoning in the comments.

The consumer describes its destinations and calls `main()`:

    from tokens import Block, Destination, load, main

    DOC = load(ROOT / "tokens.json")

    def swift_decl(name, entry):
        ...  # this project's lines for the token, or [] to skip it

    main(DOC, [
        Destination(CSS, css_lines, css_pattern),
        Destination(SWIFT, swift_decl, swift_pattern),
    ])

A `Destination` needs the declaration to already be in the file. When it is
not — a target that names none of the tokens yet — a `Block` owns the region
between two anchors the consumer writes by hand, once, and replaces it whole:

    main(DOC, [
        Block(SWIFT, radius_line, "// kyber:radius start", "// kyber:radius end"),
    ], groups="radius")

The two mix in one file. Blocks are written last and refuse the run if a
pattern reached inside their region, because the block would win and both
halves would report success.

Why `--write` matters more than it looks: before it, the token file MIRRORS
the code and a test checks they have not drifted. After it the code is written
FROM the token file, and the check becomes "regenerate and see that nothing
changed" — which is stronger than comparing text, because it proves the files
can be REBUILT rather than that they happen to match today. A file edited by
hand until it matched would pass the comparison and fail this the next time
anybody touched the source. See `docs/guardas.md`.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable


def load(path: Path) -> dict:
    """The token document, read as UTF-8 whatever the platform default is."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _is_token(node) -> bool:
    return isinstance(node, dict) and "$value" in node


def flat(doc: dict, group: str = "color") -> list[tuple[str, dict]]:
    """Every token in a group as (name, entry), in the document's own order.

    The order is the file's, not sorted: a generated block that reorders its
    declarations produces a diff on every unrelated change, and a diff nobody
    can read is a diff nobody reads.

    Groups nest to different depths and both are legitimate DTCG. Colours are
    grouped by role — `color.surface.ground` — while radii sit directly under
    theirs, `radius.card`. The first version assumed two levels everywhere,
    which read the radius group one level too deep and returned each token's
    `$extensions` dict as if it were a token.

    It returned SIX of them for a file with six radii, and five for a file with
    five: the wrong answer with the right count. A sanity check on the length
    would have passed. That is the whole reason this walks by looking for
    `$value` rather than by counting levels, and the reason the fixture for it
    now carries both shapes — the earlier one had only the nested one, so it
    reproduced the mechanism and not the shape.

    It did not, for a while, do what that paragraph says: the fix read one
    level or two and stopped, so a third level — `color.surface.card.raised` —
    was dropped without a word. The walk is recursive now, at any depth, and
    never descends into a token.

    Keys beginning with `$` are DTCG metadata (`$description`), never tokens.
    """
    node = doc.get(group, {})
    out: list[tuple[str, dict]] = []

    def walk(node: dict) -> None:
        for name, child in node.items():
            if name.startswith("$") or not isinstance(child, dict):
                continue
            if _is_token(child):
                out.append((name, child))
            else:
                walk(child)

    if isinstance(node, dict):
        walk(node)
    return out


def tokens_of(doc: dict, groups: str | list[str]) -> list[tuple[str, dict]]:
    """Every token across one group or several, in document order.

    Colours and radii land in the same stylesheet, so a destination usually
    wants both in one pass — one report, one exit code. Passing them
    separately would verify twice and leave the caller to combine two answers,
    which is how one of them ends up unread.

    Two tokens with one name are refused. Every destination spells a token by
    its leaf name, so `surface.ground` and `text.ground` would be written to
    the same lines twice, the second silently winning, with `--write`
    reporting success.
    """
    names = [groups] if isinstance(groups, str) else list(groups)
    pairs = [pair for g in names for pair in flat(doc, g)]
    seen: set[str] = set()
    for name, _ in pairs:
        if name in seen:
            raise ValueError(
                f"dos tokens se llaman {name!r}: todo destino los escribiría en el mismo lugar"
            )
        seen.add(name)
    return pairs


def css_value(value) -> str:
    """A token's CSS spelling: a hex, or `rgba()` when it carries opacity.

    The two shapes DTCG allows here are a plain string and `{base, alpha}`.
    Anything else raises rather than being coerced — a colour that silently
    becomes something printable is the failure mode this whole layer exists to
    remove, and a generator that guesses writes the guess into both platforms.
    """
    if isinstance(value, str):
        return value
    if not isinstance(value, dict) or "base" not in value or "alpha" not in value:
        raise ValueError(f"not a colour this knows how to spell: {value!r}")
    base = value["base"]
    r, g, b = (int(base[i : i + 2], 16) for i in (1, 3, 5))
    return f"rgba({r}, {g}, {b}, {value['alpha']})"


def rewrite_declarations(text: str, pattern: re.Pattern, values: Iterable[str]) -> tuple[str, int]:
    """Replace each match of `pattern` with the next value, in order.

    Line- and match-level rather than block-level, which both consumers had
    arrived at separately and for the same reason: the declarations sit
    interleaved with comments and with things the generator does not own — a
    category palette, a hue switch, shadow variables. Replacing a REGION would
    either drop those or force them into the generated file; replacing exactly
    the matched span leaves every other character where its author put it.

    `values` is consumed lazily, so a destination that declares a token once
    takes the first value and a stylesheet that declares it in a light block
    and a dark block takes both, with no list of which files carry which.

    Returns the new text, how many were replaced, how many the pattern
    MATCHED, and how many replacements would change the line's indentation.

    The first two differ exactly when the file says a token more times than the
    caller emits for it. The last one catches a different mistake, and one
    easy to make: a pattern that swallows the leading whitespace, paired with
    declarations written at one fixed indentation. The same token often sits at
    two depths — a light block at the top level and a dark one nested inside a
    media query — and rewriting both from one string silently re-indents the
    nested one. Nothing about the values is wrong, so no diff of the values
    shows it, and the file still verifies. Found by running this against a real
    consumer's stylesheet and watching four-space declarations come back with
    two.
    """
    it = iter(values)
    replaced = 0
    matched = 0
    reindented = 0
    lead = re.compile(r"^[ \t]*")

    def swap(match: re.Match) -> str:
        nonlocal replaced, matched, reindented
        matched += 1
        try:
            value = next(it)
        except StopIteration:
            return match.group(0)
        replaced += 1
        found = match.group(0)
        if lead.match(found).group(0) != lead.match(value).group(0):
            reindented += 1
        return value

    return pattern.sub(swap, text), replaced, matched, reindented


def _lines(text: str) -> list[str]:
    """Lines as verify compares them: indentation kept, trailing blanks not."""
    return [line.rstrip() for line in text.splitlines()]


def _same(have: str, want: str) -> bool:
    """Does a line on disk say what a declaration line says?

    Indentation counts exactly when the declaration carries its own, which is
    the rule `write` already applies. A declaration WITH a margin replaces the
    matched span margin and all, so four spaces on disk against two emitted is
    a re-indent `write` refuses — and verify, which used to strip both sides,
    passed that file: CI green over a file the generator could not rebuild.
    A declaration WITHOUT one is spliced in after whatever margin the file
    already has, at any depth, so there only the content can be compared.

    Comparing the margin always was the first fix, and it put a consumer's
    verify in red over a stylesheet its own `--write` left byte for byte
    unchanged: its callback emits bare declarations and its pattern leaves the
    indentation alone. Found by running the fix against both consumers before
    shipping it, not after.
    """
    return have == want if want[:1].isspace() else have.lstrip() == want


def _decls(dest, name: str, entry: dict) -> list[str]:
    """What a destination emits for a token, with None read as nothing.

    The module docstring once said a callback could return None to skip a
    token and the Destination docstring said an empty list. `write` skipped
    None; `verify` and `show` raised TypeError on it. Both mean skip now, in
    every caller.
    """
    return list(dest.declarations(name, entry) or [])


def _key(path) -> Path:
    """One identity per file, however each destination spelled its path.

    Keyed by the path as written, `Theme.swift` and `./Theme.swift` were two
    files: each was rebuilt from what was on disk, the last one written won,
    and the run listed the file twice and reported success over the half it
    had just thrown away — the clobbering the shared-file test exists to
    prevent, through a door that test did not try.
    """
    return Path(path).resolve()


def _read(destinations) -> tuple[dict[Path, str], dict[Path, str], dict[Path, str]]:
    """Each file once: its text, its line ending, and the name to report.

    Read with the line endings as they are rather than translated, and
    written back the same way. Translating on read and on write rewrote a
    CRLF file as LF on its first real change — every line in the diff, none
    of them a value — and on Windows would have done the reverse to every LF
    file. The text is handed to the patterns with plain `\n`, which is what
    every consumer's pattern was written against. A file that mixes the two
    has no ending to put back, and `write` refuses to change it.
    """
    texts: dict[Path, str] = {}
    endings: dict[Path, str] = {}
    shown: dict[Path, str] = {}
    for dest in destinations:
        key = _key(dest.path)
        if key in texts:
            continue
        with open(key, encoding="utf-8", newline="") as handle:
            raw = handle.read()
        crlf = raw.count("\r\n")
        endings[key] = "\n" if crlf == 0 else "\r\n" if crlf == raw.count("\n") else "mixed"
        texts[key] = raw.replace("\r\n", "\n")
        shown[key] = str(dest.path)
    return texts, endings, shown


def count_block(haystack: list[str], needle: list[str]) -> int:
    """How many times `needle` appears as consecutive lines of `haystack`.

    Line-aligned, and margins compared per `_same`, which is the whole point.
    Asking `decl in text` instead looks right and is not: a declaration indented two spaces is a SUBSTRING
    of the same declaration indented four, so a stylesheet that carries a
    token at both depths — a nested media query and a flat override —
    verifies green while one of the two is corrupt, because the string being
    searched for is found hiding inside the other. Reported by a consumer
    whose file has exactly that shape.

    Counting rather than merely finding, for the other half of the same
    problem: present-somewhere says nothing about present-everywhere.
    """
    if not needle:
        return 0
    n = len(needle)
    return sum(
        1
        for i in range(len(haystack) - n + 1)
        if all(_same(have, want) for have, want in zip(haystack[i : i + n], needle))
    )


class AnchorError(ValueError):
    """The anchors of a block are not a single, ordered pair.

    Its own class because it is the one thing a `Block` must never guess
    about: given a file whose anchors are missing, doubled or inverted, the
    tempting recoveries — take the first pair, insert at the end, create the
    anchors — all write generated code into a place nobody chose.
    """


@dataclass(frozen=True)
class Block:
    """A destination that CREATES its declarations instead of rewriting them.

    `Destination` needs every token to already sit somewhere in the file: it
    finds a declaration with a pattern and swaps the value. That is the right
    shape for a stylesheet or a theme that already names every token, and it
    is the wrong one for a file that names none — both consumers' iOS targets
    carry radii as bare numbers at every call site and have no constant for
    any of them, so there is nothing to find.

    So this one owns a REGION instead of a set of declarations: everything
    between two anchors, which the consumer writes into the file by hand, once:

        // kyber:radius start
        // kyber:radius end

    Anchors rather than "append at the end of the enum" or "insert after the
    colours" because where generated code goes is a decision, and a decision
    is written down by a person in the file it affects. It also makes the
    write idempotent by construction — the region is replaced whole, so the
    second run produces the same bytes as the first, which is the first thing
    `docs/guardas.md` demands of a generator.

    What it does NOT do, and the reason is worth keeping in front of whoever
    wires it: defining the constants is half. Every call site still spells its
    own number until somebody changes it by hand, and a consumer measured that
    tokenising can TURN OFF the guard that used to catch those numbers — a
    literal outside the scale stops being outside it once the scale names it.
    The replacement guard belongs with the consumer, and it is written before
    these tokens exist so its first run fails on its own.
    """

    path: Path
    declarations: Callable[[str, dict], list[str]]
    begin: str
    end: str
    label: str = ""

    def name(self) -> str:
        return self.label or Path(self.path).name

    def render(self, doc: dict, groups: str | list[str]) -> list[str]:
        """Every line the region should carry, in the document's own order."""
        out: list[str] = []
        for name, entry in tokens_of(doc, groups):
            out.extend(_decls(self, name, entry))
        return out

    def body(self, text: str) -> tuple[int, int]:
        """Character span of what lives between the anchors.

        Raises rather than returning a best guess. Each of these has been a
        real way to corrupt a file: two `begin` lines and the region silently
        becomes whichever pair the search happens to bracket; an `end` above
        its `begin` and the splice writes over everything in between,
        backwards.
        """
        for anchor, what in ((self.begin, "de apertura"), (self.end, "de cierre")):
            seen = text.count(anchor)
            if seen == 0:
                raise AnchorError(
                    f"{self.name()}: falta el ancla {what} ({anchor!r})"
                )
            if seen > 1:
                raise AnchorError(
                    f"{self.name()}: el ancla {what} ({anchor!r}) aparece {seen} veces"
                )
        begin_at = text.index(self.begin)
        end_at = text.index(self.end)
        if end_at < begin_at:
            raise AnchorError(
                f"{self.name()}: el ancla de cierre está antes que la de apertura"
            )
        # Whole lines, and each edge found on its own. The anchor STRINGS name
        # the marker, not the margin — the indentation belongs to the lines the
        # consumer typed — so the region starts after the newline that ends
        # `begin`'s line and stops at the start of `end`'s line.
        #
        # Computed independently because deriving one from the other is what
        # broke: with an empty region the text between the two anchors is just
        # the closing one's indent and holds no newline, so a conditional that
        # only moved `stop` back when it found one left the span sitting on
        # those spaces and the FIRST write swallowed them. Only the first,
        # which is the write right after somebody typed those two lines by
        # hand. Reported by the consumer that wired this first.
        newline = text.find("\n", begin_at + len(self.begin))
        start = len(text) if newline == -1 else newline + 1
        stop = text.rfind("\n", 0, end_at) + 1
        if stop < start:
            raise AnchorError(
                f"{self.name()}: las dos anclas están en la misma línea"
            )
        return start, stop

    def splice(self, text: str, lines: list[str]) -> str:
        start, stop = self.body(text)
        filled = "".join(line + "\n" for line in lines)
        return text[:start] + filled + text[stop:]

    def current(self, text: str) -> list[str]:
        start, stop = self.body(text)
        return text[start:stop].splitlines()


@dataclass(frozen=True)
class Destination:
    """One file the tokens are written into.

    `declarations(name, entry)` returns the exact text this file should carry
    for that token — a list, because a stylesheet carries a light and a dark
    line for one token — or an empty list to skip it. Skipping is how a target
    that carries a SUBSET stays a subset without a list to maintain: a watch
    app or a widget names fewer tokens, and the destination simply declines the
    ones it does not name.

    `pattern(name, entry)` matches what is on disk for that token, in every
    layout it might be in. A destination whose file wraps a long declaration
    has to match both the wrapped and the unwrapped form, or `--write` rewrites
    one layout into the other and produces a diff that is not a value change.

    `subset=True` says the file carries only SOME of the tokens, and which ones
    is read from the file itself: a token whose pattern finds nothing there is
    not this destination's. That is what the paragraph above asks for, and the
    flag exists because asking was not enough. A consumer read that sentence,
    wired three destinations, and still typed out eight identifiers for its
    watch target — which then disagreed with the nine the file declared, so the
    ninth was silently outside the generator and drifted on the next write.
    Prose describing a property does not stop the obvious implementation; the
    obvious implementation has to be the right one.

    What this does NOT catch is the other direction: a file MISSING a token it
    should carry looks the same as a subset declining it. The file cannot
    answer a question about intent. Deriving membership closed one hole and
    opened its mirror image — a consumer deleted a token from its watch theme
    and verify stayed green at 151.

    So `subset=True` is half of a pair, and the other half is the consumer's:

      - HERE, the emitter follows the file. A token the file starts declaring
        is adopted and its value tracks the others, so the values cannot
        diverge. Nothing about behaviour is gated by a list.
      - THERE, a test pins the membership, exact, and fails by NAME in both
        directions. Which roles a partial target carries is a design decision,
        so changing it should mean editing a list on purpose — a closed
        population, fixed by the test that states it.

    That is why this list is not the one that was wrong before: a list that
    silently gates what a generator does is a second copy nobody couples; a
    list that asserts a decision and names what broke is the decision written
    down.
    """

    path: Path
    declarations: Callable[[str, dict], list[str]]
    pattern: Callable[[str, dict], re.Pattern | None]
    label: str = ""
    subset: bool = False

    def name(self) -> str:
        return self.label or Path(self.path).name

    def carries(self, name: str, entry: dict, text: str) -> bool:
        """Does this destination own this token? Every one, unless a subset."""
        if not self.subset:
            return True
        pattern = self.pattern(name, entry)
        return pattern is not None and pattern.search(text) is not None


def verify(doc: dict, destinations: list[Destination | Block],
           groups: str | list[str] = "color") -> int:
    """Every declaration this would emit must already be in the file, verbatim.

    Reports what is missing and how much was checked. The second number is not
    decoration: a run that checks nothing passes just as quietly as one that
    checks everything, and "0 mismatches" out of zero declarations is the most
    absorbable result there is (see `docs/guardas.md`).
    """
    texts, _, _ = _read(destinations)
    lines = {key: _lines(text) for key, text in texts.items()}
    missing: list[str] = []
    checked = 0
    blocks = [d for d in destinations if isinstance(d, Block)]
    plain = [d for d in destinations if not isinstance(d, Block)]

    for name, entry in tokens_of(doc, groups):
        for dest in plain:
            key = _key(dest.path)
            if not dest.carries(name, entry, texts[key]):
                continue
            decls = _decls(dest, name, entry)
            checked += len(decls)
            # Grouped, so a token declared twice with the same text has to be
            # there twice. Finding it once and calling that done is how a
            # stale second copy survives the check that exists to catch it.
            wanted: dict[tuple[str, ...], int] = {}
            for decl in decls:
                want = tuple(_lines(decl))
                wanted[want] = wanted.get(want, 0) + 1
            for want, times in wanted.items():
                found = count_block(lines[key], list(want))
                if found < times:
                    where = " / ".join(line.strip() for line in want)
                    missing.append(
                        f"{dest.name()}  {where}"
                        + (f"  (aparece {found} de {times} veces)" if times > 1 else "")
                    )

            # And the same question `write` asks: does the file declare this
            # token somewhere these declarations do not cover? Asking it here
            # too is what puts it in CI rather than only in front of whoever
            # runs --write. A copy nobody emits keeps its old value through
            # both, and the check that exists to find exactly that would say
            # nothing — reported by a consumer whose stylesheet declares each
            # token three times against a callback returning two.
            if decls:
                pattern = dest.pattern(name, entry)
                if pattern is not None:
                    seen = len(pattern.findall(texts[key]))
                    if seen > len(decls):
                        missing.append(
                            f"{dest.name()}  {name} aparece {seen} vez(ces) en el archivo "
                            f"y sólo se emiten {len(decls)} declaración(es): "
                            "las otras nunca se reescriben"
                        )

    # A block is checked whole rather than declaration by declaration, and
    # that is the point of it: the region belongs to the generator, so a line
    # somebody ADDED by hand inside it is a mismatch too. The pattern-based
    # half cannot ask that question — it only ever asks whether what it emits
    # is present, so an extra neighbour sits there unnoticed for good.
    for blk in blocks:
        want = [line for decl in blk.render(doc, groups) for line in _lines(decl)]
        if not want:
            # The same refusal `write` makes. Without it, a block that emits
            # nothing passed here beside any destination that checked
            # something, and failed only when somebody ran --write.
            missing.append(f"{blk.name()}  el bloque quedaría vacío, no se emite ningún token")
            continue
        checked += len(want)
        try:
            have = _lines("\n".join(blk.current(texts[_key(blk.path)])))
        except AnchorError as err:
            missing.append(str(err))
            continue
        if have != want:
            absent = [line.strip() for line in want if line not in have]
            extra = [line.strip() for line in have if line not in want]
            detail = []
            if absent:
                detail.append("falta: " + " / ".join(absent[:3]))
            if extra:
                detail.append("sobra: " + " / ".join(extra[:3]))
            if not detail:
                detail.append("el mismo contenido en otro orden o con otra indentación")
            missing.append(f"{blk.name()}  bloque — " + "; ".join(detail))

    if checked == 0:
        print("  nada que verificar: ningún destino declara ningún token")
        return 1
    if missing:
        print(f"  {len(missing)} de {checked} declaraciones NO coinciden con el código:")
        for m in missing:
            print(f"    · {m}")
        return 1
    print(f"  las {checked} declaraciones coinciden con el código, línea por línea")
    return 0


def _reaches(pattern: re.Pattern, text: str, span: tuple[int, int]) -> bool:
    """Does any match of `pattern` in `text` overlap the character span?"""
    start, stop = span
    return any(m.start() < stop and m.end() > start for m in pattern.finditer(text))


def write(doc: dict, destinations: list[Destination | Block],
          groups: str | list[str] = "color") -> int:
    """Rewrite every declaration in place, from the token document.

    Refuses to write anything if any destination would lose a declaration it
    currently has — a pattern that stops matching rewrites nothing and would
    otherwise report success over a file it never touched. All the files are
    written only after all of them have been rebuilt in memory, so a failure
    halfway through leaves the tree as it was rather than half-generated.
    """
    texts, endings, shown = _read(destinations)
    updated = dict(texts)
    problems: list[str] = []
    rewritten = 0

    blocks = [d for d in destinations if isinstance(d, Block)]
    plain = [d for d in destinations if not isinstance(d, Block)]

    for name, entry in tokens_of(doc, groups):
        for dest in plain:
            key = _key(dest.path)
            if not dest.carries(name, entry, updated[key]):
                continue
            decls = _decls(dest, name, entry)
            if not decls:
                continue
            pattern = dest.pattern(name, entry)
            if pattern is None:
                continue
            new, count, matched, reindented = rewrite_declarations(updated[key], pattern, decls)
            if reindented:
                problems.append(
                    f"{dest.name()}: {name} cambiaría la indentación de {reindented} "
                    "declaración(es) — el patrón se come el espacio inicial y las "
                    "declaraciones lo traen fijo"
                )
            # A token a SUBSET destination's file does not name is a no-op and
            # legitimate: that is what makes it a subset. For any other
            # destination zero matches is a token it owns and cannot find, and
            # used to pass here too — a comment from before `subset` existed
            # still called it legitimate for everyone, so a full destination
            # missing a token wrote the rest, said so, and left verify to fail.
            # Anything between zero and agreement is wrong in BOTH directions.
            #
            # Too FEW matches means only some of a token's declarations were
            # rewritten, leaving the file internally inconsistent.
            #
            # Too MANY means the file says this token somewhere this does not
            # write, and that one keeps its old value — through the write, and
            # then through verify as well, because verify only asks whether
            # what it emits is present. A consumer whose stylesheet declares
            # every token three times while its callback returns two would have
            # carried a stale third copy past both guards, silently and
            # for good. Found by reconciling two declaration counts that did
            # not agree.
            if matched != len(decls) and (matched or not dest.subset):
                problems.append(
                    f"{dest.name()}: {name} aparece {matched} vez(ces) en el archivo "
                    f"y se emiten {len(decls)} declaraciones"
                )
            updated[key] = new
            rewritten += count

    # Blocks last, because they replace their region whole and would
    # overwrite anything a pattern had just written inside it. Which is a
    # failure worth naming rather than tolerating: the other destination
    # reports the declarations it rewrote, the file does not carry them, and
    # both halves look like they worked.
    #
    # Asked by POSITION: does any other destination's pattern match inside
    # the region? Comparing the region's bytes before and after the rewrites
    # was the first version, and it missed the case where the declarations
    # inside already carried the right values — the rewrite changed nothing,
    # the bytes agreed, and the splice deleted them while the run reported
    # success. The byte comparison stays behind it for a match that straddles
    # an anchor.
    for blk in blocks:
        key = _key(blk.path)
        want = blk.render(doc, groups)
        try:
            span = blk.body(texts[key])
            before = blk.current(texts[key])
            after = blk.current(updated[key])
        except AnchorError as err:
            problems.append(str(err))
            continue
        intruders = []
        for name, entry in tokens_of(doc, groups):
            for dest in plain:
                if _key(dest.path) != key or not _decls(dest, name, entry):
                    continue
                pattern = dest.pattern(name, entry)
                if pattern is not None and _reaches(pattern, texts[key], span):
                    intruders.append(f"{dest.name()} declara {name}")
        if intruders or before != after:
            problems.append(
                f"{blk.name()}: otro destino escribe adentro del bloque, que este "
                "destino reemplaza entero — los dos dirían que escribieron"
                + (f" ({', '.join(intruders[:3])})" if intruders else "")
            )
            continue
        if not want:
            # Splicing nothing in is a wipe that reports success: the anchors
            # stay, the region empties, and the count of what was written is
            # zero for a reason nobody reads.
            problems.append(f"{blk.name()}: el bloque quedaría vacío, no se emite ningún token")
            continue
        updated[key] = blk.splice(updated[key], want)
        # Counted whether or not the bytes changed, like the pattern half: a
        # second run rewriting the same values is a success, not an empty one.
        rewritten += len(want)

    for key, text in updated.items():
        if text != texts[key] and endings[key] == "mixed":
            problems.append(
                f"{shown[key]}: mezcla finales de línea CRLF y LF, y no hay uno solo "
                "que devolverle — normalizalo antes de escribir"
            )

    if problems:
        print(f"  {len(problems)} destino(s) quedarían a medias, no se escribió nada:")
        for p in problems:
            print(f"    · {p}")
        return 1
    if rewritten == 0:
        print("  no se reescribió ninguna declaración: ningún patrón coincidió")
        return 1

    # By FILE, not by destination. Two destinations can share one file — a
    # theme taking colours line by line and radii as a block — and iterating
    # destinations wrote that file twice and then listed it twice in the
    # report. The second write was harmless and the second line was not: a
    # consumer reading it the first time has to work out whether something was
    # written twice, and a report that needs interpreting is one that stops
    # being read.
    written = []
    for key, text in updated.items():
        if text != texts[key]:
            with open(key, "w", encoding="utf-8", newline="") as handle:
                handle.write(text.replace("\n", endings[key]))
            written.append(shown[key])
    if not written:
        # Distinguished from having written, because on a second run they are
        # the same number of declarations and a different fact about the disk.
        print(f"  {rewritten} declaraciones ya estaban escritas: ningún archivo cambió")
        return 0
    names = "\n    ".join(written)
    print(f"  {rewritten} declaraciones reescritas desde tokens.json:\n    {names}")
    return 0


def show(doc: dict, destinations: list[Destination | Block],
         groups: str | list[str] = "color") -> int:
    """Print what each destination should say, without touching anything."""
    for dest in destinations:
        print(f"// {dest.name()}")
        for name, entry in tokens_of(doc, groups):
            for decl in _decls(dest, name, entry):
                print(decl)
        print()
    return 0


def main(doc: dict, destinations: list[Destination | Block], argv: list[str] | None = None,
         groups: str | list[str] = "color") -> int:
    """`--write`, `--verify`, or print. An unknown flag is refused.

    Refused rather than ignored, for the reason an install script learned the
    hard way: the flag somebody types to ask what a command does should never
    be the one that makes it act.
    """
    args = sys.argv[1:] if argv is None else argv
    known = {"--write", "--verify", "--help", "-h"}
    unknown = [a for a in args if a not in known]
    # Every flag `known` accepts is named here, and a test couples the two:
    # the list decides what is REFUSED, so a flag missing from the message is
    # one nobody can discover, and a flag in the message that is not accepted
    # sends someone to a wrong command. It listed two of four.
    usage = "uso: emit.py [--verify | --write | --help]"
    if unknown:
        print(f"no entiendo {' '.join(unknown)}.\n{usage}", file=sys.stderr)
        return 1
    if "--write" in args and "--verify" in args:
        # One of them would win without a word, and which one is not
        # something to learn from the result.
        print(f"--write y --verify no van juntos.\n{usage}", file=sys.stderr)
        return 1
    if "--help" in args or "-h" in args:
        print(usage)
        return 0
    if "--write" in args:
        return write(doc, destinations, groups)
    if "--verify" in args:
        return verify(doc, destinations, groups)
    return show(doc, destinations, groups)
