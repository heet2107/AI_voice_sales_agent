import { z } from "zod";
import type { Lead } from "@/lib/repository";

export const ServiceMatchSchema = z.enum([
  "website_app",
  "google_visibility",
  "website_chat_agent",
  "voice_calling_agent",
  "custom_ai_automation",
  "none",
]);

export const ConversationStageSchema = z.enum([
  "not_connected",
  "disclosure",
  "opening",
  "workflow_question",
  "gatekeeper",
  "decision_maker",
  "discovery",
  "recommendation",
  "demo_ask",
  "scheduling",
  "completed",
]);

export const EndReasonSchema = z.enum([
  "no_answer",
  "voicemail",
  "audio_failure",
  "recording_concern",
  "early_disconnect",
  "gatekeeper",
  "decision_maker_unavailable",
  "not_interested",
  "do_not_call",
  "wrong_number",
  "callback_requested",
  "workflow_question_unanswered",
  "objection_unresolved",
  "demo_declined",
  "calendar_followup",
  "meeting_confirmed",
  "completed",
  "unknown",
]);

export const ObjectionDetailSchema = z.object({
  exact: z.string(),
  category: z.enum([
    "timing",
    "authority",
    "status_quo",
    "trust",
    "budget",
    "need",
    "implementation",
    "competition",
    "recording",
    "other",
  ]),
  handled: z.enum(["yes", "partial", "no", "not_applicable"]),
  responseSummary: z.string().nullable(),
  evidence: z.string().nullable(),
});

export const CommitmentSchema = z.object({
  speaker: z.enum(["jessica", "prospect"]),
  commitment: z.string(),
  due: z.string().nullable(),
  confirmed: z.boolean(),
  evidence: z.string().nullable(),
});

export const DecisionMakerProgressSchema = z.enum([
  "not_started",
  "gatekeeper_engaged",
  "role_identified",
  "named_contact_identified",
  "decision_maker_reached",
]);

export const GuardrailViolationSchema = z.object({
  category: z.enum([
    "unsupported_claim",
    "pricing",
    "booking_misrepresentation",
    "calendar_url_spoken",
    "identity_misrepresentation",
    "pressure_or_repeated_objection",
    "privacy_or_sensitive_data",
    "opt_out_not_honored",
    "other",
  ]),
  description: z.string(),
  evidence: z.string(),
});

export const FollowUpEvidenceSchema = z.object({
  required: z.boolean(),
  type: z.enum(["none", "callback", "send_calendar_link", "send_information", "human_review"]),
  promisedAction: z.string().nullable(),
  dueAt: z.string().nullable(),
  contactMethod: z.enum(["mobile", "email", "unknown"]),
  contactValueConfirmed: z.boolean(),
  evidence: z.string().nullable(),
});

export const ConversationScorecardSchema = z.object({
  humanConnected: z.boolean(),
  stageReached: ConversationStageSchema,
  endReason: EndReasonSchema,
  openingAnswered: z.boolean(),
  workflowQuestionAnswered: z.boolean(),
  decisionMakerProgress: DecisionMakerProgressSchema,
  discoveryCompleted: z.boolean(),
  painConfirmed: z.boolean(),
  demoDeclineReason: z.string().nullable(),
  recommendationMade: z.boolean(),
  demoAsked: z.boolean(),
  demoAccepted: z.boolean(),
  bookingOutcome: z.enum(["not_offered", "declined", "calendar_followup", "confirmed", "unknown"]),
  qualitySignals: z.object({
    oneQuestionAtATime: z.boolean().nullable(),
    acknowledgedAnswer: z.boolean().nullable(),
    reflectedProspectLanguage: z.boolean().nullable(),
    reflectedBeforePitch: z.boolean().nullable(),
    impactClarified: z.boolean().nullable(),
    recommendedSmallestSolution: z.boolean().nullable(),
    askedForInquiryCall: z.boolean().nullable(),
    honoredRefusal: z.boolean().nullable(),
    unsupportedClaimDetected: z.boolean(),
  }),
  objectionDetails: z.array(ObjectionDetailSchema),
  commitments: z.array(CommitmentSchema),
  followUpEvidence: FollowUpEvidenceSchema,
  guardrailViolations: z.array(GuardrailViolationSchema),
  unaddressedProspectQuestion: z.string().nullable(),
  evidence: z.array(z.object({ signal: z.string(), excerpt: z.string() })).max(8),
});

