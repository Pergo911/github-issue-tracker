// `npm run test:visual`: compare every declared screen (e2e/screens.ts) with its committed reference image
// (e2e/reference/), rendered in Playwright's Docker image: the same one CI uses, so the pixels agree.
// `npm run test:visual:update`: write new and changed reference images. Deliberate by design:
//   1. run test:visual, 2. open every image in .screenshots/diffs/index.html (actual, expected, diff),
//   3. only if each change is intended, run test:visual:update and commit the changed e2e/reference/*.png.
// The browser runs in a container (Playwright's `run-server`, with only `playwright-core` mounted read-only so
// no npm download happens at runtime); the dev servers and the test runner stay on the host, and the container
// reaches them through Playwright's own tunnel (`exposeNetwork`), so no workspace state is mounted, no host port
// is fixed and the container name is unique per run. Inside Playwright's container in CI (`VISUAL_IN_CONTAINER=1`
// or `--no-docker`), the suite drives the container's own browser directly without Docker-in-Docker.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative } from "node:path";
import { randomBytes } from "node:crypto";
import { hasWorkersFlag, machinePlaywrightWorkers } from "./lib/jobs.ts";
import { prepareRun, runPlaywright } from "./lib/run.ts";
import { APP_ROOT } from "./lib/state.ts";

const update = process.argv.includes("--update");
const inContainer =
  process.argv.includes("--no-docker") || process.env["VISUAL_IN_CONTAINER"] === "1";
const extra = process.argv
  .slice(2)
  .filter((argument) => argument !== "--update" && argument !== "--no-docker");
const workers = machinePlaywrightWorkers("VISUAL_WORKERS");
const workerArgs = hasWorkersFlag(extra) ? [] : [`--workers=${workers}`];

const require = createRequire(import.meta.url);
const { version } = require("@playwright/test/package.json") as { version: string };
const playwrightCoreDir = dirname(require.resolve("playwright-core/package.json"));
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const name = `reports-visual-${randomBytes(4).toString("hex")}`;

function docker(...args: string[]) {
  return spawnSync("docker", args, { encoding: "utf8" });
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(description: string, check: () => boolean, seconds: number): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(1000);
  }
  throw new Error(`Timed out after ${seconds}s waiting for ${description}`);
}

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/** Copies Playwright's actual/expected/diff images to .screenshots/diffs/ with an index page to browse them. */
function collectDiffs(testResults: string): string | null {
  const images = listFiles(testResults).filter((file) =>
    /-(actual|expected|diff)\.png$/.test(file),
  );
  if (images.length === 0) return null;
  const output = join(APP_ROOT, ".screenshots", "diffs");
  rmSync(output, { recursive: true, force: true });
  const cases = new Map<string, string[]>();
  for (const file of images) {
    const testName = basename(dirname(file));
    const target = join(output, testName, basename(file));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target);
    cases.set(testName, [
      ...(cases.get(testName) ?? []),
      relative(output, target).replace(/\\/g, "/"),
    ]);
  }
  const sections = [...cases]
    .map(
      ([testName, files]) =>
        `<section><h2>${testName}</h2><div>${files
          .sort()
          .map(
            (file) =>
              `<figure><figcaption>${basename(file)}</figcaption><img src="${file}" alt=""></figure>`,
          )
          .join("")}</div></section>`,
    )
    .join("\n");
  writeFileSync(
    join(output, "index.html"),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Visual differences</title><style>body{font:14px system-ui;margin:24px}div{display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start}figure{margin:0}img{max-width:420px;border:1px solid #888;display:block}</style></head><body><h1>Visual differences</h1><p>actual = what rendered now, expected = the committed reference, diff = the changed pixels.</p>${sections}</body></html>`,
  );
  return join(output, "index.html");
}

if (!inContainer && docker("info").status !== 0) {
  console.log("Waiting for the Docker daemon (is Docker Desktop running?) ...");
  try {
    await waitFor("the Docker daemon", () => docker("info").status === 0, 10);
  } catch {
    console.error(
      "Docker is not available. The reference screenshots need it: start Docker Desktop and retry.",
    );
    process.exit(2);
  }
}

const run = await prepareRun(["seeded", "empty"]);
let code: number;
try {
  const extraEnv: Record<string, string> = {
    ...run.env,
    ...(update ? { UPDATE_SNAPSHOTS: "1" } : {}),
  };
  if (!inContainer) {
    console.log(`Starting ${image} as ${name} ...`);
    const started = docker(
      "run",
      "-d",
      "--rm",
      "--init",
      "--ipc=host",
      "--name",
      name,
      "-p",
      "127.0.0.1::3000",
      // Mount only the pure-JS playwright-core package read-only so the container skips `npx -y` downloads.
      "-v",
      `${playwrightCoreDir}:/pw:ro`,
      image,
      "node",
      "/pw/cli.js",
      "run-server",
      "--port",
      "3000",
      "--host",
      "0.0.0.0",
    );
    if (started.status !== 0) throw new Error(`docker run failed: ${started.stderr}`);
    await waitFor(
      "the Playwright server in the container",
      () => docker("logs", name).stdout.includes("Listening on"),
      180,
    );
    const mapping = docker("port", name, "3000/tcp").stdout.trim().split("\n")[0] ?? "";
    const port = /:(\d+)$/.exec(mapping)?.[1];
    if (!port) throw new Error(`could not find the published port in "${mapping}"`);
    extraEnv["PW_DOCKER_WS_ENDPOINT"] = `ws://127.0.0.1:${port}/`;
  }

  code = await runPlaywright(["--project=visual", ...workerArgs, ...extra], extraEnv);
  const diffs = collectDiffs(join(run.directory, "test-results"));
  if (!update && diffs) {
    console.error(
      `\nVisual differences: open ${diffs}\nIf every change is intended: npm run test:visual:update`,
    );
  }
  if (update) {
    console.log(
      "\nReference images updated. Open every changed image under e2e/reference/ before you commit it.",
    );
  }
} finally {
  if (!inContainer) docker("rm", "-f", name);
  run.cleanup();
}
process.exit(code);
