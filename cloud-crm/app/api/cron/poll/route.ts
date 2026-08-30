import { pollActiveCalls, verifyCron } from "@/lib/campaign";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCron(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return Response.json(await pollActiveCalls()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Polling failed" }, { status: 500 }); }
}
