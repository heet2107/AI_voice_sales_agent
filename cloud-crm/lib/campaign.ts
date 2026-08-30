import { analyzeAndApply, createDailyScriptSuggestion } from "@/lib/analysis";
import { buildCallInstructions } from "@/lib/call-script";
import { getCall, startCall } from "@/lib/clawcall";
import { db, logActivity, setting } from "@/lib/db";
import type { Lead } from "@/lib/repository";
import { compareCanary } from "@/lib/experiments";
import { parseConversationScorecard, type ConversationScorecard } from "@/lib/sales-intelligence";
import { loadBusinessProfile } from "@/lib/business-config";

const businessProfile = loadBusinessProfile();
const campaignTimezone = businessProfile.operations.timezone;

export function centralParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: campaignTimezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday: get("weekday"), hour: Number(get("hour")), minute: Number(get("minute")) };
}

const weekdayKeys: Record<string, string> = {
  Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun"
};

function minutesOfDay(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : Number.NaN;
}

export function configuredCampaignWindow() {
  const minutes = businessProfile.operations.callSlots.map(minutesOfDay).filter(Number.isFinite).sort((a, b) => a - b);
  const firstMinute = minutes[0] ?? 10 * 60;
  const lastMinute = minutes.at(-1) ?? 15 * 60;
  return {
    firstMinute,
    lastMinute,
    preparationHour: Math.max(0, Math.floor(firstMinute / 60) - 1),
    reviewHour: Math.min(23, Math.floor(lastMinute / 60) + 1),
    timezone: campaignTimezone,
  };
}

function isOpenAtSlot(lead: Lead, weekday: string, slot: string) {
  const intervals = lead.business_hours?.[weekdayKeys[weekday] ?? ""];
  if (!Array.isArray(intervals) || intervals.length === 0) return false;
  const slotMinute = minutesOfDay(slot);
  return intervals.some(([start, end]) => {
    const startMinute = minutesOfDay(start);
    const endMinute = minutesOfDay(end);
    return slotMinute >= startMinute && slotMinute < endMinute;
  });
}

function followUpIsDue(lead: Lead, localDate: string, slot: string) {
  const dueAt = lead.next_follow_up_at
    ? new Date(lead.next_follow_up_at)
    : lead.last_contact_at
      ? new Date(new Date(lead.last_contact_at).getTime() + 24 * 60 * 60 * 1000)
      : null;
  if (!dueAt) return true;
  const due = centralParts(dueAt);
  const [slotHour, slotMinute] = slot.split(":").map(Number);
  if (due.date < localDate) return true;
  if (due.date > localDate) return false;
  return due.hour * 60 + due.minute <= slotHour * 60 + slotMinute;
}

function selectForSlots(candidates: Lead[], slotLabels: string[], weekday: string, localDate: string) {
  const remaining = [...candidates];
  const selected: Array<{ lead: Lead; slot: string }> = [];
  for (const slot of slotLabels) {
    const index = remaining.findIndex((lead) => isOpenAtSlot(lead, weekday, slot) && followUpIsDue(lead, localDate, slot));
    if (index < 0) continue;
    selected.push({ lead: remaining.splice(index, 1)[0], slot });
  }
  return selected;
}

function allocateSegmentTargets(total: number, previousMix: Array<{ segment: string; count: number }>) {
  const definitions = businessProfile.operations.segmentTargets.map((target) => {
    const segment = businessProfile.outreach.segments.find((item) => item.id === target.segmentId)!;
    const previous = previousMix
      .filter((row) => segment.leadSegmentValues.includes(String(row.segment)))
      .reduce((sum, row) => sum + Number(row.count), 0);
    return { target, segment, previous, count: 0 };
  });
  let remaining = Math.max(0, total);
  while (remaining > 0 && definitions.some((item) => item.count < item.target.minimum)) {
    for (const item of definitions) {
      if (remaining === 0) break;
      if (item.count < item.target.minimum) { item.count += 1; remaining -= 1; }
    }
  }
  while (remaining > 0 && definitions.some((item) => item.count < item.target.maximum)) {
    const eligible = definitions
      .filter((item) => item.count < item.target.maximum)
      .sort((a, b) => (a.previous + a.count) - (b.previous + b.count));
    for (const item of eligible) {
      if (remaining === 0) break;
      item.count += 1;
      remaining -= 1;
    }
  }
  return definitions;
}

