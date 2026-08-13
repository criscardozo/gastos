import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// Code.gs is Apps Script, not a module: it declares bare functions and calls
// globals (GmailApp, Utilities) that only exist inside Google's runtime. So it
// is evaluated here in a VM context with those globals stubbed, which is the
// only way to test it without deploying — and `readMailbox` is worth testing,
// because a retry is easy to get quietly wrong: a loop that never retries, or
// one that swallows the final error, both look fine by reading.
const SOURCE = readFileSync(
  fileURLToPath(new URL("./Code.gs", import.meta.url)),
  "utf-8",
);

/** Load Code.gs with a fake mailbox, and return what the tests need from it. */
function load({ searchResults }) {
  const sleeps = [];
  let call = 0;
  const context = {
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    Utilities: { sleep: (ms) => sleeps.push(ms) },
    GmailApp: {
      search: () => {
        const result = searchResults[call];
        call += 1;
        if (result instanceof Error) throw result;
        return result;
      },
      // The threads are opaque here; the retry is about the call succeeding.
      getMessagesForThreads: (threads) => threads,
    },
  };
  vm.createContext(context);
  new vm.Script(SOURCE).runInContext(context);
  return { context, sleeps, attempts: () => call };
}

describe("readMailbox", () => {
  it("returns the messages when Gmail answers first time, without sleeping", () => {
    const { context, sleeps, attempts } = load({ searchResults: [["t1", "t2"]] });
    expect(context.readMailbox("query")).toEqual(["t1", "t2"]);
    expect(attempts()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("retries once after a transient failure and succeeds", () => {
    // The real one: a single run died with this at 02:17 while the runs either
    // side of it, fifteen minutes apart, were fine.
    const { context, sleeps, attempts } = load({
      searchResults: [new Error("Gmail operation not allowed."), ["t1"]],
    });
    expect(context.readMailbox("query")).toEqual(["t1"]);
    expect(attempts()).toBe(2);
    expect(sleeps).toEqual([2000]);
    expect(context.console.warn).toHaveBeenCalledOnce();
  });

  it("rethrows when the second attempt fails too — that alarm is worth having", () => {
    const { context, attempts } = load({
      searchResults: [
        new Error("Gmail operation not allowed."),
        new Error("Gmail operation not allowed."),
      ],
    });
    expect(() => context.readMailbox("query")).toThrow(/not allowed/);
    // Exactly two: a third attempt would hold the execution open for nothing.
    expect(attempts()).toBe(2);
  });
});
