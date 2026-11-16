import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // "server-only" refuses to load outside Next.js's server build; tests run in plain Node.
      "server-only": fileURLToPath(new URL("./src/test/serverOnly.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "db/**/*.test.ts"],
  },
});
