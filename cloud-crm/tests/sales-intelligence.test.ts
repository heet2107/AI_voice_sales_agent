import { expect, test } from "vitest";
import { buildCoachingSummary, deriveResearchProfile, emptyConversationScorecard } from "../lib/sales-intelligence";

const restaurantLead = {
  business: "Juniper Cafe",
  category: "Restaurant",
  segment: "local_business",
  city: "Round Rock",
  address: "1 Main Street",
  rating: 4.8,
  review_count: 120,
  presence_class: "listing only",
  website_url: null,
  social_url: null,
  evidence_notes: "Family-owned independent business. No independent website was found during verification.",
  primary_source_url: "https://example.com/juniper",
  presence_check_url: "https://example.com/search/juniper",
  verified_on: "2026-08-30",
  confidence: "high",
  research_profile: null,
};

test("research profile separates specific verified evidence from category hypotheses", () => {
  const profile = deriveResearchProfile(restaurantLead, { force: true });
  expect(profile.status).toBe("ready");
  expect(profile.icpProfile.id).toBe("hospitality");
  expect(profile.localAuthority.status).toBe("verified");
  expect(profile.personalizedObservation ?? "").toMatch(/4\.8/);
  expect(profile.personalizedObservationEvidence?.sourceUrl).toBe("https://example.com/juniper");
  expect(profile.likelyObjection ?? "").toMatch(/staff/i);
  expect(profile.evidenceSafeResponse ?? "").toMatch(/rush|after hours/i);
  expect(profile.prohibitedClaims.some((claim) => /reservations|revenue/i.test(claim))).toBe(true);
  expect(profile.hypotheses.every((hypothesis) => /hypothesis|validate/i.test(hypothesis))).toBe(true);
});

test("custom ICP input overrides category preparation without changing evidence", () => {
  const profile = deriveResearchProfile(restaurantLead, {
    force: true,
    icpProfile: {
      id: "custom-catering",
      name: "Catering-led restaurant",
      categoryPatterns: ["restaurant"],
      discoveryQuestion: "How are large catering inquiries routed?",
      likelyObjection: "Catering is seasonal.",
      evidenceSafeResponse: "Understood. Which periods create the most routing work?",
    },
  });
  expect(profile.icpProfile.id).toBe("custom-catering");
  expect(profile.discoveryQuestion).toBe("How are large catering inquiries routed?");
  expect(profile.verifiedFacts[0]?.sourceUrl).toBe(restaurantLead.primary_source_url);
});

test("empty scorecard includes durable quality, follow-up, and guardrail fields", () => {
  const card = emptyConversationScorecard("no_answer");
  expect(card.stageReached).toBe("not_connected");
  expect(card.decisionMakerProgress).toBe("not_started");
  expect(card.qualitySignals.impactClarified).toBeNull();
  expect(card.qualitySignals.reflectedBeforePitch).toBeNull();
  expect(card.followUpEvidence.required).toBe(false);
  expect(card.guardrailViolations).toEqual([]);
});

test("coaching summary aggregates the new evidence-backed quality signals", () => {
  const card = emptyConversationScorecard("answered");
  card.humanConnected = true;
  card.stageReached = "demo_ask";
  card.workflowQuestionAnswered = true;
  card.demoAsked = true;
  card.qualitySignals.impactClarified = true;
  card.qualitySignals.reflectedBeforePitch = true;
  card.qualitySignals.askedForInquiryCall = true;
  card.followUpEvidence = { required: true, type: "send_calendar_link", promisedAction: "Send link", dueAt: null, contactMethod: "email", contactValueConfirmed: true, evidence: "Please email it" };
  const summary = buildCoachingSummary([{ ai_analysis: { conversationScorecard: card } }]);
  expect(summary.impactClarified).toBe(1);
  expect(summary.reflectedBeforePitch).toBe(1);
  expect(summary.askedForInquiryCall).toBe(1);
  expect(summary.followUpsRequired).toBe(1);
});
