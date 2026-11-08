import { createServer } from "node:net";
import { defineConfig } from "@playwright/test";

// The shell's end-to-end tests: Playwright's Electron driver against the real SPA and Worker (`app/`'s dev
// server, seeded). Run them with `npm test`. The port is picked once, free, and shared with the workers through
// the environment, so sibling worktrees never collide (AGENTS.md "Parallel runs").
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        address && typeof address !== "string"
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });

process.env["APP_PORT"] ??= String(await freePort());
const appUrl = `http://127.0.0.1:${process.env["APP_PORT"]}`;
process.env["APP_URL"] = appUrl;

export default defineConfig({
  testDir: "test/electron",
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  outputDir: ".tmp/test-results",
  webServer: {
    command: "node scripts/serve-app.ts",
    url: `${appUrl}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
