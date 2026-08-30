import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const sql = neon(process.env.DATABASE_URL);
const here = path.dirname(fileURLToPath(import.meta.url));

async function loadProfile() {
  if (process.env.BUSINESS_PROFILE_JSON?.trim()) return JSON.parse(process.env.BUSINESS_PROFILE_JSON);
  const configured = process.env.BUSINESS_PROFILE_PATH?.trim();
  const profilePath = configured
    ? path.resolve(process.cwd(), configured)
    : path.join(here, "../config/business-profile.json");
  return JSON.parse(await fs.readFile(profilePath, "utf8"));
}

const profile = await loadProfile();
if (!profile?.company?.name || !profile?.agent?.name || !profile?.operations?.timezone) {
  throw new Error("Business profile is missing company, agent, or operations settings.");
}
if (profile.operations.startPaused !== true) {
  throw new Error("Business profile must keep operations.startPaused=true. Enable a campaign only after deployment and outreach review.");
}

const services = (profile.company.services ?? []).map((service) => service.name).filter(Boolean).join(", ");
const guardrails = [
  `${profile.agent.name}, ${profile.agent.title} at ${profile.company.name}`,
  profile.disclosure.recordingInstruction,
  `Use this truthful AI response according to the configured policy: ${profile.disclosure.truthfulAiResponse}`,
  profile.guardrails.neverDiscussPricing ? "Never discuss pricing" : "Discuss only explicitly approved pricing",
  "Never claim a meeting or follow-up is confirmed without confirmation",
  "Honor refusals and do-not-call requests immediately",
  "Never guarantee outcomes or present research hypotheses as facts",
  `Never request: ${(profile.guardrails.prohibitedData ?? []).join(", ")}`,
  ...(profile.guardrails.additional ?? []),
];

const initialScript = `Call as ${profile.agent.name}, ${profile.agent.title} at ${profile.company.name}. Ask one concise operational question before explaining services. Learn how the prospect currently handles inquiries, acknowledge the answer, clarify frequency and impact, reflect the confirmed need, and recommend only the smallest relevant option from the approved service set: ${services}. Ask for a ${profile.contact.scheduling.durationMinutes}-minute ${profile.contact.scheduling.inquiryCallLabel} only after a relevant need is confirmed. ${profile.guardrails.neverDiscussPricing ? "Do not discuss pricing." : "Only discuss explicitly approved pricing."} If no connected booking capability confirms a slot, say: ${profile.contact.scheduling.fallbackPhrase} Confirm the best contact channel without claiming the link was sent or the meeting was booked.`;

await sql.query(
  `INSERT INTO script_versions (version,status,content,change_summary,evidence,fixed_guardrails,activated_at)
   SELECT 'v1-template','active',$1,$2,'[]'::jsonb,$3::jsonb,now()
   WHERE NOT EXISTS (SELECT 1 FROM script_versions WHERE status='active')
   ON CONFLICT (version) DO NOTHING`,
  [initialScript, "Initial business-profile baseline. Human review is required before any experiment or campaign activation.", JSON.stringify(guardrails)]
);

const firstTarget = profile.operations.segmentTargets?.[0];
const secondTarget = profile.operations.segmentTargets?.[1];
const settings = {
  campaign_enabled: false,
  daily_call_cap: profile.operations.dailyCallCap,
  max_lifetime_attempts: profile.operations.maxLifetimeAttempts,
  same_day_retry: true,
  same_day_retry_min_gap_minutes: profile.operations.retryDelayMinutes,
  same_day_retry_max_per_lead: 1,
  timezone: profile.operations.timezone,
  slots: profile.operations.callSlots,
  local_business_target: firstTarget?.maximum ?? Math.ceil(profile.operations.dailyCallCap / 2),
  service_smb_target: secondTarget?.minimum ?? Math.floor(profile.operations.dailyCallCap / 2),
  calendly_url: profile.contact.scheduling.url,
  public_contact_phone: profile.contact.publicPhone,
  script_review_mode: "review_required",
};

for (const [key, value] of Object.entries(settings)) {
  await sql.query(
    `INSERT INTO settings (key,value) VALUES ($1,$2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value=excluded.value, updated_at=now()`,
    [key, JSON.stringify(value)]
  );
}

console.log(`Seeded the paused ${profile.company.name} campaign baseline. No leads or calls were created.`);
