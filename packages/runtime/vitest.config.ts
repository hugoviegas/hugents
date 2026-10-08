import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@hugents/generator/admin": src("../generator/src/admin.ts"),
      "@hugents/generator": src("../generator/src/index.ts"),
      "@hugents/core": src("../core/src/index.ts"),
    },
  },
  test: { testTimeout: 30_000 },
});
