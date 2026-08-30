import { neon } from "@neondatabase/serverless";

type Row = Record<string, any>;
type Database = { query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]> };

let client: ReturnType<typeof neon> | null = null;
let wrapper: Database | null = null;

export function db(): Database {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  client ??= neon(process.env.DATABASE_URL);
  wrapper ??= {
    async query<T extends Row = Row>(text: string, params: unknown[] = []) {
      return await client!.query(text, params) as T[];
    }
  };
  return wrapper;
}

export async function setting<T>(key: string, fallback: T): Promise<T> {
  const rows = await db().query("SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value === undefined ? fallback : (rows[0].value as T);
}

export async function logActivity(entityType: string, entityId: string | null, action: string, detail: unknown = {}) {
  await db().query(
    "INSERT INTO activity_log (entity_type, entity_id, action, detail) VALUES ($1,$2,$3,$4::jsonb)",
    [entityType, entityId, action, JSON.stringify(detail)]
  );
}
