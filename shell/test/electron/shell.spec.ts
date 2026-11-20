import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type ElectronApplication } from "@playwright/test";
import { appUrl, launchShell, stubOpenExternal } from "./support.ts";

let app: ElectronApplication;
test.afterEach(async () => {
  await app?.close();
});

test("the window loads the app's home page", async () => {
  const launched = await launchShell();
  app = launched.app;
  await expect(launched.window.getByRole("heading", { level: 1 })).toBeVisible();
  expect(launched.window.url()).toBe(`${appUrl()}/`);
  expect(app.windows()).toHaveLength(1);
});

test("the page gets no native APIs and the web preferences are the secure ones", async () => {
  const launched = await launchShell();
  app = launched.app;
  await expect(launched.window.getByRole("heading", { level: 1 })).toBeVisible();

  // What the page can see: no Node, no bridge from a preload script.
  const seen = await launched.window.evaluate(() => ({
    require: typeof (globalThis as { require?: unknown }).require,
    module: typeof (globalThis as { module?: unknown }).module,
    process: typeof (globalThis as { process?: unknown }).process,
    electron: typeof (globalThis as { electron?: unknown }).electron,
  }));
  expect(seen).toEqual({
    require: "undefined",
    module: "undefined",
    process: "undefined",
    electron: "undefined",
  });

  // What the main process configured.
  const preferences = await app.evaluate(({ BrowserWindow }) => {
    const [first] = BrowserWindow.getAllWindows();
    // Not in Electron's typings, but there at runtime: what the window was really created with.
    return (
      first!.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> }
    ).getLastWebPreferences();
  });
  expect(preferences).toMatchObject({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
  });
  expect(preferences?.preload).toBeUndefined();
});

test("a target=_blank link opens the system browser and no window", async () => {
  const launched = await launchShell();
  app = launched.app;
  const opened = await stubOpenExternal(app);
  await expect(launched.window.getByRole("heading", { level: 1 })).toBeVisible();

  await launched.window.evaluate(() => {
    const link = document.createElement("a");
    link.href = "https://example.org/status/abc";
    link.target = "_blank";
    link.textContent = "status link";
    document.body.prepend(link);
  });
  await launched.window.getByRole("link", { name: "status link" }).click();

  await expect.poll(opened).toEqual(["https://example.org/status/abc"]);
  expect(app.windows()).toHaveLength(1);
  expect(launched.window.url()).toBe(`${appUrl()}/`);
});

test("window.open goes to the system browser, and a file: URL goes nowhere", async () => {
  const launched = await launchShell();
  app = launched.app;
  const opened = await stubOpenExternal(app);
  await expect(launched.window.getByRole("heading", { level: 1 })).toBeVisible();

  await launched.window.evaluate(() => {
    window.open("file:///C:/Windows/System32/calc.exe");
    window.open("https://github.com/login/device");
  });

  await expect.poll(opened).toEqual(["https://github.com/login/device"]);
  expect(app.windows()).toHaveLength(1);
});

test("an off-origin navigation is blocked, and nothing opens", async () => {
  const launched = await launchShell();
  app = launched.app;
  const opened = await stubOpenExternal(app);
  await expect(launched.window.getByRole("heading", { level: 1 })).toBeVisible();

  await launched.window.evaluate(() => {
    window.location.href = "https://example.org/";
  });
  // Give the blocked navigation time to show itself if it was not blocked.
  await launched.window.waitForTimeout(1_500);

  expect(launched.window.url()).toBe(`${appUrl()}/`);
  // Read the page directly: Playwright's locators wait for a navigation that never commits.
  expect(
    await launched.window.evaluate(() => document.querySelector("h1")?.textContent),
  ).toBeTruthy();
  expect(app.windows()).toHaveLength(1);
  expect(await opened()).toEqual([]);
});

test("navigation inside the app's origin still works", async () => {
  const launched = await launchShell();
  app = launched.app;
  await expect(launched.window.getByRole("heading", { level: 1 })).toBeVisible();

  await launched.window
    .getByRole("link", { name: /staff|munkatárs|karbantart/i })
    .first()
    .click();
  await expect(launched.window).toHaveURL(`${appUrl()}/staff/reports`);
});

test("a server redirect off the origin is blocked too", async () => {
  // A one-page server of its own: the app's dev server has no off-origin redirect to follow.
  const server = createServer((request, response) => {
    if (request.url === "/go") {
      response.writeHead(302, { location: "https://example.org/" }).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end('<!doctype html><title>fixture</title><h1>fixture</h1><a href="/go">go</a>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    const launched = await launchShell({ url: origin });
    app = launched.app;
    await expect(launched.window.getByRole("link", { name: "go" })).toBeVisible();

    await launched.window.getByRole("link", { name: "go" }).click();
    await launched.window.waitForTimeout(1_500);

    expect(launched.window.url()).toBe(`${origin}/`);
    expect(app.windows()).toHaveLength(1);
  } finally {
    await app?.close();
    server.close();
  }
});

test("an unreachable site shows a plain error page, not a blank window", async () => {
  // A port that was free a moment ago and has nothing listening on it now.
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));

  const launched = await launchShell({ url: `http://127.0.0.1:${port}` });
  app = launched.app;
  await expect(launched.window.getByRole("heading", { level: 1 })).toContainText("Nem érhető el");
  await expect(launched.window.getByRole("link", { name: /Try again/ })).toBeVisible();
});