export type ConversationScorecard = z.infer<typeof ConversationScorecardSchema>;

const VerifiedFactSchema = z.object({
  fact: z.string(),
  sourceUrl: z.string().url().nullable(),
  verifiedOn: z.string().nullable(),
});

export const IcpProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  categoryPatterns: z.array(z.string()),
  decisionMakerRole: z.string().nullable().optional(),
  discoveryQuestion: z.string().nullable().optional(),
  likelyObjection: z.string().nullable().optional(),
  evidenceSafeResponse: z.string().nullable().optional(),
  serviceHypothesis: ServiceMatchSchema.optional(),
  prohibitedClaims: z.array(z.string()).optional(),
});

export type IcpProfile = z.infer<typeof IcpProfileSchema>;

type StoredIcpProfileRow = {
  slug?: unknown;
  name?: unknown;
  match_terms?: unknown;
  decision_maker_role?: unknown;
  discovery_question?: unknown;
  likely_objection?: unknown;
  safe_response?: unknown;
  service_hypothesis?: unknown;
  privacy_notes?: unknown;
};

export function mapStoredIcpProfile(row: StoredIcpProfileRow): IcpProfile | null {
  const parsedTerms = Array.isArray(row.match_terms) ? row.match_terms.map(String).filter(Boolean) : [];
  const parsed = IcpProfileSchema.safeParse({
    id: String(row.slug ?? ""),
    name: String(row.name ?? ""),
    categoryPatterns: parsedTerms,
    decisionMakerRole: row.decision_maker_role ? String(row.decision_maker_role) : null,
    discoveryQuestion: row.discovery_question ? String(row.discovery_question) : null,
    likelyObjection: row.likely_objection ? String(row.likely_objection) : null,
    evidenceSafeResponse: row.safe_response ? String(row.safe_response) : null,
    serviceHypothesis: row.service_hypothesis ? String(row.service_hypothesis) : undefined,
    prohibitedClaims: row.privacy_notes ? [String(row.privacy_notes)] : [],
  });
  return parsed.success && parsed.data.categoryPatterns.length ? parsed.data : null;
}

export function selectStoredIcpProfile(category: string, rows: StoredIcpProfileRow[]) {
  const profiles = rows.map(mapStoredIcpProfile).filter((profile): profile is IcpProfile => Boolean(profile));
  return selectIcpProfile(category, profiles);
}

export const ResearchProfileSchema = z.object({
  version: z.literal("local-smb-v1"),
  status: z.enum(["ready", "needs_review", "unverified"]),
  verifiedFacts: z.array(VerifiedFactSchema),
  hypotheses: z.array(z.string()),
  localAuthority: z.object({
    status: z.enum(["verified", "likely", "unverified"]),
    evidence: z.string().nullable(),
    buyingAuthorityReason: z.string(),
  }),
  icpProfile: z.object({ id: z.string(), name: z.string(), fit: z.enum(["matched", "generic"]) }),
  decisionMakerRole: z.string(),
  personalizedObservation: z.string().nullable(),
  personalizedObservationEvidence: VerifiedFactSchema.nullable(),
  discoveryQuestion: z.string(),
  likelyObjection: z.string().nullable(),
  evidenceSafeResponse: z.string().nullable(),
  smallestLikelyService: ServiceMatchSchema,
  serviceReason: z.string().nullable(),
  prohibitedClaims: z.array(z.string()),
});

export type ResearchProfile = z.infer<typeof ResearchProfileSchema>;

type ResearchLead = Pick<Lead,
  "business" | "category" | "segment" | "city" | "address" | "rating" | "review_count" |
  "presence_class" | "website_url" | "social_url" | "evidence_notes" | "primary_source_url" |
  "presence_check_url" | "verified_on" | "confidence" | "research_profile"
>;

