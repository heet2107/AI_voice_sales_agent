import Link from "next/link";
import { CalendarCheck2, ListChecks, ShieldCheck } from "lucide-react";
import { Badge, EmptyState, PageTitle } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { getMeetingBriefs } from "@/lib/repository";

type Brief = {
  meetingStatus?: string;
  confirmedAt?: string | null;
  timeZone?: string | null;
  format?: string;
  contactName?: string | null;
  decisionMakerRole?: string | null;
  objective?: string | null;
  painPoint?: string | null;
  currentProcess?: string | null;
  businessImpact?: string | null;
  desiredOutcome?: string | null;
  serviceHypothesis?: string | null;
  recommendedAgenda?: string[];
  openQuestions?: string[];
  boundaries?: string[];
  evidence?: string[];
};

function briefValue(value: unknown): Brief {
  return value && typeof value === "object" ? value as Brief : {};
}

export default async function MeetingsPage() {
  const meetings = await getMeetingBriefs();
  const confirmed = meetings.filter((row) => briefValue(row.brief).meetingStatus === "confirmed").length;
  return <>
    <PageTitle eyebrow="Human handoff" title="Meeting preparation" description="Turn confirmed discovery into a concise, evidence-backed agenda for the human inquiry call." />
    <section className="insight-banner"><div className="insight-icon"><CalendarCheck2 size={20} /></div><div><span className="eyebrow">Handoff standard</span><h3>{confirmed} confirmed meeting{confirmed === 1 ? "" : "s"} ready for preparation</h3><p>A brief summarizes only what the prospect said, identifies open questions, and preserves pricing, privacy and no-guarantee boundaries for the human advisor.</p></div><div className="guardrail"><ShieldCheck size={15} /> Transcript grounded</div></section>
    <section className="meeting-grid">{meetings.length ? meetings.map((row) => {
      const brief = briefValue(row.brief);
      const meetingAt = (brief.confirmedAt || row.meeting_at) as string | null;
      return <article className="panel meeting-card" key={String(row.id)}>
        <div className="panel-heading"><div><span className="eyebrow">{String(row.category)} · {String(row.city)}</span><h2><Link href={`/leads/${row.lead_id}`}>{String(row.business)}</Link></h2></div><Badge status={String(brief.meetingStatus || row.status)}>{String(brief.meetingStatus || row.status).replaceAll("_", " ")}</Badge></div>
        <div className="meeting-meta"><div><span>When</span><strong>{formatDateTime(meetingAt)}</strong><small>{brief.timeZone || "Time zone not confirmed"}</small></div><div><span>Format</span><strong>{String(brief.format || row.format || "unknown").replaceAll("_", " ")}</strong><small>{brief.contactName || "Contact name not captured"}</small></div><div><span>Decision-maker</span><strong>{brief.decisionMakerRole || "Confirm on the meeting"}</strong></div></div>
        <div className="meeting-story"><div><span>Pain point</span><p>{brief.painPoint || "Not confirmed"}</p></div><div><span>Current process</span><p>{brief.currentProcess || "Not confirmed"}</p></div><div><span>Business impact</span><p>{brief.businessImpact || "Not confirmed"}</p></div><div><span>Desired outcome</span><p>{brief.desiredOutcome || "Not confirmed"}</p></div></div>
        <div className="meeting-focus"><ListChecks size={17} /><div><strong>{brief.objective || "Confirm the workflow before recommending scope."}</strong><small>Initial service hypothesis: {brief.serviceHypothesis?.replaceAll("_", " ") || "none yet"}</small></div></div>
        <div className="meeting-lists"><div><span className="section-label">Suggested agenda</span>{brief.recommendedAgenda?.length ? <ol>{brief.recommendedAgenda.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ol> : <p>No agenda generated.</p>}</div><div><span className="section-label">Open questions</span>{brief.openQuestions?.length ? <ul>{brief.openQuestions.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p>No open questions recorded.</p>}</div></div>
        {brief.boundaries?.length ? <div className="meeting-boundaries"><span className="section-label">Boundaries for the advisor</span><ul>{brief.boundaries.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div> : null}
        {brief.evidence?.length ? <details className="scorecard-evidence"><summary>View source evidence ({brief.evidence.length})</summary><div>{brief.evidence.map((item, index) => <blockquote key={`${item}-${index}`}>“{item}”</blockquote>)}</div></details> : null}
      </article>;
    }) : <section className="panel"><EmptyState title="No meeting briefs" body="A brief is generated only when a transcript supports a calendar-link follow-up or confirmed meeting." /></section>}</section>
  </>;
}
