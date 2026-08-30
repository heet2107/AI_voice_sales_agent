import Link from "next/link";
import { ArrowUpRight, CalendarClock, CirclePause, PhoneCall, ShieldCheck, Sparkles } from "lucide-react";
import { Badge, EmptyState, Metric, PageTitle } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { getDashboardData } from "@/lib/repository";
import { prepareTodayQueue } from "@/app/actions";
import { loadBusinessProfile } from "@/lib/business-config";

export default async function DashboardPage() {
  const data = await getDashboardData();
  const stats = data.stats as Record<string, number>;
  const maxPipeline = Math.max(...data.pipeline.map((row) => Number(row.count)), 1);
  const operational = data.hardMode === "live" && data.campaignEnabled;
  const profile = loadBusinessProfile();
  const agentFirstName = profile.agent.name.split(/\s+/)[0] || profile.agent.name;

  return (
    <>
      <PageTitle eyebrow="Operations overview" title={`Good morning, ${profile.branding.operatorName}.`} description={`One place to see what ${agentFirstName} called, learned, and needs next.`} action={<div className={`status-card ${operational ? "on" : "off"}`}>{operational ? <PhoneCall size={19} /> : <CirclePause size={19} />}<div><strong>{operational ? "Campaign live" : "Campaign paused"}</strong><span>{data.dailyCallCap} daily attempts · {profile.operations.timezone}</span></div></div>} />
      <section className="metrics-grid">
        <Metric label="Qualified leads" value={stats.qualified_leads ?? 0} note={`${stats.total_leads ?? 0} total researched`} tone="blue" />
        <Metric label="Contacted" value={stats.contacted ?? 0} note="Across all attempts" tone="violet" />
        <Metric label="Interested" value={stats.interested ?? 0} note="Discovery signal captured" tone="green" />
        <Metric label="Meetings" value={stats.meetings ?? 0} note="Confirmed, not promised" tone="amber" />
      </section>

      <section className="dashboard-grid">
        <article className="panel span-2">
          <div className="panel-heading"><div><span className="eyebrow">Today’s run</span><h2>Call queue</h2></div><Link href="/leads">View pipeline <ArrowUpRight size={15} /></Link></div>
          {data.queue.length ? <div className="queue-list">{data.queue.map((item) => <div className="queue-row" key={String(item.id)}><span className="slot">{String(item.slot_label)}</span><div className="queue-business"><strong>{String(item.business)}</strong><span>{String(item.category)} · {String(item.city)}</span></div><Badge status={String(item.status)}>{String(item.status)}</Badge><span className="attempts">{Number(item.attempt_count)}/3 attempts</span></div>)}</div> : <div className="queue-empty-action"><EmptyState title="No queue generated yet" body="The cloud worker prepares today’s balanced queue at 9:55 AM Central." /><form action={prepareTodayQueue}><button className="primary-button">Prepare today’s queue now</button></form></div>}
        </article>

        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Funnel health</span><h2>Pipeline</h2></div></div>
          <div className="bar-list">{data.pipeline.map((row) => <div className="bar-item" key={String(row.stage)}><div><span>{String(row.stage)}</span><strong>{Number(row.count)}</strong></div><div className="bar-track"><span style={{ width: `${Math.max((Number(row.count) / maxPipeline) * 100, 4)}%` }} /></div></div>)}</div>
        </article>

        <article className="panel span-2">
          <div className="panel-heading"><div><span className="eyebrow">Latest activity</span><h2>Calls and learning</h2></div><Link href="/calls">All calls <ArrowUpRight size={15} /></Link></div>
          {data.recentCalls.length ? <div className="activity-list">{data.recentCalls.map((call) => <Link className="activity-row" href={`/leads/${call.lead_id}`} key={String(call.id)}><div className="activity-icon"><PhoneCall size={17} /></div><div><strong>{String(call.business)}</strong><span>{String(call.summary || call.network_outcome || "Call in progress")}</span></div><div className="activity-meta"><Badge status={String(call.task_success || call.network_outcome)}>{String(call.task_success || call.network_outcome || "processing")}</Badge><small>{formatDateTime(call.finalized_at as string | null)}</small></div></Link>)}</div> : <EmptyState title="No calls imported" body="Completed calls and AI summaries will appear here." />}
        </article>

        <article className="panel">
          <div className="panel-heading"><div><span className="eyebrow">Action center</span><h2>Follow-ups due</h2></div><Link href="/follow-ups">Open list <ArrowUpRight size={15} /></Link></div>
          {data.followUps.length ? <div className="mini-list">{data.followUps.map((item) => <div className="mini-row" key={String(item.id)}><CalendarClock size={16} /><div><strong>{String(item.business)}</strong><span>{String(item.type)} · {formatDateTime(item.due_at as string | null)}</span></div></div>)}</div> : <EmptyState title="Inbox clear" body="No open callback or calendar-link tasks." />}
        </article>
      </section>

      <section className="insight-banner"><div className="insight-icon"><Sparkles size={22} /></div><div><span className="eyebrow">AI campaign analyst</span><h3>Learning stays controlled.</h3><p>Each transcript is structured, matched to the smallest relevant service, and used to propose one evidence-backed script adjustment. Fixed disclosure, identity, pricing, booking, DNC, privacy, and retry rules stay locked.</p></div><div className="guardrail"><ShieldCheck size={17} /> Review required</div></section>
    </>
  );
}
