import { AlertTriangle, Clock3, Cloud, Database, LockKeyhole, PhoneCall } from "lucide-react";
import { setCampaignEnabled } from "@/app/actions";
import { Badge, PageTitle } from "@/components/ui";
import { getSettings } from "@/lib/repository";

function display(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value ?? "—");
}

export default async function SettingsPage() {
  const rows = await getSettings();
  const values = Object.fromEntries(rows.map((row) => [String(row.key), row.value]));
  const enabled = values.campaign_enabled === true;
  const hardLive = process.env.CAMPAIGN_MODE === "live";
  return <><PageTitle eyebrow="Cloud control plane" title="Campaign settings" description="Production status, schedule, security, and deterministic operating limits." />
    <section className="settings-grid">
      <article className="panel"><div className="settings-icon"><Cloud size={20} /></div><span className="eyebrow">Deployment</span><h2>Vercel cloud worker</h2><p>Runs without your laptop. Cron dispatch and polling endpoints are protected by a secret bearer token.</p><Badge status={hardLive ? "live" : "paused"}>{hardLive ? "Runtime live" : "Runtime paused"}</Badge></article>
      <article className="panel"><div className="settings-icon"><Database size={20} /></div><span className="eyebrow">Data</span><h2>Neon Postgres</h2><p>Leads, transcripts, follow-ups, DNC entries, scripts and audit events persist independently of deployments.</p><Badge status="connected">Connected</Badge></article>
      <article className="panel"><div className="settings-icon"><LockKeyhole size={20} /></div><span className="eyebrow">Access</span><h2>Passcode protected</h2><p>Signed HTTP-only sessions protect every CRM page and internal API. Failed attempts are rate limited and logged.</p><Badge status="protected">Protected</Badge></article>
      <article className="panel"><div className="settings-icon"><Clock3 size={20} /></div><span className="eyebrow">Schedule</span><h2>15 daily slots</h2><p>{display(values.slots)} · {display(values.timezone)}</p><Badge status="scheduled">3 per hour</Badge></article>
      <article className="panel span-2 campaign-control"><div><div className="settings-icon"><PhoneCall size={20} /></div><span className="eyebrow">Database switch</span><h2>{enabled ? "Campaign enabled" : "Campaign paused"}</h2><p>This switch controls whether eligible jobs can dispatch. The Vercel environment hard switch must also be live.</p>{!hardLive ? <div className="warning-note"><AlertTriangle size={16} /> Production is hard-paused until CAMPAIGN_MODE is changed to live.</div> : null}</div><form action={setCampaignEnabled}><input type="hidden" name="enabled" value={enabled ? "false" : "true"} /><button className={enabled ? "secondary-button" : "primary-button"}>{enabled ? "Pause campaign" : "Enable campaign"}</button></form></article>
    </section>
    <section className="panel settings-table"><div className="panel-heading"><div><span className="eyebrow">Stored configuration</span><h2>Campaign values</h2></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Setting</th><th>Value</th><th>Source</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.key)}><td>{String(row.key).replaceAll("_", " ")}</td><td>{display(row.value)}</td><td>Database</td></tr>)}</tbody></table></div></section>
  </>;
}