export const DEFAULT_ICP_PROFILES: IcpProfile[] = [
  {
    id: "hospitality",
    name: "Restaurants and hospitality",
    categoryPatterns: ["restaurant", "cafe", "coffee", "bakery", "bar", "tavern", "dessert"],
    decisionMakerRole: "Owner or general manager",
    discoveryQuestion: "When the front-of-house team is busy, how are reservation, catering, or customer inquiries handled?",
    likelyObjection: "Our staff already answers the phone.",
    evidenceSafeResponse: "That makes sense. What normally happens during a rush or after hours when the team cannot answer immediately?",
    prohibitedClaims: ["Do not claim the business is missing reservations, catering requests, or revenue unless the prospect confirms it."],
  },
  {
    id: "personal-care",
    name: "Salons, barbers, and spas",
    categoryPatterns: ["salon", "barber", "spa"],
    decisionMakerRole: "Owner or salon/spa manager",
    discoveryQuestion: "When everyone is helping a client, how are new appointment calls or website questions handled?",
    likelyObjection: "Clients already book online.",
    evidenceSafeResponse: "That is helpful. Are there still questions, rescheduling requests, or after-hours inquiries that require someone to respond manually?",
    prohibitedClaims: ["Do not claim the current booking tool loses appointments or creates no-shows without transcript evidence."],
  },
  {
    id: "healthcare",
    name: "Clinics and appointment practices",
    categoryPatterns: ["dental", "dentist", "orthodont", "clinic", "veterinary", "medical", "optometr", "chiropr", "therapy"],
    decisionMakerRole: "Practice owner, practice manager, or office manager",
    discoveryQuestion: "When the front desk is tied up, how are new appointment inquiries handled?",
    likelyObjection: "Our front desk already handles that.",
    evidenceSafeResponse: "Understood. I am not suggesting replacing that team—what happens to new inquiries when they are helping patients or the office is closed?",
    prohibitedClaims: ["Do not request patient information or claim HIPAA compliance, clinical capability, or patient outcomes."],
  },
  {
    id: "field-services",
    name: "Home, field, and automotive services",
    categoryPatterns: ["hvac", "plumb", "electric", "roof", "pest", "clean", "landscap", "auto", "repair", "contractor"],
    decisionMakerRole: "Owner, operations manager, or service manager",
    discoveryQuestion: "When the team is helping customers or out on jobs, how are missed estimate, service, or appointment calls handled?",
    likelyObjection: "We return missed calls ourselves.",
    evidenceSafeResponse: "That may be working well. How quickly can the team usually respond when several requests arrive while everyone is on a job?",
    prohibitedClaims: ["Do not claim missed estimates, slow response times, or lost jobs unless the prospect confirms them."],
  },
  {
    id: "real-estate",
    name: "Real estate and property management",
    categoryPatterns: ["property", "real estate"],
    decisionMakerRole: "Broker-owner, managing broker, or operations manager",
    discoveryQuestion: "How are after-hours rental, showing, maintenance, or new-client inquiries routed today?",
    likelyObjection: "Our agents or property managers handle their own inquiries.",
    evidenceSafeResponse: "That makes sense. Is routing still straightforward when requests come in after hours or need to reach different people?",
    prohibitedClaims: ["Do not request confidential tenant, buyer, financial, qualification, or property-access information."],
  },
  {
    id: "insurance",
    name: "Independent insurance agencies",
    categoryPatterns: ["insurance"],
    decisionMakerRole: "Agency owner, principal, or office manager",
    discoveryQuestion: "When the office is busy, how are new quote and policy-service inquiries routed?",
    likelyObjection: "Licensed staff need to handle those calls.",
    evidenceSafeResponse: "Absolutely. The question is only whether non-advisory intake and routing create extra work before a licensed person takes over.",
    prohibitedClaims: ["Do not give insurance advice or request policy, claim, financial, medical, driver-license, or identity data."],
  },
];

function matchesPattern(category: string, pattern: string) {
  return category.toLowerCase().includes(pattern.toLowerCase());
}

export function selectIcpProfile(category: string, profiles: IcpProfile[] = DEFAULT_ICP_PROFILES) {
  return profiles.find((profile) => profile.categoryPatterns.some((pattern) => matchesPattern(category, pattern))) ?? null;
}

