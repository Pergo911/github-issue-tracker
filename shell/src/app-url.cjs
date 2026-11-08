// @ts-check
// Where the shell loads (SPEC 2.1): a packaged build reads the URL baked in at build time and accepts HTTPS
// only; an unpackaged `npm start` reads APP_URL from the environment and also accepts http to localhost.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * @param {{ isPackaged: boolean, metadataUrl?: string, environmentUrl?: string }} input
 *   `metadataUrl` is `appUrl` from the packaged package.json; `environmentUrl` is `process.env.APP_URL`.
 * @returns {{ url: string, origin: string }}
 */
function resolveAppUrl({ isPackaged, metadataUrl, environmentUrl }) {
  const raw = isPackaged ? metadataUrl : environmentUrl;
  if (!raw) {
    throw new Error(
      isPackaged
        ? "This build has no app URL. Build it with APP_URL=https://<deployment> npm run build."
        : "APP_URL is not set. Start the shell with APP_URL=http://localhost:5173 npm start.",
    );
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`APP_URL is not a web address: ${raw}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("APP_URL must not contain credentials.");
  }

  const secure = url.protocol === "https:";
  const localDevelopment =
    !isPackaged && url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (!secure && !localDevelopment) {
    throw new Error(
      isPackaged
        ? `A packaged build accepts HTTPS only, got ${url.protocol}//${url.host}.`
        : `APP_URL must be HTTPS, or http on localhost, got ${url.protocol}//${url.host}.`,
    );
  }
  return { url: url.href, origin: url.origin };
}

module.exports = { resolveAppUrl };
