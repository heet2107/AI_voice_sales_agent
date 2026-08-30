# Observable readiness checklist

Use this checklist after bootstrap and before describing a client instance as ready.

## Repository

- The checkout has an expected remote and clean or understood Git state.
- `cloud-crm/config/business-profile.json` exists, validates, and contains the intended client only.
- No `.env.local`, provider key, passcode, database URL, transcript, recording, or client export is tracked.
- Business-specific behavior comes from configuration or database records rather than hardcoded source edits.

## Provider connections

- The installed ClawCall skill/MCP is discoverable for operator-side work.
- A documented read-only account check succeeds if the user authorized it.
- The deployed runtime separately has the `CLAWCALL_API_KEY` secret name configured.
- No call is used as an authentication or readiness test.

## Application and data

- Supported Node.js version and dependencies install cleanly.
- Typecheck, automated tests, and production build pass.
- Migration targets the intended new client database and completes successfully.
- Seed/bootstrap data contains the new client's settings, no prior-client leads or transcripts, and a disabled campaign switch.
- Transcript persistence, durable summaries, scorecards, follow-ups, DNC state, calibration, and meeting briefs have valid empty states.

## Protected deployment

- The production deployment is bound to the intended project and exact source revision.
- Unauthenticated access is rejected or redirected to authentication.
- Authentication succeeds with the client-owned credential.
- The live health route succeeds.
- The dashboard shows the intended client identity and an empty or intentionally imported pipeline.
- Both the environment campaign mode and database campaign switch are paused.
- Scheduled jobs may be installed, but they cannot dispatch while either safety gate is paused.

## Authorization boundary

Report these independently:

1. setup complete;
2. deployment verified;
3. provider connected;
4. outreach authorized.

The first three never imply the fourth. Before a live canary, confirm the exact audience, number of attempts, calling window, retry policy, recording disclosure, consent/DNC basis, success criteria, and rollback/stop condition.
