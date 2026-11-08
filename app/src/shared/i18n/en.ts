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
} as const satisfies Record<string, string>;
