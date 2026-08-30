import { classForStatus } from "@/lib/format";

export function Badge({ children, status }: { children: React.ReactNode; status?: string | null }) {
  return <span className={`badge ${classForStatus(status ?? String(children))}`}>{children}</span>;
}

export function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><strong>{title}</strong><p>{body}</p></div>;
}

export function Metric({ label, value, note, tone = "blue" }: { label: string; value: string | number; note: string; tone?: string }) {
  return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}
