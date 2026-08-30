import { existsSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { z } from "zod";
import defaultProfileJson from "@/config/business-profile.example.json";

const NonEmpty = z.string().trim().min(1);

export const BusinessProfileSchema = z.object({
  profileVersion: z.literal(1),
  company: z.object({
    name: NonEmpty,
    shortName: NonEmpty,
    websiteUrl: z.url(),
    homeBase: NonEmpty,
    description: NonEmpty,
    valueProposition: NonEmpty,
    services: z.array(z.object({ name: NonEmpty, summary: NonEmpty }).strict()).min(1),
  }).strict(),
  agent: z.object({
    name: NonEmpty,
    title: NonEmpty,
    shortTitle: NonEmpty,
    voice: NonEmpty,
    tone: z.array(NonEmpty).min(1),
  }).strict(),
  outreach: z.object({
    regions: z.array(NonEmpty).min(1),
    segments: z.array(z.object({
      id: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      label: NonEmpty,
      leadSegmentValues: z.array(NonEmpty).min(1),
      categories: z.array(NonEmpty).min(1),
      decisionMakerRoles: z.array(NonEmpty).min(1),
    }).strict()).min(1),
    defaultDiscoveryQuestion: NonEmpty,
  }).strict(),
  operations: z.object({
    timezone: NonEmpty.refine((value) => {
      try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
    }, "Must be a valid IANA timezone"),
    dailyCallCap: z.number().int().min(1).max(100),
    maxLifetimeAttempts: z.number().int().min(1).max(10),
    retryDelayMinutes: z.number().int().min(1).max(1440),
    callSlots: z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).min(1),
    segmentTargets: z.array(z.object({
      segmentId: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      minimum: z.number().int().min(0),
      maximum: z.number().int().min(1),
    }).strict().refine((value) => value.maximum >= value.minimum, "Maximum must be greater than or equal to minimum")).min(1),
    startPaused: z.literal(true),
  }).strict(),
  contact: z.object({
    publicPhone: NonEmpty,
    scheduling: z.object({
      mode: z.enum(["follow_up_link", "connected_booking"]),
      url: z.url(),
      inquiryCallLabel: NonEmpty,
      durationMinutes: z.number().int().min(5).max(60),
      fallbackPhrase: NonEmpty,
    }).strict(),
  }).strict(),
  disclosure: z.object({
    recordingRequired: z.literal(true),
    recordingInstruction: NonEmpty,
    aiDisclosurePolicy: z.enum(["on_direct_question", "proactive"]),
    truthfulAiResponse: NonEmpty,
  }).strict(),
  guardrails: z.object({
    neverDiscussPricing: z.boolean(),
    honorOptOut: z.literal(true),
    noGuarantees: z.literal(true),
    prohibitedData: z.array(NonEmpty).min(1),
    additional: z.array(NonEmpty),
  }).strict(),
  branding: z.object({
    appName: NonEmpty,
    crmLabel: NonEmpty,
    regionLabel: NonEmpty,
    operatorName: NonEmpty,
  }).strict(),
}).strict().superRefine((profile, context) => {
  const segmentIds = new Set(profile.outreach.segments.map((segment) => segment.id));
  for (const [index, target] of profile.operations.segmentTargets.entries()) {
    if (!segmentIds.has(target.segmentId)) context.addIssue({ code: "custom", path: ["operations", "segmentTargets", index, "segmentId"], message: "Must reference an outreach segment id" });
  }
  if (profile.operations.callSlots.length < profile.operations.dailyCallCap) {
    context.addIssue({ code: "custom", path: ["operations", "callSlots"], message: "Must provide at least dailyCallCap slots" });
  }
  const minimumTotal = profile.operations.segmentTargets.reduce((sum, target) => sum + target.minimum, 0);
  const maximumTotal = profile.operations.segmentTargets.reduce((sum, target) => sum + target.maximum, 0);
  if (minimumTotal > profile.operations.dailyCallCap || maximumTotal < profile.operations.dailyCallCap) {
    context.addIssue({ code: "custom", path: ["operations", "segmentTargets"], message: "Combined minimums and maximums must contain dailyCallCap" });
  }
});

export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

function readableIssues(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.join(".") || "profile"}: ${issue.message}`).join("; ");
}

export function parseBusinessProfile(input: unknown, source = "business profile"): BusinessProfile {
  const parsed = BusinessProfileSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid ${source}: ${readableIssues(parsed.error)}`);
  return parsed.data;
}

export function loadBusinessProfile(env: Readonly<Record<string, string | undefined>> = process.env): BusinessProfile {
  if (env.BUSINESS_PROFILE_JSON?.trim()) {
    try {
      return parseBusinessProfile(JSON.parse(env.BUSINESS_PROFILE_JSON), "BUSINESS_PROFILE_JSON");
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`Invalid BUSINESS_PROFILE_JSON: ${error.message}`);
      throw error;
    }
  }

  if (env.BUSINESS_PROFILE_PATH?.trim()) {
    const configDirectory = resolve(process.cwd(), "config");
    const requested = env.BUSINESS_PROFILE_PATH.replace(/^\.\//, "").replace(/^config\//, "");
    const path = resolve(configDirectory, requested);
    const outsideConfig = relative(configDirectory, path).startsWith(`..${sep}`) || relative(configDirectory, path) === "..";
    if (outsideConfig) throw new Error("BUSINESS_PROFILE_PATH must reference a file inside config/");
    try {
      return parseBusinessProfile(JSON.parse(readFileSync(path, "utf8")), `business profile at ${path}`);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`Invalid JSON in business profile at ${path}: ${error.message}`);
      throw error;
    }
  }

  const localProfilePath = resolve(process.cwd(), "config", "business-profile.json");
  if (existsSync(localProfilePath)) {
    return parseBusinessProfile(JSON.parse(readFileSync(localProfilePath, "utf8")), "config/business-profile.json");
  }
  return parseBusinessProfile(defaultProfileJson, "config/business-profile.example.json");
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function matchBusinessSegment(profile: BusinessProfile, category: string) {
  const normalized = category.toLowerCase();
  return profile.outreach.segments.find((segment) =>
    segment.categories.some((candidate) => normalized.includes(candidate.toLowerCase()) || candidate.toLowerCase().includes(normalized))
  ) ?? null;
}

export function businessProfileSummary(profile: BusinessProfile) {
  return `${profile.company.name} is ${profile.company.description}. We ${profile.company.valueProposition}.`;
}