function allocateSegmentSlots(slots: string[], targets: ReturnType<typeof allocateSegmentTargets>) {
  const assigned = new Map<string, string[]>(targets.map((item) => [item.segment.id, []]));
  const remaining = new Map(targets.map((item) => [item.segment.id, item.count]));
  let slotIndex = 0;
  while (slotIndex < slots.length && [...remaining.values()].some((count) => count > 0)) {
    for (const item of targets) {
      if (slotIndex >= slots.length) break;
      const count = remaining.get(item.segment.id) ?? 0;
      if (count <= 0) continue;
      assigned.get(item.segment.id)!.push(slots[slotIndex]);
      remaining.set(item.segment.id, count - 1);
      slotIndex += 1;
    }
  }
  return assigned;
}

export async function ensureDailyQueue(localDate: string) {
  const existing = await db().query(`SELECT r.id,r.status,r.attempted_count,count(q.id)::int AS count
    FROM campaign_runs r LEFT JOIN daily_queue q ON q.run_id=r.id
    WHERE r.run_date=$1::date GROUP BY r.id,r.status,r.attempted_count`, [localDate]);
  if (existing.length && (Number(existing[0].count) > 0 || Number(existing[0].attempted_count) > 0)) {
    return { created: false, count: Number(existing[0].count), status: existing[0].status };
  }

  const [cap, slots, previousMix] = await Promise.all([
    setting("daily_call_cap", businessProfile.operations.dailyCallCap),
    setting<string[]>("slots", businessProfile.operations.callSlots),
    db().query(`SELECT l.segment,count(*)::int AS count
      FROM daily_queue q JOIN leads l ON l.id=q.lead_id
      WHERE q.queue_date=(SELECT max(queue_date) FROM daily_queue WHERE queue_date < $1::date)
      GROUP BY l.segment`, [localDate])
  ]);
  const nowLocal = centralParts();
  const availableSlots = nowLocal.date === localDate
    ? slots.filter((slot) => minutesOfDay(slot) >= nowLocal.hour * 60 + nowLocal.minute)
    : slots;
  const weekday = centralParts(new Date(`${localDate}T18:00:00Z`)).weekday;
  const maxLifetimeAttempts = await setting("max_lifetime_attempts", businessProfile.operations.maxLifetimeAttempts);
  const candidates = await db().query(`SELECT l.* FROM leads l
    WHERE l.qualified=true AND l.do_not_call=false AND l.attempt_count < $2
      AND l.pipeline_stage NOT IN ('Meeting','Not interested','Disqualified')
      AND l.verified_on >= $1::date - interval '30 days'
      AND l.business_hours <> '{}'::jsonb
      AND (l.next_follow_up_at IS NULL OR (l.next_follow_up_at AT TIME ZONE $3)::date <= $1::date)
      AND (l.last_contact_at IS NULL OR (l.last_contact_at AT TIME ZONE $3)::date < $1::date)
      AND NOT EXISTS (SELECT 1 FROM dnc_entries d WHERE d.phone=l.phone)
    ORDER BY l.priority='High' DESC,l.lead_score DESC,l.verified_on DESC` , [localDate, maxLifetimeAttempts, campaignTimezone]);

  const targetTotal = Math.min(Number(cap), availableSlots.length);
  const segmentTargets = allocateSegmentTargets(targetTotal, previousMix as Array<{ segment: string; count: number }>);
  const segmentSlots = allocateSegmentSlots(availableSlots.slice(0, targetTotal), segmentTargets);
  let remainingCandidates = candidates as Lead[];
  const segmentResults = segmentTargets.map((item) => {
    const matching = remainingCandidates.filter((lead) => item.segment.leadSegmentValues.includes(lead.segment));
    const picked = selectForSlots(matching, segmentSlots.get(item.segment.id) ?? [], weekday, localDate);
    const pickedIds = new Set(picked.map((selection) => selection.lead.id));
    remainingCandidates = remainingCandidates.filter((lead) => !pickedIds.has(lead.id));
    return { ...item, picked };
  });
  const balanced = segmentResults.every((item) => item.picked.length === item.count);
  const selected = segmentResults.flatMap((item) => item.picked).sort((a, b) => slots.indexOf(a.slot) - slots.indexOf(b.slot));
  const mixSummary = segmentResults.map((item) => `${item.segment.label}: ${item.picked.length}/${item.count}`).join("; ");

  const runs = await db().query(
    `INSERT INTO campaign_runs(run_date,status,target_count,notes) VALUES($1::date,$3,$2,$4)
     ON CONFLICT(run_date) DO UPDATE SET target_count=excluded.target_count,status=excluded.status,notes=excluded.notes,finished_at=NULL RETURNING id`,
    [localDate, cap, selected.length ? "scheduled" : "completed",
      balanced ? null : `Partial daily queue: ${mixSummary}. No unverified or closed lead was added.`]
  );
  const runId = runs[0].id;
  for (let index = 0; index < selected.length; index += 1) {
    const selection = selected[index];
    const sequence = slots.indexOf(selection.slot) + 1;
    await db().query(
      `INSERT INTO daily_queue(run_id,queue_date,slot_label,sequence,lead_id,status)
       VALUES($1,$2::date,$3,$4,$5,'scheduled') ON CONFLICT(queue_date,sequence) DO NOTHING`,
      [runId, localDate, selection.slot, sequence, selection.lead.id]
    );
  }
  await logActivity("campaign_run", String(runId), "queue_created", {
    localDate, selected: selected.length,
    segmentMix: Object.fromEntries(segmentResults.map((item) => [item.segment.id, { selected: item.picked.length, requested: item.count }])),
    eligibilityShortfall: !balanced
  });
  return { created: true, count: selected.length, desired: cap };
}

