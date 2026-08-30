import { db, setting } from "@/lib/db";
import { requireSession } from "@/lib/dal";
import { buildCoachingSummary } from "@/lib/sales-intelligence";
import { loadBusinessProfile } from "@/lib/business-config";

const businessProfile = loadBusinessProfile();
const repositoryTimezone = businessProfile.operations.timezone;

export type Lead = {
  id: string;
  business: string;
  category: string;
  segment: string;
  city: string;
  address: string | null;
  phone: string;
  rating: number | null;
  review_count: number | null;
  presence_class: string;
  website_url: string | null;
  social_url: string | null;
  evidence_notes: string | null;
  primary_source_url: string | null;
  presence_check_url: string | null;
  verified_on: string | null;
  confidence: string;
  lead_score: number;
  priority: string;
  qualified: boolean;
  pipeline_stage: string;
  do_not_call: boolean;
  dnc_reason: string | null;
  attempt_count: number;
  last_contact_at: string | null;
  next_follow_up_at: string | null;
  outcome: string | null;
  call_notes: string | null;
  business_hours: Record<string, Array<[string, string]>> | null;
  research_profile: unknown;
  research_status: string;
  research_profile_updated_at: string | null;
  research_depth: string;
};

export async function getDashboardData() {
  await requireSession();
  const [stats, queue, recentCalls, followUps, settings] = await Promise.all([
    db().query(`SELECT
      count(*)::int AS total_leads,
      count(*) FILTER (WHERE qualified)::int AS qualified_leads,
      count(*) FILTER (WHERE pipeline_stage IN ('Contacted','Attempted','Voicemail','Callback'))::int AS contacted,
      count(*) FILTER (WHERE pipeline_stage='Interested')::int AS interested,
      count(*) FILTER (WHERE pipeline_stage='Meeting')::int AS meetings,
      count(*) FILTER (WHERE do_not_call)::int AS dnc
      FROM leads`),
    db().query(`SELECT q.id,q.slot_label,q.sequence,q.status,q.outcome,l.id AS lead_id,l.business,l.category,l.city,l.segment,l.attempt_count
      FROM daily_queue q JOIN leads l ON l.id=q.lead_id
      WHERE q.queue_date=(now() AT TIME ZONE $1)::date
      ORDER BY q.sequence LIMIT 30`, [repositoryTimezone]),
    db().query(`SELECT c.id,c.network_outcome,c.task_success,c.talk_seconds,c.summary,c.finalized_at,
      l.id AS lead_id,l.business,l.city
      FROM calls c JOIN leads l ON l.id=c.lead_id
      ORDER BY COALESCE(c.finalized_at,c.started_at) DESC LIMIT 8`),
    db().query(`SELECT f.id,f.type,f.status,f.due_at,f.channel,f.draft,l.id AS lead_id,l.business
      FROM follow_ups f JOIN leads l ON l.id=f.lead_id
      WHERE f.status='open' ORDER BY f.due_at NULLS LAST LIMIT 8`),
    Promise.all([
      setting("campaign_enabled", false),
      setting("daily_call_cap", businessProfile.operations.dailyCallCap),
      setting("timezone", repositoryTimezone),
    ])
  ]);
  const pipeline = await db().query(`SELECT pipeline_stage AS stage,count(*)::int AS count FROM leads GROUP BY pipeline_stage ORDER BY count DESC`);
  const segment = await db().query(`SELECT segment,count(*)::int AS count FROM leads WHERE qualified GROUP BY segment`);
  return {
    stats: stats[0] ?? {}, queue, recentCalls, followUps, pipeline, segment,
    campaignEnabled: settings[0], dailyCallCap: settings[1], timezone: settings[2],
    hardMode: process.env.CAMPAIGN_MODE ?? "paused"
  };
}

