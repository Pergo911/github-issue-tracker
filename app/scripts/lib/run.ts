import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { createRequire } from "node:module";
import { join } from "node:path";
import { APP_ROOT, seedLocalConfig } from "./state.ts";

/** `n` distinct free TCP ports. All are held open together, so two calls cannot return the same port. */
export async function freePorts(count: number): Promise<number[]> {
  const servers: Server[] = [];
  const ports: number[] = [];
  try {
    for (let index = 0; index < count; index++) {
      const server = createServer();
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      servers.push(server);
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port was assigned");
      ports.push(address.port);
    }
    return ports;
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

/** A private working area for one run: free ports for the three local servers, and state nobody else touches. */
export interface Run {
  directory: string;
  /** What `playwright.config.ts` and the servers read: ports, run directory. */
  env: Record<string, string>;
  cleanup(): void;
}

export async function prepareRun(): Promise<Run> {
  const [seeded, empty, setup, seededFakes, emptyFakes, setupFakes] = await freePorts(6);
  const directory = join(APP_ROOT, ".tmp", `run-${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(directory, { recursive: true });
  // The seeded server's state holds the Appendix A configuration; the empty and setup ones start with none.
  await seedLocalConfig(join(directory, "state-seeded"));
  return {
    directory,
    env: {
      E2E_PORT_SEEDED: String(seeded),
      E2E_PORT_EMPTY: String(empty),
      E2E_PORT_SETUP: String(setup),
      E2E_FAKES_PORT_SEEDED: String(seededFakes),
      E2E_FAKES_PORT_EMPTY: String(emptyFakes),
      E2E_FAKES_PORT_SETUP: String(setupFakes),
      E2E_RUN_DIR: directory,
    },
    cleanup: () => {
      // On Windows the dev servers' workerd can hold files for a moment after Playwright exits (EPERM).
      // Retry, then leave the git-ignored scratch folder behind: it must never change the run's result.
      try {
        rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch {
        console.warn(`could not remove ${directory}; delete it by hand`);
      }
    },
  };
}

/** Runs `playwright test` with the given arguments and environment, resolving with its exit code. */
export function runPlaywright(
  args: string[],
  environment: Record<string, string>,
): Promise<number> {
  const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "test", ...args], {
      cwd: APP_ROOT,
      stdio: "inherit",
      env: { ...process.env, ...environment },
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