async function retryableStart(to: string, task: string) {
  try { return await startCall({ to, task }); }
  catch (error) {
    const code = (error as Error & { code?: string }).code;
    if (!["number_pool_exhausted", "dial_failed", "network_error"].includes(code ?? "")) throw error;
    await new Promise((resolve) => setTimeout(resolve, code === "number_pool_exhausted" ? 15000 : 4000));
    return startCall({ to, task });
  }
}

function looksLikeHumanConnection(transcript: unknown) {
  if (!Array.isArray(transcript)) return false;
  const prospectLines = transcript
    .filter((line): line is { role?: string; text?: string } => Boolean(line && typeof line === "object" && (line as { role?: string }).role === "user"))
    .map((line) => String(line.text ?? "").trim())
    .filter(Boolean);
  if (!prospectLines.length) return false;
  const joined = prospectLines.join(" ");
  const ivrOnly = /thank you for calling|press (?:one|two|three|four|zero|\d)|at the tone|leave (?:us |a )?message|voice ?mail|mailbox|business hours|your call (?:is|may be)|google subscriber/i.test(joined)
    && !prospectLines.some((line) => /how (?:can|may) i help|this is [a-z]+|yes\b|speaking|not (?:in|available)|call back|send an email/i.test(line));
  return !ivrOnly;
}

async function conversationCircuitBreaker(localDate: string) {
  const [enabled, threshold, active] = await Promise.all([
    setting("conversation_circuit_breaker_enabled", true),
    setting("conversation_circuit_breaker_human_calls", 5),
    db().query("SELECT version FROM script_versions WHERE status IN ('canary','active') ORDER BY (status='canary') DESC,activated_at DESC LIMIT 1")
  ]);
  const version = String(active[0]?.version ?? "");
  if (!enabled || !version) return { paused: false };
  const rows = await db().query(`SELECT id,task_success,summary,transcript
    FROM calls
    WHERE lifecycle='finalized'
      AND (started_at AT TIME ZONE $3)::date=$1::date
      AND task LIKE $2
    ORDER BY started_at`, [localDate, `%Use campaign script ${version}:%`, campaignTimezone]);
  const humanCalls = rows.filter((row) => looksLikeHumanConnection(row.transcript));
  if (humanCalls.length < Number(threshold)) return { paused: false, reviewed: humanCalls.length };
  const sample = humanCalls.slice(-Number(threshold));
  const progress = sample.filter((row) => ["partial", "achieved"].includes(String(row.task_success))).length;
  const audioFailures = sample.filter((row) => /audio|repeated greetings|no prospect speech|hear me/i.test(String(row.summary ?? ""))).length;
  if (progress > 0 && audioFailures < 2) return { paused: false, reviewed: sample.length, progress, audioFailures };
  await db().query(`INSERT INTO settings(key,value) VALUES('campaign_enabled','false'::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`);
  await db().query(`UPDATE campaign_runs SET notes=concat_ws(' ',notes,$2) WHERE run_date=$1::date`, [
    localDate,
    `Safety pause after ${sample.length} human connections on ${version}: ${progress} partial/achieved conversations and ${audioFailures} audio failures. Review transcripts before resuming.`
  ]);
  await logActivity("campaign", localDate, "conversation_circuit_breaker", { version, sample: sample.map((row) => row.id), progress, audioFailures });
  return { paused: true, reason: "Conversation-quality circuit breaker", reviewed: sample.length, progress, audioFailures };
}

