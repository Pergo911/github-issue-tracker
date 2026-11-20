// `npm run test:installer`: builds the installer, installs it silently into a temporary folder, launches the
// INSTALLED app through Playwright's Electron driver, screenshots it, and uninstalls it. Windows only, slow
// (the build compresses ~120 MB twice: several minutes), and it touches the machine: it installs under a
// throwaway appId and product name, so a real install of the shell is never touched, and it removes what it
// installed (the uninstaller, the shortcuts, the HKCU entry), also when a step fails.
//
// A packaged shell loads HTTPS only, so the check serves the real SPA (app/'s dev server, seeded) behind a local
// HTTPS proxy with a throwaway self-signed certificate, and starts the shell with --ignore-certificate-errors.
// That switch is the only difference from a Deployment; the shell itself has no test hook.
//
//   npm run test:installer                       build, install, check, uninstall
//   npm run test:installer -- --skip-build       reuse dist/ (needs HTTPS_PORT: the port its APP_URL was built with)
//   HTTPS_PORT=<n>                               pin the HTTPS port (the default is a free one)
//
// Screenshots go to .screenshots/installed/.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createNetServer, connect, type AddressInfo, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, type ElectronApplication } from "@playwright/test";

const shellRoot = resolve(import.meta.dirname, "..");
const productName = "ShellInstallCheck";
const appId = "test.shell.installcheck";
const skipBuild = process.argv.includes("--skip-build");

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})`);
}

function powershell(script: string): string {
  const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
  });
  return result.stdout.trim();
}

/** The ids of processes running a program from inside `directory` (found by path, never by image name). */
function processesUnder(directory: string): number[] {
  const out = powershell(
    `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${directory}', 'OrdinalIgnoreCase') } | ForEach-Object { $_.ProcessId }`,
  );
  return out.split(/\s+/).filter(Boolean).map(Number);
}

function killTree(pid: number) {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}

/** Is an uninstall entry for the throwaway product in this user's registry? */
function hasUninstallEntry(): boolean {
  const result = spawnSync(
    "reg",
    [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
      "/s",
      "/f",
      productName,
      "/d",
    ],
    { encoding: "utf8" },
  );
  return result.status === 0 && result.stdout.includes(productName);
}

/** A throwaway self-signed certificate for 127.0.0.1, made with the openssl that ships with Git for Windows. */
function makeCertificate(directory: string): { key: string; cert: string } {
  const key = join(directory, "key.pem");
  const cert = join(directory, "cert.pem");
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(`openssl could not make a certificate: ${result.stderr}`);
  return { key, cert };
}

