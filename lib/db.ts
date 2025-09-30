// lib/db.ts
import { Pool } from 'pg';

// Accept managed cert chains in serverless (server-only code)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Use ONLY a full connection string (Supabase pooled URL)
// Prefer DATABASE_URL; fall back to POSTGRES_URL if you kept that env.
const connectionString =
  process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('Missing DATABASE_URL (or POSTGRES_URL) env var');
}

// Proactively remove per-field envs so pg cannot fall back to wrong host
for (const k of [
  'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE',
  'POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DATABASE',
  'POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL'
]) {
  if (process.env[k]) delete (process.env as any)[k];
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // critical for managed PG in serverless
});

// Keep the template tag API you already use
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