export async function dispatchDueCall(now = new Date()) {
  const local = centralParts(now);
  const window = configuredCampaignWindow();
  const currentMinute = local.hour * 60 + local.minute;
  if (currentMinute < window.firstMinute || currentMinute > window.lastMinute + 5) {
    return { skipped: true, reason: `Outside the configured ${window.timezone} calling window` };
  }
  if (process.env.CAMPAIGN_MODE !== "live") return { skipped: true, reason: "CAMPAIGN_MODE is paused" };
  if (!(await setting("campaign_enabled", false))) return { skipped: true, reason: "Campaign database switch is paused" };
  await ensureDailyQueue(local.date);
  const qualityGate = await conversationCircuitBreaker(local.date);
  if (qualityGate.paused) return { skipped: true, ...qualityGate };
  const state = await db().query(`SELECT
      EXISTS(SELECT 1 FROM calls WHERE lifecycle!='finalized') AS active_call,
      MAX(started_at) FILTER (WHERE (started_at AT TIME ZONE $2)::date=$1::date) AS last_started_at
    FROM calls`, [local.date, campaignTimezone]);
  if (state[0]?.active_call) return { skipped: true, reason: "A prior call is still active" };
  if (state[0]?.last_started_at && now.getTime() - new Date(state[0].last_started_at).getTime() < 15 * 60 * 1000) {
    return { skipped: true, reason: "Minimum 15-minute spacing has not elapsed" };
  }
  const scheduled = await db().query(`SELECT id,sequence,slot_label,outcome,updated_at FROM daily_queue
    WHERE queue_date=$1::date AND status='scheduled' ORDER BY sequence`, [local.date]);
  const due = scheduled.find((row) => {
    if (minutesOfDay(String(row.slot_label)) > currentMinute) return false;
    if (!String(row.outcome ?? "").startsWith("technical_retry_scheduled:")) return true;
    return now.getTime() - new Date(row.updated_at).getTime() >= 5 * 60 * 1000;
  });
  if (!due) return { skipped: true, reason: "No scheduled call is due yet" };
  const claimed = await db().query(
    `UPDATE daily_queue SET status='dispatching',updated_at=now()
     WHERE id=(SELECT id FROM daily_queue WHERE id=$2 AND queue_date=$1::date AND status='scheduled' FOR UPDATE SKIP LOCKED)
     RETURNING *`,
    [local.date, due.id]
  );
  if (!claimed.length) return { skipped: true, reason: "Slot already processed or no eligible lead" };
  const queue = claimed[0];
  const leadRows = await db().query("SELECT * FROM leads WHERE id=$1", [queue.lead_id]);
  const lead = leadRows[0] as Lead | undefined;
  const maxLifetimeAttempts = await setting("max_lifetime_attempts", businessProfile.operations.maxLifetimeAttempts);
  if (!lead || lead.do_not_call || lead.attempt_count >= Number(maxLifetimeAttempts) || !isOpenAtSlot(lead, local.weekday, String(queue.slot_label)) || !followUpIsDue(lead, local.date, String(queue.slot_label))) {
    await db().query("UPDATE daily_queue SET status='blocked',outcome='Eligibility changed before dispatch',updated_at=now() WHERE id=$1", [queue.id]);
    return { skipped: true, reason: "Eligibility changed before dispatch" };
  }
  try {
    const callBrief = await buildCallInstructions(lead);
    const task = callBrief.instructions;
    const started = await retryableStart(lead.phone, task);
    await db().query(
      `INSERT INTO calls(id,lead_id,queue_id,lifecycle,task,script_version_id,started_at) VALUES($1,$2,$3,$4,$5,$6,now())`,
      [started.call_id, lead.id, queue.id, started.status || "queued", task, callBrief.scriptVersionId]
    );
    await db().query("UPDATE daily_queue SET status='calling',outcome=NULL,updated_at=now() WHERE id=$1", [queue.id]);
    await db().query("UPDATE leads SET attempt_count=attempt_count+1,last_contact_at=now(),pipeline_stage='Attempted',updated_at=now() WHERE id=$1", [lead.id]);
    await db().query("UPDATE campaign_runs SET status='running',started_at=COALESCE(started_at,now()),attempted_count=attempted_count+1 WHERE id=$1", [queue.run_id]);
    await db().query(`UPDATE follow_ups SET status='completed',completed_at=now(),updated_at=now()
      WHERE lead_id=$1 AND type='retry_call' AND status='open' AND due_at <= now() + interval '5 minutes'`, [lead.id]);
    await logActivity("call", started.call_id, "dispatched", { leadId: lead.id, queueId: queue.id, sequence: queue.sequence, scheduledSlot: queue.slot_label });
    return { started: true, callId: started.call_id, leadId: lead.id, sequence: queue.sequence, scheduledSlot: queue.slot_label };
  } catch (error) {
    const details = error as Error & { code?: string; status?: number; actionUrl?: string };
    const technicalCodes = ["number_pool_exhausted", "dial_failed", "network_error", "system_error", "reserved_number_busy"];
    const alreadyRetried = String(queue.outcome ?? "").startsWith("technical_retry_scheduled:");
    const retryInFiveMinutes = technicalCodes.includes(details.code ?? "") && !alreadyRetried;
    await db().query("UPDATE daily_queue SET status=$1,outcome=$2,updated_at=now() WHERE id=$3", [
      retryInFiveMinutes ? "scheduled" : "error",
      retryInFiveMinutes ? `technical_retry_scheduled:${details.code}` : (details.code || details.message),
      queue.id
    ]);
    await logActivity("queue", String(queue.id), "dispatch_failed", { code: details.code, status: details.status, message: details.message, actionUrl: details.actionUrl });
    if (retryInFiveMinutes) return { started: false, retryScheduled: true, retryAfterMinutes: 5, code: details.code, sequence: queue.sequence };
    throw error;
  }
}

