// One-off migration: add hotels.brand_url (idempotent).
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!connectionString) {
  throw new Error('Missing DATABASE_URL or POSTGRES_URL environment variable');
}

const sslConfig = process.env.PGSSLMODE === 'no-verify'
  ? { rejectUnauthorized: false }
  : { rejectUnauthorized: true };

const pool = new Pool({ connectionString, ssl: sslConfig, max: 1 });

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE hotels ADD COLUMN IF NOT EXISTS brand_url VARCHAR(500) DEFAULT NULL`);
    console.log('Migration complete: hotels.brand_url added.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
