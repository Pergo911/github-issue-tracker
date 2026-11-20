import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getPlatformProxy } from "wrangler";
import { referenceConfig } from "../../src/shared/seed/reference-config.ts";

/** The app's root: where wrangler.jsonc lives, and the only place (besides the temp directory) state may live. */
export const APP_ROOT = resolve(import.meta.dirname, "..", "..");
const CONFIG_KEY = "config";

/**
 * Where local KV and Durable Object state lives. All of it stays inside the worktree and is git-ignored, so
 * sibling worktrees never share state: `PERSIST_DIR` overrides it (the end-to-end runner gives every run its
 * own), otherwise `.wrangler/state`. The dev server (vite.config.ts) reads the same variable.
 */
export function persistDirectory(environment: NodeJS.ProcessEnv = process.env): string {
  return resolve(APP_ROOT, environment["PERSIST_DIR"] ?? ".wrangler/state");
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

/** Deleting is only ever allowed inside this worktree or the system temp directory. */
export function assertDisposable(directory: string): void {
  const target = resolve(directory);
  if (!isInside(APP_ROOT, target) && !isInside(resolve(tmpdir()), target)) {
    throw new Error(
      `Refusing to delete ${target}: it is outside the worktree and the temp directory`,
    );
  }
}

/** The slice of the local Worker environment this script uses. (The Workers runtime types are not loaded here.) */
interface LocalBindings {
  KV: {
    get(key: string, type: "json"): Promise<unknown>;
    put(key: string, value: string): Promise<void>;
  };
}

async function withLocalEnv<T>(
  persistDir: string,
  use: (env: LocalBindings) => Promise<T>,
): Promise<T> {
  // Wrangler warns that the Durable Object gates "will not work" in this KV-only proxy. True, and irrelevant.
  process.env["WRANGLER_LOG"] ??= "error";
  const proxy = await getPlatformProxy<LocalBindings>({
    configPath: resolve(APP_ROOT, "wrangler.jsonc"),
    // getPlatformProxy uses this path as is, while the Vite plugin keeps its state in <path>/v3.
    persist: { path: join(persistDir, "v3") },
  });
  try {
    return await use(proxy.env);
  } finally {
    await proxy.dispose();
  }
}

/** Writes the SPEC Appendix A configuration (Hungarian, Europe/Budapest) into local KV. */
export async function seedLocalConfig(persistDir: string = persistDirectory()): Promise<void> {
  await withLocalEnv(persistDir, (env) => env.KV.put(CONFIG_KEY, JSON.stringify(referenceConfig)));
}

/** The stored config key as the Worker would see it, or `null` when there is none. */
export async function readLocalConfig(persistDir: string = persistDirectory()): Promise<unknown> {
  if (!existsSync(persistDir)) return null;
  return withLocalEnv(persistDir, (env) => env.KV.get(CONFIG_KEY, "json"));
}

/** Clears all local state: KV, Durable Objects, rate-limit counters, everything under the state directory. */
export function resetLocalState(persistDir: string = persistDirectory()): void {
  assertDisposable(persistDir);
  rmSync(persistDir, { recursive: true, force: true });
}
