// lib/db.ts
import { Pool } from "pg";

const connectionString =
  process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    "Missing DATABASE_URL or POSTGRES_URL environment variable"
  );
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  // Vercel serverless: each function instance should hold at most 1 connection.
  // Transaction-mode pgBouncer (port 6543) does not support prepared statements.
  max: 1,
});

type Primitive = string | number | boolean | null | Date;

export async function sql<T = any>(
  strings: TemplateStringsArray,
  ...values: Primitive[]
): Promise<{ rows: T[]; rowCount: number }> {
  const text = strings.reduce(
    (acc, cur, i) => acc + cur + (i < values.length ? `$${i + 1}` : ""),
    ""
  );

  // name: undefined disables prepared statements, required for pgBouncer transaction mode
  const res = await pool.query({ text, values, name: undefined });

  return {
    rows: res.rows as T[],
    rowCount: res.rowCount ?? 0,
  };
}

export async function query<T = any>(
  text: string,
  values: any[] = []
): Promise<{ rows: T[]; rowCount: number }> {
  const res = await pool.query({ text, values, name: undefined });

  return {
    rows: res.rows as T[],
    rowCount: res.rowCount ?? 0,
  };
}

export function getPool() {
  return pool;
}
