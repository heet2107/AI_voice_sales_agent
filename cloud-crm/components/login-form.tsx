"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(""); setLoading(true);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passcode }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to sign in");
      window.location.assign(nextPath.startsWith("/") ? nextPath : "/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in");
      setPasscode("");
    } finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="login-form">
      <label htmlFor="passcode">6-digit access code</label>
      <div className="passcode-input"><LockKeyhole size={19} /><input id="passcode" name="passcode" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={passcode} onChange={(event) => setPasscode(event.target.value.replace(/\D/g, ""))} autoFocus required /></div>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="primary-button" disabled={loading || passcode.length !== 6}>{loading ? "Checking…" : "Open dashboard"}<ArrowRight size={17} /></button>
      <p className="login-note">Access attempts are rate limited and logged.</p>
    </form>
  );
}
