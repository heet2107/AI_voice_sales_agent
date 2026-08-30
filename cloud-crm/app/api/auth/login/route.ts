import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, sessionCookieOptions, sha256, SESSION_COOKIE, verifyPasscode } from "@/lib/auth";
import { db, logActivity } from "@/lib/db";

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 5;
const BLOCK_MINUTES = 30;

export async function POST(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const identity = await sha256(`${forwarded || "unknown"}:${request.headers.get("user-agent") || "unknown"}`);
  const attempts = await db().query(
    "SELECT failure_count, window_started_at, blocked_until FROM login_attempts WHERE identity_hash=$1",
    [identity]
  );
  const record = attempts[0];
  if (record?.blocked_until && new Date(record.blocked_until).getTime() > Date.now()) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({})) as { passcode?: string };
  const valid = await verifyPasscode(body.passcode ?? "");
  if (!valid) {
    await db().query(
      `INSERT INTO login_attempts (identity_hash,failure_count,window_started_at,blocked_until,updated_at)
       VALUES ($1,1,now(),NULL,now())
       ON CONFLICT (identity_hash) DO UPDATE SET
         failure_count=CASE WHEN login_attempts.window_started_at < now()-($2 || ' minutes')::interval THEN 1 ELSE login_attempts.failure_count+1 END,
         window_started_at=CASE WHEN login_attempts.window_started_at < now()-($2 || ' minutes')::interval THEN now() ELSE login_attempts.window_started_at END,
         blocked_until=CASE WHEN
           (CASE WHEN login_attempts.window_started_at < now()-($2 || ' minutes')::interval THEN 1 ELSE login_attempts.failure_count+1 END) >= $3
           THEN now()+($4 || ' minutes')::interval ELSE NULL END,
         updated_at=now()`,
      [identity, WINDOW_MINUTES, MAX_FAILURES, BLOCK_MINUTES]
    );
    await logActivity("auth", identity.slice(0, 12), "login_failed");
    return NextResponse.json({ error: "Incorrect passcode." }, { status: 401 });
  }

  await db().query("DELETE FROM login_attempts WHERE identity_hash=$1", [identity]);
  await logActivity("auth", identity.slice(0, 12), "login_succeeded");
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions);
  return response;
}
