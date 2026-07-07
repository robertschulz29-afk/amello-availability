// One-off migration: add email/role/status to users table (idempotent).
// Does NOT touch existing password_hash values.
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
    // Detect first-run vs. re-run BEFORE adding the column: if `role` already
    // exists, this is a re-invocation and we must NOT re-run the backfill below
    // (it would wrongly promote real viewer/registered accounts created after
    // the first run to analyst/active).
    const { rows: existing } = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role'`,
    );
    const isFirstRun = existing.length === 0;

    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) UNIQUE`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'viewer'`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'registered'`);

    // Add CHECK constraints idempotently (skip if already present)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','analyst','viewer'));
        END IF;
      END $$;
    `);
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check'
        ) THEN
          ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('registered','active','inactive'));
        END IF;
      END $$;
    `);

    if (isFirstRun) {
      // Every account that existed before this migration was already a
      // fully-trusted user of the app (there was no role/status concept
      // until now). Backfill them to 'active'/'analyst' (full access minus
      // user management) so this migration doesn't lock them out or
      // silently downgrade them to a viewer. New self-registered accounts
      // created AFTER this point correctly keep the 'viewer'/'registered'
      // column defaults.
      const { rowCount } = await client.query(`UPDATE users SET status = 'active', role = 'analyst'`);
      console.log(`Backfilled ${rowCount} pre-existing user(s) to status='active', role='analyst'.`);
    }

    await client.query(`UPDATE users SET role = 'admin', status = 'active' WHERE username = 'admin'`);

    console.log('Migration complete: users.email/role/status added, admin seed row updated.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
