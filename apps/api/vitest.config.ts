import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Integration tests share one database; run files serially for determinism.
    fileParallelism: false,
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: 20_000,
  },
});
