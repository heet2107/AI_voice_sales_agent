"use server";

import { revalidatePath } from "next/cache";
import { db, logActivity } from "@/lib/db";
import { requireSession } from "@/lib/dal";
import { centralParts, ensureDailyQueue } from "@/lib/campaign";
import type { Lead } from "@/lib/repository";
import { deriveResearchProfile, selectStoredIcpProfile } from "@/lib/sales-intelligence";

export async function updateLeadStage(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const stage = String(formData.get("stage") ?? "");
  const allowed = ["New","Research","Qualified","Scheduled","Attempted","Contacted","Voicemail","Callback","Interested","Meeting","Not interested","Disqualified"];
  if (!id || !allowed.includes(stage)) throw new Error("Invalid lead update");
  await db().query("UPDATE leads SET pipeline_stage=$1,updated_at=now() WHERE id=$2", [stage, id]);
  await logActivity("lead", id, "stage_updated", { stage });
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
}

export async function completeFollowUp(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing follow-up id");
  await db().query("UPDATE follow_ups SET status='completed',completed_at=now(),updated_at=now() WHERE id=$1", [id]);
  await logActivity("follow_up", id, "completed");
  revalidatePath("/");
  revalidatePath("/follow-ups");
}

export async function updateFollowUpDraft(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const draft = String(formData.get("draft") ?? "").trim();
  if (!id || !draft) throw new Error("Follow-up and draft are required");
  await db().query(`UPDATE follow_ups SET draft=$1,approval_status='draft',approved_at=NULL,updated_at=now()
    WHERE id=$2 AND status='open'`, [draft, id]);
  await logActivity("follow_up", id, "draft_updated");
  revalidatePath("/follow-ups");
}

export async function approveFollowUp(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing follow-up id");
  await db().query(`UPDATE follow_ups SET approval_status='approved',approved_at=now(),updated_at=now()
    WHERE id=$1 AND status='open' AND NULLIF(trim(COALESCE(draft,'')),'') IS NOT NULL`, [id]);
  await logActivity("follow_up", id, "approved");
  revalidatePath("/follow-ups");
}

export async function markFollowUpSent(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing follow-up id");
  const rows = await db().query(`UPDATE follow_ups SET status='completed',sent_at=now(),completed_at=now(),updated_at=now()
    WHERE id=$1 AND status='open' AND approval_status='approved' RETURNING id`, [id]);
  if (!rows.length) throw new Error("Approve the follow-up before marking it sent");
  await logActivity("follow_up", id, "marked_sent");
  revalidatePath("/");
  revalidatePath("/follow-ups");
}

export async function setCampaignEnabled(formData: FormData) {
  await requireSession();
  const enabled = formData.get("enabled") === "true";
  await db().query(
    "INSERT INTO settings(key,value) VALUES('campaign_enabled',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()",
    [JSON.stringify(enabled)]
  );
  await logActivity("campaign", null, enabled ? "enabled" : "paused");
  revalidatePath("/");
  revalidatePath("/settings");
}

export async function prepareTodayQueue() {
  await requireSession();
  const local = centralParts();
  const result = await ensureDailyQueue(local.date);
  await logActivity("campaign", local.date, "queue_prepared_manually", result);
  revalidatePath("/");
}

export async function refreshLeadResearchProfile(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing lead id");
  const rows = await db().query<Lead>("SELECT * FROM leads WHERE id=$1", [id]);
  const lead = rows[0];
  if (!lead) throw new Error("Lead not found");
  const storedProfiles = await db().query("SELECT * FROM icp_profiles WHERE active=true ORDER BY name");
  const profile = deriveResearchProfile(lead, { force: true, icpProfile: selectStoredIcpProfile(lead.category, storedProfiles) });
  await db().query(
    `UPDATE leads SET research_profile=$1::jsonb,research_status=$2,
      research_profile_updated_at=now(),updated_at=now() WHERE id=$3`,
    [JSON.stringify(profile), profile.status, id]
  );
  await logActivity("lead", id, "research_profile_refreshed", {
    status: profile.status,
    verifiedFactCount: profile.verifiedFacts.length,
    serviceHypothesis: profile.smallestLikelyService,
  });
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
}

export async function queueDeepResearch(formData: FormData) {
  await requireSession();
  const leadId = String(formData.get("leadId") ?? formData.get("id") ?? "");
  if (!leadId) throw new Error("Missing lead id");
  await db().query("UPDATE leads SET research_depth='deep',research_status='needs_review',updated_at=now() WHERE id=$1", [leadId]);
  await db().query(`INSERT INTO follow_ups(lead_id,type,status,approval_status,draft,notes)
    SELECT $1,'human_review','open','approved','Complete a deeper account audit before the next outreach attempt.',
      'Verify local buying authority, decision-maker identity, current inquiry workflow, source freshness, and any high-value integration opportunities.'
    WHERE NOT EXISTS (SELECT 1 FROM follow_ups WHERE lead_id=$1 AND type='human_review' AND status='open')`, [leadId]);
  await logActivity("lead", leadId, "deep_research_queued");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/follow-ups");
}