export function discoveryQuestionForLead(lead: Pick<ResearchLead, "category" | "segment">) {
  const icp = selectIcpProfile(lead.category);
  if (icp?.discoveryQuestion) return icp.discoveryQuestion;
  const category = lead.category.toLowerCase();
  if (/salon|barber|spa/.test(category)) return "When everyone is helping a client, how are new appointment calls or website questions handled?";
  if (/restaurant|cafe|coffee|bakery|bar|tavern|dessert/.test(category)) return "When the front-of-house team is busy, how are reservation, catering, or customer inquiries handled?";
  if (/dental|dentist|orthodont|clinic|veterinary|medical|optometr|chiropr|therapy/.test(category)) return "When the front desk is tied up, how are new appointment inquiries handled?";
  if (/hvac|plumb|electric|roof|pest|clean|landscap|auto|repair|contractor/.test(category)) return "When the team is helping customers or out on jobs, how are missed estimate, service, or appointment calls handled?";
  if (/property|real estate/.test(category)) return "How are after-hours rental, showing, maintenance, or new-client inquiries routed today?";
  if (/insurance/.test(category)) return "When the office is busy, how are new quote and policy-service inquiries routed?";
  return lead.segment === "local_business"
    ? "When the team is busy, how are new customer calls or website inquiries handled?"
    : "When the office is busy, how are new inquiries captured and routed today?";
}

function decisionMakerRole(category: string, profile?: IcpProfile | null) {
  if (profile?.decisionMakerRole) return profile.decisionMakerRole;
  const value = category.toLowerCase();
  if (/restaurant|cafe|coffee|bakery|bar|tavern/.test(value)) return "Owner or general manager";
  if (/salon|barber|spa/.test(value)) return "Owner or salon/spa manager";
  if (/dental|dentist|orthodont|clinic|veterinary|medical|optometr|chiropr|therapy/.test(value)) return "Practice owner, practice manager, or office manager";
  if (/auto|repair|dealership/.test(value)) return "Owner, general manager, service manager, or internet sales manager";
  if (/property|real estate/.test(value)) return "Broker-owner, managing broker, or operations manager";
  if (/insurance/.test(value)) return "Agency owner, principal, or office manager";
  if (/hvac|plumb|electric|roof|pest|clean|landscap|contractor/.test(value)) return "Owner or operations manager";
  return "Owner or operations manager";
}

function serviceHypothesis(lead: ResearchLead) {
  const presence = lead.presence_class.toLowerCase();
  const evidence = (lead.evidence_notes ?? "").toLowerCase();
  const category = lead.category.toLowerCase();
  if (/no (?:independent )?website|google-only|social-only|weak website|outdated|not mobile/.test(`${presence} ${evidence}`)) {
    return { service: "website_app" as const, reason: "The recorded presence evidence suggests the website or owned lead-capture experience should be validated first." };
  }
  if (/weak google|visibility|inconsistent listing|local search/.test(`${presence} ${evidence}`)) {
    return { service: "google_visibility" as const, reason: "The recorded evidence suggests a Google visibility or listing-consistency gap that should be confirmed in discovery." };
  }
  if (/missed call|after.hours|reception|phone.first|inbound call|call volume|overflow/.test(evidence) && /clinic|dental|veterinary|service|hvac|plumb|auto|insurance|property|real estate/.test(category)) {
    return { service: "voice_calling_agent" as const, reason: "The existing notes describe a possible inbound-call workload; the prospect must confirm frequency and impact before it is presented as a need." };
  }
  if (/no (?:online )?booking|no chat|website chat|lead capture/.test(evidence)) {
    return { service: "website_chat_agent" as const, reason: "The existing notes describe a possible online inquiry-capture gap that should be confirmed with the prospect." };
  }
  return { service: "none" as const, reason: "The verified CRM evidence is not specific enough to choose a service before discovery." };
}

