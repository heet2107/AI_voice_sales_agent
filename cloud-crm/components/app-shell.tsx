import Link from "next/link";
import { BarChart3, BrainCircuit, CalendarClock, ClipboardCheck, Headphones, LayoutDashboard, LogOut, ScrollText, Settings, Sparkles, Target, Users, Video } from "lucide-react";
import { initials, loadBusinessProfile } from "@/lib/business-config";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/leads", label: "Lead pipeline", icon: Users },
  { href: "/calls", label: "Calls & transcripts", icon: Headphones },
  { href: "/coaching", label: "Conversation coaching", icon: BrainCircuit },
  { href: "/calibration", label: "Evaluator calibration", icon: ClipboardCheck },
  { href: "/follow-ups", label: "Follow-ups", icon: CalendarClock },
  { href: "/meetings", label: "Meeting briefs", icon: Video },
  { href: "/scripts", label: "Script learning", icon: ScrollText },
  { href: "/icp", label: "ICP playbooks", icon: Target },
  { href: "/settings", label: "Campaign settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const profile = loadBusinessProfile();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Sparkles size={18} /></div>
          <div><strong>{profile.company.shortName}</strong><span>{profile.branding.crmLabel}</span></div>
        </div>
        <nav className="nav-list">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="nav-item"><Icon size={18} /><span>{label}</span></Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="rep-card"><div className="avatar">{initials(profile.agent.name)}</div><div><strong>{profile.agent.name}</strong><span>{profile.agent.shortTitle}</span></div></div>
          <form action="/api/auth/logout" method="post"><button className="logout" type="submit"><LogOut size={16} /> Sign out</button></form>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div><span className="eyebrow">{profile.company.shortName} · {profile.branding.regionLabel}</span></div>
          <div className="topbar-right"><span className="live-dot" /> Cloud operations <BarChart3 size={16} /></div>
        </header>
        <div className="page-wrap">{children}</div>
      </main>
    </div>
  );
}
