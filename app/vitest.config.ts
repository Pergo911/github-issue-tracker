import { resolve } from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { generateAppKeyPair } from "./fakes/keys.ts";
import {
  TEST_BOT,
  TEST_ORG,
  TEST_ORIGIN,
  TEST_REPO,
  TEST_STAFF_CLIENT_ID,
  TEST_WEBHOOK_SECRET,
} from "./fakes/testing/constants.ts";
import { defineConfig } from "vitest/config";

const alias = {
  "@fakes": resolve(import.meta.dirname, "fakes"),
  "@shared": resolve(import.meta.dirname, "src/shared"),
  "@worker": resolve(import.meta.dirname, "src/worker"),
  "@": resolve(import.meta.dirname, "src/client"),
};

/** True unless `--project` was passed and explicitly excluded `worker`. */
function needsWorkerProject(argv: readonly string[]): boolean {
  const selected: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--project" && argv[index + 1] !== undefined) {
      selected.push(argv[++index] as string);
    } else if (argument?.startsWith("--project=")) {
      selected.push(argument.slice("--project=".length));
    }
  }
  return selected.length === 0 || selected.includes("worker");
}

async function workerProject() {
  // The secrets `secrets.required` lists in wrangler.jsonc, as fixed test values. Wrangler reads secrets from
  // process.env when there is no .dev.vars, so the Worker tests never depend on a developer's local file.
  // The Bot key is a throwaway generated for this run (nothing secret is committed), in the PKCS#1 form GitHub
  // hands out. The fake GitHub verifies App JWTs with the public half, which reaches the tests as a binding.
  const botKeys = await generateAppKeyPair();
  process.env["RESEND_API_KEY"] = "test-resend-api-key";
  process.env["BOT_APP_PRIVATE_KEY"] = botKeys.privateKeyPkcs1;
  process.env["GITHUB_WEBHOOK_SECRET"] = TEST_WEBHOOK_SECRET;

  return {
    extends: true as const,
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        // The Worker reaches GitHub and Resend through these base URLs: in Worker tests they are the fake
        // world (see src/worker/testing/setup.ts), which answers every request to TEST_ORIGIN.
        miniflare: {
          bindings: {
            GITHUB_API_BASE: `${TEST_ORIGIN}/github`,
            GITHUB_WEB_BASE: `${TEST_ORIGIN}/github-web`,
            RESEND_API_BASE: `${TEST_ORIGIN}/resend`,
            GITHUB_ORG: TEST_ORG,
            GITHUB_REPO: TEST_REPO,
            BOT_APP_ID: String(TEST_BOT.appId),
            BOT_INSTALLATION_ID: String(TEST_BOT.installationId),
            BOT_USER_ID: "",
            BOT_LOGIN: "",
            STAFF_APP_CLIENT_ID: TEST_STAFF_CLIENT_ID,
            RESEND_FROM_DOMAIN: "mail.test",
            APP_URL: "https://reports.test",
            // Both halves from this one evaluation of the config, so they always match.
            BOT_APP_PRIVATE_KEY: botKeys.privateKeyPkcs1,
            TEST_BOT_PUBLIC_KEY: botKeys.publicKey,
          },
        },
      }),
    ],
    test: {
      name: "worker",
      include: ["src/worker/**/*.test.ts"],
      // Every test file gets a fake GitHub and Resend in the Workers runtime, and fails if a write to the
      // fake GitHub carried an Allowlist email address.
      setupFiles: ["src/worker/testing/setup.ts"],
      // The first Durable Object call of a run starts its runtime, which can take longer than 5 s
      // when several test files start at once.
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  };
}

// Three projects, so `test:unit` stays fast and `test:worker` runs inside the local Workers runtime.
// Deferring RSA key generation and Miniflare config keeps `test:unit` and `test:tooling` from paying for them.
export default defineConfig(async () => ({
  resolve: { alias },
  define: { __PSEUDO_LANGUAGE__: false },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          // Generating an RSA key (the fakes' tests do) takes seconds on a loaded machine, as `verify` makes it.
          testTimeout: 30_000,
          include: [
            "src/shared/**/*.test.ts",
            "fakes/**/*.test.ts",
            "src/client/**/*.test.{ts,tsx}",
            "eslint-rules/**/*.test.ts",
            "e2e/**/*.test.ts",
          ],
        },
      },
      {
        // Tests of the repo's own tooling. They start a local Workers runtime, so they are slower than `unit`.
        extends: true,
        test: {
          name: "tooling",
          environment: "node",
          include: ["scripts/**/*.test.ts"],
          testTimeout: 60_000,
        },
      },
      ...(needsWorkerProject(process.argv) ? [await workerProject()] : []),
    ],
  },
}));