export function deriveResearchProfile(lead: ResearchLead, options: { force?: boolean; icpProfile?: IcpProfile | null } = {}): ResearchProfile {
  const parsed = ResearchProfileSchema.safeParse(lead.research_profile);
  if (parsed.success && !options.force) return parsed.data;

  const icp = options.icpProfile ?? selectIcpProfile(lead.category);

  const verified = Boolean(lead.verified_on && (lead.primary_source_url || lead.presence_check_url));
  const sourceUrl = lead.primary_source_url || lead.presence_check_url || null;
  const facts: ResearchProfile["verifiedFacts"] = [];
  if (verified) {
    facts.push({ fact: `${lead.business} is recorded as a ${lead.category} serving ${lead.city}.`, sourceUrl, verifiedOn: lead.verified_on });
    if (lead.rating !== null && lead.review_count !== null) {
      facts.push({ fact: `The recorded public rating is ${lead.rating} from ${lead.review_count} reviews.`, sourceUrl, verifiedOn: lead.verified_on });
    }
    if (lead.website_url) facts.push({ fact: `An independent website is recorded at ${lead.website_url}.`, sourceUrl: lead.website_url, verifiedOn: lead.verified_on });
    if (lead.social_url) facts.push({ fact: "A public social profile is recorded for the business.", sourceUrl: lead.social_url, verifiedOn: lead.verified_on });
    if (lead.address) facts.push({ fact: `The recorded business location is ${lead.address}.`, sourceUrl, verifiedOn: lead.verified_on });
  }

  const evidence = lead.evidence_notes ?? "";
  const owned = /locally owned|independently owned|independent business|owner-operated|family-owned|family owned/i.test(evidence);
  const authorityStatus = verified && owned ? "verified" : owned ? "likely" : "unverified";
  const hypotheses = [
    `The recorded presence class is “${lead.presence_class}”; validate whether it affects inquiries before describing it as a problem.`,
    `${lead.category} businesses may lose or delay inquiries when staff are occupied, but this is only a discovery hypothesis until the prospect confirms it.`,
  ];
  const service = icp?.serviceHypothesis
    ? { service: icp.serviceHypothesis, reason: `The active ${icp.name} ICP profile proposes this as the smallest starting hypothesis; discovery must confirm the need.` }
    : serviceHypothesis(lead);
  const observationEvidence = verified
    ? lead.rating !== null && lead.review_count !== null && lead.review_count > 0
      ? facts.find((fact) => fact.fact.includes("public rating")) ?? null
      : lead.website_url
        ? facts.find((fact) => fact.fact.includes("independent website")) ?? null
        : facts[0] ?? null
    : null;
  const observation = observationEvidence
    ? lead.rating !== null && lead.review_count !== null && observationEvidence.fact.includes("public rating")
      ? `I noticed ${lead.business} has a recorded public rating of ${lead.rating} across ${lead.review_count} reviews.`
      : lead.website_url && observationEvidence.fact.includes("independent website")
        ? `I reviewed the public website recorded for ${lead.business}.`
        : `I reviewed the current public listing recorded for ${lead.business}.`
    : null;
  const sharedProhibitedClaims = [
    "Do not claim a missed-call, staffing, revenue, ranking, booking, or conversion problem that the prospect has not confirmed.",
    "Do not invent customer examples, ROI, savings, urgency, pricing, implementation timing, or competitor comparisons.",
    "Do not present a research hypothesis as a verified fact.",
  ];

  return {
    version: "local-smb-v1",
    status: verified && facts.length >= 2 ? "ready" : verified ? "needs_review" : "unverified",
    verifiedFacts: facts,
    hypotheses,
    localAuthority: {
      status: authorityStatus,
      evidence: owned ? "The existing evidence notes describe local or independent ownership; re-check before relying on it." : null,
      buyingAuthorityReason: authorityStatus === "verified"
        ? "Verified source-backed CRM evidence indicates local or independent ownership, so a local decision-maker is plausible."
        : authorityStatus === "likely"
          ? "The CRM notes suggest independent ownership, but source-backed local buying authority still needs verification."
          : "No source-backed local buying authority is recorded; confirm the responsible local decision-maker before qualification.",
    },
    icpProfile: icp ? { id: icp.id, name: icp.name, fit: "matched" } : { id: "generic-local-smb", name: "Generic local SMB", fit: "generic" },
    decisionMakerRole: decisionMakerRole(lead.category, icp),
    personalizedObservation: observation,
    personalizedObservationEvidence: observationEvidence,
    discoveryQuestion: icp?.discoveryQuestion || discoveryQuestionForLead(lead),
    likelyObjection: icp?.likelyObjection || "We already handle inquiries ourselves.",
    evidenceSafeResponse: icp?.evidenceSafeResponse || "That makes sense. I’m not assuming it is broken—what normally happens when everyone is busy or after hours?",
    smallestLikelyService: service.service,
    serviceReason: service.reason,
    prohibitedClaims: [...sharedProhibitedClaims, ...(icp?.prohibitedClaims ?? [])],
  };
}

