import { expect, test } from "vitest";
import defaultProfileJson from "../config/business-profile.example.json";
import { loadBusinessProfile, matchBusinessSegment, parseBusinessProfile } from "../lib/business-config";

test("the checked-in profile fallback is safe and portable", () => {
  const profile = loadBusinessProfile({ BUSINESS_PROFILE_PATH: "config/business-profile.example.json" });
  expect(profile.company.name).toBe("Example Company");
  expect(profile.agent.name).toBe("Alex Morgan");
  expect(profile.disclosure.recordingRequired).toBe(true);
  expect(profile.guardrails.honorOptOut).toBe(true);
});

test("BUSINESS_PROFILE_JSON overrides the checked-in profile", () => {
  const custom = structuredClone(defaultProfileJson);
  custom.company.name = "Northstar Services";
  custom.agent.name = "Avery Stone";
  const profile = loadBusinessProfile({ BUSINESS_PROFILE_JSON: JSON.stringify(custom) });
  expect(profile.company.name).toBe("Northstar Services");
  expect(profile.agent.name).toBe("Avery Stone");
});

test("BUSINESS_PROFILE_PATH loads a portable client profile", () => {
  const profile = loadBusinessProfile({ BUSINESS_PROFILE_PATH: "config/business-profile.example.json" });
  expect(profile.company.name).toBe("Example Company");
  expect(profile.branding.regionLabel).toBe("Your Service Area");
});

test("unknown or unsafe profile fields fail closed with a readable path", () => {
  const invalid = { ...structuredClone(defaultProfileJson), apiKey: "must-not-be-stored-here" };
  expect(() => parseBusinessProfile(invalid)).toThrow(/unrecognized key/i);
  const noOptOut = structuredClone(defaultProfileJson);
  noOptOut.guardrails.honorOptOut = false as true;
  expect(() => parseBusinessProfile(noOptOut)).toThrow(/guardrails\.honorOptOut/i);
});

test("category matching uses the configured client segments", () => {
  const profile = parseBusinessProfile(defaultProfileJson);
  expect(matchBusinessSegment(profile, "Independent category one")?.id).toBe("best-fit-customers");
  expect(matchBusinessSegment(profile, "Category two specialist")?.id).toBe("best-fit-customers");
  expect(matchBusinessSegment(profile, "Unmapped category")).toBeNull();
});
