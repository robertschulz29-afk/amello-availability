// lib/db.ts
import { Pool } from 'pg';

// 0) Force Node to accept managed/chain certs in this process (server-side only)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// 1) Use ONLY our URL (not PGHOST/POSTGRES_HOST etc.)
let connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // If you didn't add DATABASE_URL, fall back to POSTGRES_URL (from the integration)
  connectionString = process.env.POSTGRES_URL!;
}
if (!connectionString) {
  throw new Error('Missing DATABASE_URL (or POSTGRES_URL) env var');
}

// 2) Proactively remove per-field vars that hijack pg config
for (const k of [
  'PGHOST','PGPORT','PGUSER','PGPASSWORD','PGDATABASE',
  'POSTGRES_HOST','POSTGRES_PORT','POSTGRES_USER','POSTGRES_PASSWORD','POSTGRES_DATABASE',
  'POSTGRES_URL_NON_POOLING','POSTGRES_PRISMA_URL'
]) {
  if (process.env[k]) delete (process.env as any)[k];
}

// 3) Build the pool. Keep ssl off verification explicitly.
const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }, // critical: bypass cert verification in serverless
});

// 4) Keep the template tag you use elsewhere
type Primitive = string | number | boolean | null | Date;

export async function sql<T = any>(
  strings: TemplateStringsArray,
  ...values: Primitive[]
): Promise<{ rows: T[]; rowCount: number }> {
  const
