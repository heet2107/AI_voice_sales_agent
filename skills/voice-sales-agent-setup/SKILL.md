---
name: voice-sales-agent-setup
description: Configure, validate, and optionally deploy the reusable AI voice sales CRM for a new client. Use when cloning the template, collecting business requirements, connecting ClawCall, or proving setup readiness; do not use it as authorization to activate or run outreach.
---

# Voice Sales Agent Setup

Set up a client-specific instance without carrying over another client's identity, data, credentials, or campaign state. A technically ready system must remain paused until the user separately authorizes outreach.

## Locate the template

Work from the repository root. The application lives in `cloud-crm/`; client configuration lives in `cloud-crm/config/business-profile.json`, with `business-profile.example.json` as the safe template.

Begin read-only:

- Inspect `README.md`, `cloud-crm/README.md`, `cloud-crm/package.json`, `.env.example`, the business-profile example, Git status, and existing remotes.
- Preserve unrelated or uncommitted work. Never reuse `.env.local`, `.vercel/`, live database rows, recordings, transcripts, or client-specific exports from the source checkout.
- If this is a fresh client, use a new database and deployment project unless the user explicitly identifies an existing client environment to update.

## Collect the client brief

Read [client-intake.md](references/client-intake.md) and collect only missing information. Separate verified business facts from sales hypotheses. Put business-safe configuration in the profile; put secrets only in the local or hosting-provider secret store.

Do not invent an employee identity, offer, price, proof point, operating hour, compliance claim, or booking capability. The representative name and role must be truthful and client-approved.

## Bootstrap while paused

Use the repository bootstrap command described in the root README, normally:

```bash
node scripts/bootstrap-client.mjs --client "Client Name"
```

Review the resulting diff before proceeding. Confirm that:

- `cloud-crm/config/business-profile.json` describes only the current client;
- runtime secrets remain untracked and no secret value appears in output;
- both the profile and runtime environment keep execution disabled/paused;
- the fixed recording disclosure, truthful AI answer, DNC, privacy, pricing, booking-confirmation, and no-guarantee controls remain intact.

Do not weaken a fixed guardrail to match a client preference. Record the conflict and request a compliant alternative.

## Connect ClawCall

Treat operator tooling and the deployed runtime as two distinct connections:

1. **Operator-side capability:** If the ClawCall skill or MCP is installed, read its current instructions and verify that it is callable. Use only a documented read-only account check when the user has authorized account validation. Do not place a test call as part of setup.
2. **Cloud runtime:** The application uses its HTTPS provider adapter and the `CLAWCALL_API_KEY` secret. Add the credential through `.env.local` or the deployment platform's encrypted environment settings. Never write it into the business profile, source, Git history, chat, or logs.

Do not invent an MCP endpoint or assume that connecting an MCP also configures the deployed application. Report each connection independently.

## Validate

Run the deterministic readiness check from the repository root:

```bash
python3 skills/voice-sales-agent-setup/scripts/check_readiness.py
```

Then run the application quality gate:

```bash
cd cloud-crm
npm run config:check
npm run typecheck
npm test
npm run build
```

Database migrations, seed operations, remote environment changes, and deployment are external mutations. Perform them only when they are within the user's request and the exact target is known. Never run seed data against an existing client database without confirming that it is intended for this instance.

For detailed proof requirements, read [readiness-checklist.md](references/readiness-checklist.md).

## Deploy only when requested

When deployment is requested, use a client-specific hosting project and database, set encrypted environment variables, migrate the intended database, deploy, and verify the live protected surface. Keep campaign execution paused both in environment configuration and the database setting.

Deployment readiness is not outreach authorization. Do not enable a campaign, generate a live queue, place a call, send a follow-up, or schedule recurring outreach without a separate, explicit user instruction that covers that action.

## Handoff

Lead with the observable result. Report:

- repository/config identity and whether secrets are excluded from Git;
- operator-side ClawCall status and cloud-runtime credential status separately;
- database, tests, build, deployment, authentication, and health-check evidence;
- campaign gate state, which must be paused;
- any missing business facts or human/legal approvals;
- the exact next action required before a first authorized canary call.

Never describe a meeting as booked, a message as sent, a call as completed, or a deployment as live unless the relevant system confirms it.
