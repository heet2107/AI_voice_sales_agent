import Link from "next/link";
import { Badge, EmptyState, PageTitle } from "@/components/ui";
import { ConversationScorecard } from "@/components/conversation-scorecard";
import { formatDateTime } from "@/lib/format";
import { getCalls } from "@/lib/repository";
import { loadBusinessProfile } from "@/lib/business-config";

export default async function CallsPage() {
  const calls = await getCalls();
  const profile = loadBusinessProfile();
  return <><PageTitle eyebrow="Conversation intelligence" title="Calls & transcripts" description="Network outcomes are separated from actual task success and discovery quality." />
    <section className="panel">{calls.length ? <div className="call-list">{calls.map((call) => <details className="call-card" key={String(call.id)}><summary><div className="call-summary-main"><Link href={`/leads/${call.lead_id}`}><strong>{String(call.business)}</strong></Link><span>{String(call.category)} · {String(call.city)} · {formatDateTime(call.finalized_at as string | null)}</span><p className="call-summary-preview">{String(call.summary || "Summary will appear as soon as the call finalizes.")}</p></div><div className="call-summary-meta"><span>{Number(call.talk_seconds)} sec</span><Badge status={String(call.task_success || call.network_outcome)}>{String(call.task_success || call.network_outcome || call.lifecycle)}</Badge></div></summary><div className="call-body"><div className="analysis-grid"><div><span>Durable call summary</span><p>{String(call.summary || "Awaiting structured analysis.")}</p></div><div><span>Analysis status</span><p>{String(call.analysis_status)}</p></div></div><ConversationScorecard analysis={call.ai_analysis} /><p className="recording-note">Transcript captured {formatDateTime(call.transcript_captured_at as string | null)}. Source recordings may expire; the saved transcript and summary remain in this CRM.</p><div className="transcript">{Array.isArray(call.transcript) ? call.transcript.map((line: { role?: string; text?: string }, index: number) => <div key={index} className={`transcript-line ${line.role === "assistant" ? "assistant" : "prospect"}`}><span>{line.role === "assistant" ? profile.agent.name : "Prospect"}</span><p>{line.text}</p></div>) : null}</div></div></details>)}</div> : <EmptyState title="No calls available" body="Cloud and imported call records will appear here." />}</section>
  </>;
}
