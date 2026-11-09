import { defineConfig, devices } from "@playwright/test";
import {
  fakesPort,
  runDirectory,
  serverPort,
  SERVER_KINDS,
  type ServerKind,
} from "./e2e/support/servers.ts";

/**
 * Do not run `playwright test` directly. `npm run test:e2e`, `npm run screenshots` and `npm run test:visual`
 * (scripts/*.ts) first pick free ports and a private state directory for the run and pass them in the
 * environment (E2E_PORT_SEEDED, E2E_PORT_EMPTY, E2E_PORT_SETUP, E2E_RUN_DIR), so runs in sibling worktrees, or two runs in
 * this one, never share a port or a state file.
 */
const run = runDirectory();
const dockerEndpoint = process.env["PW_DOCKER_WS_ENDPOINT"];

const server = (kind: ServerKind) => ({
  // `node vite.js` rather than `npx vite`, so killing the server kills the whole process tree on Windows too.
  command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${serverPort(kind)} --strictPort`,
  // The SPA's index page, not an /api/ path: the empty server answers 404 there on purpose.
  url: `http://127.0.0.1:${serverPort(kind)}/`,
  reuseExistingServer: false,
  timeout: 120_000,
  stdout: "pipe" as const,
  stderr: "pipe" as const,
  env: {
    PERSIST_DIR: `${run}/state-${kind}`,
    VITE_CACHE_DIR: `${run}/vite-cache-${kind}`,
    VITE_PSEUDO: "1",
    // The fake GitHub and fake Resend (ticket #22) this server hosts listen here.
    FAKES_PORT: String(fakesPort(kind)),
    // Local Workers secrets (SPEC 2.6): fixed values. The Bot key is left empty on purpose: the dev server then
    // generates a throwaway one and the fake GitHub verifies the Bot's JWTs with it.
    RESEND_API_KEY: "e2e-resend-key",
    BOT_APP_PRIVATE_KEY: "",
    GITHUB_WEBHOOK_SECRET: "e2e-webhook-secret",
  },
});

export default defineConfig({
  testDir: "./e2e",
  outputDir: `${run}/test-results`,
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  // 60 s, not 30: with several worktrees running dev servers and Docker at once a page can take 20 s to load.
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled", caret: "hide" },
  },
  // `npm run test:visual:update` sets this; every other run fails on a missing or different image.
  updateSnapshots: process.env["UPDATE_SNAPSHOTS"] ? "changed" : "none",
  // No {platform}: one set of reference images, rendered only in Playwright's Docker image.
  snapshotPathTemplate: "{testDir}/reference/{arg}{ext}",
  use: {
    locale: "hu-HU",
    timezoneId: "Europe/Budapest",
    ...(dockerEndpoint
      ? { connectOptions: { wsEndpoint: dockerEndpoint, exposeNetwork: "<loopback>" } }
      : {}),
  },
  projects: [
    {
      name: "chromium",
      testMatch: [
        "boot.spec.ts",
        "screens.spec.ts",
        "submission.spec.ts",
        "recovery.spec.ts",
        "staff.spec.ts",
        "admin.spec.ts",
        "status.spec.ts",
        "sweep.spec.ts",
        "world.spec.ts",
      ],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "screenshots",
      testMatch: "screenshots.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    { name: "visual", testMatch: "visual.spec.ts", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: SERVER_KINDS.map(server),
});
