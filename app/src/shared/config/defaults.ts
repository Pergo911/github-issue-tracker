import type { ConfigSave } from "./save.ts";

/**
 * What the Configuration screen of a fresh Deployment is pre-filled with (SPEC 2.4): the smallest valid
 * configuration, in English, with every template written out. A System admin edits it and the first valid save
 * creates the `config` key. It is a starting point, not seed data: the reference Deployment's Hungarian
 * configuration is `seed/reference-config.ts`.
 */
export const starterConfig = {
  language: "en",
  timezone: "UTC",
  displayName: "",
  emergencyNotice: "",
  codeSentHelp:
    "If your address is on the reporters' list, the code arrives within a few minutes. Check your spam folder too. If it still does not arrive, ask the maintenance staff: your address may not be listed yet, or may have been mistyped.",
  taxonomy: {
    category: [{ id: "general", name: "General", color: "cfd3d7" }],
    location: [{ id: "building", name: "Building", color: "ededed" }],
    priority: [
      { id: "low", name: "Low", color: "c2e0c6" },
      { id: "normal", name: "Normal", color: "fef2c0" },
      { id: "high", name: "High", color: "f9a03f" },
    ],
    status: [
      { id: "new", name: "New", color: "1d76db", initial: true, notify: false },
      { id: "in-progress", name: "In progress", color: "fbca04", initial: false, notify: true },
    ],
  },
  email: {
    senderLocalPart: "reports",
    senderName: "",
    replyTo: "",
    replyClause: "reply to this email to reach the maintenance staff",
    footer: "Automatic message from the fault-reporting system — {reply}",
    templates: {
      otp: {
        subject: "Your verification code",
        body: "Your verification code is {code}.\n\nIt is valid for {minutes} minutes and is needed to submit your report.\n\nIf you did not request it, ignore this email.",
      },
      submissionConfirmation: {
        subject: 'Report #{number} — "{title}" — received',
        body: "We received your report.\n\nNumber: #{number}\nTitle: {title}\n\nUse this link to follow the report and to add comments to it:\n{link}\n\nKeep this email: the link is how you follow the report.",
      },
      closed: {
        subject: 'Report #{number} — "{title}" — closed',
        body: "Your report #{number} was closed.\n\nTitle: {title}\nReason: {reason}\n\nDetails and history:\n{link}",
      },
      reopened: {
        subject: 'Report #{number} — "{title}" — reopened',
        body: "Your report #{number} was reopened.\n\nTitle: {title}\n\nThe current status:\n{link}",
      },
      statusEntered: {
        subject: 'Report #{number} — "{title}" — new status: {status}',
        body: "The status of your report #{number} is now: {status}\n\nTitle: {title}\n\nDetails:\n{link}",
      },
      linkReissued: {
        subject: 'Report #{number} — "{title}" — new link',
        body: "The earlier link to your report #{number} has ended for everyone.\n\nTitle: {title}\n\nThe new link:\n{link}",
      },
    },
  },
  dailyCodeBudget: 40,
} as const satisfies ConfigSave;

/** The placeholders each template (and the footer) takes (SPEC 4.6). */
export const TEMPLATE_PLACEHOLDERS = {
  otp: ["code", "minutes"],
  submissionConfirmation: ["number", "title", "link"],
  closed: ["number", "title", "reason", "link"],
  reopened: ["number", "title", "link"],
  statusEntered: ["number", "title", "status", "link"],
  linkReissued: ["number", "title", "link"],
} as const;
