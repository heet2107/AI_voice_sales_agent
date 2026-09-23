"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

export default function CrmError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const message = error.message || "The CRM could not load this page.";
  const isDatabaseQuota = /quota|HTTP status 402|NeonDbError/i.test(message);
  const showRawMessage = !/Minified React error|digest/i.test(message);

  return (
    <section className="panel span-2">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Database unavailable</span>
          <h2>CRM data is temporarily offline</h2>
        </div>
        <button className="secondary-button" onClick={() => reset()}><RefreshCw size={14} /> Try again</button>
      </div>
      <div className="empty-state">
        <div className="empty-icon"><AlertTriangle size={21} /></div>
        <strong>{isDatabaseQuota ? "Neon is blocking database reads" : "The dashboard shell is still available"}</strong>
        <p>Login and navigation are working, but this CRM page needs database records that are not available right now. Restore the database quota or point the app to a working Postgres database, then use Try again.</p>
        {showRawMessage ? <p className="muted">Latest error: {message}</p> : null}
      </div>
    </section>
  );
}
