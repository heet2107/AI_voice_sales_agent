import { analyzeAndApply } from "@/lib/analysis";
import type { ClawCallTerminal } from "@/lib/clawcall";
import { db } from "@/lib/db";

async function main() {
  const requestedLimit = Number(process.argv[2] ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 100;
  const calls = await db().query(`SELECT id,lead_id,network_outcome,outcome_detail,talk_seconds,transcript,
    recording_url,recording_available_until,recording_expired,finalized_at
  FROM calls
  WHERE lifecycle='finalized'
    AND NOT (COALESCE(ai_analysis,'{}'::jsonb) ? 'conversationScorecard')
  ORDER BY finalized_at ASC LIMIT $1`, [limit]);

  const completed: string[] = [];
  const errors: Array<{ callId: string; error: string }> = [];
  for (const call of calls) {
    try {
      const terminal: ClawCallTerminal = {
      id: String(call.id),
      lifecycle: "finalized",
      outcome: call.network_outcome ? String(call.network_outcome) : undefined,
      outcome_detail: call.outcome_detail,
      talk_seconds: Number(call.talk_seconds ?? 0),
      transcript: Array.isArray(call.transcript) ? call.transcript as ClawCallTerminal["transcript"] : [],
      recording_url: call.recording_url ? String(call.recording_url) : null,
      recording_available_until: call.recording_available_until ? String(call.recording_available_until) : null,
      recording_expired: Boolean(call.recording_expired),
      timestamps: { finalized_at: call.finalized_at ? new Date(String(call.finalized_at)).toISOString() : undefined },
      };
      await analyzeAndApply(String(call.id), String(call.lead_id), terminal);
      completed.push(String(call.id));
    } catch (error) {
      errors.push({ callId: String(call.id), error: error instanceof Error ? error.message : "Backfill failed" });
    }
  }
  console.log(JSON.stringify({ checked: calls.length, completed: completed.length, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Backfill failed");
  process.exitCode = 1;
});
