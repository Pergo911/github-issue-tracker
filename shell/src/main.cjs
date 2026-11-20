// @ts-check
// The desktop shell (SPEC 2.1): one window around the hosted SPA. No preload script, no native APIs for the
// page, links that leave the app go to the system browser. The SPA has no shell-specific code.
const path = require("node:path");
const { app, BrowserWindow, Menu, dialog, session, shell } = require("electron");
const { resolveAppUrl } = require("./app-url.cjs");
const { externalUrlToOpen, isAppUrl } = require("./navigation.cjs");
const { webPreferences } = require("./web-preferences.cjs");

/** The address the shell loads, or a message to show instead. */
function readTarget() {
  const packageJson = /** @type {{ appUrl?: string }} */ (
    require(path.join(app.getAppPath(), "package.json"))
  );
  return resolveAppUrl({
    isPackaged: app.isPackaged,
    metadataUrl: packageJson.appUrl,
    environmentUrl: process.env["APP_URL"],
  });
}

/**
 * Applies the navigation rules to every web contents the app ever makes (SPEC 2.1).
 * @param {string} appOrigin
 */
function guardNavigation(appOrigin) {
  app.on("web-contents-created", (_event, contents) => {
    // target="_blank", window.open, shift-click: never a window of ours, the system browser instead.
    contents.setWindowOpenHandler(({ url }) => {
      const external = externalUrlToOpen(url);
      if (external !== null) {
        // Not inside the handler: the docs do this after it returns.
        setImmediate(() => {
          shell.openExternal(external).catch(() => {});
        });
      }
      return { action: "deny" };
    });

    /** @param {{ url: string, preventDefault(): void }} details */
    const stayInApp = (details) => {
      if (!isAppUrl(details.url, appOrigin)) details.preventDefault();
    };
    contents.on("will-navigate", stayInApp);
    contents.on("will-redirect", stayInApp); // a server redirect off the origin is not a will-navigate
    contents.on("will-frame-navigate", stayInApp);
  });
}

/**
 * A plain page for an unreachable site: the SPA is not there to show its own.
 * @param {string} url
 */
function unreachablePage(url) {
  const html = `<!doctype html><meta charset="utf-8"><title>Unavailable</title>
<style>:root{color-scheme:light dark}body{font:16px system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem}</style>
<h1>Nem érhető el a szolgáltatás</h1>
<p>The service cannot be reached. Check the internet connection, then try again.</p>
<p><a href="${encodeURI(url)}">Újrapróbálás / Try again</a></p>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** @param {{ url: string }} target */
function openWindow(target) {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    show: false,
    webPreferences,
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.on("did-fail-load", (_event, code, _description, failedUrl, isMainFrame) => {
    // -3 is a navigation that was cancelled (a blocked one, a click during a load), not a failure.
    if (isMainFrame && code !== -3 && !failedUrl.startsWith("data:")) {
      void window.loadURL(unreachablePage(target.url));
    }
  });
  void window.loadURL(target.url);
  return window;
}

void app.whenReady().then(() => {
  /** @type {{ url: string, origin: string }} */
  let target;
  try {
    target = readTarget();
  } catch (error) {
    dialog.showErrorBox("Cannot start", error instanceof Error ? error.message : String(error));
    app.quit();
    return;
  }

  // Electron grants every permission request unless told otherwise. The page asks for none.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  if (app.isPackaged) Menu.setApplicationMenu(null);
  guardNavigation(target.origin);
  openWindow(target);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow(target);
  });
});

app.on("window-all-closed", () => app.quit());
