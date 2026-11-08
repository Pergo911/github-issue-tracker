import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { externalUrlToOpen, isAppUrl } from "../../src/navigation.cjs";
import { webPreferences } from "../../src/web-preferences.cjs";

const origin = "https://reports.example.workers.dev";

describe("isAppUrl: navigation stays on the app's own origin", () => {
  it("accepts any path on the origin", () => {
    assert.equal(isAppUrl(`${origin}/`, origin), true);
    assert.equal(isAppUrl(`${origin}/staff?x=1#y`, origin), true);
  });

  it("rejects another host, port, scheme or lookalike", () => {
    for (const url of [
      "https://example.org/",
      `${origin}.attacker.example/`,
      "https://reports.example.workers.dev:8443/",
      "http://reports.example.workers.dev/",
      "https://reports.example.workers.dev.evil.example/",
      "https://reports.example.workers.dev@evil.example/",
    ]) {
      assert.equal(isAppUrl(url, origin), false, url);
    }
  });

  it("rejects what is not a URL, and non-web schemes", () => {
    for (const url of ["", "not a url", "file:///C:/Windows/win.ini", "javascript:alert(1)"]) {
      assert.equal(isAppUrl(url, origin), false, url);
    }
  });
});

describe("externalUrlToOpen: what may go to the system browser", () => {
  it("passes web and mail links through", () => {
    assert.equal(
      externalUrlToOpen("https://github.com/login/device"),
      "https://github.com/login/device",
    );
    assert.equal(externalUrlToOpen(`${origin}/status/abc`), `${origin}/status/abc`);
    assert.equal(externalUrlToOpen("http://example.org/a"), "http://example.org/a");
    assert.equal(externalUrlToOpen("mailto:it@example.org"), "mailto:it@example.org");
  });

  it("refuses anything that could run something", () => {
    for (const url of [
      "file:///C:/Windows/System32/calc.exe",
      "javascript:alert(1)",
      "ms-msdt:/id PCWDiagnostic",
      "data:text/html,<script>1</script>",
      "not a url",
      "",
    ]) {
      assert.equal(externalUrlToOpen(url), null, url);
    }
  });
});

describe("webPreferences: Electron's secure defaults, stated", () => {
  it("keeps isolation and the sandbox on, node integration off, and has no preload", () => {
    assert.deepEqual(webPreferences, {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
    assert.equal("preload" in webPreferences, false);
  });
});
