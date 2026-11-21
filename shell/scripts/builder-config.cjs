// @ts-check
// The electron-builder configuration for one Deployment (SPEC 2.1, ADR 0001). Everything per Deployment comes
// from the environment, so one command builds for one APP_URL:
//
//   APP_URL=https://<deployment>        required: HTTPS, where the packaged shell loads
//   APP_ID=<reverse.dns.id>             optional: the Windows app identity (the uninstall key derives from it)
//   PRODUCT_NAME=<name>                 optional: install folder, shortcut and exe name (keep it ASCII)
//
// Two Deployments need different APP_ID and PRODUCT_NAME, or their installs overwrite each other. Changing
// APP_ID later stops an upgrade from finding the old install.
const { resolveAppUrl } = require("../src/app-url.cjs");

const DEFAULT_APP_ID = "app.faultreports.shell";
const DEFAULT_PRODUCT_NAME = "Hibabejelento";

/**
 * @param {Record<string, string | undefined>} environment
 * @returns {import("electron-builder").Configuration}
 */
function createBuilderConfig(environment) {
  // The same rule the packaged shell applies at start-up, so a build that would never run is not produced.
  const target = resolveAppUrl({ isPackaged: true, metadataUrl: environment["APP_URL"] });

  return {
    appId: environment["APP_ID"] || DEFAULT_APP_ID,
    productName: environment["PRODUCT_NAME"] || DEFAULT_PRODUCT_NAME,
    // Merged into the packaged package.json, where the shell reads `appUrl`.
    extraMetadata: { appUrl: target.url },
    directories: { output: "dist" },
    files: ["package.json", "src/**/*.cjs", "assets/icon.ico"],
    // Unsigned: SmartScreen's click-through is accepted (SPEC 2.1).
    win: { icon: "assets/icon.ico", target: ["nsis", "portable"] },
    // Per-user, one-click: no admin rights, no wizard.
    nsis: {
      oneClick: true,
      perMachine: false,
      artifactName: "${productName}-Setup-${version}.${ext}",
    },
    portable: { artifactName: "${productName}-${version}-portable.${ext}" },
  };
}

module.exports = { createBuilderConfig };
