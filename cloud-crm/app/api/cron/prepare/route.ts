import { centralParts, configuredCampaignWindow, ensureDailyQueue, verifyCron } from "@/lib/campaign";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!verifyCron(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const local = centralParts();
  const window = configuredCampaignWindow();
  if (local.hour !== window.preparationHour) {
    return Response.json({ skipped: true, reason: `Outside the configured ${window.timezone} preparation window` });
  }
  return Response.json(await ensureDailyQueue(local.date));
}
