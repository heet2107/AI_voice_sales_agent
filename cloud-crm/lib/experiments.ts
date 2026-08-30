import type { ConversationScorecard } from "./sales-intelligence";

const stageOrder: ConversationScorecard["stageReached"][] = [
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
];

export type CalibrationReview = {
  id: string;
  automated: ConversationScorecard;
  manual: ConversationScorecard;
};

type ComparableField =
  | "stageReached"
  | "endReason"
  | "workflowQuestionAnswered"
  | "decisionMakerProgress"
  | "discoveryCompleted"
  | "recommendationMade"
  | "demoAsked"
  | "demoAccepted";

const calibrationFields: ComparableField[] = [
  "stageReached",
  "endReason",
  "workflowQuestionAnswered",
  "decisionMakerProgress",
  "discoveryCompleted",
  "recommendationMade",
  "demoAsked",
  "demoAccepted",
];

export function compareCalibrationReviews(reviews: CalibrationReview[], minimumReviews = 10) {
  const fieldResults = calibrationFields.map((field) => {
    const agreements = reviews.filter((review) => review.automated[field] === review.manual[field]).length;
    return {
      field,
      agreements,
      total: reviews.length,
      agreementRate: reviews.length ? agreements / reviews.length : 0,
    };
  });
  const exactMatches = reviews.filter((review) => calibrationFields.every((field) => review.automated[field] === review.manual[field])).length;
  const disagreements = reviews.flatMap((review) => calibrationFields
    .filter((field) => review.automated[field] !== review.manual[field])
    .map((field) => ({ id: review.id, field, automated: review.automated[field], manual: review.manual[field] })));
  const weakestFields = [...fieldResults].sort((a, b) => a.agreementRate - b.agreementRate || a.field.localeCompare(b.field)).slice(0, 3);
  const complete = reviews.length >= minimumReviews;
  return {
    sampleSize: reviews.length,
    minimumReviews,
    complete,
    exactMatches,
    exactMatchRate: reviews.length ? exactMatches / reviews.length : 0,
    fieldResults,
    weakestFields,
    disagreements,
    recommendation: !complete
      ? `Manually review ${minimumReviews - reviews.length} more transcript${minimumReviews - reviews.length === 1 ? "" : "s"} before trusting automated coaching.`
      : weakestFields[0] && weakestFields[0].agreementRate < 0.8
        ? `Recalibrate ${weakestFields[0].field} before using it for script recommendations.`
        : "Calibration coverage is sufficient; keep human approval for every script experiment.",
  };
}

export type CanaryMetric = "workflow_answer_rate" | "discovery_rate" | "inquiry_ask_rate" | "demo_accept_rate" | "average_stage";

function scoreCards(cards: ConversationScorecard[]) {
  const connected = cards.filter((card) => card.humanConnected);
  const divisor = connected.length || 1;
  return {
    calls: cards.length,
    humanConnections: connected.length,
    workflowAnswerRate: connected.filter((card) => card.workflowQuestionAnswered).length / divisor,
    discoveryRate: connected.filter((card) => card.discoveryCompleted).length / divisor,
    inquiryAskRate: connected.filter((card) => card.qualitySignals.askedForInquiryCall === true || card.demoAsked).length / divisor,
    demoAcceptRate: connected.filter((card) => card.demoAccepted).length / divisor,
    averageStage: connected.reduce((sum, card) => sum + stageOrder.indexOf(card.stageReached), 0) / divisor,
    guardrailViolations: connected.reduce((sum, card) => sum + card.guardrailViolations.length, 0),
    honoredRefusals: connected.filter((card) => card.qualitySignals.honoredRefusal === true).length,
  };
}

function metricValue(summary: ReturnType<typeof scoreCards>, metric: CanaryMetric) {
  if (metric === "workflow_answer_rate") return summary.workflowAnswerRate;
  if (metric === "discovery_rate") return summary.discoveryRate;
  if (metric === "inquiry_ask_rate") return summary.inquiryAskRate;
  if (metric === "demo_accept_rate") return summary.demoAcceptRate;
  return summary.averageStage;
}

export function compareCanary(
  control: ConversationScorecard[],
  canary: ConversationScorecard[],
  options: { minimumHumanCalls?: number; primaryMetric?: CanaryMetric; minimumImprovement?: number } = {},
) {
  const minimumHumanCalls = options.minimumHumanCalls ?? 5;
  const primaryMetric = options.primaryMetric ?? "workflow_answer_rate";
  const minimumImprovement = options.minimumImprovement ?? 0.05;
  const controlSummary = scoreCards(control);
  const canarySummary = scoreCards(canary);
  const controlMetric = metricValue(controlSummary, primaryMetric);
  const canaryMetric = metricValue(canarySummary, primaryMetric);
  const delta = canaryMetric - controlMetric;
  const enoughEvidence = controlSummary.humanConnections >= minimumHumanCalls && canarySummary.humanConnections >= minimumHumanCalls;
  const safetyRegression = canarySummary.guardrailViolations > controlSummary.guardrailViolations;
  const decision = !enoughEvidence
    ? "insufficient_evidence"
    : safetyRegression
      ? "revert"
      : delta >= minimumImprovement
        ? "keep"
        : delta <= -minimumImprovement
          ? "revert"
          : "human_review";
  return {
    decision,
    enoughEvidence,
    primaryMetric,
    minimumHumanCalls,
    minimumImprovement,
    control: controlSummary,
    canary: canarySummary,
    controlMetric,
    canaryMetric,
    delta,
    safetyRegression,
    reason: !enoughEvidence
      ? `Both groups need at least ${minimumHumanCalls} human-connected calls.`
      : safetyRegression
        ? "The canary produced more guardrail violations and must be reverted."
        : decision === "keep"
          ? `The canary improved ${primaryMetric} by ${(delta * 100).toFixed(1)} percentage points without a safety regression.`
          : decision === "revert"
            ? `The canary reduced ${primaryMetric} by ${(Math.abs(delta) * 100).toFixed(1)} percentage points.`
            : "The result is within the neutral range; a human should decide whether to extend or stop the canary.",
  } as const;
}
