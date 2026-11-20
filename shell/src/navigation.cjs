// @ts-check
// The navigation rules (SPEC 2.1): the window stays on the app's own origin, and everything else that a link
// or window.open asks for goes to the system browser instead, if it is something a browser should open.

const EXTERNAL_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

/**
 * Whether `url` is on the app's origin. Compares parsed origins, never string prefixes
 * (`https://app.example.com.attacker.com` starts with `https://app.example.com`).
 * @param {string} url
 * @param {string} appOrigin
 */
function isAppUrl(url, appOrigin) {
  try {
    return new URL(url).origin === appOrigin;
  } catch {
    return false;
  }
}

/**
 * The URL to hand to `shell.openExternal`, or null when it must not be opened at all: a file:, javascript: or
 * custom-protocol URL would run something on the user's machine.
 * @param {string} url
 * @returns {string | null}
 */
function externalUrlToOpen(url) {
  try {
    const parsed = new URL(url);
    return EXTERNAL_PROTOCOLS.has(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}

module.exports = { isAppUrl, externalUrlToOpen };
