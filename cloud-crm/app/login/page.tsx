import { LoginForm } from "@/components/login-form";
import { ShieldCheck, Sparkles } from "lucide-react";
import { loadBusinessProfile } from "@/lib/business-config";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "/" } = await searchParams;
  const profile = loadBusinessProfile();
  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand"><div className="brand-mark"><Sparkles size={20} /></div><span>{profile.company.shortName}</span></div>
        <div className="login-copy"><span className="eyebrow">Private operations console</span><h1>Your growth pipeline,<br />kept under lock.</h1><p>Review leads, calls, transcripts, follow-ups, and script intelligence from anywhere.</p></div>
        <div className="security-pill"><ShieldCheck size={17} /><span>Signed session · server-side access control</span></div>
      </section>
      <section className="login-card-wrap"><div className="login-card"><span className="eyebrow">Secure access</span><h2>Welcome back</h2><p>Enter your private code to continue.</p><LoginForm nextPath={next} /></div></section>
    </main>
  );
}
