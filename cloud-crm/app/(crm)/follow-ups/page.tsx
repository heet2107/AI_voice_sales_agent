import Link from "next/link";
import { Check, CheckCheck, PencilLine, Send } from "lucide-react";
import { approveFollowUp, completeFollowUp, markFollowUpSent, updateFollowUpDraft } from "@/app/actions";
import { Badge, EmptyState, PageTitle } from "@/components/ui";
import { formatDateTime, phoneDisplay } from "@/lib/format";
import { getFollowUps } from "@/lib/repository";

export default async function FollowUpsPage() {
  const followUps = await getFollowUps();
  const open = followUps.filter((item) => item.status === "open");
  const awaitingReview = open.filter((item) => item.approval_status !== "approved" && item.approval_status !== "sent").length;
  const readyToSend = open.filter((item) => item.approval_status === "approved").length;
  return <>
    <PageTitle eyebrow="Human-controlled action center" title="Follow-ups" description="Review every extracted promise and draft before anything is treated as approved or sent." />
    <section className="metrics-grid compact-metrics">
      <article className="metric-card"><span>Open actions</span><strong>{open.length}</strong><small>Callbacks, links and information requests</small></article>
      <article className="metric-card violet"><span>Awaiting review</span><strong>{awaitingReview}</strong><small>Drafts that still require a human decision</small></article>
      <article className="metric-card green"><span>Approved</span><strong>{readyToSend}</strong><small>Ready for the documented delivery step</small></article>
      <article className="metric-card amber"><span>Completed</span><strong>{followUps.filter((item) => item.status === "completed").length}</strong><small>Finished actions retained in the audit trail</small></article>
    </section>
    <section className="panel">{followUps.length ? <div className="followup-list">{followUps.map((item) => {
      const status = String(item.status);
      const approval = String(item.approval_status || "draft");
      const contact = item.contact ? String(item.contact) : "";
      return <article className="followup-card followup-workbench" key={String(item.id)}>
        <div className="followup-main">
          <div className="followup-title"><Link href={`/leads/${item.lead_id}`}><strong>{String(item.business)}</strong></Link><Badge status={status}>{status}</Badge><Badge status={approval}>{approval.replaceAll("_", " ")}</Badge></div>
          <span>{String(item.type)} · {String(item.city)} · Due {formatDateTime(item.due_at as string | null)}</span>
          <p>{String(item.notes || "No transcript-derived note was stored.")}</p>
          <small>{String(item.channel || "manual")} {contact ? `· ${contact.includes("@") ? contact : phoneDisplay(contact)}` : "· contact not confirmed"}</small>
          <form action={updateFollowUpDraft} className="draft-form">
            <input type="hidden" name="id" value={String(item.id)} />
            <label htmlFor={`draft-${item.id}`}>Editable draft</label>
            <textarea id={`draft-${item.id}`} name="draft" defaultValue={String(item.draft || "")} placeholder="Write the exact follow-up that a human should review." rows={4} />
            <button className="secondary-button" type="submit"><PencilLine size={14} /> Save draft</button>
          </form>
        </div>
        <div className="followup-actions">
          {status === "open" && approval !== "approved" && approval !== "sent" ? <form action={approveFollowUp}><input type="hidden" name="id" value={String(item.id)} /><button className="primary-button" type="submit"><CheckCheck size={14} /> Approve</button></form> : null}
          {status === "open" && approval === "approved" ? <form action={markFollowUpSent}><input type="hidden" name="id" value={String(item.id)} /><button className="primary-button" type="submit"><Send size={14} /> Mark sent</button></form> : null}
          {status === "open" ? <form action={completeFollowUp}><input type="hidden" name="id" value={String(item.id)} /><button className="secondary-button" type="submit"><Check size={14} /> Complete</button></form> : null}
          {item.sent_at ? <small>Sent {formatDateTime(item.sent_at as string | null)}</small> : null}
        </div>
      </article>;
    })}</div> : <EmptyState title="No follow-ups yet" body="Tasks will appear after transcript analysis or manual creation." />}</section>
  </>;
}
