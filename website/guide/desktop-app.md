# Windows Desktop App

Issue Tracker ships an optional thin **Windows Electron shell** (`shell/`) that opens a Deployment's hosted HTTPS URL in a native desktop window. It shares no code with `app/`, and the SPA contains no shell-specific logic — the web app and desktop app render the exact same screens.

## How the shell works

- **Single-origin window:** Loads the configured `APP_URL` and keeps in-window navigation locked to that origin.
- **External links open in the system browser:** Any `target="_blank"` link or `window.open` call opens in Windows' default browser instead of spawning a second Electron window. This means:
  - **Status links** on the confirmation screen open in the browser where Reporters can bookmark them.
  - **GitHub Device Flow** sign-in opens in the browser where passkeys, 2FA, and existing GitHub sessions work reliably.
- **Hardened defaults:** Context isolation and sandbox stay enabled, Node integration stays disabled, **no preload script** is attached, and all browser permission prompts are denied.
- **Offline fallback:** If the hosted Deployment cannot be reached, the window shows a plain error page instead of a blank screen.
- **HTTPS-only in packaged builds:** Packaged executables accept `https://` origins only. Unpackaged `npm start` also allows `http://localhost`, `http://127.0.0.1`, and `http://[::1]` for local development.

## Installing on Windows

Each Deployment builds two unsigned executables in `shell/dist/`:

- **`<ProductName>-Setup-<version>.exe`** — a one-click, **per-user NSIS installer** (no Windows administrator rights required, no wizard steps).
- **`<ProductName>-<version>-portable.exe`** — a standalone portable executable that runs without installing.

::: warning Windows SmartScreen notice
Because the reference executables are unsigned, Windows Defender SmartScreen displays an "Unknown publisher" prompt on first launch. Click **More info**, then **Run anyway**.
:::

## Building for your Deployment

Each Organization builds its own Windows executable baked with its Deployment's `APP_URL` (`extraMetadata.appUrl` inside the packaged app). Run from `shell/` in PowerShell (requires Node 24+ and npm):

```powershell
cd shell
npm ci

$env:APP_URL = "https://<your-worker>.<your-subdomain>.workers.dev"
$env:APP_ID = "org.example.faultreports"
$env:PRODUCT_NAME = "ExampleReports"

npm run build
```

### Build variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `APP_URL` | Yes | — | Target Deployment HTTPS URL baked into the build. |
| `APP_ID` | No | `app.faultreports.shell` | Windows application & uninstall identity. Keep stable across upgrades, and set a distinct value per Deployment so installs do not overwrite one another. |
| `PRODUCT_NAME` | No | `Hibabejelento` | Install directory, Start menu shortcut, and executable filename prefix. Keep ASCII. |

The first build downloads Electron and NSIS packaging tools from GitHub and compresses ~120 MB, so allow a few minutes.

## Verifying the shell

Run from `shell/`:

| Command | What it verifies |
| --- | --- |
| `npm run verify` | Typecheck, Prettier formatting, unit tests (URL rules, navigation policy, secure preferences, builder config), and Electron Playwright tests against `app/`'s dev server. |
| `npm run test:installer` | *(Windows only, slower)* Builds the installer, installs it silently into a temporary directory, launches the installed app against a local HTTPS proxy, captures screenshots, and uninstalls cleanly. |
