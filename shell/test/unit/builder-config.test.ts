import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { createBuilderConfig } from "../../scripts/builder-config.cjs";

describe("createBuilderConfig: one build per Deployment", () => {
  it("bakes the APP_URL into the packaged package.json", () => {
    const config = createBuilderConfig({ APP_URL: "https://reports.example.workers.dev" });
    assert.equal(config.extraMetadata?.["appUrl"], "https://reports.example.workers.dev/");
  });

  it("refuses to build without an APP_URL, or with one a packaged shell would refuse to load", () => {
    assert.throws(() => createBuilderConfig({}), /APP_URL/);
    assert.throws(() => createBuilderConfig({ APP_URL: "http://localhost:5173" }), /HTTPS/);
    assert.throws(() => createBuilderConfig({ APP_URL: "http://reports.example.org" }), /HTTPS/);
  });

  it("builds a per-user installer and a portable exe for Windows, unsigned", () => {
    const config = createBuilderConfig({ APP_URL: "https://reports.example.org" });
    assert.deepEqual(config.win?.target, ["nsis", "portable"]);
    assert.equal(config.nsis?.perMachine, false);
    assert.equal(config.nsis?.oneClick, true);
    assert.equal(config.forceCodeSigning ?? false, false);
    assert.notEqual(config.nsis?.artifactName, config.portable?.artifactName);
  });

  it("takes appId and productName from the environment, with defaults", () => {
    const base = { APP_URL: "https://reports.example.org" };
    const defaults = createBuilderConfig(base);
    assert.match(defaults.appId ?? "", /^[a-z0-9.-]+$/i);
    assert.ok(defaults.productName);

    const own = createBuilderConfig({
      ...base,
      APP_ID: "hu.example.reports",
      PRODUCT_NAME: "Reports",
    });
    assert.equal(own.appId, "hu.example.reports");
    assert.equal(own.productName, "Reports");
  });

  it("packs only the shell's own files and sets a valid Windows app icon", () => {
    const config = createBuilderConfig({ APP_URL: "https://reports.example.org" });
    assert.deepEqual(config.files, ["package.json", "src/**/*.cjs", "assets/icon.ico"]);
    assert.equal(config.win?.icon, "assets/icon.ico");

    const iconPath = resolve(import.meta.dirname, "..", "..", "assets", "icon.ico");
    assert.ok(existsSync(iconPath), "assets/icon.ico must exist");
    const header = readFileSync(iconPath).subarray(0, 4);
    // ICO magic: 00 00 01 00
    assert.deepEqual([...header], [0x00, 0x00, 0x01, 0x00]);
  });
});
