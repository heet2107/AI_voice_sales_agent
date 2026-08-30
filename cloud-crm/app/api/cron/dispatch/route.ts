import { dispatchDueCall, verifyCron } from "@/lib/campaign";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!verifyCron(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try { return Response.json(await dispatchDueCall()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Dispatch failed" }, { status: 500 }); }
}
