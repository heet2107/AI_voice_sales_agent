import { loadBusinessProfile } from "../lib/business-config";

try {
  const profile = loadBusinessProfile();
  console.log(`Business profile valid: ${profile.company.name}`);
  console.log(`Agent: ${profile.agent.name} — ${profile.agent.title}`);
  console.log(`Operations: ${profile.operations.timezone}; ${profile.operations.dailyCallCap} calls/day; starts paused`);
  console.log(`Segments: ${profile.outreach.segments.map((segment) => segment.label).join(", ")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Business profile validation failed");
  process.exitCode = 1;
}
