import { defineConfig } from "vitest/config";
import rules from "../../kyber/firebase/vitest-rules.mjs";

// The settings every consumer's rules suite shares — sequential files, and
// the timeouts — live in kyber so the sibling projects cannot drift. This
// suite used 20 s for a test until 2026-09-29; nothing recorded that as a
// decision, so it took kyber's 30 s.
export default defineConfig(rules);
