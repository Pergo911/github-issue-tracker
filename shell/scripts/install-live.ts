// Install the real Deployment build, capture it, then uninstall only what this run installed.
// Unlike installer-check.ts this uses the live HTTPS origin, with no certificate override or dev server.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "@playwright/test";

if (process.platform !== "win32") throw new Error("Windows is required");
const root = resolve(import.meta.dirname, "..");
const product = process.env["PRODUCT_NAME"] ?? "Hibabejelento";
if (!/^[A-Za-z0-9-]+$/.test(product)) throw new Error("PRODUCT_NAME must be a simple ASCII name");
const url = process.env["APP_URL"];
if (!url || new URL(url).protocol !== "https:")
  throw new Error("Set APP_URL to the live HTTPS origin");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  version: string;
};
const setup = join(root, "dist", `${product}-Setup-${version}.exe`);
if (!existsSync(setup)) throw new Error("Build the live installer first");

function hasUninstallEntry(): boolean {
  const registry = spawnSync(
    "reg",
    [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      "/s",
      "/f",
      product,
      "/d",
    ],
    { encoding: "utf8" },
  );
  return registry.status === 0 && registry.stdout.includes(product);
}

if (hasUninstallEntry()) throw new Error(`${product} is already installed; refusing to replace it`);
const directory = join(root, ".tmp", `live-install-${process.pid}-${Date.now()}`);
const screenshots = join(root, ".screenshots", "live-installed");
mkdirSync(screenshots, { recursive: true });
let app: ElectronApplication | undefined;
let installed = false;
let failure: unknown;

function stopInstalled() {
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${directory}', 'OrdinalIgnoreCase') } | ForEach-Object { $_.ProcessId }`,
    ],
    { encoding: "utf8" },
  );
  for (const pid of result.stdout.trim().split(/\s+/).filter(Boolean))
    spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
}

try {
  console.log("Installing the live Deployment build silently.");
  installed = true;
  const result = spawnSync(setup, ["/S", `/D=${directory}`], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Installer failed");
  stopInstalled();
  // Electron-based agent hosts may export this for their subprocesses. A real desktop launch
  // does not inherit it: it would run the installed application as Node rather than open a window.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== "ELECTRON_RUN_AS_NODE" && entry[1] !== undefined,
    ),
  );
  for (const colorScheme of ["light", "dark"] as const) {
    app = await electron.launch({
      executablePath: join(directory, `${product}.exe`),
      colorScheme,
      env: environment,
    });
    const window = await app.firstWindow();
    await window.getByRole("heading", { level: 1 }).waitFor();
    await window.waitForLoadState("networkidle");
    if (new URL(window.url()).origin !== new URL(url).origin)
      throw new Error("Installed app loaded the wrong origin");
    if (!(await app.evaluate(({ app }) => app.isPackaged)))
      throw new Error("Installed app is not packaged");
    await window.screenshot({ path: join(screenshots, `home--${colorScheme}.png`) });
    await app.close();
    app = undefined;
  }
  console.log(`Live installed app captured in ${screenshots}.`);
} catch (error) {
  failure = error;
} finally {
  await app?.close().catch(() => {});
  if (installed) {
    stopInstalled();
    const uninstaller = join(directory, `Uninstall ${product}.exe`);
    if (existsSync(uninstaller)) {
      const removed = spawnSync(uninstaller, ["/currentuser", "/S", `_?=${directory}`], {
        stdio: "inherit",
      });
      if (removed.status !== 0) failure ??= new Error("Uninstaller exited non-zero");
    }
    const exeLeft = existsSync(join(directory, `${product}.exe`));
    const entryLeft = hasUninstallEntry();
    if (exeLeft || entryLeft) {
      failure ??= new Error(
        `Uninstall left things behind: exe=${exeLeft}, registry entry=${entryLeft}`,
      );
    }
  }
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  } catch {
    console.warn(`Could not remove ${directory}; delete it by hand.`);
  }
}

if (failure) {
  console.error(failure instanceof Error ? failure.message : failure);
  process.exit(1);
}
