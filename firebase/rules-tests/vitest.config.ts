import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Rules tests hit the emulator; keep them sequential so `clearFirestore`
    // calls from one file don't wipe another file's state.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
