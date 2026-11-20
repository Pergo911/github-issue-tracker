// Serves the real SPA and Worker for the shell's tests: `app/`'s own Vite dev server, seeded with the reference
// configuration, on a port and in a state directory nobody else uses. It runs in this process, so stopping the
// process (Playwright's webServer does) stops the server, and nothing is left behind to hunt by image name.
//
//   APP_PORT   required: the port to listen on (strict: it fails if the port is taken).
//   STATE_DIR  optional: where the local KV state goes; default is a fresh directory under .tmp/.
//
// Needs `app/` installed (`npm ci` in app/). The shell shares no code with `app/`; this only drives its CLI.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const shellRoot = resolve(import.meta.dirname, "..");
const appRoot = resolve(shellRoot, "..", "app");
const port = Number(process.env["APP_PORT"]);
if (!Number.isInteger(port) || port <= 0) throw new Error("APP_PORT is not set to a port number");

let require: NodeJS.Require;
try {
  require = createRequire(join(appRoot, "package.json"));
  require.resolve("vite");
} catch {
  throw new Error(
    "app/ is not installed. Run `npm ci` in app/ first: the shell tests serve the real SPA.",
  );
}

const stateDir =
  process.env["STATE_DIR"] ??
  join(shellRoot, ".tmp", `app-${process.pid}-${Date.now().toString(36)}`);
mkdirSync(stateDir, { recursive: true });
const environment = {
  ...process.env,
  PERSIST_DIR: stateDir,
  VITE_CACHE_DIR: join(stateDir, "vite"),
};

const seed = spawnSync(process.execPath, [join(appRoot, "scripts", "seed.ts")], {
  cwd: appRoot,
  env: { ...environment, WRANGLER_LOG: "error" },
  stdio: "inherit",
});
if (seed.status !== 0) throw new Error("seeding app/ failed");

Object.assign(process.env, environment);
process.chdir(appRoot);
// app/'s own Vite, typed by the two calls this file makes (the shell does not depend on vite).
interface ViteServer {
  listen(): Promise<unknown>;
  printUrls(): void;
  close(): Promise<void>;
}
const { createServer } = (await import(pathToFileURL(require.resolve("vite")).href)) as {
  createServer(config: object): Promise<ViteServer>;
};
const server = await createServer({
  root: appRoot,
  server: { port, strictPort: true, host: "127.0.0.1" },
});
await server.listen();
server.printUrls();

const stop = async () => {
  await server.close();
  rmSync(stateDir, { recursive: true, force: true });
  process.exit(0);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
