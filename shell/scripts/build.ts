// `APP_URL=https://<deployment> npm run build`: the unsigned per-user installer and the portable exe, in dist/,
// for one Deployment. APP_ID and PRODUCT_NAME are optional (see scripts/builder-config.cjs).
// PowerShell: `$env:APP_URL = "https://..."; npm run build`.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { createBuilderConfig } from "./builder-config.cjs";

const shellRoot = resolve(import.meta.dirname, "..");

// Fails here, before any download, when APP_URL is missing or not HTTPS.
try {
  createBuilderConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// An old build must not be mistaken for this one.
rmSync(join(shellRoot, "dist"), { recursive: true, force: true });

const cli = createRequire(import.meta.url).resolve("electron-builder/cli.js");
const child = spawn(
  process.execPath,
  [cli, "--win", "--config", "electron-builder.config.cjs", ...process.argv.slice(2)],
  { cwd: shellRoot, stdio: "inherit", env: process.env },
);
child.once("exit", (code) => process.exit(code ?? 1));
