# shell: the Windows desktop app

A thin Electron wrapper that opens the hosted SPA in a window (`SPEC.md` §2.1, ADR 0001). It is its own
package and shares no code with `app/`. The SPA has no shell-specific code, so the website and the app are
the same pages.

What it does, and nothing more:

- loads one URL, `APP_URL`, and keeps navigation on that origin;
- sends `target="_blank"` links and `window.open` to the system browser (`shell.openExternal`) and never opens
  a second window: Status links and the GitHub device-flow page open there;
- keeps Electron's secure defaults (context isolation, sandbox, no Node integration, **no preload script**) and
  denies every permission request;
- shows a plain error page, not a blank window, when the site cannot be reached.

A packaged build accepts **HTTPS only**. An unpackaged `npm start` also accepts `http://localhost`,
`http://127.0.0.1` and `http://[::1]`, for the dev loop.

## The dev loop

Run everything from `shell/`, with npm. `npm install` once. Electron's binary downloads from github.com the first
time it starts.

```powershell
# terminal 1: the SPA and Worker (see ../AGENTS.md)
cd ../app; npm run seed; npm run dev        # note the port it prints, 5173 by default

# terminal 2: the shell
$env:APP_URL = "http://localhost:5173"; npm start
```

(Git Bash: `APP_URL=http://localhost:5173 npm start`.) Without `APP_URL` the shell stops with a message
saying so.

## Build the installer for a Deployment

```powershell
$env:APP_URL = "https://<the Deployment's workers.dev address>"; npm run build
```

`dist/` then holds an unsigned **per-user** NSIS installer (no admin rights, one click, no wizard),
`<productName>-Setup-<version>.exe`, and a **portable** `<productName>-<version>-portable.exe`. The first build
downloads Electron and the NSIS tools from github.com; the build compresses about 120 MB, so allow a few minutes.
Windows shows a SmartScreen warning for an unsigned installer: "More info", then "Run anyway" (accepted, SPEC §2.1).

`APP_URL` is required, must be HTTPS, and is baked into the packaged `package.json` (`extraMetadata.appUrl`):
one build per Deployment. Two optional variables keep two Deployments' installs apart:

| Variable       | Default                  | Meaning                                                                                                                            |
| -------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ID`       | `app.faultreports.shell` | The Windows app identity. The uninstall entry derives from it, so changing it later stops an upgrade from finding the old install. |
| `PRODUCT_NAME` | `Hibabejelento`          | Install folder, shortcut and exe name. Keep it ASCII.                                                                              |

The configuration is `electron-builder.config.cjs` (logic in `scripts/builder-config.cjs`). Versions of
`electron` and `electron-builder` are pinned exactly.

## Checks

| Command                  | What it checks                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run verify`         | typecheck, Prettier, unit tests and the Electron-driver tests (about a minute)                                                                                                           |
| `npm run test:unit`      | the URL rule, the navigation policy, the secure web preferences, the builder config                                                                                                      |
| `npm run test:e2e`       | Playwright's Electron driver against the real SPA: home page, secure preferences, `target="_blank"` and `window.open` to the system browser, off-origin navigation and redirects blocked |
| `npm run test:installer` | **slow, Windows only.** Builds, installs silently into a temp folder, launches the installed app, screenshots it, uninstalls. `verify -- --installer` runs it too.                       |

`test:e2e` needs `app/` installed (`npm ci` in `app/`): it starts that package's dev server, seeded, on a free
port and in a private state directory, and stops it afterwards. Nothing uses a fixed port.

`test:installer` serves the SPA behind a local HTTPS proxy with a throwaway self-signed certificate (a packaged
build loads HTTPS only) and starts the installed app with `--ignore-certificate-errors`. It installs under a
throwaway `appId` and product name, so a real install is untouched, and it removes what it installed. Its
screenshots are in `.screenshots/installed/`.
