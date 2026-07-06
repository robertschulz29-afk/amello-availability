// One-off migration (Phase C — N-way room mapping rework):
//   1. Create room_mapping_groups + room_mapping_members tables.
//   2. Migrate every row in the legacy 2-column room_mappings table into a
//      group of two members, find-or-creating room_names rows as needed.
//   3. Rename room_mappings -> room_mappings_legacy (kept as rollback safety net,
//      never read/written by app code going forward).
//
// Transaction-wrapped; verifies end-state (row counts) before/after so partial
// re-runs are safe and detectable, mirroring migrate-drop-imagery-mappings-rename-room-names.mjs.
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
    const existsQ = await client.query(`
      SELECT to_regclass('public.room_mappings') AS legacy_current_name,
             to_regclass('public.room_mappings_legacy') AS legacy_renamed,
             to_regclass('public.room_mapping_groups') AS groups_table,
             to_regclass('public.room_mapping_members') AS members_table
    `);
    const { legacy_current_name, legacy_renamed, groups_table, members_table } = existsQ.rows[0];

    if (!legacy_current_name && legacy_renamed && groups_table && members_table) {
      console.log('Migration already complete: room_mappings_legacy exists, new tables present.');
      return;
    }

    if (!legacy_current_name && !legacy_renamed) {
      throw new Error('Neither room_mappings nor room_mappings_legacy exists — cannot proceed.');
    }

    await client.query('BEGIN');
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS room_mapping_groups (
          id SERIAL PRIMARY KEY,
          hotel_id INT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
          source VARCHAR(20) NOT NULL DEFAULT 'manual',
          confidence NUMERIC,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS room_mapping_members (
          id SERIAL PRIMARY KEY,
          group_id INT NOT NULL REFERENCES room_mapping_groups(id) ON DELETE CASCADE,
          room_name_id INT NOT NULL REFERENCES room_names(id) ON DELETE CASCADE,
          source VARCHAR(20) NOT NULL,
          member_status VARCHAR(10) NOT NULL DEFAULT 'manual',
          confidence NUMERIC,
          UNIQUE(group_id, source),
          UNIQUE(room_name_id)
        )
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_room_mapping_members_group ON room_mapping_members(group_id)
      `);

      let migratedGroups = 0;
      let legacyCount = 0;

      if (legacy_current_name) {
        const legacyRows = await client.query(`
          SELECT id, hotel_id, amello_room, booking_room, source, confidence
          FROM room_mappings
          ORDER BY id
        `);
        legacyCount = legacyRows.rows.length;

        for (const row of legacyRows.rows) {
          const { hotel_id, amello_room, booking_room, source, confidence } = row;

          // Find-or-create room_names rows for both sides.
          const findOrCreateRoomName = async (src, name) => {
            const existing = await client.query(
              `SELECT id FROM room_names WHERE hotel_id = $1 AND source = $2 AND room_name = $3`,
              [hotel_id, src, name]
            );
            if (existing.rows.length) return existing.rows[0].id;
            const inserted = await client.query(
              `INSERT INTO room_names (hotel_id, source, room_name) VALUES ($1, $2, $3) RETURNING id`,
              [hotel_id, src, name]
            );
            return inserted.rows[0].id;
          };

          const amelloRoomNameId = await findOrCreateRoomName('amello', amello_room);
          const bookingRoomNameId = await findOrCreateRoomName('booking', booking_room);

          // Skip if either room_name is already claimed by another group
          // (shouldn't happen on a fresh migration, but guards re-runs / dupes).
          const alreadyGrouped = await client.query(
            `SELECT room_name_id FROM room_mapping_members WHERE room_name_id = ANY($1::int[])`,
            [[amelloRoomNameId, bookingRoomNameId]]
          );
          if (alreadyGrouped.rows.length > 0) {
            console.warn(`Skipping legacy room_mappings.id=${row.id}: room_name already grouped`, alreadyGrouped.rows);
            continue;
          }

          const memberStatus = source === 'ai' ? 'ai' : 'manual';

          const groupIns = await client.query(
            `INSERT INTO room_mapping_groups (hotel_id, source, confidence) VALUES ($1, $2, $3) RETURNING id`,
            [hotel_id, source, confidence]
          );
          const groupId = groupIns.rows[0].id;

          await client.query(
            `INSERT INTO room_mapping_members (group_id, room_name_id, source, member_status, confidence)
             VALUES ($1, $2, 'amello', $3, $4)`,
            [groupId, amelloRoomNameId, memberStatus, confidence]
          );
          await client.query(
            `INSERT INTO room_mapping_members (group_id, room_name_id, source, member_status, confidence)
             VALUES ($1, $2, 'booking', $3, $4)`,
            [groupId, bookingRoomNameId, memberStatus, confidence]
          );

          migratedGroups++;
        }

        await client.query(`ALTER TABLE room_mappings RENAME TO room_mappings_legacy`);
      }

      await client.query('COMMIT');
      console.log(`Migration complete. Legacy rows: ${legacyCount}, groups migrated: ${migratedGroups}.`);
      if (legacyCount !== migratedGroups) {
        console.warn(`WARNING: legacy row count (${legacyCount}) != migrated group count (${migratedGroups}). Investigate skipped rows above.`);
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
