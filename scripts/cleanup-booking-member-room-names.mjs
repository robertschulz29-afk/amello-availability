// One-off cleanup: booking_member is no longer a mapping dimension —
// checkAndFinalizeScan (lib/scrapers/process-helpers.ts) now skips writing
// room_names rows for source='booking_member' going forward, since booking's
// own scan already captures the same room inventory under source='booking'.
// This script removes any pre-existing booking_member rows from room_names
// and room_mapping_members (mirroring the "last member removed -> group
// deleted" semantics already implemented in
// app/api/room-mappings/[groupId]/members/route.ts), leaving other members'
// groups intact as partial groups.
//
// Transaction-wrapped; verifies end-state (zero booking_member rows in both
// tables) before committing, mirroring migrate-room-mapping-groups.mjs.
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
    const before = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM room_names WHERE source = 'booking_member') AS room_names_count,
        (SELECT COUNT(*)::int FROM room_mapping_members WHERE source = 'booking_member') AS members_count
    `);
    const { room_names_count: beforeRoomNames, members_count: beforeMembers } = before.rows[0];
    console.log(`Before cleanup: room_names(booking_member)=${beforeRoomNames}, room_mapping_members(booking_member)=${beforeMembers}`);

    if (beforeRoomNames === 0 && beforeMembers === 0) {
      console.log('Nothing to clean up — no booking_member rows found.');
      return;
    }

    await client.query('BEGIN');
    try {
      // Find groups whose booking_member member removal would leave them empty.
      const groupsToCheck = await client.query(`
        SELECT DISTINCT group_id FROM room_mapping_members WHERE source = 'booking_member'
      `);

      const memberDel = await client.query(`
        DELETE FROM room_mapping_members WHERE source = 'booking_member' RETURNING id, group_id
      `);
      console.log(`Deleted ${memberDel.rows.length} room_mapping_members rows (source='booking_member').`);

      let groupsDeleted = 0;
      for (const { group_id } of groupsToCheck.rows) {
        const remaining = await client.query(
          `SELECT COUNT(*)::int AS count FROM room_mapping_members WHERE group_id = $1`,
          [group_id]
        );
        if (remaining.rows[0].count === 0) {
          await client.query(`DELETE FROM room_mapping_groups WHERE id = $1`, [group_id]);
          groupsDeleted++;
        }
      }
      console.log(`Deleted ${groupsDeleted} now-empty room_mapping_groups.`);

      const roomNamesDel = await client.query(`
        DELETE FROM room_names WHERE source = 'booking_member' RETURNING id
      `);
      console.log(`Deleted ${roomNamesDel.rows.length} room_names rows (source='booking_member').`);

      const after = await client.query(`
        SELECT
          (SELECT COUNT(*)::int FROM room_names WHERE source = 'booking_member') AS room_names_count,
          (SELECT COUNT(*)::int FROM room_mapping_members WHERE source = 'booking_member') AS members_count
      `);
      const { room_names_count: afterRoomNames, members_count: afterMembers } = after.rows[0];
      console.log(`After cleanup (pre-commit verify): room_names(booking_member)=${afterRoomNames}, room_mapping_members(booking_member)=${afterMembers}`);

      if (afterRoomNames !== 0 || afterMembers !== 0) {
        throw new Error(`Verification failed: expected zero booking_member rows, got room_names=${afterRoomNames}, members=${afterMembers}`);
      }

      await client.query('COMMIT');
      console.log(`Cleanup complete. Before: room_names=${beforeRoomNames}, members=${beforeMembers}. After: room_names=0, members=0.`);
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
