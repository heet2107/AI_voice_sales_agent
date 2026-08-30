import { generateText, Output } from "ai";
import { z } from "zod";
import { db, logActivity, setting } from "@/lib/db";
import type { ClawCallTerminal } from "@/lib/clawcall";
import { ConversationScorecardSchema, emptyConversationScorecard, parseConversationScorecard } from "@/lib/sales-intelligence";
import { loadBusinessProfile } from "@/lib/business-config";

export const MeetingBriefSchema = z.object({
  status: z.enum(["not_applicable", "needs_confirmation", "ready"]),
  meetingStatus: z.enum(["none", "calendar_link_pending", "confirmed"]),
  confirmedAt: z.string().nullable(),
  timeZone: z.string().nullable(),
  format: z.enum(["online", "in_person", "phone", "unknown"]),
  contactName: z.string().nullable(),
  decisionMakerRole: z.string().nullable(),
  objective: z.string().nullable(),
  painPoint: z.string().nullable(),
  currentProcess: z.string().nullable(),
  businessImpact: z.string().nullable(),
  desiredOutcome: z.string().nullable(),
  serviceHypothesis: z.string().nullable(),
  recommendedAgenda: z.array(z.string()).max(5),
  openQuestions: z.array(z.string()).max(5),
  boundaries: z.array(z.string()).max(8),
  evidence: z.array(z.string()).max(6),
});

export type MeetingBrief = z.infer<typeof MeetingBriefSchema>;

export function emptyMeetingBrief(): MeetingBrief {
  return {
    status: "not_applicable",
    meetingStatus: "none",
    confirmedAt: null,
    timeZone: null,
    format: "unknown",
    contactName: null,
    decisionMakerRole: null,
    objective: null,
    painPoint: null,
    currentProcess: null,
    businessImpact: null,
    desiredOutcome: null,
    serviceHypothesis: null,
    recommendedAgenda: [],
    openQuestions: [],
    boundaries: [
      "Confirm the prospect's workflow and desired outcome before recommending scope.",
      "Do not quote pricing, promise outcomes, or introduce unsupported research claims.",
    ],
    evidence: [],
  };
}

export const AnalysisSchema = z.object({
  taskSuccess: z.enum(["achieved", "partial", "failed", "unknown"]),
  correctBusiness: z.boolean().nullable(),
  decisionMakerReached: z.boolean(),
  contactName: z.string().nullable(),
  painPointExact: z.string().nullable(),
  currentWorkaround: z.string().nullable(),
  businessImpact: z.string().nullable(),
  desiredOutcome: z.string().nullable(),
  priority: z.string().nullable(),
  timeframe: z.string().nullable(),
  objections: z.array(z.string()),
  serviceMatch: z.string().min(1),
  serviceReason: z.string().nullable(),
  callbackRequested: z.boolean(),
  callbackAt: z.string().nullable(),
  calendarLinkFollowup: z.boolean(),
  contactMethod: z.enum(["mobile", "email", "unknown"]),
  contactValue: z.string().nullable(),
  dncRequested: z.boolean(),
  wrongNumber: z.boolean(),
  summary: z.string(),
  whatHappened: z.string(),
  nextStep: z.string(),
  followupType: z.enum(["none", "callback", "send_calendar_link", "send_information", "human_review"]),
  followupDraft: z.string().nullable(),
  scriptSignal: z.string().nullable(),
  conversationScorecard: ConversationScorecardSchema,
  meetingBrief: MeetingBriefSchema,
});

export type Analysis = z.infer<typeof AnalysisSchema>;

function transcriptText(transcript: ClawCallTerminal["transcript"]) {
  const profile = loadBusinessProfile();
  return (transcript ?? []).map((line) => `${line.role === "assistant" ? profile.agent.name : line.role === "tool" ? "System" : "Prospect"}: ${line.text}`).join("\n");
}