/** HTTPS in front of the dev server: requests and WebSocket upgrades are passed through unchanged. */
async function startHttpsProxy(port: number, target: number, directory: string) {
  const { key, cert } = makeCertificate(directory);
  const server = createHttpsServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (req, res) => {
      const upstream = httpRequest(
        {
          host: "127.0.0.1",
          port: target,
          method: req.method,
          path: req.url,
          headers: req.headers,
        },
        (answer) => {
          res.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(res);
        },
      );
      upstream.on("error", () => res.writeHead(502).end());
      req.pipe(upstream);
    },
  );
  server.on("upgrade", (req, socket: Socket, head) => {
    const upstream = connect(target, "127.0.0.1", () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2)
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  return server;
}

const log = (message: string) => console.log(`\n== ${message}`);

if (process.platform !== "win32") {
  console.error("The installer check is Windows only.");
  process.exit(1);
}

const workDir = join(tmpdir(), `shell-installer-check-${process.pid}-${Date.now().toString(36)}`);
mkdirSync(workDir, { recursive: true });
const installDir = join(workDir, "installed");
const screenshots = join(shellRoot, ".screenshots", "installed");
mkdirSync(screenshots, { recursive: true });

let appServer: ChildProcess | undefined;
let proxy: Awaited<ReturnType<typeof startHttpsProxy>> | undefined;
let installed = false;
const apps: ElectronApplication[] = [];
let failure: unknown;

try {
  const httpsPort = process.env["HTTPS_PORT"]
    ? Number(process.env["HTTPS_PORT"])
    : await freePort();
  const appPort = await freePort();
  const appUrl = `https://127.0.0.1:${httpsPort}`;

  if (skipBuild) {
    if (!process.env["HTTPS_PORT"])
      throw new Error("--skip-build needs HTTPS_PORT, the port dist/ was built with");
  } else {
    log(`Building for ${appUrl}`);
    run(process.execPath, ["scripts/build.ts"], {
      cwd: shellRoot,
      env: { ...process.env, APP_URL: appUrl, APP_ID: appId, PRODUCT_NAME: productName },
    });
  }
  const setup = readdirSync(join(shellRoot, "dist")).find(
    (name) => name.endsWith(".exe") && name.includes("Setup"),
  );
  if (!setup) throw new Error("the build produced no installer");

  log("Serving the SPA behind local HTTPS");
  appServer = spawn(process.execPath, ["scripts/serve-app.ts"], {
    cwd: shellRoot,
    env: { ...process.env, APP_PORT: String(appPort), STATE_DIR: join(workDir, "app-state") },
    stdio: "inherit",
  });
  proxy = await startHttpsProxy(httpsPort, appPort, workDir);
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`http://127.0.0.1:${appPort}/`).catch(() => undefined);
    if (response?.ok) break;
    if (attempt > 120) throw new Error("the dev server did not start");
    await new Promise((done) => setTimeout(done, 1_000));
  }

  if (hasUninstallEntry())
    throw new Error(`${productName} is already installed on this machine; remove it first`);
  log(`Installing silently into ${installDir}`);
  installed = true;
  run(join(shellRoot, "dist", setup), ["/S", `/D=${installDir}`]);
  const exe = join(installDir, `${productName}.exe`);
  if (!existsSync(exe)) throw new Error(`the installer did not put ${exe} in place`);
  if (!hasUninstallEntry())
    throw new Error("the installer wrote no per-user uninstall entry (HKCU)");
  // A silent install may start the app afterwards: stop what it started, by PID.
  for (const pid of processesUnder(installDir)) killTree(pid);

  const launchEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[0] !== "ELECTRON_RUN_AS_NODE" && entry[1] !== undefined,
    ),
  );
  for (const colorScheme of ["light", "dark"] as const) {
    log(`Launching the installed app (${colorScheme})`);
    const app = await electron.launch({
      executablePath: exe,
      args: ["--ignore-certificate-errors"],
      colorScheme,
      env: launchEnv,
    });
    apps.push(app);
    const window = await app.firstWindow();
    const packaged = await app.evaluate(({ app }) => app.isPackaged);
    if (!packaged) throw new Error("the installed app is not packaged");
    await window.getByRole("heading", { level: 1 }).waitFor();
    if (!window.url().startsWith(appUrl))
      throw new Error(`the installed app loaded ${window.url()}`);
    await window.screenshot({ path: join(screenshots, `home--${colorScheme}.png`) });

    await window.getByRole("link", { name: /Munkatársi bejelentkezés/ }).click();
    await window.waitForURL(`${appUrl}/staff`);
    await window.getByRole("heading", { level: 1 }).waitFor();
    await window.screenshot({ path: join(screenshots, `staff-sign-in--${colorScheme}.png`) });
    await app.close();
    apps.pop();
  }
  console.log(`Screenshots: ${screenshots}`);
} catch (error) {
  failure = error;
} finally {
  for (const app of apps) await app.close().catch(() => {});
  if (installed) {
    log("Uninstalling");
    for (const pid of processesUnder(installDir)) killTree(pid);
    const uninstaller = join(installDir, `Uninstall ${productName}.exe`);
    if (existsSync(uninstaller)) {
      // `_?=` makes the uninstaller run in place and wait, instead of copying itself to TEMP and returning.
      spawnSync(uninstaller, ["/S", `_?=${installDir}`], { stdio: "inherit" });
    }
    const stillThere = existsSync(join(installDir, `${productName}.exe`));
    const entryLeft = hasUninstallEntry();
    if (stillThere || entryLeft) {
      failure ??= new Error(
        `uninstall left things behind: exe=${stillThere}, registry entry=${entryLeft}`,
      );
    } else {
      console.log("Uninstalled: the exe and the HKCU entry are gone.");
    }
  }
  proxy?.close();
  if (appServer?.pid) killTree(appServer.pid);
  // The dev server was killed a moment ago: Windows may hold its files for a little longer.
  try {
    rmSync(workDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 500 });
  } catch {
    console.warn(`Could not remove ${workDir}; delete it by hand.`);
  }
}

if (failure) {
  console.error(failure instanceof Error ? failure.message : failure);
  process.exit(1);
}