export function emptyConversationScorecard(outcome?: string | null): ConversationScorecard {
  const noAnswer = ["no_answer", "busy", "rejected", "unreachable"].includes(outcome ?? "");
  return {
    humanConnected: false,
    stageReached: "not_connected",
    endReason: noAnswer ? "no_answer" : "unknown",
    openingAnswered: false,
    workflowQuestionAnswered: false,
    decisionMakerProgress: "not_started",
    discoveryCompleted: false,
    painConfirmed: false,
    demoDeclineReason: null,
    recommendationMade: false,
    demoAsked: false,
    demoAccepted: false,
    bookingOutcome: "not_offered",
    qualitySignals: {
      oneQuestionAtATime: null,
      acknowledgedAnswer: null,
      reflectedProspectLanguage: null,
      reflectedBeforePitch: null,
      impactClarified: null,
      recommendedSmallestSolution: null,
      askedForInquiryCall: null,
      honoredRefusal: null,
      unsupportedClaimDetected: false,
    },
    objectionDetails: [],
    commitments: [],
    followUpEvidence: {
      required: false,
      type: "none",
      promisedAction: null,
      dueAt: null,
      contactMethod: "unknown",
      contactValueConfirmed: false,
      evidence: null,
    },
    guardrailViolations: [],
    unaddressedProspectQuestion: null,
    evidence: [],
  };
}

export function parseConversationScorecard(value: unknown) {
  const analysis = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const parsed = ConversationScorecardSchema.safeParse(analysis.conversationScorecard);
  return parsed.success ? parsed.data : null;
}

type CoachingCall = {
  ai_analysis?: unknown;
  network_outcome?: unknown;
};

function rankedCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function buildCoachingSummary(calls: CoachingCall[]) {
  const cards = calls.map((call) => parseConversationScorecard(call.ai_analysis)).filter((card): card is ConversationScorecard => Boolean(card));
  const connected = cards.filter((card) => card.humanConnected);
  const objections = connected.flatMap((card) => card.objectionDetails);
  const stages = rankedCounts(connected.map((card) => card.stageReached));
  const endReasons = rankedCounts(connected.map((card) => card.endReason));
  const objectionCounts = rankedCounts(objections.map((item) => item.category));
  const unhandledObjections = objections.filter((item) => item.handled === "no" || item.handled === "partial").length;
  const workflowAnswers = connected.filter((card) => card.workflowQuestionAnswered).length;
  const discoveries = connected.filter((card) => card.discoveryCompleted).length;
  const demoAsks = connected.filter((card) => card.demoAsked).length;
  const demoAccepts = connected.filter((card) => card.demoAccepted).length;
  const unsupportedClaims = connected.filter((card) => card.qualitySignals.unsupportedClaimDetected).length;
  const impactClarified = connected.filter((card) => card.qualitySignals.impactClarified === true).length;
  const reflectedBeforePitch = connected.filter((card) => card.qualitySignals.reflectedBeforePitch === true).length;
  const askedForInquiryCall = connected.filter((card) => card.qualitySignals.askedForInquiryCall === true).length;
  const unansweredQuestions = connected.filter((card) => Boolean(card.unaddressedProspectQuestion)).length;
  const followUpsRequired = connected.filter((card) => card.followUpEvidence.required).length;
  const guardrailViolations = connected.reduce((count, card) => count + card.guardrailViolations.length, 0);
  const dominant = endReasons[0];
  let nextExperiment = "Collect at least five human-connected calls before changing the script.";
  if (connected.length >= 5 && dominant?.count >= 2) {
    const experiments: Record<string, string> = {
      recording_concern: "Test one shorter recording acknowledgement, then stop and wait for permission.",
      early_disconnect: "Test a shorter opening with only the company name and one operational question.",
      workflow_question_unanswered: "Test one simpler category-specific workflow question and remove all setup language.",
      gatekeeper: "Test asking the gatekeeper about the workflow before requesting a decision-maker.",
      decision_maker_unavailable: "Test asking for the decision-maker’s name and a specific callback window.",
      objection_unresolved: "Test one evidence-safe clarification for the most repeated objection.",
      demo_declined: "Test a smaller CTA: a 10-minute workflow review tied to the confirmed pain point.",
    };
    nextExperiment = experiments[dominant.label] ?? `Review the repeated “${dominant.label.replaceAll("_", " ")}” ending before changing one line of the script.`;
  }
  return {
    totalCalls: calls.length,
    scoredCalls: cards.length,
    humanConnections: connected.length,
    workflowAnswers,
    discoveries,
    demoAsks,
    demoAccepts,
    impactClarified,
    reflectedBeforePitch,
    askedForInquiryCall,
    unansweredQuestions,
    followUpsRequired,
    guardrailViolations,
    unhandledObjections,
    unsupportedClaims,
    stages,
    endReasons,
    objections: objectionCounts,
    nextExperiment,
  };
}
