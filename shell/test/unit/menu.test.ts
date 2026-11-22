import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MENU_IDS,
  appCommandAction,
  canNavigateHistory,
  createApplicationMenuTemplate,
  createContextMenuTemplate,
  shortcutActionForInput,
} from "../../src/menu.cjs";

const origin = "https://reports.example.workers.dev";

function createRecordingActions() {
  const calls: Array<{ action: string; win: unknown }> = [];
  const actions = {
    goBack: (win?: unknown) => calls.push({ action: "goBack", win }),
    goForward: (win?: unknown) => calls.push({ action: "goForward", win }),
    goHome: (win?: unknown) => calls.push({ action: "goHome", win }),
    reload: (win?: unknown) => calls.push({ action: "reload", win }),
    forceReload: (win?: unknown) => calls.push({ action: "forceReload", win }),
  };
  return { calls, actions };
}

function submenuItems(template: ReturnType<typeof createApplicationMenuTemplate>, label: string) {
  const menu = template.find((item) => item.label === label);
  assert.ok(menu && Array.isArray(menu.submenu), `expected ${label} submenu`);
  return menu.submenu;
}

describe("createApplicationMenuTemplate", () => {
  it("builds Navigation, Edit, and View menus in both packaged and unpackaged runs", () => {
    for (const isPackaged of [true, false]) {
      const { actions } = createRecordingActions();
      const template = createApplicationMenuTemplate({ isPackaged, actions });
      assert.deepEqual(
        template.map((item) => item.label),
        ["Navigation", "Edit", "View"],
      );

      const nav = submenuItems(template, "Navigation");
      assert.deepEqual(
        nav.map((item) => item.id ?? item.type),
        [
          MENU_IDS.back,
          MENU_IDS.forward,
          MENU_IDS.home,
          "separator",
          MENU_IDS.reload,
          MENU_IDS.forceReload,
        ],
      );
      assert.equal(nav[0]?.accelerator, "Alt+Left");
      assert.equal(nav[0]?.enabled, false);
      assert.equal(nav[1]?.accelerator, "Alt+Right");
      assert.equal(nav[1]?.enabled, false);
      assert.equal(nav[2]?.accelerator, "Alt+Home");
      assert.equal(nav[4]?.accelerator, "CmdOrCtrl+R");
      assert.equal(nav[5]?.accelerator, "CmdOrCtrl+Shift+R");

      const edit = submenuItems(template, "Edit");
      assert.deepEqual(
        edit.map((item) => item.role ?? item.type),
        ["undo", "redo", "separator", "cut", "copy", "paste", "separator", "selectAll"],
      );
    }
  });

  it("omits toggleDevTools when packaged and includes it when unpackaged", () => {
    const { actions } = createRecordingActions();
    const packagedView = submenuItems(
      createApplicationMenuTemplate({ isPackaged: true, actions }),
      "View",
    );
    assert.deepEqual(
      packagedView.map((item) => item.role ?? item.type),
      ["resetZoom", "zoomIn", "zoomOut", "separator", "togglefullscreen"],
    );

    const devView = submenuItems(
      createApplicationMenuTemplate({ isPackaged: false, actions }),
      "View",
    );
    assert.deepEqual(
      devView.map((item) => item.role ?? item.type),
      [
        "resetZoom",
        "zoomIn",
        "zoomOut",
        "separator",
        "togglefullscreen",
        "separator",
        "toggleDevTools",
      ],
    );
  });

  it("delegates Navigation item clicks to the matching action with the window", () => {
    const { calls, actions } = createRecordingActions();
    const template = createApplicationMenuTemplate({ isPackaged: true, actions });
    const nav = submenuItems(template, "Navigation");
    const fakeWindow = { id: 1 } as unknown as Parameters<NonNullable<(typeof nav)[0]["click"]>>[1];

    for (const id of [
      MENU_IDS.back,
      MENU_IDS.forward,
      MENU_IDS.home,
      MENU_IDS.reload,
      MENU_IDS.forceReload,
    ]) {
      const item = nav.find((entry) => entry.id === id);
      assert.ok(item?.click, `missing click handler for ${id}`);
      item.click(
        {} as Parameters<NonNullable<typeof item.click>>[0],
        fakeWindow,
        {} as Parameters<NonNullable<typeof item.click>>[2],
      );
    }

    assert.deepEqual(calls, [
      { action: "goBack", win: fakeWindow },
      { action: "goForward", win: fakeWindow },
      { action: "goHome", win: fakeWindow },
      { action: "reload", win: fakeWindow },
      { action: "forceReload", win: fakeWindow },
    ]);
  });
});

