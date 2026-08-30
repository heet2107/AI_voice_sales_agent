import { analyzeAndApply } from "@/lib/analysis";
import type { ClawCallTerminal } from "@/lib/clawcall";
import { requireSession } from "@/lib/dal";
import { db } from "@/lib/db";

export const maxDuration = 300;

export async function POST() {
  await requireSession();
  const calls = await db().query(`SELECT id,lead_id,network_outcome,outcome_detail,talk_seconds,transcript,
      recording_url,recording_available_until,finalized_at
    FROM calls
    WHERE lifecycle='finalized' AND (
      (analysis_status IN ('legacy','pending','fallback')
        AND (summary IS NULL OR summary LIKE 'Imported %' OR summary='Call completed without enough discovery information.'))
      OR NOT (COALESCE(ai_analysis,'{}'::jsonb) ? 'conversationScorecard')
    )
    ORDER BY finalized_at ASC LIMIT 25`);
  const completed: Array<{ callId: string; summary: string }> = [];
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
        recording_expired: true,
        timestamps: { finalized_at: call.finalized_at ? new Date(String(call.finalized_at)).toISOString() : undefined }
      };
      await db().query(`UPDATE calls SET transcript_captured_at=COALESCE(transcript_captured_at,finalized_at,created_at),
        recording_expired=true,updated_at=now() WHERE id=$1`, [call.id]);
      const analysis = await analyzeAndApply(String(call.id), String(call.lead_id), terminal);
      completed.push({ callId: String(call.id), summary: analysis.summary });
    } catch (error) {
      errors.push({ callId: String(call.id), error: error instanceof Error ? error.message : "Backfill failed" });
    }
  }
  return Response.json({ checked: calls.length, completed, errors });
}
