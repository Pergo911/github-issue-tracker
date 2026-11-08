// @ts-check
// Electron's secure defaults, stated so a test can hold them (SPEC 2.1): no preload script and no native APIs
// for the page. Turning contextIsolation off would also turn the sandbox off, so all three are explicit.

/** @type {import("electron").WebPreferences} */
const webPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
};

module.exports = { webPreferences };
