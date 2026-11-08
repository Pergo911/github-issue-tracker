import type { ApiErrorCode } from "../api/endpoints.ts";

/**
 * The English catalog: it defines the flat, dotted MessageKey set (SPEC 2.5) and is the per-key fallback.
 * Every other language is a Partial of it. Fixed system wording only; Deployment-authored wording
 * (display names, the emergency notice, the email templates) lives in the configuration.
 * `{name}` marks a typed placeholder.
 */
export const en = {
  "boot.loading": "Loading…",
  "boot.notConfigured.title": "This service is not set up yet",
  "boot.notConfigured.description":
    "Whoever runs this service has not finished setting it up. Please try again later.",
  "boot.fetchFailed.title": "The service could not be loaded",
  "boot.fetchFailed.description": "Check your internet connection and try again.",
  "boot.retry": "Try again",
  "a11y.skipToContent": "Skip to main content",
  "header.homeLink": "{organization}: home page",
  "home.heading": "Fault reporting",
  "home.intro": "Report a fault, or sign in to work on reports.",
  "home.submission.title": "Submit a report",
  "home.submission.description":
    "Describe a fault. You need an email address that is on the list of reporters.",
  "home.staff.title": "Staff sign-in",
  "home.staff.description": "For maintenance staff and administrators.",
  "placeholder.comingSoon": "This page is coming soon.",
  "nav.backToHome": "Back to the home page",
  "notFound.title": "Page not found",
  "notFound.description": "There is nothing at this address.",
  "api.error.not_configured": "This service is not set up yet.",
  "api.error.invalid_request": "Some of the information was not accepted. Check it and try again.",
  "api.error.not_found": "This could not be found.",
  "api.error.rate_limited": "Too many attempts. Please wait a moment and try again.",
  "api.error.internal_error": "Something went wrong on our side. Please try again later.",
  "api.error.unauthorized": "You are not signed in. Sign in with GitHub and try again.",
  "api.error.forbidden": "Your GitHub account does not have access to this.",
  "api.error.upstream_unavailable":
    "GitHub could not be reached to check your access. Please try again later.",
  "api.error.network_error": "The service could not be reached. Check your internet connection.",
  "api.error.invalid_response": "The service sent an unexpected answer. Please try again later.",
} as const satisfies Record<string, string> & Record<`api.error.${ApiErrorCode}`, string>;
