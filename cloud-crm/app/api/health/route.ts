export async function GET() {
  return Response.json({ ok: true, service: "inbound-cms-clawcall-crm", time: new Date().toISOString() });
}
