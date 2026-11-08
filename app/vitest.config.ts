import { resolve } from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const alias = {
  "@shared": resolve(import.meta.dirname, "src/shared"),
  "@worker": resolve(import.meta.dirname, "src/worker"),
  "@": resolve(import.meta.dirname, "src/client"),
};

// The secrets `secrets.required` lists in wrangler.jsonc, as fixed test values. Wrangler reads secrets from
// process.env when there is no .dev.vars, so the Worker tests never depend on a developer's local file.
process.env["RESEND_API_KEY"] = "test-resend-api-key";
process.env["BOT_APP_PRIVATE_KEY"] = "test-bot-private-key";
process.env["GITHUB_WEBHOOK_SECRET"] = "test-webhook-secret";

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
          // The first Durable Object call of a run starts its runtime, which can take longer than 5 s
          // when several test files start at once.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
