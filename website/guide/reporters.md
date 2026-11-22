# Reporters & Status Page

Reporters do not need a GitHub account, a password, or a login session. Everything happens through two public surfaces: the **Submission form** and the per-Report **Status page**.

## Submitting a Report

1. Open the Deployment's home page and choose **Report a fault** (or navigate directly to the Submission form).
2. Read the **Emergency notice** if configured — for example, whom to call immediately for fire, gas leaks, or flooding instead of filing a Report.
3. Fill out all fields before requesting a verification code:
   - **Email address** — must be on the Organization's Allowlist.
   - **Category** — the kind of fault, picked from the Deployment's Taxonomy.
   - **Location** — the coarse area of the premises, picked from the Taxonomy.
   - **Title** — short one-line summary, **3–80 characters**. Titles allow letters, numbers, spaces, and standard punctuation (including Hungarian quotation marks), and reject characters like backticks, colons, `@`, `#`, and HTML brackets.
   - **Description** — full description of the fault, **1–4,000 characters**.
   - **Exact place** *(optional)* — specific room, floor, or fixture within the Location, up to **100 characters**.
4. Click **Send code**. The Worker sends a single-use **6-digit code** valid for **10 minutes**.
5. Enter the code and click **Submit report**.

<AppScreenshot
  name="submission-filled"
  alt="Submission form filled out with emergency notice, email, category, location, title, description, and exact place"
  caption="The Submission form with an Emergency notice banner above the fields (shown in Hungarian from the reference Deployment)."
/>

::: info Why the "code sent" screen does not confirm whether an address is listed
To prevent outsiders from guessing valid resident email addresses, the Submission form always shows the same confirmation message after you request a code. If no email arrives, check spam and follow the Deployment's configured help text on that screen to contact an administrator.
:::

### Verification limits & interrupted submissions

- A verification code expires after **10 minutes** and allows at most **5 wrong guesses** before it is burned.
- You can request a new code after a **60-second cooldown** (up to 5 codes per hour and 10 per day per email address).
- **Automatic recovery without duplicates:** If your connection drops or you refresh while the Report is being saved, the tab holds a temporary recovery credential and resumes the same **Submission attempt** automatically without requiring a new code or creating duplicate Reports.
- If the system cannot confirm whether GitHub created the issue, it displays a short reference (such as `A1B2-C3D4`) and asks you to contact the Organization's administrators rather than resubmitting. See [Submission Recovery](/operations/submission-recovery).

## Following a Report on the Status page

Once submitted, the confirmation screen displays your permanent **Status link** (and sends a copy by email):

```text
https://<your-deployment>/status/<unguessable-token>
```

Keep this link — it is the only way to view your Report's timeline and add comments. Status links never expire, even after a Report is closed, and you are free to share the link with a family member or colleague who also needs to follow the fault.

<AppScreenshot
  name="status-open-in-progress"
  alt="Public Status page showing Report title, open state pill, details, timeline, comments, comment box, and Reissue section"
  caption="The public Status page displays decoded details, safe progress history, Staff and Reporter comments, a comment box, and a Reissue control."
/>

### What the Status page shows

- **Visible:** Report number, title, description, Exact place, Category, Location, current Status (or a waiting indicator if Staff need to repair the Status), open/closed state with close reason (*fixed*, *rejected*, or *duplicate*), whether someone from Maintenance staff is assigned (presence only), and the timeline of progress changes and comments.
- **Kept private:** Internal Priority, Staff usernames and avatars, internal GitHub URLs, and unrelated repository labels are never exposed on the Status page.

### Adding a Reporter comment

Use the comment box at the bottom of the Status page to add updates (1–2,000 characters).

- Comments are posted by the **Bot** on your behalf and labeled **Reporter** on both the Status page and the Staff dashboard. Your email address is never written to GitHub.
- Comments are **append-only** (they cannot be edited or deleted from the Status page) and are rate-limited (up to 3 per minute and 20 per day per Report).
- **Commenting on a closed Report never reopens it.** If a fixed fault returns, file a new Report or contact Maintenance staff.

### Reissuing a Status link

If you accidentally shared a Status link or suspect it leaked, click **Request a new link** at the bottom of the Status page and confirm:

- The old link stops working for everyone (returning a generic "link does not work" page once KV propagates, within about a minute).
- A brand-new Status link is sent **only to the Reporter's email address** — it is never displayed to the caller on screen, so an unauthorized holder cannot hijack the Report.
- Holders can Reissue a link up to **3 times per Report per day**; Maintenance staff can also Reissue it without a cap.

## When email notifications are sent

All system emails are **plain text** and come from the Organization's verified sending subdomain with a monitored `Reply-To` address. Emails are sent only for six events:

1. **Verification code (OTP)** when filing a Report.
2. **Submission confirmation** with the Report number and permanent Status link.
3. **Closed** — states whether the Report was fixed, rejected, or marked duplicate.
4. **Reopened** — when Maintenance staff reopen a closed Report.
5. **Status entered (`notify` flag)** — only when an open Report moves into a Status configured with notifications enabled.
6. **Link reissued** — delivers the replacement Status link after a Reissue.

Minor changes — such as Staff comments, Priority changes, Category/Location corrections, or assignment changes — do not send email; check the Status link for the full timeline.
