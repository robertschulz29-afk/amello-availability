// lib/db.ts
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase requires SSL; false is fine in serverless
});

// primitive bindings we support
type Primitive = string | number | boolean | null | Date;

export async function sql<T = any>(
  strings: TemplateStringsArray,
  ...values: Primitive[]
): Promise<{ rows: T[]; rowCount: number }> {
  // Build parameterized text: "SELECT ... WHERE id = $1 AND code = $2"
  const text = strings.reduce((acc, cur, i) => acc + cur + (i < values.length ? `$${i + 1}` : ''), '');
  const res = await pool.query({ text, values });
  return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
}
