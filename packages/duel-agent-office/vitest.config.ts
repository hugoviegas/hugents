import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { "@hugents/live": src("../live/src/index.ts"), "@hugents/core": src("../core/src/index.ts") } },
  test: { exclude: [...configDefaults.exclude, "vendor/**"] },
});
