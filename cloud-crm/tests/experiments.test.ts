import { expect, test } from "vitest";
import { compareCalibrationReviews, compareCanary } from "../lib/experiments";
import { emptyConversationScorecard } from "../lib/sales-intelligence";

function connectedCard(workflowAnswered: boolean) {
  const card = emptyConversationScorecard("answered");
  card.humanConnected = true;
  card.stageReached = workflowAnswered ? "workflow_question" : "opening";
  card.endReason = workflowAnswered ? "unknown" : "workflow_question_unanswered";
  card.workflowQuestionAnswered = workflowAnswered;
  return card;
}

test("calibration requires ten reviews and identifies the weakest field", () => {
  const reviews = Array.from({ length: 10 }, (_, index) => {
    const automated = connectedCard(true);
    const manual = connectedCard(true);
    if (index < 3) manual.stageReached = "discovery";
    return { id: `call-${index}`, automated, manual };
  });
  const result = compareCalibrationReviews(reviews);
  expect(result.complete).toBe(true);
  expect(result.sampleSize).toBe(10);
  expect(result.weakestFields[0]?.field).toBe("stageReached");
  expect(result.weakestFields[0]?.agreementRate).toBe(0.7);
  expect(result.recommendation).toMatch(/recalibrate/i);
});

test("five-call canary is kept only after improvement without a safety regression", () => {
  const control = Array.from({ length: 5 }, (_, index) => connectedCard(index < 2));
  const canary = Array.from({ length: 5 }, (_, index) => connectedCard(index < 4));
  const result = compareCanary(control, canary);
  expect(result.enoughEvidence).toBe(true);
  expect(result.decision).toBe("keep");
  expect(result.delta).toBe(0.4);
});

test("any additional canary guardrail violation forces reversion", () => {
  const control = Array.from({ length: 5 }, () => connectedCard(true));
  const canary = Array.from({ length: 5 }, () => connectedCard(true));
  canary[0].guardrailViolations.push({ category: "unsupported_claim", description: "Guarantee", evidence: "Guaranteed results" });
  const result = compareCanary(control, canary);
  expect(result.safetyRegression).toBe(true);
  expect(result.decision).toBe("revert");
});
