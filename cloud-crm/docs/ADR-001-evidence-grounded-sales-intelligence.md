# ADR-001: Evidence-grounded sales intelligence

Status: Accepted

## Context

The campaign needs stronger pre-call preparation and post-call learning, but prospect research can be stale and short call recordings expire. A generic sales framework can also over-score weak signals or encourage the caller to state hypotheses as facts.

## Decision

Keep sales intelligence inside the CRM and split it into three explicit layers:

1. Verified facts carry a source and verification date. Hypotheses are stored and displayed separately.
2. Transcript analysis writes a durable conversation scorecard alongside the summary. Every stage, objection, commitment, and booking result must be supported by transcript evidence.
3. Coaching aggregates repeated signals. A script change is considered only after five human-connected calls and at least one repeated ending signal, and the change remains review-required.

The live calling prompt receives a concise brief but is instructed not to read it verbatim or present a hypothesis as a fact. Fixed identity, disclosure, truthful AI response, consent, DNC, privacy, pricing, scheduling confirmation, and no-guarantee rules stay outside the learning loop.

## Consequences

- Call recordings are optional for later review because the transcript, summary, and scorecard are durable.
- A weak or unverified lead produces a neutral discovery question instead of a fabricated personalized claim.
- Learning is slower than per-call prompt mutation, but changes are auditable, reversible, and less likely to overfit one conversation.
- External research or sales-agent repositories are not runtime dependencies.
