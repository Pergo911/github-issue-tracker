// Install the real Deployment build, capture it, then uninstall only what this run installed.
// Unlike installer-check.ts this uses the live HTTPS origin, with no certificate override or dev server.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
if (registry.status === 0 && registry.stdout.includes(product))
  throw new Error(`${product} is already installed; refusing to replace it`);
const directory = join(root, ".tmp", `live-install-${process.pid}-${Date.now()}`);
const screenshots = join(root, ".screenshots", "live-installed");
mkdirSync(screenshots, { recursive: true });
let app: ElectronApplication | undefined;

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
  const installed = spawnSync(setup, ["/S", `/D=${directory}`], { stdio: "inherit" });
  if (installed.status !== 0) throw new Error("Installer failed");
  stopInstalled();
  // Electron-based agent hosts may export this for their subprocesses. A real desktop launch
  // does not inherit it: it would run the installed application as Node rather than open a window.
  const environment = { ...process.env };
  delete environment["ELECTRON_RUN_AS_NODE"];
  for (const colorScheme of ["light", "dark"] as const) {
    app = await electron.launch({ executablePath: join(directory, `${product}.exe`), colorScheme, env: environment });
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
} finally {
  await app?.close().catch(() => {});
  stopInstalled();
  const uninstaller = join(directory, `Uninstall ${product}.exe`);
  if (existsSync(uninstaller)) {
    const removed = spawnSync(uninstaller, ["/currentuser", "/S", `_?=${directory}`], { stdio: "inherit" });
    if (removed.status !== 0 || existsSync(join(directory, `${product}.exe`)))
      throw new Error("Uninstall did not complete");
  }
}
