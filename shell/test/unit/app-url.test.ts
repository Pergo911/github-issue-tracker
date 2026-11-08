import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAppUrl } from "../../src/app-url.cjs";

describe("resolveAppUrl: where the shell loads", () => {
  describe("a packaged build", () => {
    it("reads the build metadata, not the environment", () => {
      const target = resolveAppUrl({
        isPackaged: true,
        metadataUrl: "https://reports.example.workers.dev",
        environmentUrl: "https://elsewhere.example.org",
      });
      assert.equal(target.url, "https://reports.example.workers.dev/");
      assert.equal(target.origin, "https://reports.example.workers.dev");
    });

    it("refuses plain http, even to localhost", () => {
      for (const url of ["http://reports.example.org", "http://localhost:5173", "http://127.0.0.1"]) {
        assert.throws(() => resolveAppUrl({ isPackaged: true, metadataUrl: url }), /HTTPS/);
      }
    });

    it("refuses a build that has no URL, saying how to build one", () => {
      assert.throws(() => resolveAppUrl({ isPackaged: true }), /APP_URL/);
      assert.throws(() => resolveAppUrl({ isPackaged: true, metadataUrl: "" }), /APP_URL/);
    });

    it("refuses things that are not a web address", () => {
      for (const url of ["not a url", "file:///C:/x.html", "javascript:alert(1)", "ftp://x.org"]) {
        assert.throws(() => resolveAppUrl({ isPackaged: true, metadataUrl: url }));
      }
    });
  });

  describe("an unpackaged run (npm start)", () => {
    it("reads the environment", () => {
      const target = resolveAppUrl({ isPackaged: false, environmentUrl: "https://x.example.org/" });
      assert.equal(target.origin, "https://x.example.org");
    });

    it("also accepts http to localhost, for the dev loop", () => {
      for (const url of ["http://localhost:5173", "http://127.0.0.1:5199", "http://[::1]:5173"]) {
        assert.equal(
          resolveAppUrl({ isPackaged: false, environmentUrl: url }).origin,
          new URL(url).origin,
        );
      }
    });

    it("still refuses http to anything else", () => {
      for (const url of ["http://example.org", "http://localhost.evil.example", "http://192.168.1.5"]) {
        assert.throws(() => resolveAppUrl({ isPackaged: false, environmentUrl: url }), /HTTPS/);
      }
    });

    it("tells the developer how to set APP_URL when it is missing", () => {
      assert.throws(
        () => resolveAppUrl({ isPackaged: false }),
        /APP_URL=http:\/\/localhost:5173 npm start/,
      );
    });

    it("ignores the build metadata", () => {
      assert.throws(
        () => resolveAppUrl({ isPackaged: false, metadataUrl: "https://reports.example.org" }),
        /APP_URL/,
      );
    });
  });

  it("refuses an address with credentials in it", () => {
    assert.throws(() =>
      resolveAppUrl({ isPackaged: true, metadataUrl: "https://user:pw@reports.example.org" }),
    );
  });
});
