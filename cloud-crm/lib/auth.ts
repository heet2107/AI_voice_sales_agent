export const SESSION_COOKIE = "inbound_crm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function hmac(value: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(signature));
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

export async function verifyPasscode(passcode: string) {
  if (!/^\d{6}$/.test(passcode)) return false;
  const expected = process.env.DASHBOARD_PASSCODE_HASH;
  if (!expected) throw new Error("DASHBOARD_PASSCODE_HASH is not configured");
  return constantTimeEqual(await sha256(passcode), expected);
}

export async function createSessionToken() {
  const payload = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, v: 1 });
  const encoded = toBase64Url(payload);
  return `${encoded}.${await hmac(encoded)}`;
}

export async function verifySessionToken(token?: string | null) {
  if (!token) return false;
  const [encoded, providedSignature] = token.split(".");
  if (!encoded || !providedSignature) return false;
  const expectedSignature = await hmac(encoded);
  if (!constantTimeEqual(providedSignature, expectedSignature)) return false;
  try {
    const payload = JSON.parse(fromBase64Url(encoded)) as { exp?: number; v?: number };
    return payload.v === 1 && typeof payload.exp === "number" && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
};