function prospectObjectionCategory(text: string) {
  if (/busy|bad time|not (?:a )?good time|call back|later/.test(text)) return "timing" as const;
  if (/not (?:the|a) (?:owner|manager)|don't make|do not make|not my decision/.test(text)) return "authority" as const;
  if (/already (?:have|use|handle)|we handle|covered/.test(text)) return "status_quo" as const;
  if (/not interested|don't need|do not need|no need/.test(text)) return "need" as const;
  if (/cost|price|budget|expensive/.test(text)) return "budget" as const;
  if (/record/.test(text)) return "recording" as const;
  if (/trust|scam|spam|legit/.test(text)) return "trust" as const;
  return "other" as const;
}

function detectGuardrailViolations(transcript: NonNullable<ClawCallTerminal["transcript"]>) {
  const profile = loadBusinessProfile();
  const violations: z.infer<typeof ConversationScorecardSchema>["guardrailViolations"] = [];
  for (const line of transcript.filter((item) => item.role === "assistant")) {
    const checks: Array<{ category: typeof violations[number]["category"]; pattern: RegExp; description: string }> = [
      { category: "unsupported_claim", pattern: /\b(?:guarantee|guaranteed|definitely increase|will rank|will generate|proven roi|double your|will save you)\b/i, description: `${profile.agent.name} made an outcome or performance claim that requires review.` },
      { category: "pricing", pattern: /(?:\$\s?\d|\b(?:price|pricing|costs?|monthly fee|per month)\b)/i, description: `${profile.agent.name} mentioned or discussed pricing during the outreach call.` },
      { category: "calendar_url_spoken", pattern: /calendly|https?:\/\//i, description: `${profile.agent.name} appears to have spoken or provided a scheduling URL during the call.` },
      { category: "booking_misrepresentation", pattern: /\b(?:you(?:'re| are) booked|meeting is (?:booked|confirmed)|i(?:'ve| have) booked)\b/i, description: `${profile.agent.name} claimed a booking was confirmed; verify that a real scheduling confirmation existed.` },
      { category: "privacy_or_sensitive_data", pattern: /\b(?:social security|ssn|policy number|claim number|credit card|driver(?:'s)? license|patient name|date of birth)\b/i, description: `${profile.agent.name} requested or discussed sensitive information.` },
      { category: "identity_misrepresentation", pattern: /\b(?:i am not an ai|i'm not an ai|i am human|i'm human)\b/i, description: `${profile.agent.name} appears to have misrepresented AI identity.` },
    ];
    for (const check of checks) {
      if (check.pattern.test(line.text)) violations.push({ category: check.category, description: check.description, evidence: line.text.slice(0, 280) });
    }
  }
  return violations;
}

export function deterministicFallback(terminal: ClawCallTerminal): Analysis {
  const profile = loadBusinessProfile();
  const text = transcriptText(terminal.transcript);
  const prospectLines = (terminal.transcript ?? []).filter((line) => line.role !== "assistant" && line.role !== "tool").map((line) => line.text.trim()).filter(Boolean);
  const prospect = prospectLines.join(" ");
  const dnc = /do not call|don't call|remove me|take me off|stop calling/i.test(prospect);
  const wrong = /wrong number|not (this|that) business|doesn't work here|no longer (here|in business)/i.test(prospect);
  const noAnswer = terminal.outcome === "no_answer" || terminal.outcome === "busy" || terminal.outcome === "rejected" || terminal.outcome === "unreachable";
  const voicemail = /you have reached|after the beep|leave (?:us |a )?message|left voicemail|sorry (?:we|i) missed your call|assisting another (?:guest|customer|client)/i.test(text);
  const callback = /call (me )?(back|tomorrow)|maybe call tomorrow|call tomorrow/i.test(prospect);
  const recordingConcern = /how does that matter|why.*record|recording/i.test(prospect);
  const audioIssue = /can you hear me|audio|hear me okay/i.test(text) || prospectLines.filter((line) => /^hello\??$/i.test(line)).length > 1;
  const businessConfirmed = /\b(yes|yeah|correct|that's right)\b/i.test(prospect) && /is this|am i reaching/i.test(text);
  const contactMatch = prospect.match(/my name is\s+([a-z][a-z .'-]{1,40})/i);
  const scorecard = emptyConversationScorecard(terminal.outcome);
  const transcript = terminal.transcript ?? [];
  const humanConnected = prospectLines.length > 0 && !voicemail && !noAnswer;
  const operationalQuestionIndex = transcript.findIndex((line) => line.role === "assistant" && /\b(?:how are|how do|what happens|when .*? how|how .*? handled|how .*? routed)\b/i.test(line.text));
  const workflowAnswer = operationalQuestionIndex >= 0
    ? transcript.slice(operationalQuestionIndex + 1).find((line) => line.role !== "assistant" && line.role !== "tool" && !/^(?:hello|yes|yeah|correct|speaking)\??$/i.test(line.text.trim()))
    : undefined;
  const assistantQuestions = transcript.filter((line) => line.role === "assistant" && line.text.includes("?"));
  const demoAskIndex = transcript.findIndex((line) => line.role === "assistant" && /(?:10.minute|workflow review|inquiry call|short call|demo)/i.test(line.text));
  const demoResponse = demoAskIndex >= 0
    ? transcript.slice(demoAskIndex + 1).find((line) => line.role !== "assistant" && line.role !== "tool")
    : undefined;
  const recommendationIndex = transcript.findIndex((line) => line.role === "assistant" && /\b(?:could help|recommend|solution|voice agent|calling agent|website chat|website|automation)\b/i.test(line.text));
  const reflectionIndex = transcript.findIndex((line) => line.role === "assistant" && /\b(?:it sounds like|sounds like|what i(?:'m| am) hearing|if i understand|so you(?:'re| are)|so the main)\b/i.test(line.text));
  const impactQuestionIndex = transcript.findIndex((line) => line.role === "assistant" && /\b(?:how often|what impact|how does that affect|what happens to those|how much time|how many)\b/i.test(line.text));
  const impactAnswer = impactQuestionIndex >= 0
    ? transcript.slice(impactQuestionIndex + 1).find((line) => line.role !== "assistant" && line.role !== "tool")
    : undefined;
  const firstWorkflowAnswerIndex = workflowAnswer ? transcript.indexOf(workflowAnswer) : -1;
  const acknowledgement = firstWorkflowAnswerIndex >= 0
    ? transcript.slice(firstWorkflowAnswerIndex + 1).find((line) => line.role === "assistant")
    : undefined;
  const objectionLine = transcript.find((line) => line.role !== "assistant" && line.role !== "tool" && /\b(?:not interested|already (?:have|use|handle)|we handle|too (?:busy|expensive)|bad time|call back|don't need|do not need|not my decision|why.*record|scam|spam)\b/i.test(line.text));
  const objectionIndex = objectionLine ? transcript.indexOf(objectionLine) : -1;
  const objectionResponse = objectionIndex >= 0 ? transcript.slice(objectionIndex + 1).find((line) => line.role === "assistant") : undefined;
  const objectionHandled = objectionResponse
    ? /\b(?:understand|makes sense|that makes sense|absolutely|fair|hear you|not assuming|what normally|would it be fair)\b/i.test(objectionResponse.text)
    : false;
  const guardrailViolations = detectGuardrailViolations(transcript);
  const demoDeclined = Boolean(demoResponse && /\b(?:no|not interested|don't|do not|maybe later|too busy|send information)\b/i.test(demoResponse.text));
  const ownerOrManagerMentioned = prospectLines.some((line) => /\b(?:owner|manager|director|principal|broker|doctor|practice manager)\b/i.test(line));
  const decisionMakerReached = prospectLines.some((line) => /\b(?:i am|i'm|speaking|this is)\b.{0,24}\b(?:owner|manager|director|principal|broker|doctor)\b/i.test(line));
  scorecard.humanConnected = humanConnected;
  scorecard.openingAnswered = humanConnected;
  scorecard.workflowQuestionAnswered = Boolean(workflowAnswer);
  scorecard.decisionMakerProgress = decisionMakerReached ? "decision_maker_reached"
    : contactMatch ? "named_contact_identified"
    : ownerOrManagerMentioned ? "role_identified"
    : humanConnected ? "gatekeeper_engaged"
    : "not_started";
  scorecard.discoveryCompleted = Boolean(workflowAnswer && assistantQuestions.length >= 3 && prospectLines.length >= 3);
  scorecard.recommendationMade = recommendationIndex >= 0;
  scorecard.demoAsked = demoAskIndex >= 0;
  scorecard.demoAccepted = Boolean(demoResponse && /\b(?:yes|sure|okay|send|schedule|calendar)\b/i.test(demoResponse.text));
  scorecard.demoDeclineReason = demoDeclined ? demoResponse?.text.slice(0, 280) ?? null : null;
  scorecard.bookingOutcome = scorecard.demoAccepted ? "calendar_followup" : demoDeclined ? "declined" : scorecard.demoAsked ? "unknown" : "not_offered";
  scorecard.qualitySignals.oneQuestionAtATime = humanConnected ? assistantQuestions.every((line) => (line.text.match(/\?/g) ?? []).length <= 1) : null;
  scorecard.qualitySignals.acknowledgedAnswer = workflowAnswer ? Boolean(acknowledgement && /\b(?:understand|got it|makes sense|thank you|helpful|sounds like)\b/i.test(acknowledgement.text)) : null;
  scorecard.qualitySignals.reflectedProspectLanguage = recommendationIndex >= 0 ? reflectionIndex >= 0 && reflectionIndex < recommendationIndex : null;
  scorecard.qualitySignals.reflectedBeforePitch = recommendationIndex >= 0 ? reflectionIndex >= 0 && reflectionIndex < recommendationIndex : null;
  scorecard.qualitySignals.impactClarified = workflowAnswer ? Boolean(impactQuestionIndex >= 0 && impactAnswer) : null;
  scorecard.qualitySignals.recommendedSmallestSolution = recommendationIndex >= 0 ? null : null;
  scorecard.qualitySignals.askedForInquiryCall = humanConnected ? demoAskIndex >= 0 : null;
  scorecard.guardrailViolations = guardrailViolations;
  scorecard.qualitySignals.unsupportedClaimDetected = guardrailViolations.some((violation) => violation.category === "unsupported_claim");
  if (objectionLine) {
    scorecard.objectionDetails.push({
      exact: objectionLine.text.slice(0, 280),
      category: prospectObjectionCategory(objectionLine.text.toLowerCase()),
      handled: objectionResponse ? objectionHandled ? "yes" : "no" : "no",
      responseSummary: objectionResponse?.text.slice(0, 280) ?? null,
      evidence: objectionLine.text.slice(0, 280),
    });
    const assistantTurnsAfterObjection = transcript.slice(objectionIndex + 1).filter((line) => line.role === "assistant");
    if (/not interested|don't need|do not need/i.test(objectionLine.text) && assistantTurnsAfterObjection.length > 2) {
      scorecard.guardrailViolations.push({
        category: "pressure_or_repeated_objection",
        description: `${profile.agent.name} continued for multiple turns after an explicit soft refusal; review whether more than one respectful response was attempted.`,
        evidence: assistantTurnsAfterObjection.slice(0, 3).map((line) => line.text).join(" | ").slice(0, 280),
      });
    }
  }
  if (callback) {
    const callbackEvidence = prospectLines.find((line) => /call (?:me )?(?:back|tomorrow)|call tomorrow/i.test(line)) ?? null;
    scorecard.commitments.push({ speaker: "prospect", commitment: "Requested a callback", due: null, confirmed: true, evidence: callbackEvidence });
    scorecard.followUpEvidence = { required: true, type: "callback", promisedAction: "Call the prospect back", dueAt: null, contactMethod: "unknown", contactValueConfirmed: false, evidence: callbackEvidence };
  } else if (scorecard.demoAccepted) {
    scorecard.commitments.push({ speaker: "jessica", commitment: "Send the calendar link", due: null, confirmed: true, evidence: demoResponse?.text.slice(0, 280) ?? null });
    scorecard.followUpEvidence = { required: true, type: "send_calendar_link", promisedAction: "Send the calendar link", dueAt: null, contactMethod: "unknown", contactValueConfirmed: false, evidence: demoResponse?.text.slice(0, 280) ?? null };
  }
  if (workflowAnswer) scorecard.evidence.push({ signal: "workflow_question_answered", excerpt: workflowAnswer.text.slice(0, 240) });
  if (demoResponse) scorecard.evidence.push({ signal: "demo_response", excerpt: demoResponse.text.slice(0, 240) });
  let summary = "The call connected but ended during the introduction before any discovery information was collected.";
  let whatHappened = `A person answered, but the conversation ended before ${profile.agent.name} reached a decision-maker or discussed a business need.`;
  let nextStep = `Retry later only if a verified-open slot, the configured ${profile.operations.retryDelayMinutes}-minute minimum gap, and daily capacity remain; otherwise carry the lead forward, subject to the ${profile.operations.maxLifetimeAttempts}-attempt cap.`;
  let taskSuccess: Analysis["taskSuccess"] = "failed";
  let followupType: Analysis["followupType"] = "none";
  let followupDraft: string | null = null;
  let scriptSignal: string | null = null;
  if (dnc) {
    summary = "The prospect explicitly requested no further calls. The number was added to the do-not-call list.";
    whatHappened = "The prospect opted out of future outreach.";
    nextStep = "Do not call again.";
    scorecard.stageReached = "opening";
    scorecard.endReason = "do_not_call";
    const dncIndex = transcript.findIndex((line) => line.role !== "assistant" && line.role !== "tool" && /do not call|don't call|remove me|take me off|stop calling/i.test(line.text));
    const responseAfterDnc = dncIndex >= 0 ? transcript.slice(dncIndex + 1).find((line) => line.role === "assistant") : undefined;
    scorecard.qualitySignals.honoredRefusal = responseAfterDnc
      ? /understand|won't call|will not call|remove|take you off|have a good/i.test(responseAfterDnc.text)
      : null;
    if (responseAfterDnc && scorecard.qualitySignals.honoredRefusal === false) {
      scorecard.guardrailViolations.push({
        category: "opt_out_not_honored",
        description: "The first response after an explicit opt-out did not clearly acknowledge and honor the request.",
        evidence: responseAfterDnc.text.slice(0, 280),
      });
    }
  } else if (wrong) {
    summary = "The call reached the wrong business or an incorrect number. The lead was disqualified and suppressed from future calls.";
    whatHappened = "The person who answered said this was not the intended business or contact.";
    nextStep = "Do not retry this number; research a corrected business line before creating a new lead.";
    scorecard.stageReached = "opening";
    scorecard.endReason = "wrong_number";
  } else if (noAnswer) {
    summary = terminal.outcome === "no_answer" ? "Nobody answered the business line, and no conversation occurred." : `The call ended with the network outcome “${terminal.outcome}” before a conversation occurred.`;
    whatHappened = "The call did not reach a person.";
    scorecard.stageReached = "not_connected";
    scorecard.endReason = "no_answer";
  } else if (voicemail) {
    summary = `The call reached the business voicemail. ${profile.agent.name} left a concise ${profile.company.name} message and callback number; no decision-maker or pain point was reached.`;
    whatHappened = `A voicemail greeting answered and ${profile.agent.name} left a message.`;
    nextStep = "Allow time for a return call; do not place an automatic same-day retry after leaving voicemail.";
    scorecard.stageReached = "disclosure";
    scorecard.endReason = "voicemail";
  } else if (callback) {
    summary = "The business was confirmed and the contact requested a callback, but no pain point or solution discussion occurred. The requested callback window should be honored before further outreach.";
    whatHappened = `The contact asked ${profile.agent.name} to call back at a more convenient time.`;
    nextStep = "Call back during the prospect's stated window and resume from the prior context.";
    taskSuccess = "partial";
    followupType = "callback";
    followupDraft = "Callback requested during the prior call. Resume briefly and ask permission before discovery.";
    scorecard.stageReached = scorecard.workflowQuestionAnswered ? "workflow_question" : "opening";
    scorecard.endReason = "callback_requested";
  } else if (recordingConcern) {
    summary = "The person who answered questioned the recording notice. The call ended before the business or a decision-maker was confirmed, and no discovery took place.";
    whatHappened = "The recording disclosure created concern before the outreach conversation could begin.";
    nextStep = "If retried, acknowledge the concern immediately and end the call unless the prospect clearly agrees to continue.";
    scriptSignal = "Acknowledge recording concerns before continuing with the introduction.";
    scorecard.stageReached = "disclosure";
    scorecard.endReason = "recording_concern";
  } else if (audioIssue) {
    summary = "The call connected, but repeated greetings indicated a two-way audio problem. No business need, decision-maker, or follow-up commitment was captured.";
    whatHappened = "The parties could not establish a usable audio connection.";
    scorecard.stageReached = "disclosure";
    scorecard.endReason = "audio_failure";
  } else if (businessConfirmed) {
    summary = `The intended business was confirmed, and ${profile.agent.name} asked for the owner or person responsible for growth. The call ended before that person responded, so no pain point or next step was established.`;
    whatHappened = "The correct business answered, but the conversation stopped at the decision-maker request.";
    taskSuccess = "partial";
    scorecard.stageReached = scorecard.workflowQuestionAnswered ? "workflow_question" : "opening";
    scorecard.endReason = scorecard.workflowQuestionAnswered ? "unknown" : "early_disconnect";
  } else if (!prospect.trim()) {
    summary = "The call connected, but no prospect speech was captured after the recording notice. No discovery or follow-up commitment occurred.";
    whatHappened = "The line connected without a usable response from the business.";
    scorecard.stageReached = "disclosure";
    scorecard.endReason = "early_disconnect";
  } else {
    scorecard.stageReached = scorecard.demoAccepted ? "scheduling"
      : scorecard.demoAsked ? "demo_ask"
      : scorecard.discoveryCompleted ? "discovery"
      : scorecard.workflowQuestionAnswered ? "workflow_question"
      : "opening";
    scorecard.endReason = scorecard.demoAccepted ? "calendar_followup"
      : demoDeclined ? "demo_declined"
      : operationalQuestionIndex >= 0 && !workflowAnswer ? "workflow_question_unanswered"
      : "early_disconnect";
  }
  if (scorecard.demoAccepted && !dnc && !wrong) {
    followupType = "send_calendar_link";
    followupDraft = "The prospect agreed to a short workflow review. Send the calendar link, but do not state that a meeting is booked until a slot is confirmed.";
    nextStep = "Human review and send the calendar link using the confirmed contact channel; record the meeting only after a definite slot is confirmed.";
    taskSuccess = "partial";
  }
  const meetingBrief = emptyMeetingBrief();
  if (scorecard.demoAccepted) {
    meetingBrief.status = "needs_confirmation";
    meetingBrief.meetingStatus = "calendar_link_pending";
    meetingBrief.contactName = contactMatch?.[1]?.trim() ?? null;
    meetingBrief.objective = "Review the prospect's confirmed inquiry workflow and determine whether a narrowly scoped solution is appropriate.";
    meetingBrief.recommendedAgenda = [
      "Confirm the current inquiry workflow and who owns it.",
      "Quantify frequency and business impact using the prospect's own information.",
      "Map the smallest useful solution and agree on a next step.",
    ];
    meetingBrief.openQuestions = ["Who is the decision-maker?", "What workflow problem, if any, should the inquiry call address?"];
    if (demoResponse) meetingBrief.evidence = [demoResponse.text.slice(0, 280)];
  }
  return {
    taskSuccess,
    correctBusiness: wrong ? false : businessConfirmed ? true : null,
    decisionMakerReached,
    contactName: contactMatch?.[1]?.trim() ?? null,
    painPointExact: null,
    currentWorkaround: null,
    businessImpact: null,
    desiredOutcome: null,
    priority: null,
    timeframe: null,
    objections: [],
    serviceMatch: "none",
    serviceReason: null,
    callbackRequested: callback,
    callbackAt: null,
    calendarLinkFollowup: scorecard.demoAccepted,
    contactMethod: "unknown",
    contactValue: null,
    dncRequested: dnc,
    wrongNumber: wrong,
    summary,
    whatHappened,
    nextStep,
    followupType: dnc || wrong ? "none" : followupType,
    followupDraft,
    scriptSignal,
    conversationScorecard: scorecard,
    meetingBrief,
  };
}

export async function analyzeAndApply(callId: string, leadId: string, terminal: ClawCallTerminal) {
  const profile = loadBusinessProfile();
  const fallback = deterministicFallback(terminal);
  let analysis = fallback;
  let model = "deterministic-fallback";
  let usage: { inputTokens?: number; outputTokens?: number } = {};
  let aiError: string | null = null;
  const text = transcriptText(terminal.transcript);

  if (text.trim()) {
    try {
      model = process.env.AI_MODEL || "openai/gpt-5.4";
      const result = await generateText({
        model,
        output: Output.object({ schema: AnalysisSchema, name: "call_analysis", description: "Evidence-grounded sales call analysis" }),
        system: `You are the quality analyst for ${profile.company.name} outreach. The calling agent is ${profile.agent.name}. Use only the transcript and call metadata. Do not infer pain, urgency, contact details, consent, bookings, or outcomes not explicitly supported. Separate phone-network outcome from task success. Preserve exact prospect language for pain points and objections. In conversationScorecard, mark the last successful stage only with evidence. Score decisionMakerProgress conservatively. impactClarified is true only when ${profile.agent.name} asked about frequency or business impact and received an answer. reflectedBeforePitch is true only when ${profile.agent.name} accurately reflected the prospect's stated situation before recommending anything. askedForInquiryCall is true only for an explicit inquiry-call or workflow-review ask. Capture the exact demo decline reason. Keep ambiguous quality signals null and include short evidence excerpts. An objection is handled only when ${profile.agent.name} acknowledged and addressed the stated concern without pressure or unsupported proof. Record every promise in commitments and mirror any required action in followUpEvidence with exact evidence and a due date only when stated. List each unsupported claim or fixed-guardrail violation with the exact excerpt. Write a clear two-to-four sentence summary, a plain-language whatHappened field, and one concrete nextStep so someone can understand the call after the recording expires. Create a meetingBrief only after interest in an inquiry call; mark it ready only when a definite slot, timezone, and format are confirmed. A calendar-link request is not a booking. The brief must preserve the prospect's words, list unanswered discovery questions, and never add pricing, guarantees, or unsupported research. Recommend only one of the configured services when transcript evidence supports it (${profile.company.services.map((service) => service.name).join(", ")}); otherwise use none. Never generate pricing or guarantees.`,
        prompt: `Network outcome: ${terminal.outcome || "unknown"}\nTalk seconds: ${terminal.talk_seconds || 0}\n\nTranscript:\n${text}`,
        providerOptions: { gateway: { user: `${profile.company.shortName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-campaign`, tags: ["feature:transcript-analysis", `campaign:${profile.branding.regionLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`] } }
      });
      analysis = result.output;
      usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };
    } catch (error) {
      aiError = error instanceof Error ? error.message.slice(0, 500) : "AI analysis failed";
    }
  }

  const prospect = (terminal.transcript ?? []).filter((line) => line.role !== "assistant" && line.role !== "tool").map((line) => line.text).join(" ");
  const voicemailEvidence = /you have reached|after the beep|leave (?:us |a )?message|sorry (?:we|i) missed your call|assisting another (?:guest|customer|client)/i.test(prospect);
  if (/do not call|don't call|remove me|take me off|stop calling/i.test(prospect)) analysis.dncRequested = true;
  if (/wrong number|not (this|that) business|doesn't work here|no longer (here|in business)/i.test(prospect)) analysis.wrongNumber = true;
  if (voicemailEvidence && !analysis.dncRequested && !analysis.wrongNumber) {
    analysis = {
      ...analysis,
      taskSuccess: "failed",
      decisionMakerReached: false,
      painPointExact: null,
      currentWorkaround: null,
      businessImpact: null,
      desiredOutcome: null,
      priority: null,
      timeframe: null,
      serviceMatch: "none",
      serviceReason: null,
      callbackRequested: false,
      callbackAt: null,
      calendarLinkFollowup: false,
      followupType: "none",
      followupDraft: null,
      summary: `The call reached the business voicemail. ${profile.agent.name} left a concise ${profile.company.name} message and callback number; no decision-maker or pain point was reached.`,
      whatHappened: `A voicemail greeting answered and ${profile.agent.name} left one message.`,
      nextStep: "Allow time for a return call; do not place an automatic same-day retry after leaving voicemail.",
      conversationScorecard: {
        ...analysis.conversationScorecard,
        humanConnected: false,
        stageReached: "disclosure",
        endReason: "voicemail",
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
        unaddressedProspectQuestion: null,
      },
      meetingBrief: emptyMeetingBrief(),
    };
  }
  if (analysis.dncRequested || analysis.wrongNumber) {
    analysis.calendarLinkFollowup = false;
    analysis.callbackRequested = false;
    analysis.followupType = "none";
    analysis.followupDraft = null;
    analysis.conversationScorecard.followUpEvidence = {
      required: false,
      type: "none",
      promisedAction: null,
      dueAt: null,
      contactMethod: "unknown",
      contactValueConfirmed: false,
      evidence: null,
    };
    analysis.meetingBrief = emptyMeetingBrief();
  }
  if (analysis.meetingBrief.meetingStatus === "confirmed" && analysis.conversationScorecard.bookingOutcome !== "confirmed") {
    analysis.meetingBrief.meetingStatus = analysis.calendarLinkFollowup ? "calendar_link_pending" : "none";
    analysis.meetingBrief.status = analysis.calendarLinkFollowup ? "needs_confirmation" : "not_applicable";
    analysis.meetingBrief.confirmedAt = null;
  }
  if (analysis.conversationScorecard.guardrailViolations.some((item) => item.category === "unsupported_claim")) {
    analysis.conversationScorecard.qualitySignals.unsupportedClaimDetected = true;
  }

  await db().query(
    `UPDATE calls SET task_success=$1,summary=$2,ai_analysis=$3::jsonb,analysis_status=$4,summary_generated_at=now(),updated_at=now() WHERE id=$5`,
    [analysis.taskSuccess, analysis.summary, JSON.stringify(analysis), aiError ? "fallback" : "complete", callId]
  );
  await db().query(
    `INSERT INTO ai_usage(call_id,feature,model,input_tokens,output_tokens,status,error)
     VALUES($1,'transcript_analysis',$2,$3,$4,$5,$6)`,
    [callId, model, usage.inputTokens ?? null, usage.outputTokens ?? null, aiError ? "fallback" : "success", aiError]
  );

  let stage = analysis.taskSuccess === "achieved" ? "Interested" : terminal.outcome === "answered" ? "Contacted" : terminal.outcome === "no_answer" ? "Attempted" : "Attempted";
  if (analysis.callbackRequested) stage = "Callback";
  if (analysis.calendarLinkFollowup) stage = "Interested";
  if (analysis.meetingBrief.meetingStatus === "confirmed" && analysis.meetingBrief.status === "ready") stage = "Meeting";
  if (analysis.wrongNumber) stage = "Disqualified";
  if (analysis.dncRequested) stage = "Not interested";
  await db().query(
    `UPDATE leads SET pipeline_stage=$1,outcome=$2,call_notes=$3,last_contact_at=COALESCE($4::timestamptz,now()),updated_at=now(),
      do_not_call=CASE WHEN $5 THEN true ELSE do_not_call END,
      dnc_reason=CASE WHEN $5 THEN 'Explicit request in call transcript' ELSE dnc_reason END
     WHERE id=$6`,
    [stage, terminal.outcome ?? null, analysis.summary, terminal.timestamps?.finalized_at ?? null, analysis.dncRequested || analysis.wrongNumber, leadId]
  );

  if (analysis.dncRequested || analysis.wrongNumber) {
    const leadRows = await db().query("SELECT phone FROM leads WHERE id=$1", [leadId]);
    const phone = leadRows[0]?.phone;
    if (phone) await db().query(
      `INSERT INTO dnc_entries(phone,lead_id,call_id,reason) VALUES($1,$2,$3,$4)
       ON CONFLICT(phone) DO UPDATE SET reason=excluded.reason,requested_at=now(),call_id=excluded.call_id`,
      [phone, leadId, callId, analysis.dncRequested ? "Explicit do-not-call request" : "Wrong number"]
    );
  }

  const evidenceFollowupType = analysis.conversationScorecard.followUpEvidence.required
    ? analysis.conversationScorecard.followUpEvidence.type
    : "none";
  const effectiveFollowupType = analysis.followupType !== "none" ? analysis.followupType : evidenceFollowupType;
  if (effectiveFollowupType !== "none") {
    const evidenceDue = analysis.conversationScorecard.followUpEvidence.dueAt;
    const dueCandidate = analysis.callbackAt || evidenceDue;
    const due = dueCandidate && !Number.isNaN(Date.parse(dueCandidate)) ? dueCandidate : null;
    await db().query(
      `INSERT INTO follow_ups(lead_id,call_id,type,channel,contact,status,due_at,draft,notes)
       SELECT $1,$2,$3,$4,$5,'open',$6::timestamptz,$7,$8
       WHERE NOT EXISTS (SELECT 1 FROM follow_ups WHERE call_id=$2 AND type=$3 AND status='open')`,
      [leadId, callId, effectiveFollowupType, analysis.contactMethod === "unknown" ? null : analysis.contactMethod,
        analysis.contactValue, due, analysis.followupDraft || analysis.conversationScorecard.followUpEvidence.promisedAction,
        analysis.conversationScorecard.followUpEvidence.evidence || analysis.scriptSignal]
    );
  }
  for (const commitment of analysis.conversationScorecard.commitments.filter((item) => item.confirmed)) {
    const due = commitment.due && !Number.isNaN(Date.parse(commitment.due)) ? commitment.due : null;
    const note = `Commitment (${commitment.speaker}): ${commitment.commitment}`;
    await db().query(`INSERT INTO follow_ups(lead_id,call_id,type,status,due_at,draft,notes)
      SELECT $1,$2,'human_review','open',$3::timestamptz,$4,$5
      WHERE NOT EXISTS (SELECT 1 FROM follow_ups WHERE call_id=$2 AND notes=$5)`,
    [leadId, callId, due, commitment.commitment, note]);
  }
  if (analysis.meetingBrief.status !== "not_applicable") {
    const confirmedAt = analysis.meetingBrief.confirmedAt;
    const meetingAt = confirmedAt && !Number.isNaN(Date.parse(confirmedAt)) ? confirmedAt : null;
    await db().query(`INSERT INTO meeting_briefs(lead_id,call_id,status,meeting_at,format,contact_name,brief)
      VALUES($1,$2,$3,$4::timestamptz,$5,$6,$7::jsonb)
      ON CONFLICT(call_id) DO UPDATE SET status=excluded.status,meeting_at=excluded.meeting_at,
        format=excluded.format,contact_name=excluded.contact_name,brief=excluded.brief,updated_at=now()`,
    [leadId, callId, analysis.meetingBrief.status, meetingAt,
      analysis.meetingBrief.format, analysis.meetingBrief.contactName, JSON.stringify(analysis.meetingBrief)]);
  }
  await logActivity("call", callId, "analyzed", { taskSuccess: analysis.taskSuccess, stage, dnc: analysis.dncRequested, followup: effectiveFollowupType, meetingBrief: analysis.meetingBrief.status });
  return analysis;
}

const ScriptSuggestionSchema = z.object({
  shouldChange: z.boolean(),
  proposedContent: z.string().nullable(),
  changeSummary: z.string().nullable(),
  evidence: z.array(z.string())
});

export async function createDailyScriptSuggestion(localDate: string) {
  const profile = loadBusinessProfile();
  const mode = await setting("script_review_mode", "review_required");
  const [calls, active, calibration, runningExperiment] = await Promise.all([
    db().query(`SELECT c.id,c.summary,c.task_success,c.ai_analysis,l.business,l.category,l.segment
      FROM calls c JOIN leads l ON l.id=c.lead_id
      WHERE (c.finalized_at AT TIME ZONE $2)::date=$1::date AND c.analysis_status IN ('complete','fallback')
      ORDER BY c.finalized_at`, [localDate, profile.operations.timezone]),
    db().query("SELECT id,version,content,fixed_guardrails FROM script_versions WHERE status='active' ORDER BY activated_at DESC LIMIT 1"),
    db().query("SELECT count(*)::int AS reviewed FROM analysis_calibrations WHERE status='reviewed'"),
    db().query("SELECT id FROM script_experiments WHERE status IN ('running','ready_to_decide') LIMIT 1")
  ]);
  if (!calls.length || !active[0] || mode !== "review_required") return { created: false, reason: "No analyzed calls or review mode disabled" };
  if (Number(calibration[0]?.reviewed ?? 0) < 10) return { created: false, reason: "At least ten manually reviewed calibration transcripts are required before automated script suggestions" };
  if (runningExperiment.length) return { created: false, reason: "Finish the current five-call canary before proposing another script change" };
  const humanCalls = calls.filter((call) => parseConversationScorecard(call.ai_analysis)?.humanConnected);
  if (humanCalls.length < 5) return { created: false, reason: `Only ${humanCalls.length} human-connected calls; five are required before proposing a script change` };
  const repeatedEndings = new Map<string, number>();
  for (const call of humanCalls) {
    const reason = parseConversationScorecard(call.ai_analysis)?.endReason;
    if (reason) repeatedEndings.set(reason, (repeatedEndings.get(reason) ?? 0) + 1);
  }
  if (![...repeatedEndings.values()].some((count) => count >= 2)) {
    return { created: false, reason: "No repeated conversation-ending signal across the human-connected sample" };
  }
  const existing = await db().query("SELECT id FROM script_versions WHERE version=$1", [`v${localDate}`]);
  if (existing.length) return { created: false, reason: "Suggestion already exists" };
  try {
    const model = process.env.AI_MODEL || "openai/gpt-5.4";
    const result = await generateText({
      model,
      output: Output.object({ schema: ScriptSuggestionSchema, name: "script_suggestion" }),
      system: `You improve ${profile.company.name}'s discovery script using evidence only. The calling identity is ${profile.agent.name}, ${profile.agent.title}. Propose at most one small wording or sequencing change tied to a repeated conversation-ending signal. Preserve the question-first opening and never turn research hypotheses into claims. The proposed content must include a five-human-call canary metric and a rollback condition in its evidence. Never change identity, recording disclosure, truthful AI answer, no-pricing rule, no-guarantee rule, scheduling confirmation rules, privacy, opt-out, DNC, consent, or retry guardrails. If evidence is weak or mixed, propose no change.`,
      prompt: `Active script:\n${active[0].content}\n\nFixed guardrails:\n${JSON.stringify(active[0].fixed_guardrails)}\n\nRepeated ending counts:\n${JSON.stringify(Object.fromEntries(repeatedEndings))}\n\nToday's human-connected analyzed calls:\n${JSON.stringify(humanCalls)}`,
      providerOptions: { gateway: { user: `${profile.company.shortName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-campaign`, tags: ["feature:script-review", `campaign:${profile.branding.regionLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`] } }
    });
    if (!result.output.shouldChange || !result.output.proposedContent || !result.output.changeSummary) return { created: false, reason: "No evidence-backed change" };
    await db().query(
      `INSERT INTO script_versions(version,status,content,change_summary,evidence,fixed_guardrails)
       VALUES($1,'proposed',$2,$3,$4::jsonb,$5::jsonb)`,
      [`v${localDate}`, result.output.proposedContent, result.output.changeSummary, JSON.stringify(result.output.evidence), JSON.stringify(active[0].fixed_guardrails)]
    );
    return { created: true, summary: result.output.changeSummary };
  } catch (error) {
    return { created: false, reason: error instanceof Error ? error.message : "AI review failed" };
  }
}
