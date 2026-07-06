// One-off migration:
//   Phase A: drop the dead imagery_mappings table.
//   Phase B: rename hotel_room_names -> room_names, add a surrogate serial PK,
//            and re-add the (hotel_id, source, room_name) uniqueness as an
//            explicit named UNIQUE constraint.
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
    // ── Phase A ────────────────────────────────────────────────
    await client.query(`DROP TABLE IF EXISTS imagery_mappings`);
    console.log('Phase A complete: imagery_mappings dropped (if it existed).');

    // ── Phase B ────────────────────────────────────────────────
    const existsQ = await client.query(`
      SELECT to_regclass('public.hotel_room_names') AS old_table,
             to_regclass('public.room_names') AS new_table
    `);
    const { old_table, new_table } = existsQ.rows[0];

    // Completion is judged by the actual end-state (surrogate PK + named
    // unique constraint present), not merely by "room_names exists" — that
    // way a process that died mid-Phase-B (e.g. after the RENAME but before
    // the constraints were added) is correctly detected as incomplete and
    // retried, rather than silently treated as already migrated.
    const migratedCheck = new_table
      ? await client.query(`
          SELECT
            EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = 'room_names' AND column_name = 'id'
            ) AS has_id,
            EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conrelid = 'room_names'::regclass
                AND conname = 'room_names_hotel_source_name_unique'
            ) AS has_unique
        `)
      : null;
    const alreadyMigrated = migratedCheck?.rows[0]?.has_id && migratedCheck?.rows[0]?.has_unique;

    if (!old_table && new_table && alreadyMigrated) {
      console.log('Phase B skipped: room_names already fully migrated.');
    } else if (!old_table && !new_table) {
      throw new Error('Neither hotel_room_names nor room_names exists — cannot proceed.');
    } else if (!old_table && new_table && !alreadyMigrated) {
      throw new Error(
        'room_names exists but is missing the expected surrogate id column / unique constraint — ' +
        'looks like a previous run of this migration failed partway through Phase B. ' +
        'Manual inspection required before re-running (this script does not know how to resume ' +
        'from an arbitrary partial state).'
      );
    } else {
      // Run the whole rename + constraint-swap sequence as one transaction so
      // a failure partway through (e.g. the PK lookup finds nothing, or a
      // DROP/ADD CONSTRAINT fails) rolls back cleanly instead of leaving the
      // table renamed but without a primary key.
      await client.query('BEGIN');
      try {
        // Defensive duplicate check before adding the surrogate key.
        const dupCheck = await client.query(`
          SELECT hotel_id, source, room_name, COUNT(*)
          FROM hotel_room_names
          GROUP BY 1, 2, 3
          HAVING COUNT(*) > 1
        `);
        if (dupCheck.rows.length > 0) {
          console.error('Found duplicate (hotel_id, source, room_name) rows — aborting migration:');
          console.error(dupCheck.rows);
          throw new Error('Duplicate rows found in hotel_room_names; manual resolution required.');
        }

        await client.query(`ALTER TABLE hotel_room_names RENAME TO room_names`);

        const pkQ = await client.query(`
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'room_names'::regclass AND contype = 'p'
        `);
        const oldPkName = pkQ.rows[0]?.conname;
        if (!oldPkName) {
          throw new Error('Could not find existing primary key constraint on room_names.');
        }

        await client.query(`ALTER TABLE room_names ADD COLUMN IF NOT EXISTS id SERIAL`);
        await client.query(`ALTER TABLE room_names DROP CONSTRAINT "${oldPkName}"`);
        await client.query(`ALTER TABLE room_names ADD PRIMARY KEY (id)`);
        await client.query(`
          ALTER TABLE room_names
          ADD CONSTRAINT room_names_hotel_source_name_unique UNIQUE (hotel_id, source, room_name)
        `);

        const idxQ = await client.query(`
          SELECT indexname FROM pg_indexes
          WHERE tablename = 'room_names' AND indexname = 'idx_hotel_room_names_hotel_source'
        `);
        if (idxQ.rows.length > 0) {
          await client.query(`ALTER INDEX idx_hotel_room_names_hotel_source RENAME TO idx_room_names_hotel_source`);
        }

        await client.query('COMMIT');
        console.log('Phase B complete: hotel_room_names renamed to room_names with surrogate PK.');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
