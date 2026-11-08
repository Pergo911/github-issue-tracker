import { resolve } from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const alias = {
  "@shared": resolve(import.meta.dirname, "src/shared"),
  "@worker": resolve(import.meta.dirname, "src/worker"),
  "@": resolve(import.meta.dirname, "src/client"),
};

// Two projects, so `test:unit` stays fast and `test:worker` runs inside the local Workers runtime.
export default defineConfig({
  resolve: { alias },
  define: { __PSEUDO_LANGUAGE__: false },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: [
            "src/shared/**/*.test.ts",
            "src/client/**/*.test.{ts,tsx}",
            "eslint-rules/**/*.test.ts",
            "scripts/**/*.test.ts",
          ],
        },
      },
      {
        extends: true,
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: {
          name: "worker",
          include: ["src/worker/**/*.test.ts"],
        },
      },
    ],
  },
});
