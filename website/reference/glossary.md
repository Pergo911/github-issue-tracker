# Glossary

Issue Tracker uses consistent domain terminology across its UI, configuration, and operational runbooks. Using the canonical terms prevents confusion — especially between the real-world **Organization** and a **GitHub Organization**, and avoids the word *"tenant"* (which in a residential building refers to a resident, not a software customer).

## Deployment & organization

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Deployment** | One independently running and independently configured instance of the system, serving one Organization. Nothing is shared between Deployments. | tenant, instance, installation, customer |
| **Organization** | The real-world body a Deployment serves, such as a building (*társasház*), institution, or company. Never means the GitHub construct. | tenant, customer, client, site |
| **GitHub Organization** | The GitHub construct holding a Deployment's `reports` repository and Staff roles. Always written in full. | org, organization (bare) |
| **UI Language** | The single language (`en` or `hu`) a Deployment renders all three surfaces and system captions in. Never per-user or per-browser. | locale, interface language |

## Surfaces

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Submission form** | The public, no-login surface where a Reporter files a Report behind the email-OTP gate. | report form, contact page |
| **Status page** | The public, no-login surface a Status link opens: one Report's current state, progress history, and Reporter comment box. | issue view, tracking page |
| **Staff dashboard** | The GitHub-authenticated surface where Staff work Reports (Board, List, Detail) and System admins manage Allowlist, Staff, and Configuration. | admin panel, back office |

## Reports & people

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Report** | A fault someone has reported, tracked from submission to resolution. | ticket, issue, fault |
| **Submission attempt** | One verified effort to file a Report. Resuming an interrupted attempt continues that same effort rather than creating a second Report. | reporter session, pending report |
| **Reporter** | A person on the Allowlist who submits Reports. Has no GitHub account and no login. | user, resident, tenant, requester |
| **Bot** | The GitHub App automation that creates Reports and posts Reporter comments on Reporters' behalf. Not Staff. | service account, machine user |
| **Reporter comment** | An append-only comment added from the Status page and posted by the Bot with a Reporter marker. Never reopens a closed Report. | reporter note, reply |
| **Allowlist** | The System-admin-managed list of email addresses permitted to request OTP codes and submit Reports. | whitelist, resident list |
| **Status link** | The permanent, unguessable per-Report capability URL (`/status/<token>`) that displays a Report's state/history and allows commenting. | magic link, token URL, tracking link |
| **Reissue** | Replacing a Report's Status link with a new one, ending the old link for everyone and emailing the replacement only to the Reporter. | rotate, revoke, regenerate |
| **Erasure** | Fulfilling a Reporter's data-removal request per Report: deleting the GitHub issue (purging KV mappings via webhook), removing the Allowlist entry, and discarding any unlinked Submission attempt. | right to be forgotten, purge, GDPR wipe |
| **Major change** | A change significant enough to email the Reporter: Closed, Reopened, or entering an open Status carrying the `notify` flag. | notification event |
| **Staff** | People with a GitHub account and a role on the Deployment's `reports` repository: a **Viewer**, **Maintenance staff**, or **System admin**. | employees, operators |
| **Viewer** | Staff with repository Read permission: can browse Reports and post comments, but cannot triage or view Reporter contact data. | observer, read-only member |
| **Maintenance staff** | Staff with repository Triage (or higher) permission: triage, assign, comment, close/reopen, reveal Reporter contact, and Reissue links. | technician, agent |
| **System admin** | Staff with repository Admin permission: Maintenance staff capabilities plus Allowlist, Staff management, Configuration, recovery, and Erasure. | administrator, superuser |
| **Staff invitation** | A pending GitHub repository invitation granting a GitHub account a Staff role once accepted. | pending member, invite link |

## Classification

| Term | Meaning | Avoid |
| --- | --- | --- |
| **Taxonomy** | The Categories, Locations, Priorities, and Statuses configured for a Deployment. Four dimensions are fixed; values belong to each Deployment. | label set, label scheme |
| **Category** | The kind of fault (one per Report), picked by the Reporter and correctable by Staff. | type, nature |
| **Location** | The coarse area of the premises (one per Report), picked from the Taxonomy. | area, zone |
| **Exact place** | Optional free-text locator (room, floor, fixture) within the picked Location. | sub-location, detail |
| **Priority** | Staff's optional internal urgency ranking; unset means untriaged. Never shown to Reporters. | urgency, severity |
| **Status** | The handling stage of an open Report (one per open Report; missing or conflicting Status is surfaced for Staff correction). Closed Reports have no Status. | state, stage |
| **Initial status** | The single Status marked `initial` that new and reopened Reports start in. Entering it never sends email. | default status |
| **Status flag** | A configured property on a Status (`initial` or `notify`) so automation never depends on label wording. | status role |
| **Closed** | End state of a Report: *fixed*, *rejected*, or *duplicate* (counted under rejected). | resolved, done |
| **Emergency notice** | Deployment-configured banner on the Submission form telling Reporters whom to call in an emergency instead of filing a Report. | warning banner |
