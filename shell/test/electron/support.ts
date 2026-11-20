import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { resolve } from "node:path";

export const shellRoot = resolve(import.meta.dirname, "..", "..");

/** The address of the dev server `playwright.config.ts` started (the shell is pointed at it by APP_URL). */
export function appUrl(): string {
  const url = process.env["APP_URL"];
  if (!url) throw new Error("APP_URL is not set. Run the shell tests with `npm test`.");
  return url;
}

export interface Launched {
  app: ElectronApplication;
  window: Page;
}

/** Starts the unpackaged shell (`electron .`), pointed at `url`, and waits for its window. */
export async function launchShell(
  options: { url?: string; colorScheme?: "light" | "dark" } = {},
): Promise<Launched> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    // NODE_OPTIONS and an Electron host's ELECTRON_RUN_AS_NODE would break Electron's start.
    if (value !== undefined && name !== "NODE_OPTIONS" && name !== "ELECTRON_RUN_AS_NODE") {
      environment[name] = value;
    }
  }
  const app = await electron.launch({
    args: ["."],
    cwd: shellRoot,
    env: { ...environment, APP_URL: options.url ?? appUrl() },
    colorScheme: options.colorScheme ?? "light",
  });
  const window = await app.firstWindow();
  return { app, window };
}

/**
 * Replaces `shell.openExternal` in the main process with a recorder, so a test sees what the shell would have
 * opened in the system browser, and nothing really opens.
 */
export async function stubOpenExternal(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ shell }) => {
    const record: string[] = [];
    (globalThis as { __opened?: string[] }).__opened = record;
    shell.openExternal = (url: string) => {
      record.push(url);
      return Promise.resolve();
    };
  });
  return () => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? []);
}
