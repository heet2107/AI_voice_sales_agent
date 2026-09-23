"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const message = error.message || "The CRM could not load this page.";
  const isDatabaseQuota = /quota|HTTP status 402|NeonDbError/i.test(message);

  return (
    <section className="panel span-2">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{isDatabaseQuota ? "Database unavailable" : "Page unavailable"}</span>
          <h2>{isDatabaseQuota ? "CRM data is temporarily offline" : "This page could not load"}</h2>
        </div>
        <button className="secondary-button" onClick={() => reset()}><RefreshCw size={14} /> Try again</button>
      </div>
      <div className="empty-state">
        <div className="empty-icon"><AlertTriangle size={21} /></div>
        <strong>{isDatabaseQuota ? "Neon is blocking database reads" : "The dashboard shell is still available"}</strong>
        <p>{isDatabaseQuota
          ? "Login and navigation are working, but the CRM records cannot load until the database quota is restored or the app is pointed to a working Postgres database."
          : "Use the sidebar to navigate elsewhere, or try this page again after the backend recovers."}</p>
        <p className="muted">Latest error: {message}</p>
      </div>
    </section>
  );
}
