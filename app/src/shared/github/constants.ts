/**
 * GitHub contract constants shared by the Bot client, the SPA's `githubFetch` and the fake GitHub.
 * One place, so the fake can assert exactly what the real clients send.
 */

/**
 * The REST API version both clients pin. GitHub defaults to this version when the header is absent and
 * supports it until 2028-03-10. Version 2026-03-10 removes the singular `assignee` field: read `assignees`
 * if this is ever bumped.
 */
export const GITHUB_API_VERSION = "2022-11-28";
export const GITHUB_ACCEPT = "application/vnd.github+json";

/** The real services. Worker variables and the SPA build setting default to these (production unchanged). */
export const GITHUB_API_BASE_DEFAULT = "https://api.github.com";
export const GITHUB_WEB_BASE_DEFAULT = "https://github.com";
export const RESEND_API_BASE_DEFAULT = "https://api.resend.com";

/** GitHub and Resend reject (or Cloudflare blocks) requests without a User-Agent; Workers send none. */
export const WORKER_USER_AGENT = "fault-reports-worker/1";

export const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