function formBoolean(value: FormDataEntryValue | null) {
  if (value === null || value === "unknown") return null;
  return value === "true" || value === "yes" || value === "on";
}

export async function submitCalibration(formData: FormData) {
  await requireSession();
  const callId = String(formData.get("callId") ?? formData.get("id") ?? "");
  const stageReached = String(formData.get("stageReached") ?? "");
  const endReason = String(formData.get("endReason") ?? "");
  if (!callId || !stageReached || !endReason) throw new Error("Call, stage, and ending reason are required");
  const manual = {
    stageReached,
    endReason,
    decisionMakerProgress: String(formData.get("decisionMakerProgress") ?? "not_reached"),
    openingAnswered: formBoolean(formData.get("openingAnswered")),
    workflowQuestionAnswered: formBoolean(formData.get("workflowQuestionAnswered")),
    discoveryCompleted: formBoolean(formData.get("discoveryCompleted")),
    painConfirmed: formBoolean(formData.get("painConfirmed")),
    recommendationMade: formBoolean(formData.get("recommendationMade")),
    impactClarified: formBoolean(formData.get("impactClarified")),
    demoAsked: formBoolean(formData.get("demoAsked")),
    demoAccepted: formBoolean(formData.get("demoAccepted")),
    qualitySignals: {
      oneQuestionAtATime: formBoolean(formData.get("oneQuestionAtATime")),
      acknowledgedAnswer: formBoolean(formData.get("acknowledgedAnswer")),
      reflectedBeforePitch: formBoolean(formData.get("reflectedBeforePitch")),
      impactClarified: formBoolean(formData.get("impactClarified")),
      recommendedSmallestSolution: formBoolean(formData.get("recommendedSmallestSolution")),
      askedForInquiryCall: formBoolean(formData.get("askedForInquiryCall")),
    },
    objection: {
      exact: String(formData.get("objectionExact") ?? "").trim() || null,
      category: String(formData.get("objectionCategory") ?? "other"),
      handled: String(formData.get("objectionHandled") ?? "not_applicable"),
    },
    demoDeclineReason: String(formData.get("demoDeclineReason") ?? "").trim() || null,
    unaddressedProspectQuestion: String(formData.get("unaddressedProspectQuestion") ?? "").trim() || null,
  };
  const rows = await db().query("SELECT ai_analysis->'conversationScorecard' AS scorecard FROM calls WHERE id=$1", [callId]);
  const ai = (rows[0]?.scorecard ?? {}) as Record<string, unknown>;
  const comparisons = ([
    ["stageReached", ai.stageReached, manual.stageReached], ["endReason", ai.endReason, manual.endReason],
    ["decisionMakerProgress", ai.decisionMakerProgress, manual.decisionMakerProgress],
    ["openingAnswered", ai.openingAnswered, manual.openingAnswered],
    ["workflowQuestionAnswered", ai.workflowQuestionAnswered, manual.workflowQuestionAnswered],
    ["discoveryCompleted", ai.discoveryCompleted, manual.discoveryCompleted],
    ["painConfirmed", ai.painConfirmed, manual.painConfirmed],
    ["recommendationMade", ai.recommendationMade, manual.recommendationMade],
    ["demoAsked", ai.demoAsked, manual.demoAsked], ["demoAccepted", ai.demoAccepted, manual.demoAccepted],
    ...Object.entries(manual.qualitySignals).map(([key, value]) => [key, (ai.qualitySignals as Record<string, unknown> | undefined)?.[key], value] as [string, unknown, unknown]),
  ] as Array<[string, unknown, unknown]>).filter(([, , value]) => value !== null);
  const matches = comparisons.filter(([, automated, value]) => automated === value).length;
  const agreement = {
    score: comparisons.length ? Number((matches / comparisons.length).toFixed(2)) : null,
    matches,
    reviewedSignals: comparisons.length,
    mismatches: comparisons.filter(([, automated, value]) => automated !== value).map(([key, automated, value]) => ({ key, ai: automated, manual: value })),
  };
  const notes = String(formData.get("notes") ?? "").trim() || null;
  await db().query(`INSERT INTO analysis_calibrations(call_id,status,manual_scorecard,agreement,notes,reviewed_at)
    VALUES($1,'reviewed',$2::jsonb,$3::jsonb,$4,now())
    ON CONFLICT(call_id) DO UPDATE SET status='reviewed',manual_scorecard=excluded.manual_scorecard,
      agreement=excluded.agreement,notes=excluded.notes,reviewed_at=now(),updated_at=now()`,
    [callId, JSON.stringify(manual), JSON.stringify(agreement), notes]);
  await logActivity("call", callId, "analysis_calibrated", agreement);
  revalidatePath("/calibration");
}

