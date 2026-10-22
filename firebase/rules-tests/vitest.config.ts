import { defineConfig } from "vitest/config";
import rules from "./vitest-rules.mjs";

// Sequential files and the timeouts live in vitest-rules.mjs. This suite used
// 20 s for a test until 2026-09-29; nothing recorded that as a decision, so it
// took the 30 s that file holds.
export default defineConfig(rules);
