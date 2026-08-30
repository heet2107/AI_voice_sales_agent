import { db } from "@/lib/db";

async function main() {
  const inserted = await db().query(`WITH candidates AS (
    SELECT c.id
    FROM calls c
    LEFT JOIN analysis_calibrations cal ON cal.call_id=c.id
    WHERE c.lifecycle='finalized'
      AND COALESCE(c.ai_analysis,'{}'::jsonb) ? 'conversationScorecard'
      AND (c.ai_analysis->'conversationScorecard'->>'humanConnected')::boolean IS TRUE
      AND cal.id IS NULL
    ORDER BY c.finalized_at DESC
    LIMIT 15
  )
  INSERT INTO analysis_calibrations(call_id,status)
  SELECT id,'pending' FROM candidates
  ON CONFLICT(call_id) DO NOTHING
  RETURNING call_id`);

  const stats = await db().query(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE status='reviewed')::int AS reviewed,
    count(*) FILTER (WHERE status='pending')::int AS pending
  FROM analysis_calibrations`);
  console.log(JSON.stringify({ inserted: inserted.length, calibration: stats[0] }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Calibration preparation failed");
  process.exitCode = 1;
});
