import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { createRequire } from "node:module";
import { join } from "node:path";
import { SERVER_KINDS, type ServerKind } from "../../e2e/support/servers.ts";
import { APP_ROOT, seedLocalConfig } from "./state.ts";

/** Per-worktree warm Vite dep cache copied into each server's private dir so runs skip cold dep bundling. */
const WARM_VITE_CACHE = join(APP_ROOT, ".tmp", "vite-cache-e2e");

function depCacheHash(directory: string): string | null {
  const metadata = join(directory, "deps", "_metadata.json");
  if (!existsSync(metadata)) return null;
  try {
    const parsed = JSON.parse(readFileSync(metadata, "utf8")) as { hash?: unknown };
    return typeof parsed.hash === "string" ? parsed.hash : null;
  } catch {
    return null;
  }
}

function seedViteCache(target: string): void {
  if (depCacheHash(WARM_VITE_CACHE) === null) return;
  try {
    cpSync(WARM_VITE_CACHE, target, { recursive: true });
  } catch {
    // A missing or mid-update cache is safe to ignore: Vite simply builds a fresh one.
  }
}

function publishViteCache(source: string): void {
  const sourceHash = depCacheHash(source);
  if (sourceHash === null || sourceHash === depCacheHash(WARM_VITE_CACHE)) return;
  const staging = `${WARM_VITE_CACHE}-staging-${process.pid}-${Date.now().toString(36)}`;
  try {
    cpSync(source, staging, { recursive: true });
    rmSync(WARM_VITE_CACHE, { recursive: true, force: true });
    renameSync(staging, WARM_VITE_CACHE);
  } catch {
    rmSync(staging, { recursive: true, force: true });
  }
}

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

/** A private working area for one run: free ports for the requested local servers, and state nobody else touches. */
export interface Run {
  directory: string;
  /** What `playwright.config.ts` and the servers read: ports, server list, run directory. */
  env: Record<string, string>;
  cleanup(): void;
}

export async function prepareRun(kinds: readonly ServerKind[] = SERVER_KINDS): Promise<Run> {
  const ports = await freePorts(kinds.length * 2);
  const directory = join(APP_ROOT, ".tmp", `run-${process.pid}-${Date.now().toString(36)}`);
  mkdirSync(directory, { recursive: true });
  if (kinds.includes("seeded")) {
    // The seeded server's state holds the Appendix A configuration; the empty and setup ones start with none.
    await seedLocalConfig(join(directory, "state-seeded"));
  }
  const env: Record<string, string> = {
    E2E_SERVERS: kinds.join(","),
    E2E_RUN_DIR: directory,
  };
  for (let index = 0; index < kinds.length; index++) {
    const kind = kinds[index] as ServerKind;
    const upper = kind.toUpperCase();
    env[`E2E_PORT_${upper}`] = String(ports[index * 2]);
    env[`E2E_FAKES_PORT_${upper}`] = String(ports[index * 2 + 1]);
    seedViteCache(join(directory, `vite-cache-${kind}`));
  }
  const cacheSource = join(directory, `vite-cache-${kinds[0] as ServerKind}`);
  return {
    directory,
    env,
    cleanup: () => {
      publishViteCache(cacheSource);
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
