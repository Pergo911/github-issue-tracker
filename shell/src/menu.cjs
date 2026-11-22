// @ts-check
// Application menu, keyboard refresh shortcuts, mouse app-commands, and right-click context menu for the
// desktop shell. Kept free of a runtime `electron` import so unit tests can import it in plain Node.
const { isAppUrl } = require("./navigation.cjs");

const MENU_IDS = Object.freeze({
  back: "nav-back",
  forward: "nav-forward",
  home: "nav-home",
  reload: "nav-reload",
  forceReload: "nav-force-reload",
});

/**
 * @typedef {{
 *   canGoBack(): boolean,
 *   canGoForward(): boolean,
 *   getActiveIndex(): number,
 *   getEntryAtIndex(index: number): { url: string } | null | undefined,
 * }} HistoryLike
 */

/**
 * @typedef {{
 *   goBack(window?: import("electron").BaseWindow): void,
 *   goForward(window?: import("electron").BaseWindow): void,
 *   goHome(window?: import("electron").BaseWindow): void,
 *   reload(window?: import("electron").BaseWindow): void,
 *   forceReload(window?: import("electron").BaseWindow): void,
 * }} NavigationActions
 */

/**
 * Whether history navigation in `direction` stays within `appOrigin`.
 * Prevents Back/Forward from leaving the app's origin or revisiting an error data: page.
 * @param {HistoryLike} history
 * @param {"back" | "forward"} direction
 * @param {string} appOrigin
 * @returns {boolean}
 */
function canNavigateHistory(history, direction, appOrigin) {
  const possible = direction === "back" ? history.canGoBack() : history.canGoForward();
  if (!possible) return false;
  const targetIndex = history.getActiveIndex() + (direction === "back" ? -1 : 1);
  const entry = history.getEntryAtIndex(targetIndex);
  return entry != null && isAppUrl(entry.url, appOrigin);
}

/**
 * Maps a keyboard `before-input-event` payload to a refresh action, or null when unrelated.
 * Handles Windows F5 / Ctrl+F5 / Shift+F5 alongside the menu's CmdOrCtrl+R accelerators.
 * @param {{
 *   type: string,
 *   key: string,
 *   isAutoRepeat?: boolean,
 *   isComposing?: boolean,
 *   control: boolean,
 *   shift: boolean,
 *   alt: boolean,
 *   meta: boolean,
 * }} input
 * @returns {"reload" | "force-reload" | null}
 */
function shortcutActionForInput(input) {
  if (input.type !== "keyDown" || input.isAutoRepeat || input.isComposing) return null;
  if (input.key === "F5" && !input.alt && !input.meta) {
    return input.control || input.shift ? "force-reload" : "reload";
  }
  return null;
}

/**
 * Maps a Windows/Linux `app-command` string (mouse/keyboard browser keys) to a navigation action.
 * @param {string} command
 * @returns {"back" | "forward" | "reload" | "home" | null}
 */
function appCommandAction(command) {
  switch (command) {
    case "browser-backward":
      return "back";
    case "browser-forward":
      return "forward";
    case "browser-refresh":
      return "reload";
    case "browser-home":
      return "home";
    default:
      return null;
  }
}

/**
 * Builds the application menu template for both packaged and unpackaged runs.
 * DevTools stays hidden in packaged builds while Navigation, Edit, and View remain available.
 * @param {{ isPackaged: boolean, actions: NavigationActions }} options
 * @returns {import("electron").MenuItemConstructorOptions[]}
 */
function createApplicationMenuTemplate({ isPackaged, actions }) {
  /** @type {import("electron").MenuItemConstructorOptions[]} */
  const navigationSubmenu = [
    {
      id: MENU_IDS.back,
      label: "Back",
      accelerator: "Alt+Left",
      enabled: false,
      click: (_item, win) => actions.goBack(win),
    },
    {
      id: MENU_IDS.forward,
      label: "Forward",
      accelerator: "Alt+Right",
      enabled: false,
      click: (_item, win) => actions.goForward(win),
    },
    {
      id: MENU_IDS.home,
      label: "Home",
      accelerator: "Alt+Home",
      click: (_item, win) => actions.goHome(win),
    },
    { type: "separator" },
    {
      id: MENU_IDS.reload,
      label: "Reload",
      accelerator: "CmdOrCtrl+R",
      click: (_item, win) => actions.reload(win),
    },
    {
      id: MENU_IDS.forceReload,
      label: "Force Reload",
      accelerator: "CmdOrCtrl+Shift+R",
      click: (_item, win) => actions.forceReload(win),
    },
  ];

  /** @type {import("electron").MenuItemConstructorOptions[]} */
  const editSubmenu = [
    { role: "undo" },
    { role: "redo" },
    { type: "separator" },
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { type: "separator" },
    { role: "selectAll" },
  ];

  /** @type {import("electron").MenuItemConstructorOptions[]} */
  const viewSubmenu = [
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  if (!isPackaged) {
    viewSubmenu.push({ type: "separator" }, { role: "toggleDevTools" });
  }

  /** @type {import("electron").MenuItemConstructorOptions[]} */
  const template = [
    { label: "Navigation", submenu: navigationSubmenu },
    { label: "Edit", submenu: editSubmenu },
    { label: "View", submenu: viewSubmenu },
  ];
  return template;
}

/**
 * Builds the right-click context menu template for a window's web contents.
 * @param {{
 *   canGoBack: boolean,
 *   canGoForward: boolean,
 *   isEditable: boolean,
 *   selectionText: string,
 *   editFlags?: Partial<import("electron").EditFlags>,
 *   actions: { goBack(): void, goForward(): void, reload(): void },
 * }} options
 * @returns {import("electron").MenuItemConstructorOptions[]}
 */
function createContextMenuTemplate({
  canGoBack,
  canGoForward,
  isEditable,
  selectionText,
  editFlags,
  actions,
}) {
  /** @type {import("electron").MenuItemConstructorOptions[]} */
  const template = [
    { id: "context-back", label: "Back", enabled: canGoBack, click: () => actions.goBack() },
    {
      id: "context-forward",
      label: "Forward",
      enabled: canGoForward,
      click: () => actions.goForward(),
    },
    { id: "context-reload", label: "Reload", click: () => actions.reload() },
  ];
  const hasSelection = selectionText.length > 0;
  if (isEditable) {
    template.push(
      { type: "separator" },
      { role: "cut", enabled: editFlags?.canCut ?? hasSelection },
      { role: "copy", enabled: editFlags?.canCopy ?? hasSelection },
      { role: "paste", enabled: editFlags?.canPaste ?? true },
      { role: "selectAll", enabled: editFlags?.canSelectAll ?? true },
    );
  } else if (hasSelection) {
    template.push({ type: "separator" }, { role: "copy", enabled: editFlags?.canCopy ?? true });
  }
  return template;
}

module.exports = {
  MENU_IDS,
  appCommandAction,
  canNavigateHistory,
  createApplicationMenuTemplate,
  createContextMenuTemplate,
  shortcutActionForInput,
};
