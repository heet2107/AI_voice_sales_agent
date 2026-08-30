# AI Voice Sales Agent CRM

Private, business-configurable CRM and cloud campaign control plane for evidence-grounded voice outreach and inbound call operations.

## Safety defaults

- Campaign execution starts paused (`CAMPAIGN_MODE=paused`).
- Dashboard and internal APIs require the signed passcode session.
- Cron routes require Vercel's `CRON_SECRET` bearer token.
- DNC, wrong-number, refusal, retry-cap, same-day retry, and booking-confirmation controls are deterministic database rules.
- The AI analyst can summarize and recommend script changes but cannot alter fixed guardrails.

## Sales intelligence

- Each lead has a pre-call brief that separates sourced facts from discovery hypotheses. The brief is rebuilt only from the CRM's current verification evidence; it does not scrape or invent prospect claims.
- Every finalized transcript receives a structured conversation scorecard: stage reached, ending reason, objections, commitments, demo ask, booking status, and quality signals.
- The coaching page aggregates 30 days of scored calls across funnel stage, exact objections, handling quality, category performance, follow-ups, unanswered questions, and demo-decline reasons.
- The calibration page prepares a 10–15 transcript review set and blocks automated script suggestions until at least 10 human reviews exist.
- Approved script changes run as a five-human-call canary against a five-call baseline. A safety regression forces a revert recommendation; keeping or reverting remains a human decision.
- Script suggestions remain review-required, show their evidence and test plan, and cannot modify identity, disclosure, consent, DNC, privacy, pricing, booking-confirmation, or no-guarantee controls.
- Follow-up drafts must be reviewed and approved before a user can mark them sent. The application does not send external messages from that control.
- The ICP page controls category matching, decision-maker role, discovery question, likely objection, evidence-safe response, smallest-service hypothesis, and privacy notes used in live call preparation.
- Meeting briefs are created only from transcript evidence and remain unconfirmed until a definite date, time, time zone, and format exist.

Older finalized calls can receive the new scorecard through the authenticated `POST /api/admin/backfill-summaries` route. Backfilling reuses stored transcripts and does not require an active recording link.

Operational routes are `/coaching`, `/calibration`, `/follow-ups`, `/meetings`, `/icp`, and `/scripts`. All require the signed dashboard session.

## Local quality gate

Run `npm run typecheck`, `npm test`, and `npm run build` before deployment. Use `npm run intelligence:backfill -- 100` to backfill historical calls and `npm run calibration:prepare` to create the pending human-review set.

## Setup

1. Run the repository-root bootstrap and edit `config/business-profile.json`.
2. Connect a client-specific Neon Postgres database and configure `.env.local`.
3. Run `npm run config:check`, `npm run db:migrate`, and `npm run db:seed`.
4. Run `npm run typecheck`, `npm test`, and `npm run build`.
5. Deploy to a client-specific Vercel project and verify the protected production URL while both campaign gates remain paused.

The deterministic analyzer remains available if the configured model provider is unavailable. Those calls are explicitly labeled `fallback`; model-enriched analysis requires a working AI provider account and credentials.
