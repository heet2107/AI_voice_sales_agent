import { centralParts, configuredCampaignWindow, dailyReview, verifyCron } from "@/lib/campaign";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCron(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const local = centralParts();
  const window = configuredCampaignWindow();
  if (local.hour !== window.reviewHour) return Response.json({ skipped: true, reason: `Outside the configured ${window.timezone} review window` });
  try { return Response.json(await dailyReview()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Review failed" }, { status: 500 }); }
}
