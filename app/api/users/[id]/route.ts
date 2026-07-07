import { NextRequest, NextResponse } from 'next/server';
import { query, getPool } from '@/lib/db';
import { verifySessionToken, COOKIE_NAME } from '@/lib/auth-edge';

export const runtime = 'nodejs';

const VALID_ROLES = ['admin', 'analyst', 'viewer'];
const VALID_STATUSES = ['registered', 'active', 'inactive'];

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const targetId = Number(params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const { role, status } = body ?? {};

  if (role !== undefined && !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }
  if (role === undefined && status === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  // Everything below runs inside a single transaction so the last-active-admin
  // guard can't be defeated by two concurrent self-demotion/self-deactivation
  // requests racing each other (each would otherwise read the pre-update count).
  //
  // An unconditional Postgres advisory lock is taken FIRST, before any row-level
  // locking, so every PATCH on this route is globally serialized with respect to
  // the admin-lockout invariant. This avoids a deadlock that a purely row-level
  // locking scheme (target row, then admin rows) could hit if two different
  // admins' self-demotions raced each other and each waited on the other's row.
  // Volume on this endpoint is low (admin user-management only), so full
  // serialization has no meaningful performance cost.
  const ADMIN_LOCKOUT_ADVISORY_LOCK_KEY = 727433001;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADMIN_LOCKOUT_ADVISORY_LOCK_KEY]);

    const targetQ = await client.query('SELECT username, role, status FROM users WHERE id = $1', [targetId]);
    const target = targetQ.rows[0];
    if (!target) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const isSelf = target.username === session.username;
    const wouldLoseAdmin = isSelf && role !== undefined && role !== 'admin' && target.role === 'admin';
    const wouldLoseActive = isSelf && status !== undefined && status !== 'active' && target.status === 'active';

    if (wouldLoseAdmin || wouldLoseActive) {
      const countQ = await client.query(
        `SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND status = 'active'`,
      );
      const activeAdminCount = countQ.rows[0]?.c ?? 0;
      if (activeAdminCount <= 1) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: "Can't remove the last active admin" }, { status: 409 });
      }
    }

    const nextRole = role !== undefined ? role : target.role;
    const nextStatus = status !== undefined ? status : target.status;

    await client.query('UPDATE users SET role = $1, status = $2 WHERE id = $3', [nextRole, nextStatus, targetId]);
    await client.query('COMMIT');

    return NextResponse.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
