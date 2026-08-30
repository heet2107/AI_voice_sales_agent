# AI Voice Sales Agent

A reusable, private CRM and orchestration system for configuring an inbound or outbound voice-sales workflow around a client's business knowledge. It prepares evidence-grounded call instructions, tracks leads and calls, stores durable transcripts and summaries, generates follow-ups and meeting briefs, and exposes results in a passcode-protected web dashboard.

The repository is designed to be cloned for a new client. Client requirements and credentials stay outside Git. Every fresh setup starts with calling **paused**.

## Five-minute start

Prerequisites: Node.js 22, npm, a Neon Postgres connection string, and a ClawCall account/connector. Vercel is optional for local use and recommended for the hosted CRM and scheduled jobs.

```bash
git clone https://github.com/heet2107/AI_voice_sales_agent.git
cd AI_voice_sales_agent

# Installs locked dependencies and creates only local, ignored template files.
node scripts/bootstrap-client.mjs --client "Your Business Name"
```

Then:

1. Edit `cloud-crm/config/business-profile.json`. Replace the sample company, services, agent identity, service area, customer segments, discovery question, scheduling details, disclosure language, and business-specific guardrails.
2. Fill the blank values in `cloud-crm/.env.local`. Never paste credentials into `business-profile.json`.
3. Initialize the database and start the dashboard:

