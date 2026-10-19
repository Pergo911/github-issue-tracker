# Issue Tracker

A fault-reporting and maintenance-tracking system for a building, institution or organization, where residents report faults and maintenance staff resolve them.

## Language

### Deployment

**Deployment**:
One independently running and independently configured instance of the system, serving one Organization. Nothing is shared between Deployments.
_Avoid_: Tenant, instance, installation, customer

**Organization**:
The real-world body a Deployment serves, such as a társasház, an institution or a company. Always means this, never the GitHub construct.
_Avoid_: Tenant, customer, client, site

**GitHub Organization**:
The GitHub construct that holds a Deployment's reports repo and staff roles. Always written in full so it is never confused with the Organization.
_Avoid_: Org, organization (bare)

**UI Language**:
The single language a Deployment renders all three surfaces and every email in, chosen from the languages the system ships. Never per-user or per-browser.
_Avoid_: Locale, interface language, translation setting

### Surfaces

**Submission form**:
The public, no-login surface a Reporter files a Report from: the taxonomy picks, title, description and optional
exact place, behind the email-OTP gate.
_Avoid_: Report form, contact page

**Status page**:
The public, no-login surface a Status link opens: one Report's current state and history, plus its Reporter
comment box.
_Avoid_: Issue view, tracking page

**Staff dashboard**:
The GitHub-login surface Staff work Reports from: the Board, List and Detail views, plus the System admin's
Allowlist and Configuration screens.
_Avoid_: Admin panel, back office

### Reports and people

**Report**:
A fault someone has reported, tracked from submission to resolution.
_Avoid_: Ticket, issue, fault

**Submission attempt**:
One verified effort to file a Report. It can still be pending after an interruption; resuming it continues the same effort rather than filing another Report.
_Avoid_: Reporter session, pending Report

**Reporter**:
A person on the Allowlist who submits Reports. Has no GitHub identity and no login.
_Avoid_: User, resident, tenant, requester

**Bot**:
The GitHub automation that creates Reports and posts comments on Reporters' behalf, so no Reporter needs a GitHub identity. Not Staff.
_Avoid_: Service account, bot account, machine user

**Reporter comment**:
A comment added to a Report from the status page by whoever holds the link, posted by the Bot on their behalf. Append-only, and it never reopens a closed Report.
_Avoid_: Reporter note, reply

**Allowlist**:
The list of email addresses permitted to submit Reports, maintained by System admins.
_Avoid_: Whitelist, resident list

**Status link**:
The permanent, unguessable per-Report URL that shows one Report's status and history and lets its Reporter comment on it.
_Avoid_: Magic link, token URL, tracking link

**Reissue**:
Replacing a Report's Status link with a new one, which ends the old link. Staff or whoever holds the link can do it; the new link goes only to the Reporter's email.
_Avoid_: Rotate, revoke, regenerate

**Erasure**:
What a Reporter's "remove my data" request resolves to: the Report and associated contact/recovery information are removed, including any unfinished Submission attempt, and the Allowlist entry is removed. Per-Report by design, not an automatic search for all Reports from an address.
_Avoid_: Right to be forgotten, purge, GDPR wipe

**Major change**:
A change to a Report significant enough to email its Reporter: it is closed, it is reopened, or it enters a Status with the notify flag while open. Other changes do not send email; the Status page shows the permitted progress history.

**Staff**:
People with a GitHub identity and a role on a Deployment's reports repo. A Viewer, Maintenance staff or a System admin.

**Viewer**:
Staff with the repo Read role: they see Reports and may comment, but take no triage actions and never see Reporter contact data.
_Avoid_: Observer, read-only member

**Maintenance staff**:
Staff who triage, categorize, assign and resolve Reports.
_Avoid_: Technician, agent

**System admin**:
Staff who also manage membership, the Allowlist and the Deployment's settings.
_Avoid_: Administrator, superuser

### Classification

**Taxonomy**:
The Categories, Locations, Priorities and Statuses a Deployment defines for classifying its Reports. The four dimensions are fixed; the values belong to each Deployment.
_Avoid_: Label set, label scheme

**Category**:
The kind of fault a Report describes, one per Report. The Reporter picks it and Staff may correct it.
_Avoid_: Type, nature

**Location**:
The coarse area of the Organization's premises a Report is about, one per Report, picked by the Reporter from the Taxonomy. The Reporter may add an optional free-text exact place.
_Avoid_: Area, zone

**Exact place**:
The optional free-text locator a Reporter adds to a Report, naming the room, floor or fixture within the picked Location.
_Avoid_: Sub-location, detail

**Priority**:
Staff's ranking of how urgent a Report is. Optional: a Report without one is untriaged. Reporters never set it.
_Avoid_: Urgency, severity

**Status**:
The stage an open Report has reached in its handling, expected to be one per open Report. Missing or conflicting Status needs Staff correction, not an invented stage. A closed Report has no Status.
_Avoid_: State, stage

**Initial status**:
The Status a Report starts at, and returns to when reopened. Exactly one Status in a Taxonomy is the initial one.

**Status flag**:
A property a Deployment's configuration attaches to a Status that tells the system how to treat it. Two exist: initial, and notify, which means entering that Status emails the Reporter. The system never infers behaviour from a Status's name.
_Avoid_: Status role (collides with a Staff member's role)

**Closed**:
The end state of a Report, reached when it was fixed or rejected (a rejected Report includes duplicates). The Reporter sees which.
_Avoid_: Resolved, done

**Emergency notice**:
The Deployment-supplied text on the submission form telling Reporters whom to contact in an emergency instead of filing a Report.
