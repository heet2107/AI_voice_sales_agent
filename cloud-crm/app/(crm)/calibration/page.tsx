import Link from "next/link";
import { CheckCircle2, ClipboardCheck, Scale } from "lucide-react";
import { submitCalibration } from "@/app/actions";
import { ConversationScorecard } from "@/components/conversation-scorecard";
import { Badge, EmptyState, Metric, PageTitle } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { getCalibrationData } from "@/lib/repository";
import { parseConversationScorecard } from "@/lib/sales-intelligence";
import { loadBusinessProfile } from "@/lib/business-config";

const stages = ["not_connected","disclosure","opening","workflow_question","gatekeeper","decision_maker","discovery","recommendation","demo_ask","scheduling","completed"];
const endingReasons = ["no_answer","voicemail","audio_failure","recording_concern","early_disconnect","gatekeeper","decision_maker_unavailable","not_interested","do_not_call","wrong_number","callback_requested","workflow_question_unanswered","objection_unresolved","demo_declined","calendar_followup","meeting_confirmed","completed","unknown"];
const booleanFields = [
  ["openingAnswered", "Opening received a response"],
  ["workflowQuestionAnswered", "First operational question answered"],
  ["discoveryCompleted", "Discovery completed"],
  ["painConfirmed", "Pain point confirmed"],
  ["recommendationMade", "Recommendation made"],
  ["demoAsked", "Inquiry call explicitly requested"],
  ["demoAccepted", "Inquiry call accepted"],
  ["oneQuestionAtATime", "One question at a time"],
  ["acknowledgedAnswer", "Acknowledged the answer"],
  ["reflectedBeforePitch", "Reflected before pitching"],
  ["impactClarified", "Clarified impact"],
  ["recommendedSmallestSolution", "Recommended smallest solution"],
  ["askedForInquiryCall", "Asked for inquiry call"],
] as const;

function truthValue(value: boolean | null | undefined) {
  if (value === true) return "true";
  if (value === false) return "false";
  return "unknown";
}

export default async function CalibrationPage() {
  const profile = loadBusinessProfile();
  const { calls, stats } = await getCalibrationData();
  const reviewed = Number(stats.reviewed || 0);
  const target = Math.min(15, Math.max(10, calls.length));
  const average = stats.average_agreement == null ? "—" : `${Math.round(Number(stats.average_agreement) * 100)}%`;
  return <>
    <PageTitle eyebrow="Human evaluation" title="Analyzer calibration" description="Review 10–15 varied transcripts before coaching recommendations are treated as reliable." />
    <section className="metrics-grid compact-metrics">
      <Metric label="Candidate set" value={calls.length} note="Finalized calls selected for review" />
      <Metric label="Reviewed" value={reviewed} note={`Target ${target || 10} human reviews`} tone="green" />
      <Metric label="Agreement" value={average} note="Automated scorecard versus human review" tone="violet" />
      <Metric label="Remaining" value={Math.max(0, target - reviewed)} note="Reviews before calibration is complete" tone="amber" />
    </section>
    <section className="insight-banner calibration-banner"><div className="insight-icon"><Scale size={20} /></div><div><span className="eyebrow">Calibration rule</span><h3>Transcript evidence wins over model confidence</h3><p>Read the full conversation, score only what the transcript supports, and use the reviewer notes to identify systematic evaluator errors—not to improve a single call’s appearance.</p></div><div className="guardrail"><ClipboardCheck size={15} /> Human reviewed</div></section>
    <section className="calibration-list">{calls.length ? calls.map((call, callIndex) => {
      const card = parseConversationScorecard(call.ai_analysis);
      const expanded = card as (typeof card & { qualitySignals?: Record<string, boolean | null> }) | null;
      const reviewedCall = String(call.calibration_status || "pending") === "reviewed";
      return <details className="panel calibration-card" key={String(call.id)} open={!reviewedCall && callIndex === 0}>
        <summary><div><span className="eyebrow">Review {callIndex + 1} of {calls.length}</span><h2>{String(call.business)}</h2><p>{String(call.category)} · {String(call.city)} · {formatDateTime(call.finalized_at as string | null)}</p></div><Badge status={reviewedCall ? "reviewed" : "pending"}>{reviewedCall ? "reviewed" : "needs review"}</Badge></summary>
        <div className="calibration-body">
          <div className="calibration-columns">
            <div><span className="section-label">Saved transcript</span><p className="calibration-summary">{String(call.summary || "No durable summary")}</p><div className="transcript calibration-transcript">{Array.isArray(call.transcript) ? call.transcript.map((line: { role?: string; text?: string }, index: number) => <div key={index} className={`transcript-line ${line.role === "assistant" ? "assistant" : "prospect"}`}><span>{line.role === "assistant" ? profile.agent.name : "Prospect"}</span><p>{line.text}</p></div>) : <p>No transcript lines are stored.</p>}</div><Link className="text-link" href={`/leads/${call.lead_id}`}>Open complete lead history</Link></div>
            <div><span className="section-label">Automated evaluation</span><ConversationScorecard analysis={call.ai_analysis} /></div>
          </div>
          <form action={submitCalibration} className="calibration-form">
            <input type="hidden" name="callId" value={String(call.id)} />
            <div className="review-fields"><label>Last successful stage<select name="stageReached" defaultValue={card?.stageReached || "not_connected"}>{stages.map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label>Primary ending reason<select name="endReason" defaultValue={card?.endReason || "unknown"}>{endingReasons.map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label>Decision-maker progress<select name="decisionMakerProgress" defaultValue={card?.decisionMakerProgress || "not_started"}>{["not_started","gatekeeper_engaged","role_identified","named_contact_identified","decision_maker_reached"].map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>{booleanFields.map(([name, label]) => {
              const source = name in (expanded?.qualitySignals || {}) ? expanded?.qualitySignals?.[name] : card?.[name as keyof typeof card];
              return <label key={name}>{label}<select name={name} defaultValue={truthValue(typeof source === "boolean" ? source : null)}><option value="unknown">Not enough evidence</option><option value="true">Yes</option><option value="false">No</option></select></label>;
            })}<label>Exact primary objection<input name="objectionExact" defaultValue={card?.objectionDetails[0]?.exact || ""} placeholder="Copy the prospect's exact words" /></label><label>Objection category<select name="objectionCategory" defaultValue={card?.objectionDetails[0]?.category || "other"}>{["timing","authority","status_quo","trust","budget","need","implementation","competition","recording","other"].map((value) => <option value={value} key={value}>{value.replaceAll("_", " ")}</option>)}</select></label><label>Handling quality<select name="objectionHandled" defaultValue={card?.objectionDetails[0]?.handled || "not_applicable"}><option value="not_applicable">Not applicable</option><option value="yes">Handled</option><option value="partial">Partially handled</option><option value="no">Not handled</option></select></label><label>Inquiry-call decline reason<input name="demoDeclineReason" defaultValue={card?.demoDeclineReason || ""} /></label><label>Unanswered prospect question<input name="unaddressedProspectQuestion" defaultValue={card?.unaddressedProspectQuestion || ""} /></label></div>
            <label className="notes-field">Reviewer notes<textarea name="notes" defaultValue={String(call.notes || "")} rows={4} placeholder="Describe evaluator disagreements and quote the transcript evidence." /></label>
            <button className="primary-button" type="submit"><CheckCircle2 size={15} /> Save human review</button>
          </form>
        </div>
      </details>;
    }) : <section className="panel"><EmptyState title="No calibration candidates" body="Backfill conversation scorecards first; up to 15 varied finalized calls will appear here." /></section>}</section>
  </>;
}
