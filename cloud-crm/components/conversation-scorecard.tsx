import { Badge } from "@/components/ui";
import { parseConversationScorecard } from "@/lib/sales-intelligence";
import { loadBusinessProfile } from "@/lib/business-config";

function yesNo(value: boolean | null) {
  if (value === null) return "Not enough evidence";
  return value ? "Yes" : "No";
}

export function ConversationScorecard({ analysis }: { analysis: unknown }) {
  const profile = loadBusinessProfile();
  const card = parseConversationScorecard(analysis);
  if (!card) return <p className="scorecard-empty">No structured conversation scorecard is stored for this call yet.</p>;
  const qualitySignals = [
    ["One question at a time", card.qualitySignals.oneQuestionAtATime],
    ["Acknowledged answer", card.qualitySignals.acknowledgedAnswer],
    ["Reflected prospect language", card.qualitySignals.reflectedProspectLanguage],
    ["Reflected before pitch", card.qualitySignals.reflectedBeforePitch],
    ["Clarified business impact", card.qualitySignals.impactClarified],
    ["Recommended smallest solution", card.qualitySignals.recommendedSmallestSolution],
    ["Asked for inquiry call", card.qualitySignals.askedForInquiryCall],
    ["Honored refusal", card.qualitySignals.honoredRefusal],
  ] as const;
  return <section className="scorecard-box">
    <div className="scorecard-header"><div><span className="eyebrow">Conversation scorecard</span><h3>{card.stageReached.replaceAll("_", " ")}</h3></div><Badge status={card.endReason}>{card.endReason.replaceAll("_", " ")}</Badge></div>
    <div className="scorecard-grid">
      <div><span>Human connected</span><strong>{yesNo(card.humanConnected)}</strong></div>
      <div><span>Opening answered</span><strong>{yesNo(card.openingAnswered)}</strong></div>
      <div><span>Workflow answered</span><strong>{yesNo(card.workflowQuestionAnswered)}</strong></div>
      <div><span>Discovery completed</span><strong>{yesNo(card.discoveryCompleted)}</strong></div>
      <div><span>Pain confirmed</span><strong>{yesNo(card.painConfirmed)}</strong></div>
      <div><span>Recommendation made</span><strong>{yesNo(card.recommendationMade)}</strong></div>
      <div><span>Demo asked</span><strong>{yesNo(card.demoAsked)}</strong></div>
      <div><span>Demo accepted</span><strong>{yesNo(card.demoAccepted)}</strong></div>
      <div><span>Booking outcome</span><strong>{card.bookingOutcome.replaceAll("_", " ")}</strong></div>
      <div><span>Decision-maker</span><strong>{card.decisionMakerProgress.replaceAll("_", " ")}</strong></div>
    </div>
    <div className="scorecard-section"><span>Conversation quality</span><div className="quality-signal-grid">{qualitySignals.map(([label, value]) => <div className={`quality-signal ${value === true ? "pass" : value === false ? "fail" : "unknown"}`} key={label}><span>{label}</span><strong>{yesNo(value ?? null)}</strong></div>)}</div></div>
    {card.objectionDetails.length ? <div className="scorecard-section"><span>Objections heard</span>{card.objectionDetails.map((item, index) => <div className="objection-row" key={`${item.category}-${index}`}><div><strong>“{item.exact}”</strong><small>{item.category.replaceAll("_", " ")} · handled {item.handled.replaceAll("_", " ")}</small>{item.evidence ? <blockquote>Evidence: “{item.evidence}”</blockquote> : null}</div>{item.responseSummary ? <p>{item.responseSummary}</p> : null}</div>)}</div> : null}
    {card.demoDeclineReason ? <div className="scorecard-section"><span>Why the inquiry call was declined</span><p className="scorecard-evidence-copy">{card.demoDeclineReason}</p></div> : null}
    {card.commitments.length ? <div className="scorecard-section"><span>Commitments</span><div className="commitment-list">{card.commitments.map((item, index) => <div className="commitment-row" key={`${item.speaker}-${index}`}><div><strong>{item.speaker === "jessica" ? profile.agent.name : "Prospect"}</strong><p>{item.commitment}</p></div><div><Badge status={item.confirmed ? "confirmed" : "pending"}>{item.confirmed ? "confirmed" : "unconfirmed"}</Badge><small>{item.due || "No due date"}</small></div>{item.evidence ? <blockquote>“{item.evidence}”</blockquote> : null}</div>)}</div></div> : null}
    {card.followUpEvidence.required ? <div className="scorecard-section"><span>Follow-up evidence</span><div className="commitment-list"><div className="commitment-row"><div><strong>{card.followUpEvidence.type.replaceAll("_", " ")}</strong><p>{card.followUpEvidence.promisedAction || "Action requires human review"}</p><small>Contact method: {card.followUpEvidence.contactMethod}</small></div><div><Badge status={card.followUpEvidence.contactValueConfirmed ? "confirmed" : "pending"}>{card.followUpEvidence.contactValueConfirmed ? "contact confirmed" : "contact unconfirmed"}</Badge><small>{card.followUpEvidence.dueAt || "No due date"}</small></div>{card.followUpEvidence.evidence ? <blockquote>“{card.followUpEvidence.evidence}”</blockquote> : null}</div></div></div> : null}
    {card.unaddressedProspectQuestion ? <div className="warning-note">Unanswered question: {card.unaddressedProspectQuestion}</div> : null}
    {card.evidence.length ? <details className="scorecard-evidence"><summary>View transcript evidence ({card.evidence.length})</summary><div>{card.evidence.map((item, index) => <blockquote key={`${item.signal}-${index}`}><strong>{item.signal.replaceAll("_", " ")}</strong><span>“{item.excerpt}”</span></blockquote>)}</div></details> : null}
    {card.guardrailViolations.length ? <div className="danger-note"><strong>Guardrail review required</strong>{card.guardrailViolations.map((item, index) => <span key={`${item.category}-${index}`}>{item.category.replaceAll("_", " ")}: {item.description}{item.evidence ? ` — “${item.evidence}”` : ""}</span>)}</div> : card.qualitySignals.unsupportedClaimDetected ? <div className="danger-note"><strong>Review required</strong><span>The analysis detected a potentially unsupported claim.</span></div> : null}
  </section>;
}
