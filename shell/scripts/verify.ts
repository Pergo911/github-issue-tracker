// `npm run verify`: every check of the shell, in order, red on any failure.
//
//   npm run verify                 typecheck, format, unit tests, Electron-driver tests (about a minute)
//   npm run verify -- --installer  also builds the installer and installs, launches and uninstalls it
//                                  (several minutes; Windows only; see scripts/installer-check.ts)
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const shellRoot = resolve(import.meta.dirname, "..");
const steps = ["typecheck", "format:check", "test:unit", "test:e2e"];
if (process.argv.includes("--installer")) steps.push("test:installer");

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const results: { step: string; ok: boolean; seconds: number }[] = [];
for (const step of steps) {
  console.log(`\n=== ${step}`);
  const started = Date.now();
  const run = spawnSync(npm, ["run", "--silent", step], {
    cwd: shellRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  results.push({ step, ok: run.status === 0, seconds: Math.round((Date.now() - started) / 1000) });
}

console.log("\n=== shell verify");
for (const { step, ok, seconds } of results) {
  console.log(`${ok ? "pass" : "FAIL"}  ${step}  (${seconds}s)`);
}
process.exit(results.every((result) => result.ok) ? 0 : 1);
