// The vitest settings every consumer's rules suite shares.
//
// A plain object with no imports, so it can be spread into the consumer's own
// `defineConfig` without kyber resolving vitest itself:
//
//   import { defineConfig } from "vitest/config";
//   import rules from "../../kyber/firebase/vitest-rules.mjs";
//   export default defineConfig(rules);
//
// The emulator is a single shared instance, so the suites take turns instead
// of racing each other's seed data: one file's `clearFirestore` must not wipe
// another file's state mid-test.
export default {
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
};
