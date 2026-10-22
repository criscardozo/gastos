// The vitest settings of the rules suite.
//
// A plain object with no imports, spread into `vitest.config.ts`'s
// `defineConfig`. (It was written that way to be shared with sibling projects
// through the retired kyber repo, which could not resolve vitest itself.)
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