export async function getLeads(search = "", stage = "all") {
  await requireSession();
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(business ILIKE $${params.length} OR city ILIKE $${params.length} OR category ILIKE $${params.length} OR phone ILIKE $${params.length})`);
  }
  if (stage !== "all") {
    params.push(stage);
    conditions.push(`pipeline_stage=$${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return db().query<Lead>(`SELECT * FROM leads ${where} ORDER BY qualified DESC, lead_score DESC, business ASC LIMIT 300`, params);
}

export async function getLead(id: string) {
  await requireSession();
  const [leadRows, calls, followUps, meetingBriefs] = await Promise.all([
    db().query("SELECT * FROM leads WHERE id=$1", [id]),
    db().query("SELECT * FROM calls WHERE lead_id=$1 ORDER BY COALESCE(finalized_at,started_at) DESC", [id]),
    db().query("SELECT * FROM follow_ups WHERE lead_id=$1 ORDER BY created_at DESC", [id]),
    db().query("SELECT * FROM meeting_briefs WHERE lead_id=$1 ORDER BY created_at DESC", [id])
  ]);
  return { lead: leadRows[0] as Lead | undefined, calls, followUps, meetingBriefs };
}

export async function getCalls() {
  await requireSession();
  return db().query(`SELECT c.*,l.business,l.city,l.category
    FROM calls c JOIN leads l ON l.id=c.lead_id
    ORDER BY COALESCE(c.finalized_at,c.started_at) DESC LIMIT 300`);
}

export async function getCoachingData() {
  await requireSession();
  const [calls, categoryPerformance, followUpsDue, unansweredQuestions, demoDeclines] = await Promise.all([
    db().query(`SELECT c.id,c.lead_id,c.network_outcome,c.task_success,c.talk_seconds,
      c.ai_analysis,c.summary,c.finalized_at,l.business,l.category,l.segment,l.city
    FROM calls c JOIN leads l ON l.id=c.lead_id
    WHERE c.lifecycle='finalized'
      AND COALESCE(c.finalized_at,c.started_at) >= now() - interval '30 days'
    ORDER BY COALESCE(c.finalized_at,c.started_at) DESC LIMIT 500`),
    db().query(`SELECT l.category,
        count(*)::int AS calls,
        count(*) FILTER (WHERE (c.ai_analysis->'conversationScorecard'->>'humanConnected')::boolean IS TRUE)::int AS connected,
        count(*) FILTER (WHERE (c.ai_analysis->'conversationScorecard'->>'workflowQuestionAnswered')::boolean IS TRUE)::int AS workflow_answers,
        count(*) FILTER (WHERE (c.ai_analysis->'conversationScorecard'->>'demoAsked')::boolean IS TRUE)::int AS demo_asks,
        count(*) FILTER (WHERE (c.ai_analysis->'conversationScorecard'->>'demoAccepted')::boolean IS TRUE)::int AS demo_accepts
      FROM calls c JOIN leads l ON l.id=c.lead_id
      WHERE c.lifecycle='finalized' AND COALESCE(c.finalized_at,c.started_at) >= now() - interval '30 days'
      GROUP BY l.category ORDER BY connected DESC,calls DESC,l.category LIMIT 20`),
    db().query(`SELECT f.id,f.type,f.due_at,f.approval_status,f.draft,l.id AS lead_id,l.business
      FROM follow_ups f JOIN leads l ON l.id=f.lead_id
      WHERE f.status='open' AND (f.due_at IS NULL OR f.due_at <= now() + interval '7 days')
      ORDER BY f.due_at NULLS LAST LIMIT 20`),
    db().query(`SELECT c.id,c.lead_id,l.business,l.category,
        c.ai_analysis->'conversationScorecard'->>'unaddressedProspectQuestion' AS question
      FROM calls c JOIN leads l ON l.id=c.lead_id
      WHERE NULLIF(c.ai_analysis->'conversationScorecard'->>'unaddressedProspectQuestion','') IS NOT NULL
        AND COALESCE(c.finalized_at,c.started_at) >= now() - interval '30 days'
      ORDER BY c.finalized_at DESC LIMIT 20`),
    db().query(`SELECT c.id,c.lead_id,l.business,l.category,
        c.ai_analysis->'conversationScorecard'->>'demoDeclineReason' AS reason
      FROM calls c JOIN leads l ON l.id=c.lead_id
      WHERE NULLIF(c.ai_analysis->'conversationScorecard'->>'demoDeclineReason','') IS NOT NULL
        AND COALESCE(c.finalized_at,c.started_at) >= now() - interval '30 days'
      ORDER BY c.finalized_at DESC LIMIT 20`)
  ]);
  return { calls, summary: buildCoachingSummary(calls), categoryPerformance, followUpsDue, unansweredQuestions, demoDeclines };
}

export async function getFollowUps() {
  await requireSession();
  return db().query(`SELECT f.*,l.business,l.city,l.phone
    FROM follow_ups f JOIN leads l ON l.id=f.lead_id
    ORDER BY (f.status='open') DESC,f.due_at NULLS LAST,f.created_at DESC LIMIT 300`);
}

export async function getScripts() {
  await requireSession();
  return db().query("SELECT * FROM script_versions ORDER BY created_at DESC");
}

export async function getExperiments() {
  await requireSession();
  return db().query(`SELECT e.*,b.version AS baseline_version,v.version AS variant_version
    FROM script_experiments e
    JOIN script_versions b ON b.id=e.baseline_script_id
    JOIN script_versions v ON v.id=e.variant_script_id
    ORDER BY e.created_at DESC LIMIT 50`);
}

export async function getCalibrationData() {
  await requireSession();
  const [calls, stats] = await Promise.all([
    db().query(`SELECT c.id,c.lead_id,c.transcript,c.summary,c.ai_analysis,c.finalized_at,
        l.business,l.category,l.city,cal.id AS calibration_id,cal.status AS calibration_status,
        cal.manual_scorecard,cal.agreement,cal.notes,cal.reviewed_at
      FROM calls c JOIN leads l ON l.id=c.lead_id
      LEFT JOIN analysis_calibrations cal ON cal.call_id=c.id
      WHERE c.lifecycle='finalized' AND COALESCE(c.ai_analysis,'{}'::jsonb) ? 'conversationScorecard'
      ORDER BY (COALESCE(cal.status,'pending')='reviewed') ASC,
        ((c.ai_analysis->'conversationScorecard'->>'humanConnected')::boolean) DESC,
        c.finalized_at DESC LIMIT 15`),
    db().query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status='reviewed')::int AS reviewed,
        round(avg(NULLIF(agreement->>'score','')::numeric),2) AS average_agreement
      FROM analysis_calibrations`)
  ]);
  return { calls, stats: stats[0] ?? { total: 0, reviewed: 0, average_agreement: null } };
}

export async function getIcpProfiles() {
  await requireSession();
  return db().query("SELECT * FROM icp_profiles ORDER BY segment,name");
}

export async function getMeetingBriefs() {
  await requireSession();
  return db().query(`SELECT m.*,l.business,l.category,l.city
    FROM meeting_briefs m JOIN leads l ON l.id=m.lead_id
    ORDER BY m.created_at DESC LIMIT 100`);
}

export async function getSettings() {
  await requireSession();
  return db().query("SELECT key,value,updated_at FROM settings ORDER BY key");
}
