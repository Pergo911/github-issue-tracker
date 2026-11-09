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
  "api.error.invalid_code":
    "That code is not valid. Check it, or ask for a new one. A code stops working after five wrong tries.",
  "api.error.submission_pending":
    "Your report is still being saved. Do not submit it again: ask the maintenance staff to check it.",
  "api.error.title_length": "The title must be 3 to 80 characters.",
  "api.error.title_characters":
    "The title may contain only letters, numbers, spaces and these marks: . , ! ? ( ) ' \" - – — ‘ ’ “ ”",
  "api.error.description_length": "The description must be 1 to 4,000 characters.",
  "api.error.place_length": "The exact place can be at most 100 characters.",
  "api.error.unknown_category": "Choose a category from the list.",
  "api.error.unknown_location": "Choose a location from the list.",
  "form.heading": "Submit a report",
  "form.intro": "Fill in everything, then request a code. We send the code to your email address.",
  "form.emergency.title": "In an emergency",
  "form.email.label": "Email address",
  "form.email.hint": "It must be on the list of reporters. The code is sent to it.",
  "form.category.label": "Category",
  "form.location.label": "Location",
  "form.select.placeholder": "Choose…",
  "form.title.label": "Title",
  "form.title.hint": "A short summary of the fault, 3 to 80 characters.",
  "form.description.label": "Description",
  "form.description.hint":
    "What is wrong, and anything that helps to find it. Up to 4,000 characters.",
  "form.place.label": "Exact place (optional)",
  "form.place.hint": "For example a room number or the side of the building. Up to 100 characters.",
  "form.counter": "{count} / {max}",
  "form.error.emailInvalid": "Enter a valid email address.",
  "form.error.codeInvalid": "Enter the 6-digit code from the email.",
  "form.error.summary": "Some fields need your attention.",
  "form.sendCode": "Send code",
  "form.sendingCode": "Sending the code…",
  "form.codeSent.title": "Check your email",
  "form.codeSent.description":
    "If this address is on the list of reporters, a code has been sent to it. The code is valid for 10 minutes.",
  "form.codeSent.noCode": "No code arrived?",
  "form.code.label": "Code from the email",
  "form.code.hint": "6 digits.",
  "form.resend.wait": "You can ask for a new code in {seconds} seconds.",
  "form.resend": "Send a new code",
  "form.changeAddress": "Use a different address",
  "form.submit": "Submit report",
  "form.submitting": "Submitting the report…",
  "confirmation.title": "Your report was received",
  "confirmation.number": "Report number",
  "confirmation.reportTitle": "Title",
  "confirmation.link": "Status link",
  "confirmation.keep":
    "Keep this link. It is the only way to follow the report and add comments. We have also emailed it to you.",
  "confirmation.another": "Submit another report",
  "report.body.category": "Category",
  "report.body.location": "Location",
  "report.body.place": "Exact place",
  "report.body.description": "Description",
} as const satisfies Record<string, string> & Record<`api.error.${ApiErrorCode}`, string>;
