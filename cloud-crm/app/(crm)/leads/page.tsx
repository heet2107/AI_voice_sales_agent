import Link from "next/link";
import { Search } from "lucide-react";
import { Badge, EmptyState, PageTitle } from "@/components/ui";
import { phoneDisplay } from "@/lib/format";
import { getLeads } from "@/lib/repository";
import { loadBusinessProfile } from "@/lib/business-config";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string; stage?: string }> }) {
  const filters = await searchParams;
  const leads = await getLeads(filters.q ?? "", filters.stage ?? "all");
  const profile = loadBusinessProfile();
  return <>
    <PageTitle eyebrow={`${profile.branding.regionLabel} research`} title="Lead pipeline" description="Presence-gap evidence, attempt history, and opportunity stage for every business." />
    <form className="filter-bar"><div className="search-input"><Search size={17} /><input name="q" defaultValue={filters.q} placeholder="Search business, city, category, or phone" /></div><select name="stage" defaultValue={filters.stage ?? "all"}><option value="all">All stages</option>{["New","Research","Qualified","Scheduled","Attempted","Contacted","Voicemail","Callback","Interested","Meeting","Not interested","Disqualified"].map((stage) => <option key={stage}>{stage}</option>)}</select><button>Filter</button></form>
    <section className="table-panel">
      {leads.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Business</th><th>Market</th><th>Presence gap</th><th>Score</th><th>Attempts</th><th>Stage</th><th>Phone</th></tr></thead><tbody>{leads.map((lead) => <tr key={lead.id}><td><Link className="business-link" href={`/leads/${lead.id}`}><strong>{lead.business}</strong><span>{lead.category}</span></Link></td><td>{lead.city}</td><td><Badge status={lead.presence_class}>{lead.presence_class}</Badge></td><td><span className="score">{lead.lead_score}</span></td><td>{lead.attempt_count} / {profile.operations.maxLifetimeAttempts}</td><td><Badge status={lead.pipeline_stage}>{lead.pipeline_stage}</Badge></td><td>{phoneDisplay(lead.phone)}</td></tr>)}</tbody></table></div> : <EmptyState title="No leads match" body="Try clearing the current filters." />}
    </section>
  </>;
}
