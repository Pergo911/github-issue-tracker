# One Deployment per Organization, self-deployed

The system is built as one independent Deployment per Organization, each with its own GitHub Organization, Cloudflare account, Resend domain and bot credential. It is not a hosted multi-tenant service. The "reporter email never goes into GitHub" invariant is a data-minimization design, and a shared service would make its operator the central holder of every Organization's reporter emails. The free-tier sizing (Resend 100 emails/day, free KV) only fits one building at a time.

The reference Deployment is a demonstration or coursework one, so this effort stands up a single Deployment and keeps every per-Deployment value (GitHub Organization and repo names, sending address, branding, label taxonomy, the Electron shell's target URL) in configuration rather than code.

## Considered Options

- **Hosted multi-tenant service.** Rejected. It needs a tenant id in every KV key, a GitHub App installed on each customer's GitHub Organization, per-customer sending domains, tenant isolation, GDPR data-processor obligations, billing and support. That is a different and much larger project, and the brief doesn't ask for it.
- **Shared instance for a few known Organizations.** Rejected. It carries most of the multi-tenant cost for little of its benefit.
- **Several repos inside one Deployment**, one per building. Rejected. It re-introduces tenancy inside a Deployment. One Deployment has one reports repo, and buildings are `location:*` labels in it.

## Consequences

- Staff separation per building is not supported. Every Staff member with a role on the repo sees every Report. An Organization that needs hard separation runs separate Deployments.
- The Electron shell is built once per Deployment, with its URL set at build time.
- Tooling for adopters to deploy their own copy is out of scope for this design and left to implementation.
