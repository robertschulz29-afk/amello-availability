// lib/db.ts
import { Pool } from "pg";

/**
 * IMPORTANT:
 * Keep raw Postgres pool because your app already uses the `sql` tagged helper.
 * We do NOT switch to Supabase HTTP client — we keep your existing architecture.
 */

/**
 * Do NOT disable TLS globally.
 * If needed, rely on proper SSL config instead.
 */

// Read connection string from environment
const connectionString =
  process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    "Missing DATABASE_URL or POSTGRES_URL environment variable"
  );
}

/**
 * Create connection pool
 * SSL enabled for Supabase / managed databases
 */
const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
});

/**
 * ================================
 * SQL Tagged Template Helper
 * ================================
 *
 * This preserves your existing API:
 *
 * await sql`SELECT * FROM hotels WHERE id = ${id}`
 */

type Primitive = string | number | boolean | null | Date;

export async function sql<T = any>(
  strings: TemplateStringsArray,
  ...values: Primitive[]
): Promise<{ rows: T[]; rowCount: number }> {
  const text = strings.reduce(
    (acc, cur, i) =>
      acc + cur + (i < values.length ? `$${i + 1}` : ""),
    ""
  );

  const res = await pool.query({
    text,
    values,
  });

  return {
    rows: res.rows as T[],
    rowCount: res.rowCount ?? 0,
  };
}

/**
 * Optional raw query helper (if needed)
 */
export async function query<T = any>(
  text: string,
  values: any[] = []
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await pool.query({ text, values });

  return {
    rows: res.rows as T[],
    rowCount: res.rowCount ?? 0,
  };
}

/**
 * Optional pool export (for advanced use)
 */
export function getPool() {
  return pool;
}