async function updateScriptExperimentForCall(callId: string) {
  const rows = await db().query(`SELECT e.id,e.baseline_script_id,e.variant_script_id,e.target_human_calls,
      c.ai_analysis
    FROM calls c JOIN script_experiments e ON e.variant_script_id=c.script_version_id
    WHERE c.id=$1 AND e.status='running'`, [callId]);
  const experiment = rows[0];
  const currentCard = parseConversationScorecard(experiment?.ai_analysis);
  if (!experiment || !currentCard?.humanConnected) return { updated: false };
  const samples = await db().query(`SELECT script_version_id,ai_analysis
    FROM calls
    WHERE lifecycle='finalized' AND script_version_id IN ($1,$2)
      AND COALESCE(ai_analysis,'{}'::jsonb) ? 'conversationScorecard'
    ORDER BY finalized_at DESC LIMIT 100`, [experiment.baseline_script_id, experiment.variant_script_id]);
  const cardsFor = (scriptId: string) => samples
    .filter((row) => String(row.script_version_id) === String(scriptId))
    .map((row) => parseConversationScorecard(row.ai_analysis))
    .filter((card): card is ConversationScorecard => Boolean(card?.humanConnected));
  const control = cardsFor(String(experiment.baseline_script_id));
  const canary = cardsFor(String(experiment.variant_script_id));
  const target = Number(experiment.target_human_calls ?? 5);
  const comparison = compareCanary(control.slice(0, target), canary.slice(0, target), { minimumHumanCalls: target });
  const ready = control.length >= target && canary.length >= target;
  await db().query(`UPDATE script_experiments SET human_calls=$1,result=$2::jsonb,
      status=CASE WHEN $3 THEN 'ready_to_decide' ELSE status END,
      completed_at=CASE WHEN $3 THEN now() ELSE completed_at END
    WHERE id=$4`, [canary.length, JSON.stringify(comparison), ready, experiment.id]);
  await logActivity("script_experiment", String(experiment.id), ready ? "ready_to_decide" : "canary_call_scored", {
    callId, controlHumanCalls: control.length, canaryHumanCalls: canary.length, decision: comparison.decision,
  });
  return { updated: true, ready, comparison };
}