export async function updateIcpProfile(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  const fields = {
    name: String(formData.get("name") ?? "").trim(),
    segment: String(formData.get("segment") ?? "").trim(),
    matchTerms: String(formData.get("matchTerms") ?? "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean),
    decisionMakerRole: String(formData.get("decisionMakerRole") ?? "").trim(),
    discoveryQuestion: String(formData.get("discoveryQuestion") ?? "").trim(),
    likelyObjection: String(formData.get("likelyObjection") ?? "").trim(),
    safeResponse: String(formData.get("safeResponse") ?? "").trim(),
    serviceHypothesis: String(formData.get("serviceHypothesis") ?? "none").trim(),
    privacyNotes: String(formData.get("privacyNotes") ?? "").trim(),
    active: formData.get("active") === "on" || formData.get("active") === "true",
  };
  if (!id || !fields.name || !fields.segment || !fields.matchTerms.length || !fields.decisionMakerRole || !fields.discoveryQuestion || !fields.likelyObjection || !fields.safeResponse) throw new Error("Complete the required ICP fields");
  await db().query(`UPDATE icp_profiles SET name=$1,segment=$2,match_terms=$3::jsonb,decision_maker_role=$4,
    discovery_question=$5,likely_objection=$6,safe_response=$7,service_hypothesis=$8,privacy_notes=$9,
    active=$10,updated_at=now() WHERE id=$11`,
    [fields.name, fields.segment, JSON.stringify(fields.matchTerms), fields.decisionMakerRole, fields.discoveryQuestion, fields.likelyObjection, fields.safeResponse, fields.serviceHypothesis, fields.privacyNotes || null, fields.active, id]);
  await logActivity("icp_profile", id, "updated");
  revalidatePath("/icp");
}

export async function approveScript(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing script id");
  const [baseline, variant, running] = await Promise.all([
    db().query("SELECT id FROM script_versions WHERE status='active' ORDER BY activated_at DESC LIMIT 1"),
    db().query("SELECT id,evidence FROM script_versions WHERE id=$1 AND status='proposed'", [id]),
    db().query("SELECT id FROM script_experiments WHERE status IN ('running','ready_to_decide') LIMIT 1"),
  ]);
  if (!baseline[0] || !variant[0]) throw new Error("Active baseline or proposed variant is missing");
  if (running.length) throw new Error("Finish the current script experiment before starting another");
  const evidence = Array.isArray(variant[0].evidence) ? variant[0].evidence.map(String) : [];
  const rollback = evidence.find((item) => /rollback|revert/i.test(item)) ?? "Revert if workflow-question completion or respectful handling declines across the five human-call sample.";
  await db().query("UPDATE script_versions SET status='canary',activated_at=now() WHERE id=$1 AND status='proposed'", [id]);
  await db().query(`INSERT INTO script_experiments(baseline_script_id,variant_script_id,status,target_human_calls,rollback_condition)
    VALUES($1,$2,'running',5,$3)`, [baseline[0].id, id, rollback]);
  await logActivity("script", id, "canary_started", { baseline: baseline[0].id, targetHumanCalls: 5 });
  revalidatePath("/scripts");
}

export async function decideExperiment(formData: FormData) {
  await requireSession();
  const id = String(formData.get("id") ?? formData.get("experimentId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!id || !["keep", "revert"].includes(decision)) throw new Error("A valid experiment decision is required");
  const rows = await db().query("SELECT * FROM script_experiments WHERE id=$1 AND status='ready_to_decide'", [id]);
  const experiment = rows[0];
  if (!experiment) throw new Error("Experiment is not ready for a decision");
  if (decision === "keep") {
    await db().query("UPDATE script_versions SET status='archived' WHERE id=$1", [experiment.baseline_script_id]);
    await db().query("UPDATE script_versions SET status='active',activated_at=now() WHERE id=$1", [experiment.variant_script_id]);
    await db().query("UPDATE script_experiments SET status='kept',decided_at=now(),result=result || jsonb_build_object('decisionNotes',$2::text) WHERE id=$1", [id, notes]);
  } else {
    await db().query("UPDATE script_versions SET status='archived' WHERE id=$1", [experiment.variant_script_id]);
    await db().query("UPDATE script_experiments SET status='reverted',decided_at=now(),result=result || jsonb_build_object('decisionNotes',$2::text) WHERE id=$1", [id, notes]);
  }
  await logActivity("script_experiment", id, decision === "keep" ? "kept" : "reverted");
  revalidatePath("/scripts");
}
