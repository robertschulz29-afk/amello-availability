// lib/db.ts
import { Pool } from 'pg';

// 1) Hard-prefer a full connection string
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error('Missing DATABASE_URL (or POSTGRES_URL) env var');
}

// 2) Proactively remove per-field PG env that can hijack config
for (const k of [
  'PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE',
  'POSTGRES_HOST','POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_DATABASE'
]) {
  if (process.env[k]) delete process.env[k];
}

// 3) Create pool using ONLY the URL
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // required for managed PG (Supabase)
});

// Tiny helper to keep your existing sql`...${}` calls
type Primitive = string | number | boolean | null | Date;
export async function sql<T = any>(
  strings: TemplateStringsArray,
  ...values: Primitive[]
): Promise<{ rows: T[]; rowCount: number }> {
  const text = strings.reduce(
    (acc, cur, i) => acc + cur + (i < values.length ? `$${i + 1}` : ''),
    ''
  );
  const res = await pool.query({ text, values });
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}