```bash
cd cloud-crm
npm run config:check
npm run db:migrate
npm run typecheck
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). This is first success: a protected CRM backed by your client profile, with the campaign still paused. Do not enable calling until the readiness checklist below is complete.

To add researched prospects, copy `cloud-crm/config/leads.example.json` to the ignored `cloud-crm/config/leads.json`, replace every example with current source-backed lead information, then validate and import:

```bash
cd cloud-crm
npm run leads:import -- --file config/leads.json --dry-run
npm run leads:import -- --file config/leads.json
```

The importer rejects missing evidence, unverified business hours, and phone numbers outside `+1` E.164 format. Imported leads default to unqualified unless `qualified` is explicitly true. Importing does not enable the campaign or place calls.

To preview what bootstrap would do without writing files or installing packages:

```bash
node scripts/bootstrap-client.mjs --client "Your Business Name" --dry-run
```

## What bootstrap does

- verifies Node.js 22+, npm, the application package, environment template, and business-profile template;
- runs `npm ci` in `cloud-crm` using the committed lockfile;
- creates ignored `cloud-crm/config/business-profile.json` from the non-secret example;
- creates ignored `cloud-crm/.env.local` with blank credential fields;
- verifies that `CAMPAIGN_MODE=paused` is present;
- never accepts, generates, prints, or uploads credentials; and
- never migrates a database, deploys, activates a campaign, or places a call.

Existing local profile or environment files are preserved. Bootstrap refuses to continue when an existing environment explicitly enables campaign execution.

## Client business profile

The profile is the training brief for one client. Keep factual business knowledge separate from hypotheses and prospect-specific research. The checked-in schema example is [cloud-crm/config/business-profile.example.json](cloud-crm/config/business-profile.example.json); the active local copy is intentionally ignored.

It covers:

- company identity, website, location, description, value proposition, and services;
- agent name, role, voice, and tone;
- target regions, segments, categories, decision-maker roles, and discovery question;
- public contact and scheduling behavior;
- recording and truthful AI-disclosure policy;
- opt-out, pricing, privacy, sensitive-data, and no-guarantee guardrails; and
- dashboard branding.

Validate it before any deployment:

```bash
cd cloud-crm
npm run config:check
```

If a profile fails validation, fix the reported field. Do not weaken the fixed safety controls to make it pass.

## Credentials and prerequisites

The runtime variables are documented in [cloud-crm/.env.example](cloud-crm/.env.example). At minimum, configure:

- `DATABASE_URL`: pooled Neon Postgres connection string;
- `CLAWCALL_API_KEY`: runtime credential used by the server-side calling adapter;
- `AUTH_SECRET`: long random value used to sign dashboard sessions;
- `DASHBOARD_PASSCODE_HASH`: SHA-256 hash of the chosen six-digit dashboard passcode;
- `CRON_SECRET`: long random value used to authorize scheduled endpoints;
- an AI-provider credential supported by the configured model, when model-enriched analysis is desired; and
- `CAMPAIGN_MODE=paused` during setup and verification.

Generate local secret values in your own terminal; do not paste the raw passcode or generated values into chat or Git:

```bash
openssl rand -hex 32
node -e "const c=require('node:crypto'); const p=process.argv[1]; if(!/^\\d{6}$/.test(p)) throw Error('Use exactly six digits'); console.log(c.createHash('sha256').update(p).digest('hex'))" 'YOUR_6_DIGIT_PASSCODE'
```

### ClawCall connector

Install the provider skill in the operator environment when you want Codex/OpenClaw to configure or inspect the ClawCall connection:

```bash
openclaw skills install @clawcall-dev/clawcall-dev
```

That installed vendor skill is intentionally excluded from this repository. The hosted Next.js runtime currently calls the provider API through its server-side adapter, so it still needs `CLAWCALL_API_KEY` in its secret store. A local MCP/skill session does not automatically make its credentials available to Vercel; configure the equivalent Vercel secret explicitly.

No call is placed during installation, profile validation, migration, testing, or deployment.

## Neon database

1. Create a Neon project and database for the client.
2. Copy the pooled connection string into local `cloud-crm/.env.local` as `DATABASE_URL`.
3. Run the idempotent migration:

```bash
cd cloud-crm
npm run db:migrate
```

Use a separate database per client unless you have deliberately implemented and verified tenant isolation. Do not reuse historical campaign data as a new client's seed.

## Local quality gate

Run this before every deployment:

```bash
cd cloud-crm
npm ci
npm run config:check
npm run typecheck
npm test
npm run build
```

The deterministic transcript analyzer remains available when a configured model provider is unavailable. Those results must remain visibly labeled as fallback analysis.

## Deploy on Vercel

Set the Vercel project root directory to `cloud-crm`.

```bash
cd cloud-crm
vercel link
vercel env add DATABASE_URL
vercel env add CLAWCALL_API_KEY
vercel env add AUTH_SECRET
vercel env add DASHBOARD_PASSCODE_HASH
vercel env add CRON_SECRET
vercel env add CAMPAIGN_MODE
vercel env add BUSINESS_PROFILE_JSON
vercel --prod
```

Add any configured AI-provider variable and the business profile through `BUSINESS_PROFILE_JSON`, or ensure the deployment contains the intended non-secret profile file. Keep `CAMPAIGN_MODE` set to `paused` for the first production deployment.

After deployment, verify:

- `/api/health` responds successfully;
- unauthenticated CRM routes redirect to login;
- the passcode opens only the intended client dashboard;
- the displayed company, agent identity, services, scheduling behavior, and guardrails match the client profile;
- the Neon tables exist and contain no prior client's leads, transcripts, or DNC entries;
- all provider credentials are configured only in Vercel secrets; and
- campaign status is still paused.

Vercel cron routes may run while a campaign is paused, but they must not dispatch calls until both the application setting and the deployment safety gate are deliberately enabled.

## Before enabling outreach

Activation is a separate, explicit operation. Complete all of the following first:

- confirm the client controls the represented business identity, calling number, and scheduling destination;
- verify applicable calling, recording, consent, DNC, time-of-day, and industry-specific requirements with qualified counsel;
- approve the identity, disclosure, opt-out, privacy, pricing, booking-confirmation, and no-guarantee language;
- test only with authorized numbers and inspect the transcript, summary, follow-up, and CRM persistence;
- confirm daily caps, retry limits, local hours, stop conditions, and a kill switch;
- confirm that automatic script suggestions require human review and canary testing; and
- deliberately change the campaign controls only after sign-off.

Taking responsibility for account suspension or legal exposure does not replace provider rules, consent requirements, or the system's fixed safeguards.

## Reusable setup skill

The repository includes [skills/voice-sales-agent-setup/SKILL.md](skills/voice-sales-agent-setup/SKILL.md). Install or reference that skill when preparing another client. It guides profile creation, readiness checks, migration, and verification, and it must leave outreach paused unless the user separately authorizes activation after review.

To install it for Codex on a new machine:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/voice-sales-agent-setup "${CODEX_HOME:-$HOME/.codex}/skills/voice-sales-agent-setup"
```

Then invoke it as `$voice-sales-agent-setup`. The repo-contained copy remains the source of truth; reinstall it after pulling skill updates.

## Repository hygiene

The root `.gitignore` excludes credentials, active client profiles, provider-skill installations, Vercel link state, dependencies, build output, historical campaign exports, spreadsheets, transcripts, recordings, and generated presentations. Before pushing:

```bash
git status --short
git ls-files | grep -E '(^|/)(\.env|\.vercel|node_modules|outputs|recordings|transcripts)(/|$)' && echo "Review unexpected tracked files"
```

Commit source code, migrations, tests, documentation, the sanitized profile example, and the repo-owned setup skill—never client secrets or call data.
