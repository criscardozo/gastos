// One error type for "the setup is wrong", so scripts can print the message on
// its own and exit 1, instead of a stack trace pointing into scripts/ for a
// problem that lives in `scripts/project.json` or the environment.

export class ScriptError extends Error {
  constructor(message) {
    super(message);
    this.name = "ScriptError";
  }
}

/**
 * What the arguments mean, decided without touching the process.
 *
 * Separate from `run` so it can be tested: the half that decides is pure, and
 * the half that exits is three lines with nothing to get wrong.
 *
 * Any argument starting with `-` must be declared. Unknown ones are REFUSED
 * rather than ignored, which is not pedantry: a typo'd `--prod` silently
 * ignored means a restore quietly aims at the wrong target, and the run looks
 * exactly like the one that was asked for.
 *
 * Operands are refused too unless the script says how many it takes, and that
 * default is the strict one on purpose — five of the seven scripts here take
 * none, so `backup.mjs production` should not read as `backup.mjs`. The one
 * script that had this check written by hand refused stray operands as well,
 * and moving it to the shared gate had to keep that rather than quietly
 * loosen it.
 *
 * `flags` are switches; `values` are flags that take the next argument, which
 * is then not an operand. The two are declared apart because guessing was
 * wrong: when any declared flag swallowed the argument after it,
 * `restore --production old.json new.json` read `old.json` as the value of
 * `--production`, counted one operand, and ran — restoring `old.json` with
 * `new.json` dropped in silence. A value flag with nothing after it is refused
 * rather than left for the script to discover.
 */
export function gate(argv, { usage, flags = [], values = [], operands = 0 } = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { action: "help", message: usage };
  }
  const switches = new Set([...flags, "--help", "-h"]);
  const valued = new Set(values);
  const unknown = [];
  const loose = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (valued.has(arg)) {
      if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
        i += 1;
      } else {
        unknown.push(`${arg} (needs a value)`);
      }
    } else if (arg.startsWith("-")) {
      if (!switches.has(arg)) unknown.push(arg);
    } else {
      loose.push(arg);
    }
  }
  const refused = [...unknown, ...loose.slice(operands)];
  if (refused.length > 0) {
    return { action: "refuse", message: `Unrecognised: ${refused.join(" ")}\n${usage}` };
  }
  return { action: "run" };
}

/**
 * Run a script's `main`, translating failures into exit codes.
 *
 * A ScriptError is a message for the person at the keyboard; anything else is a
 * bug or a network failure and keeps its stack.
 *
 * The argument gate lives HERE, in the one call every script already makes,
 * rather than in a helper each script has to remember to call. It is here
 * because it was forgotten: `--help` on the backup script ran a full dump
 * against production, reported by someone who typed it to find out how to
 * invoke the thing. The same bug had already been fixed once, in the install
 * script, by writing the check into that file — which fixed that file and
 * nothing else. A rule you have to remember at the right moment is the rule
 * that gets skipped; a gate in the shared entry point cannot be.
 */
export function run(main, options = {}) {
  const { action, message } = gate(process.argv.slice(2), {
    usage: options.usage ?? `Usage: node ${process.argv[1] ?? "script"}`,
    flags: options.flags,
    values: options.values,
    operands: options.operands,
  });
  if (action === "help") {
    console.log(message);
    return;
  }
  if (action === "refuse") {
    console.error(message);
    process.exit(1);
    return;
  }
  main().catch((error) => {
    if (error instanceof ScriptError) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}
