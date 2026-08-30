import Link from "next/link";
import { CalendarClock, FlaskConical, MessageCircleQuestion, ShieldCheck } from "lucide-react";
import { Badge, EmptyState, Metric, PageTitle } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { getCoachingData } from "@/lib/repository";
import { parseConversationScorecard } from "@/lib/sales-intelligence";
import { loadBusinessProfile } from "@/lib/business-config";

function RankedList({ items, empty }: { items: Array<{ label: string; count: number }>; empty: string }) {
  if (!items.length) return <p className="ranked-empty">{empty}</p>;
  const max = Math.max(...items.map((item) => item.count));
  return <div className="bar-list">{items.map((item) => <div className="bar-item" key={item.label}><div><span>{item.label.replaceAll("_", " ")}</span><strong>{item.count}</strong></div><div className="bar-track"><span style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }} /></div></div>)}</div>;
}

function percent(value: number, total: number) {
  return total ? `${Math.round((value / total) * 100)}%` : "—";
}

export default async function CoachingPage() {
  const profile = loadBusinessProfile();
  const { calls, summary, categoryPerformance, followUpsDue, unansweredQuestions, demoDeclines } = await getCoachingData();
  const scored = calls.map((call) => ({ call, card: parseConversationScorecard(call.ai_analysis) })).filter((item) => item.card);
  const connected = scored.filter(({ card }) => card?.humanConnected);
  const quality = [
    ["One question at a time", connected.filter(({ card }) => card?.qualitySignals.oneQuestionAtATime).length],
    ["Acknowledged answer", connected.filter(({ card }) => card?.qualitySignals.acknowledgedAnswer).length],
    ["Reflected before pitching", connected.filter(({ card }) => card?.qualitySignals.reflectedBeforePitch).length],
    ["Clarified impact", connected.filter(({ card }) => card?.qualitySignals.impactClarified).length],
    ["Smallest solution", connected.filter(({ card }) => card?.qualitySignals.recommendedSmallestSolution).length],
    ["Asked for inquiry call", connected.filter(({ card }) => card?.qualitySignals.askedForInquiryCall).length],
  ] as const;
  return <>
    <PageTitle eyebrow="Evidence-based improvement" title="Conversation coaching" description="A 30-day view of where real conversations stop, what prospects ask, and which single change deserves a controlled test." action={<Link className="secondary-button" href="/calibration">Open calibration</Link>} />
    <section className="metrics-grid"><Metric label="Human connections" value={summary.humanConnections} note={`${summary.scoredCalls} calls have scorecards`} /><Metric label="Workflow answers" value={summary.workflowAnswers} note="Prospect answered the first operational question" tone="violet" /><Metric label="Discovery completed" value={summary.discoveries} note="Pain and context were explored" tone="green" /><Metric label="Demo accepted" value={summary.demoAccepts} note={`${summary.demoAsks} inquiry-call asks made`} tone="amber" /></section>
    <section className="insight-banner coaching-experiment"><div className="insight-icon"><FlaskConical size={20} /></div><div><span className="eyebrow">Next controlled experiment</span><h3>{summary.nextExperiment}</h3><p>Only one wording or sequence change should be tested at a time. Compare five human-connected calls, then keep or revert using transcript evidence.</p></div><div className="guardrail"><ShieldCheck size={15} /> Guardrails unchanged</div></section>
    <section className="coaching-grid"><article className="panel"><div className="panel-heading"><div><span className="eyebrow">Conversation funnel</span><h2>Last stage reached</h2></div></div><RankedList items={summary.stages} empty="No human-connected scorecards yet." /></article><article className="panel"><div className="panel-heading"><div><span className="eyebrow">Failure analysis</span><h2>How calls ended</h2></div></div><RankedList items={summary.endReasons} empty="No ending signals have been scored yet." /></article><article className="panel"><div className="panel-heading"><div><span className="eyebrow">Objection intelligence</span><h2>What prospects raised</h2></div></div><RankedList items={summary.objections} empty="No transcript-supported objections yet." /><div className="coaching-note"><strong>{summary.unhandledObjections}</strong><span>unhandled or partially handled objections</span></div></article></section>
    <section className="coaching-detail-grid">
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">Execution quality</span><h2>What {profile.agent.name} consistently does</h2></div></div><div className="quality-bars">{quality.map(([label, count]) => <div key={label}><div><span>{label}</span><strong>{percent(count, connected.length)}</strong></div><div className="bar-track"><span style={{ width: connected.length ? `${(count / connected.length) * 100}%` : "0%" }} /></div><small>{count} of {connected.length} connected calls</small></div>)}</div>{summary.unsupportedClaims ? <div className="danger-note"><strong>{summary.unsupportedClaims} claims need review</strong><span>Open the supporting scorecards before approving a script change.</span></div> : null}</article>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">Follow-up load</span><h2>Due within seven days</h2></div><CalendarClock size={18} /></div>{followUpsDue.length ? <div className="mini-list">{followUpsDue.slice(0, 8).map((item) => <Link className="coaching-action-row" href="/follow-ups" key={String(item.id)}><div><strong>{String(item.business)}</strong><span>{String(item.type).replaceAll("_", " ")} · {String(item.approval_status || "draft")}</span></div><small>{formatDateTime(item.due_at as string | null)}</small></Link>)}</div> : <EmptyState title="Nothing due" body="No open follow-up falls in the next seven days." />}</article>
    </section>
    <section className="panel coaching-table"><div className="panel-heading"><div><span className="eyebrow">Audience performance</span><h2>Results by business category</h2></div></div>{categoryPerformance.length ? <div className="data-table-wrap"><table className="data-table category-table"><thead><tr><th>Category</th><th>Calls</th><th>Connected</th><th>Workflow answered</th><th>Inquiry-call asks</th><th>Accepted</th></tr></thead><tbody>{categoryPerformance.map((row) => <tr key={String(row.category)}><td><strong>{String(row.category)}</strong></td><td>{Number(row.calls)}</td><td>{Number(row.connected)} · {percent(Number(row.connected), Number(row.calls))}</td><td>{Number(row.workflow_answers)} · {percent(Number(row.workflow_answers), Number(row.connected))}</td><td>{Number(row.demo_asks)}</td><td>{Number(row.demo_accepts)} · {percent(Number(row.demo_accepts), Number(row.demo_asks))}</td></tr>)}</tbody></table></div> : <EmptyState title="No category comparison yet" body="Category performance appears after scored calls are available." />}</section>
    <section className="coaching-detail-grid">
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">Unanswered questions</span><h2>Prospect questions to resolve</h2></div><MessageCircleQuestion size={18} /></div>{unansweredQuestions.length ? <div className="question-list">{unansweredQuestions.map((row) => <Link href={`/leads/${row.lead_id}`} key={String(row.id)}><strong>{String(row.business)}</strong><p>“{String(row.question)}”</p><small>{String(row.category)}</small></Link>)}</div> : <EmptyState title="No unanswered questions" body="The evaluator has not found an unresolved prospect question in this period." />}</article>
      <article className="panel"><div className="panel-heading"><div><span className="eyebrow">CTA learning</span><h2>Why inquiry calls were declined</h2></div></div>{demoDeclines.length ? <div className="question-list">{demoDeclines.map((row) => <Link href={`/leads/${row.lead_id}`} key={String(row.id)}><strong>{String(row.business)}</strong><p>{String(row.reason)}</p><small>{String(row.category)}</small></Link>)}</div> : <EmptyState title="No decline reasons captured" body="Reasons appear only when a prospect explicitly responds to an inquiry-call ask." />}</article>
    </section>
    <section className="panel coaching-recent"><div className="panel-heading"><div><span className="eyebrow">Audit trail</span><h2>Recent scored conversations</h2></div></div>{scored.length ? <div className="call-list">{scored.slice(0, 12).map(({ call, card }) => card ? <Link className="coaching-call-row" href={`/leads/${call.lead_id}`} key={String(call.id)}><div><strong>{String(call.business)}</strong><span>{String(call.category)} · {String(call.city)} · {formatDateTime(call.finalized_at as string | null)}</span><p>{String(call.summary || "No durable summary")}</p></div><div><Badge status={card.endReason}>{card.endReason.replaceAll("_", " ")}</Badge><small>{card.stageReached.replaceAll("_", " ")}</small></div></Link> : null)}</div> : <EmptyState title="No scored calls yet" body="Backfill finalized calls or wait for the next transcript analysis." />}</section>
  </>;
}