async function setNextCadenceRetry(leadId: string, callId: string, finalizedAt: string, reason: string) {
  const dueAt = new Date(new Date(finalizedAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
  await db().query(`UPDATE leads SET next_follow_up_at=GREATEST(COALESCE(next_follow_up_at,$1::timestamptz),$1::timestamptz),updated_at=now() WHERE id=$2`, [dueAt, leadId]);
  await db().query(`INSERT INTO follow_ups(lead_id,call_id,type,status,due_at,notes)
    SELECT $1,$2,'retry_call','open',$3::timestamptz,$4
    WHERE NOT EXISTS (SELECT 1 FROM follow_ups WHERE call_id=$2 AND type='retry_call')`, [leadId, callId, dueAt, reason]);
  await logActivity("call", callId, "retry_carried_forward", { leadId, dueAt, reason });
  return { scheduled: false, dueAt, reason };
}

async function scheduleSameDayRetry(callId: string, leadId: string, queueId: string, outcome: string | null, finalizedAt: string) {
  if (!(await setting("same_day_retry", false)) || !["no_answer", "busy"].includes(outcome ?? "")) return { scheduled: false, reason: "Outcome is not eligible for automatic same-day retry" };
  const [leadRows, queueRows, todayCalls, maxSameDay, gapMinutes] = await Promise.all([
    db().query("SELECT * FROM leads WHERE id=$1", [leadId]),
    db().query("SELECT * FROM daily_queue WHERE id=$1", [queueId]),
    db().query(`SELECT count(*)::int AS count FROM calls
      WHERE lead_id=$1 AND (started_at AT TIME ZONE $3)::date=($2::timestamptz AT TIME ZONE $3)::date`, [leadId, finalizedAt, campaignTimezone]),
    setting("same_day_retry_max_per_lead", 1),
    setting("same_day_retry_min_gap_minutes", 80)
  ]);
  const lead = leadRows[0] as Lead | undefined;
  const queue = queueRows[0];
  const maxLifetimeAttempts = await setting("max_lifetime_attempts", businessProfile.operations.maxLifetimeAttempts);
  if (!lead || !queue || lead.do_not_call || lead.attempt_count >= Number(maxLifetimeAttempts)) return { scheduled: false, reason: "Lead is no longer eligible" };
  if (Number(todayCalls[0]?.count ?? 0) > Number(maxSameDay)) {
    return setNextCadenceRetry(leadId, callId, finalizedAt, "Same-day retry limit reached; carry to the next verified-open time after 24 hours.");
  }

  const local = centralParts(new Date(finalizedAt));
  if (String(queue.queue_date).slice(0, 10) !== local.date) {
    return setNextCadenceRetry(leadId, callId, finalizedAt, "Call finalized outside its queue date; carry forward after 24 hours.");
  }
  const earliestMinute = local.hour * 60 + local.minute + Number(gapMinutes);
  const future = await db().query(`SELECT id,sequence,slot_label,slot_at,lead_id FROM daily_queue
    WHERE run_id=$1 AND queue_date=$2::date AND status='scheduled' AND sequence>$3 ORDER BY sequence`, [queue.run_id, local.date, queue.sequence]);
  const replacement = future.find((row) => minutesOfDay(String(row.slot_label)) >= earliestMinute && isOpenAtSlot(lead, local.weekday, String(row.slot_label)));
  if (!replacement) {
    return setNextCadenceRetry(leadId, callId, finalizedAt, "No later verified-open slot remained inside today's 15-attempt capacity.");
  }

  const swapped = await db().query(`WITH displaced AS (
      DELETE FROM daily_queue WHERE id=$1 AND status='scheduled'
      RETURNING lead_id,sequence,slot_label,slot_at
    )
    UPDATE daily_queue q SET sequence=d.sequence,slot_label=d.slot_label,slot_at=d.slot_at,status='scheduled',
      outcome=$2,updated_at=now()
    FROM displaced d WHERE q.id=$3
    RETURNING q.sequence,q.slot_label,d.lead_id AS displaced_lead_id`,
    [replacement.id, `Same-day retry after ${outcome}; previous call ${callId}.`, queueId]);
  if (!swapped.length) return setNextCadenceRetry(leadId, callId, finalizedAt, "The later slot was no longer available; carry forward after 24 hours.");

  const dueRows = await db().query(`SELECT (($1::date::text || ' ' || $2)::timestamp AT TIME ZONE $3)::text AS due_at`, [local.date, swapped[0].slot_label, campaignTimezone]);
  const dueAt = String(dueRows[0].due_at);
  await db().query("UPDATE leads SET next_follow_up_at=$1::timestamptz,updated_at=now() WHERE id=$2", [dueAt, leadId]);
  await db().query(`INSERT INTO follow_ups(lead_id,call_id,type,status,due_at,notes)
    VALUES($1,$2,'retry_call','open',$3::timestamptz,$4)`, [leadId, callId, dueAt, `One same-day retry after ${outcome}; use prior-call context.`]);
  await logActivity("call", callId, "same_day_retry_scheduled", {
    leadId, dueAt, sequence: swapped[0].sequence, displacedLeadId: swapped[0].displaced_lead_id,
    dailyAttemptCapPreserved: true
  });
  return { scheduled: true, dueAt, displacedLeadId: swapped[0].displaced_lead_id };
}

export async function pollActiveCalls() {
  const active = await db().query(`SELECT id,lead_id,queue_id FROM calls WHERE lifecycle!='finalized' ORDER BY started_at LIMIT 10`);
  const completed: string[] = [];
  const pending: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];
  for (const call of active) {
    try {
      const terminal = await getCall(String(call.id));
      if (terminal.lifecycle !== "finalized") {
        await db().query("UPDATE calls SET lifecycle=$1,updated_at=now() WHERE id=$2", [terminal.lifecycle, call.id]);
        pending.push(String(call.id));
        continue;
      }
      const finalizedAt = terminal.timestamps?.finalized_at ?? new Date().toISOString();
      const recordingAvailableUntil = terminal.recording_available_until
        ?? (terminal.recording_url ? new Date(new Date(finalizedAt).getTime() + 10 * 60 * 1000).toISOString() : null);
      await db().query(
        `UPDATE calls SET lifecycle='finalized',network_outcome=$1,outcome_detail=$2::jsonb,talk_seconds=$3,transcript=$4::jsonb,
          recording_url=$5,recording_available_until=$6::timestamptz,recording_expired=$7,transcript_captured_at=now(),
          finalized_at=COALESCE($8::timestamptz,now()),updated_at=now() WHERE id=$9`,
        [terminal.outcome ?? null, JSON.stringify(terminal.outcome_detail ?? {}), terminal.talk_seconds ?? 0,
          JSON.stringify(terminal.transcript ?? []), terminal.recording_url ?? null, recordingAvailableUntil,
          terminal.recording_expired ?? false, terminal.timestamps?.finalized_at ?? null, call.id]
      );
      await db().query("UPDATE daily_queue SET status='completed',outcome=$1,updated_at=now() WHERE id=$2", [terminal.outcome ?? "finalized", call.queue_id]);
      await analyzeAndApply(String(call.id), String(call.lead_id), terminal);
      await updateScriptExperimentForCall(String(call.id));
      await scheduleSameDayRetry(String(call.id), String(call.lead_id), String(call.queue_id), terminal.outcome ?? null, finalizedAt);
      completed.push(String(call.id));
    } catch (error) {
      errors.push({ id: String(call.id), error: error instanceof Error ? error.message : "Polling failed" });
    }
  }
  return { checked: active.length, completed, pending, errors };
}

export async function dailyReview() {
  const local = centralParts();
  const result = await createDailyScriptSuggestion(local.date);
  await db().query("UPDATE campaign_runs SET status='completed',finished_at=now() WHERE run_date=$1::date AND status='running'", [local.date]);
  await logActivity("campaign", local.date, "daily_review", result);
  return result;
}

export function verifyCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}
