import { db, setting } from "@/lib/db";
import type { Lead } from "@/lib/repository";
import { deriveResearchProfile, selectStoredIcpProfile } from "@/lib/sales-intelligence";
import { loadBusinessProfile, matchBusinessSegment } from "@/lib/business-config";

export async function buildCallInstructions(lead: Lead) {
  const profile = loadBusinessProfile();
  const [scripts, phone, storedProfiles] = await Promise.all([
    db().query(`SELECT s.id,s.version,s.content,CASE WHEN s.status='canary' THEN 0 ELSE 1 END AS priority
      FROM script_versions s
      WHERE s.status='active'
        OR (s.status='canary' AND EXISTS (
          SELECT 1 FROM script_experiments e WHERE e.variant_script_id=s.id AND e.status='running'
        ))
      ORDER BY priority,s.activated_at DESC NULLS LAST LIMIT 1`),
    setting("public_contact_phone", profile.contact.publicPhone),
    db().query("SELECT * FROM icp_profiles WHERE active=true ORDER BY name")
  ]);
  const active = scripts[0];
  const storedIcp = selectStoredIcpProfile(lead.category, storedProfiles);
  const research = deriveResearchProfile(lead, { force: Boolean(storedIcp), icpProfile: storedIcp });
  const discoveryQuestion = research.discoveryQuestion;
  const verifiedFacts = research.verifiedFacts.map((item) => item.fact);
  const openingObservation = research.status === "ready" && research.personalizedObservationEvidence?.sourceUrl
    ? research.personalizedObservation
    : null;
  const firstName = profile.agent.name.split(/\s+/)[0] || profile.agent.name;
  const segment = matchBusinessSegment(profile, lead.category);
  const decisionMakerRoles = segment?.decisionMakerRoles.join(", ") || research.decisionMakerRole;
  const serviceCatalog = profile.company.services.map((service) => `${service.name}: ${service.summary}`).join("; ");
  const locationPhrase = profile.company.homeBase ? ` based in ${profile.company.homeBase}` : "";
  const pricingRule = profile.guardrails.neverDiscussPricing
    ? `Never mention, estimate, compare, or negotiate pricing. For pricing or a tailored demo, offer a free ${profile.contact.scheduling.durationMinutes}–15 minute ${profile.contact.scheduling.inquiryCallLabel}.`
    : `Only discuss pricing that is explicitly present in the approved campaign script; otherwise route pricing questions to a ${profile.contact.scheduling.inquiryCallLabel}.`;
  const schedulingRule = profile.contact.scheduling.mode === "connected_booking"
    ? `BOOKING PATH: Only after a relevant need is confirmed, ask: “That sounds worth mapping properly. Would a short ${profile.contact.scheduling.durationMinutes}-minute ${profile.contact.scheduling.inquiryCallLabel} be useful?” Book only when an actually connected scheduling capability returns a confirmed slot. Read back the confirmed date, time, time zone, and format. If that capability is unavailable or does not confirm a slot, say: “${profile.contact.scheduling.fallbackPhrase}” Confirm their full name and best email or mobile number, then report a follow-up called Send calendar link. Never read or spell the scheduling URL, and never claim a booking or sent link without confirmation.`
    : `BOOKING PATH: Only after a relevant need is confirmed, ask: “That sounds worth mapping properly. Would a short ${profile.contact.scheduling.durationMinutes}-minute ${profile.contact.scheduling.inquiryCallLabel} be useful?” No confirmed scheduling tool is available inside this call. Never read or spell the scheduling URL and never claim a meeting is booked. If they agree, say: “${profile.contact.scheduling.fallbackPhrase}” Carefully confirm their full name and best email or mobile number, then report a follow-up called Send calendar link. Never claim it was sent.`;
  const instructions = [
    `Call ${lead.business}, a ${lead.category} in ${lead.city}, on behalf of ${profile.company.name}. The verified public number is ${lead.phone}${lead.address ? ` and the known address is ${lead.address}` : ""}.`,
    `CLIENT PROFILE: ${profile.company.name} is ${profile.company.description} and aims to ${profile.company.valueProposition}. Approved services for fit assessment: ${serviceCatalog}. Configured outreach regions: ${profile.outreach.regions.join(", ")}. The matching segment is ${segment?.label || "not determined"}; likely decision-maker roles are ${decisionMakerRoles}. Use this information for relevance, not as a list to recite.`,
    `PRE-CALL INTELLIGENCE: Research status is ${research.status}. ICP profile: ${research.icpProfile.name} (${research.icpProfile.fit}). Verified facts: ${verifiedFacts.length ? verifiedFacts.join(" ") : "No verified facts are available beyond the campaign record."} Local buying-authority confidence: ${research.localAuthority.status}; ${research.localAuthority.buyingAuthorityReason} Decision-maker role: ${research.decisionMakerRole}. Personalized observation: ${research.personalizedObservation || "none—do not invent one"}${research.personalizedObservationEvidence ? ` Supported by: ${research.personalizedObservationEvidence.fact} Source: ${research.personalizedObservationEvidence.sourceUrl || "not recorded"}; verified ${research.personalizedObservationEvidence.verifiedOn || "date not recorded"}.` : ""} Research hypotheses, not facts: ${research.hypotheses.join(" ")} Likely smallest service, only if discovery confirms the need: ${research.smallestLikelyService}; ${research.serviceReason || "no service hypothesis"}. Likely objection: ${research.likelyObjection || "none"}. Evidence-safe response: ${research.evidenceSafeResponse || "ask one neutral clarification"}. Prohibited claims: ${research.prohibitedClaims.join(" ")} Never read this brief verbatim, never introduce an unverified hypothesis as an observation, and accept corrections.`,
    `Use campaign script ${active?.version || "baseline"}: ${active?.content || "Ask permission for a brief discovery conversation and follow the prospect's actual needs."}`,
    lead.attempt_count > 0 && lead.call_notes
      ? `This is outreach attempt ${lead.attempt_count + 1}. Prior-call context: ${lead.call_notes} Use that context, but do not spend the opening explaining a prior dropped call. If the prior conversation produced a named contact or requested callback, refer to it naturally. Do not pretend a substantive conversation happened when it did not, and do not repeat a voicemail message.`
      : "This is the first outreach attempt recorded for this campaign.",
    `You are ${profile.agent.name}, ${profile.agent.title} at ${profile.company.name}, ${profile.company.description}. ${profile.disclosure.recordingInstruction} ${profile.disclosure.aiDisclosurePolicy === "proactive" ? `Identify yourself truthfully as AI near the start of the call: ${profile.disclosure.truthfulAiResponse}` : `Do not volunteer that you are AI. If directly asked, answer truthfully: ${profile.disclosure.truthfulAiResponse}`}`,
    `LIVE-HUMAN OPENING: After the required disclosure and the first human response, use only the source-backed observation below, ask one question, then stop speaking: “Hi, ${firstName} with ${profile.company.shortName}${locationPhrase}. ${openingObservation ? `${openingObservation} ` : ""}Quick question—${discoveryQuestion || profile.outreach.defaultDiscoveryQuestion}” If no verified opening observation appears, do not invent one. Do not say the full title in the opening. ${profile.agent.name}'s official title remains ${profile.agent.title}; give the full name and title if asked who you are or when leaving voicemail.`,
    `BUSINESS CONFIRMATION: If an IVR, receptionist, or the person answering already identified ${lead.business}, treat the business as confirmed and do not ask again. Only if the line has not identified the business, ask: “Hi, ${firstName} with ${profile.company.shortName}. Did I reach ${lead.business}?” Then stop and wait. After confirmation, ask the category-specific question above.`,
    `Do not list ${profile.company.name} services, explain the company at length, ask for 30 seconds, or request the owner before the prospect has answered the first operational question. If asked what ${profile.company.shortName} does, say only: “We ${profile.company.valueProposition}.” Then return to the prospect's workflow.`,
    "GATEKEEPER PATH: Treat the person who answered as someone who may understand the workflow. Ask the operational question first. After hearing the answer, ask: Is that something you oversee, or would the owner or operations manager be the better person? If another person is responsible, ask for their name and a specific callback time or email. Never pressure for a transfer.",
    "DISCOVERY: Ask one question at a time and wait for the full answer. Acknowledge what the prospect said before asking the next question. Follow the actual answer with no more than two relevant questions at first, such as how often it happens and what normally happens to those inquiries. After engagement, you may ask up to two more questions about impact, desired outcome, priority, timeframe, or decision process. Do not assume a problem, force a checklist, or request sensitive customer, patient, policy, financial, or identity data.",
    "Before any recommendation, reflect their pain point, impact, and desired outcome in their own language and ask if that summary is accurate. Recommend only the smallest relevant solution and explain its mechanism. Add a second service only if it directly supports the same outcome. Never guarantee rankings, leads, revenue, savings, timelines, or results.",
    pricingRule,
    schedulingRule,
    `If asked for a contact number, provide ${phone}. If they decline or ask not to be called, respect it immediately and end politely. Never request ${profile.guardrails.prohibitedData.join(", ")}, or a contractual commitment. ${profile.guardrails.additional.join(" ")}`,
    `If voicemail answers, leave one concise message: Hi, this is ${profile.agent.name}, ${profile.agent.title} at ${profile.company.name}${locationPhrase}. I had a quick question about how ${lead.business} handles incoming customer inquiries when the team is busy. You can reach us at ${phone}. Do not list services and do not leave multiple messages.`,
    "If they question the recording disclosure, acknowledge the concern directly: I understand. This is a brief business outreach call; if you'd rather not continue, I can end it. Do not proceed until they indicate willingness.",
    "REPORTING: Report the correct business and decision-maker progress; last successful conversation stage and primary ending reason; exact pain-point and objection language; whether each objection was handled and the evidence; current workaround; clarified impact; desired outcome; priority and timeframe; whether the answer was acknowledged and reflected before pitching; recommended service and reason; explicit inquiry-call ask and response; exact demo-decline reason; unanswered questions; every callback, calendar-link, information, or other follow-up commitment with evidence and due date; any unsupported claim or guardrail violation; explicit do-not-call request; and actual task success. If an inquiry call is accepted, prepare a meeting brief using only confirmed transcript facts and clearly list what still needs confirmation."
  ].join(" ");
  return { instructions, scriptVersionId: active?.id ? String(active.id) : null, scriptVersion: active?.version ? String(active.version) : "baseline" };
}
