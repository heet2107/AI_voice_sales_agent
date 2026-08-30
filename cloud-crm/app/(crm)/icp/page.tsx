import { Save, ShieldCheck, Target } from "lucide-react";
import { updateIcpProfile } from "@/app/actions";
import { Badge, EmptyState, PageTitle } from "@/components/ui";
import { getIcpProfiles } from "@/lib/repository";

const services = ["none","website_app","google_visibility","website_chat_agent","voice_calling_agent","custom_ai_automation"];

export default async function IcpProfilesPage() {
  const profiles = await getIcpProfiles();
  return <>
    <PageTitle eyebrow="Audience strategy" title="Ideal customer profiles" description="Category-specific preparation keeps research, discovery and privacy boundaries relevant to each business." />
    <section className="insight-banner"><div className="insight-icon"><Target size={20} /></div><div><span className="eyebrow">How profiles are used</span><h3>Prepare a relevant question—not a manufactured pain point</h3><p>Match terms select a preparation profile. Every operational need remains a hypothesis until the prospect confirms it during the conversation.</p></div><div className="guardrail"><ShieldCheck size={15} /> Evidence first</div></section>
    <section className="icp-grid">{profiles.length ? profiles.map((profile) => {
      const terms = Array.isArray(profile.match_terms) ? profile.match_terms.map(String).join("\n") : "";
      return <article className="panel icp-card" key={String(profile.id)}>
        <div className="panel-heading"><div><span className="eyebrow">{String(profile.segment).replaceAll("_", " ")}</span><h2>{String(profile.name)}</h2></div><Badge status={profile.active ? "active" : "inactive"}>{profile.active ? "active" : "inactive"}</Badge></div>
        <form action={updateIcpProfile} className="icp-form">
          <input type="hidden" name="id" value={String(profile.id)} />
          <label>Profile name<input name="name" defaultValue={String(profile.name)} required /></label>
          <label>Segment<select name="segment" defaultValue={String(profile.segment)}><option value="local_business">Neighborhood business</option><option value="service_smb">Service / receptionist-heavy SMB</option></select></label>
          <label className="span-form">Match terms, one per line<textarea name="matchTerms" rows={3} defaultValue={terms} /></label>
          <label className="span-form">Decision-maker role<input name="decisionMakerRole" defaultValue={String(profile.decision_maker_role)} required /></label>
          <label className="span-form">First operational question<textarea name="discoveryQuestion" rows={3} defaultValue={String(profile.discovery_question)} required /></label>
          <label>Likely objection<textarea name="likelyObjection" rows={3} defaultValue={String(profile.likely_objection)} required /></label>
          <label>Evidence-safe response<textarea name="safeResponse" rows={3} defaultValue={String(profile.safe_response)} required /></label>
          <label>Smallest service hypothesis<select name="serviceHypothesis" defaultValue={String(profile.service_hypothesis)}>{services.map((service) => <option value={service} key={service}>{service.replaceAll("_", " ")}</option>)}</select></label>
          <label>Profile status<select name="active" defaultValue={profile.active ? "true" : "false"}><option value="true">Active</option><option value="false">Inactive</option></select></label>
          <label className="span-form">Privacy and category constraints<textarea name="privacyNotes" rows={3} defaultValue={String(profile.privacy_notes || "")} /></label>
          <button className="primary-button span-form" type="submit"><Save size={15} /> Save profile</button>
        </form>
      </article>;
    }) : <section className="panel"><EmptyState title="No ICP profiles" body="Run the database migration to seed the category preparation profiles." /></section>}</section>
  </>;
}
