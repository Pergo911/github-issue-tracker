// @ts-check
// The desktop shell (SPEC 2.1): one window around the hosted SPA. No preload script, no native APIs for the
// page, links that leave the app go to the system browser. The SPA has no shell-specific code.
const path = require("node:path");
const { app, BrowserWindow, Menu, dialog, session, shell } = require("electron");
const { resolveAppUrl } = require("./app-url.cjs");
const {
  MENU_IDS,
  appCommandAction,
  canNavigateHistory,
  createApplicationMenuTemplate,
  createContextMenuTemplate,
  shortcutActionForInput,
} = require("./menu.cjs");
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

/**
 * Resolves a live BrowserWindow from a menu click target, the focused window, or the first open window.
 * @param {import("electron").BaseWindow | undefined} candidate
 * @returns {BrowserWindow | null}
 */
function resolveWindow(candidate) {
  if (candidate instanceof BrowserWindow && !candidate.isDestroyed()) return candidate;
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null;
}

/**
 * @param {import("electron").BaseWindow | undefined} candidate
 * @returns {import("electron").WebContents | null}
 */
function resolveWebContents(candidate) {
  const win = resolveWindow(candidate);
  return win && !win.webContents.isDestroyed() ? win.webContents : null;
}

/**
 * @param {import("electron").WebContents} contents
 * @param {string} appOrigin
 */
function goBack(contents, appOrigin) {
  if (
    !contents.isDestroyed() &&
    canNavigateHistory(contents.navigationHistory, "back", appOrigin)
  ) {
    contents.navigationHistory.goBack();
  }
}

/**
 * @param {import("electron").WebContents} contents
 * @param {string} appOrigin
 */
function goForward(contents, appOrigin) {
  if (
    !contents.isDestroyed() &&
    canNavigateHistory(contents.navigationHistory, "forward", appOrigin)
  ) {
    contents.navigationHistory.goForward();
  }
}

/**
 * @param {import("electron").WebContents} contents
 * @param {{ url: string }} target
 */
function goHome(contents, target) {
  if (!contents.isDestroyed()) {
    void contents.loadURL(target.url);
  }
}

/**
 * Reloads the current page, or returns to `target.url` if the window is showing the offline error page.
 * @param {import("electron").WebContents} contents
 * @param {{ url: string, origin: string }} target
 * @param {boolean} ignoreCache
 */
function reloadPage(contents, target, ignoreCache) {
  if (contents.isDestroyed()) return;
  if (!isAppUrl(contents.getURL(), target.origin)) {
    void contents.loadURL(target.url);
    return;
  }
  if (ignoreCache) contents.reloadIgnoringCache();
  else contents.reload();
}

/**
 * Synchronizes Back and Forward menu item enabled state with `contents` history.
 * @param {import("electron").WebContents | null} contents
 * @param {string} appOrigin
 */
function syncNavigationMenu(contents, appOrigin) {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const backItem = menu.getMenuItemById(MENU_IDS.back);
  const forwardItem = menu.getMenuItemById(MENU_IDS.forward);
  const liveContents = contents !== null && !contents.isDestroyed() ? contents : null;
  if (backItem) {
    backItem.enabled =
      liveContents !== null &&
      canNavigateHistory(liveContents.navigationHistory, "back", appOrigin);
  }
  if (forwardItem) {
    forwardItem.enabled =
      liveContents !== null &&
      canNavigateHistory(liveContents.navigationHistory, "forward", appOrigin);
  }
}

/**
 * Installs the application menu for both packaged and unpackaged builds.
 * @param {{ url: string, origin: string }} target
 */
function installApplicationMenu(target) {
  const template = createApplicationMenuTemplate({
    isPackaged: app.isPackaged,
    actions: {
      goBack: (win) => {
        const contents = resolveWebContents(win);
        if (contents) goBack(contents, target.origin);
      },
      goForward: (win) => {
        const contents = resolveWebContents(win);
        if (contents) goForward(contents, target.origin);
      },
      goHome: (win) => {
        const contents = resolveWebContents(win);
        if (contents) goHome(contents, target);
      },
      reload: (win) => {
        const contents = resolveWebContents(win);
        if (contents) reloadPage(contents, target, false);
      },
      forceReload: (win) => {
        const contents = resolveWebContents(win);
        if (contents) reloadPage(contents, target, true);
      },
    },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** @param {{ url: string, origin: string }} target */
function openWindow(target) {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    icon: path.join(__dirname, "..", "assets", "icon.ico"),
    show: false,
    webPreferences,
  });

  const syncIfActive = () => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    const active = resolveWindow(undefined);
    if (active !== null && active !== window) return;
    syncNavigationMenu(window.webContents, target.origin);
  };

  window.once("ready-to-show", () => window.show());
  window.webContents.on("did-navigate", syncIfActive);
  window.webContents.on("did-navigate-in-page", (_event, _url, isMainFrame) => {
    if (isMainFrame) syncIfActive();
  });
  window.webContents.on("did-finish-load", syncIfActive);
  window.on("focus", syncIfActive);
  window.once("closed", () => {
    syncNavigationMenu(resolveWebContents(undefined), target.origin);
  });

  window.webContents.on("before-input-event", (event, input) => {
    const action = shortcutActionForInput(input);
    if (!action || window.isDestroyed() || window.webContents.isDestroyed()) return;
    event.preventDefault();
    reloadPage(window.webContents, target, action === "force-reload");
  });

  window.on("app-command", (_event, command) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    switch (appCommandAction(command)) {
      case "back":
        goBack(window.webContents, target.origin);
        break;
      case "forward":
        goForward(window.webContents, target.origin);
        break;
      case "reload":
        reloadPage(window.webContents, target, false);
        break;
      case "home":
        goHome(window.webContents, target);
        break;
    }
  });

  window.webContents.on("context-menu", (_event, params) => {
    if (window.isDestroyed() || window.webContents.isDestroyed()) return;
    const contents = window.webContents;
    const template = createContextMenuTemplate({
      canGoBack: canNavigateHistory(contents.navigationHistory, "back", target.origin),
      canGoForward: canNavigateHistory(contents.navigationHistory, "forward", target.origin),
      isEditable: params.isEditable,
      selectionText: params.selectionText,
      editFlags: params.editFlags,
      actions: {
        goBack: () => goBack(contents, target.origin),
        goForward: () => goForward(contents, target.origin),
        reload: () => reloadPage(contents, target, false),
      },
    });
    Menu.buildFromTemplate(template).popup({ window });
  });

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
  installApplicationMenu(target);
  guardNavigation(target.origin);
  openWindow(target);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow(target);
  });
});

app.on("window-all-closed", () => app.quit());