describe("createContextMenuTemplate", () => {
  it("shows Back, Forward, and Reload on plain non-selected content", () => {
    const calls: string[] = [];
    const template = createContextMenuTemplate({
      canGoBack: true,
      canGoForward: false,
      isEditable: false,
      selectionText: "",
      actions: {
        goBack: () => calls.push("back"),
        goForward: () => calls.push("forward"),
        reload: () => calls.push("reload"),
      },
    });
    assert.deepEqual(
      template.map((item) => ({ id: item.id, enabled: item.enabled })),
      [
        { id: "context-back", enabled: true },
        { id: "context-forward", enabled: false },
        { id: "context-reload", enabled: undefined },
      ],
    );
    for (const item of template) {
      item.click?.(
        {} as Parameters<NonNullable<typeof item.click>>[0],
        undefined,
        {} as Parameters<NonNullable<typeof item.click>>[2],
      );
    }
    assert.deepEqual(calls, ["back", "forward", "reload"]);
  });

  it("adds Copy when text is selected outside an editable field", () => {
    const template = createContextMenuTemplate({
      canGoBack: false,
      canGoForward: false,
      isEditable: false,
      selectionText: "selected text",
      editFlags: { canCopy: true },
      actions: { goBack: () => {}, goForward: () => {}, reload: () => {} },
    });
    assert.deepEqual(
      template.map((item) => item.id ?? item.role ?? item.type),
      ["context-back", "context-forward", "context-reload", "separator", "copy"],
    );
    assert.equal(template[4]?.enabled, true);
  });

  it("adds Cut, Copy, Paste, and Select All in editable fields respecting editFlags", () => {
    const template = createContextMenuTemplate({
      canGoBack: false,
      canGoForward: true,
      isEditable: true,
      selectionText: "",
      editFlags: { canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
      actions: { goBack: () => {}, goForward: () => {}, reload: () => {} },
    });
    assert.deepEqual(
      template.map((item) => ({
        key: item.id ?? item.role ?? item.type,
        enabled: item.enabled,
      })),
      [
        { key: "context-back", enabled: false },
        { key: "context-forward", enabled: true },
        { key: "context-reload", enabled: undefined },
        { key: "separator", enabled: undefined },
        { key: "cut", enabled: false },
        { key: "copy", enabled: false },
        { key: "paste", enabled: true },
        { key: "selectAll", enabled: true },
      ],
    );
  });
});

describe("shortcutActionForInput", () => {
  const base = {
    type: "keyDown",
    key: "F5",
    isAutoRepeat: false,
    isComposing: false,
    control: false,
    shift: false,
    alt: false,
    meta: false,
  };

  it("maps F5 to reload and Ctrl/Shift+F5 to force-reload", () => {
    assert.equal(shortcutActionForInput(base), "reload");
    assert.equal(shortcutActionForInput({ ...base, control: true }), "force-reload");
    assert.equal(shortcutActionForInput({ ...base, shift: true }), "force-reload");
    assert.equal(shortcutActionForInput({ ...base, control: true, shift: true }), "force-reload");
  });

  it("ignores keyUp, repeat, composing, Alt/Meta modifiers, and other keys", () => {
    assert.equal(shortcutActionForInput({ ...base, type: "keyUp" }), null);
    assert.equal(shortcutActionForInput({ ...base, isAutoRepeat: true }), null);
    assert.equal(shortcutActionForInput({ ...base, isComposing: true }), null);
    assert.equal(shortcutActionForInput({ ...base, alt: true }), null);
    assert.equal(shortcutActionForInput({ ...base, meta: true }), null);
    assert.equal(shortcutActionForInput({ ...base, key: "r", control: true }), null);
  });
});

describe("appCommandAction", () => {
  it("maps browser app-commands and ignores unknown ones", () => {
    assert.equal(appCommandAction("browser-backward"), "back");
    assert.equal(appCommandAction("browser-forward"), "forward");
    assert.equal(appCommandAction("browser-refresh"), "reload");
    assert.equal(appCommandAction("browser-home"), "home");
    assert.equal(appCommandAction("media-play"), null);
  });
});

describe("canNavigateHistory", () => {
  function historyOf(entries: Array<string | null>, activeIndex: number) {
    return {
      canGoBack: () => activeIndex > 0,
      canGoForward: () => activeIndex < entries.length - 1,
      getActiveIndex: () => activeIndex,
      getEntryAtIndex: (index: number) => {
        const url = entries[index];
        return url == null ? null : { url };
      },
    };
  }

  it("allows back and forward only when the target entry is on appOrigin", () => {
    const history = historyOf([`${origin}/`, `${origin}/staff/reports`], 1);
    assert.equal(canNavigateHistory(history, "back", origin), true);
    assert.equal(canNavigateHistory(history, "forward", origin), false);

    const mid = historyOf([`${origin}/`, `${origin}/report`, `${origin}/staff/reports`], 1);
    assert.equal(canNavigateHistory(mid, "back", origin), true);
    assert.equal(canNavigateHistory(mid, "forward", origin), true);
  });

  it("rejects off-origin, data:, about:blank, and missing entries", () => {
    assert.equal(
      canNavigateHistory(historyOf(["https://example.org/", `${origin}/`], 1), "back", origin),
      false,
    );
    assert.equal(
      canNavigateHistory(
        historyOf(["data:text/html,unavailable", `${origin}/`], 1),
        "back",
        origin,
      ),
      false,
    );
    assert.equal(
      canNavigateHistory(historyOf(["about:blank", `${origin}/`], 1), "back", origin),
      false,
    );
    assert.equal(canNavigateHistory(historyOf([null, `${origin}/`], 1), "back", origin), false);
  });
});
