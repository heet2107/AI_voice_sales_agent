import { loadBusinessProfile } from "@/lib/business-config";

const BASE_URL = "https://api.clawcall.dev";

export type ClawCallTerminal = {
  id: string;
  lifecycle: "queued" | "dialing" | "answered" | "finalized";
  outcome?: string;
  outcome_detail?: unknown;
  talk_seconds?: number;
  task?: string;
  transcript?: Array<{ role: string; text: string; timestamp?: string }>;
  recording_url?: string | null;
  recording_available_until?: string | null;
  recording_expired?: boolean;
  timestamps?: { queued_at?: string; dialing_at?: string; answered_at?: string; finalized_at?: string };
};

async function request<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const apiKey = process.env.CLAWCALL_API_KEY;
  if (!apiKey) throw new Error("CLAWCALL_API_KEY is not configured");
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...init,
    headers: { "X-Api-Key": apiKey, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    cache: "no-store",
  });
  const raw = await response.text();
  let payload: unknown;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { message: raw }; }
  if (!response.ok) {
    const details = payload as { error?: { code?: string; message?: string; action?: { url?: string } }; code?: string; message?: string; action?: { url?: string } };
    const error = new Error(details.error?.message || details.message || `ClawCall request failed (${response.status})`) as Error & { status?: number; code?: string; actionUrl?: string };
    error.status = response.status;
    error.code = details.error?.code || details.code;
    error.actionUrl = details.error?.action?.url || details.action?.url;
    throw error;
  }
  return payload as T;
}

export async function startCall(input: { to: string; task: string }) {
  const profile = loadBusinessProfile();
  const disclosureDirection = profile.disclosure.aiDisclosurePolicy === "proactive"
    ? `Disclose AI identity near the start: ${profile.disclosure.truthfulAiResponse}`
    : `Do not volunteer AI identity; if directly asked, respond exactly and truthfully: ${profile.disclosure.truthfulAiResponse}`;
  return request<{ call_id: string; status?: string }>("/call", {
    method: "POST",
    body: JSON.stringify({
      to: input.to,
      task: input.task,
      voice: profile.agent.voice,
      personality: `${profile.agent.name}, ${profile.agent.title} at ${profile.company.name}. ${profile.agent.tone.join(", ")}. ${profile.disclosure.recordingInstruction} After the recording disclosure, speak one short sentence at a time and stop after each question so the other person can answer. ${disclosureDirection} Never invent facts, manufacture urgency, guarantee outcomes, or ignore a refusal or do-not-call request.${profile.guardrails.neverDiscussPricing ? " Never discuss pricing." : ""}`
    })
  });
}

export async function getCall(callId: string) {
  return request<ClawCallTerminal>(`/call/${encodeURIComponent(callId)}`);
}
