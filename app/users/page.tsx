'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

type User = {
  id: number;
  username: string;
  email: string | null;
  role: 'admin' | 'analyst' | 'viewer';
  status: 'registered' | 'active' | 'inactive';
  created_at: string;
};

const ROLES: User['role'][] = ['admin', 'analyst', 'viewer'];
const STATUSES: User['status'][] = ['registered', 'active', 'inactive'];

function fmt(iso: string) {
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

export default function UsersPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = React.useState(false);
  const [authorized, setAuthorized] = React.useState(false);

  const [users, setUsers] = React.useState<User[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [savingIds, setSavingIds] = React.useState<Set<number>>(new Set());
  const [rowError, setRowError] = React.useState<string | null>(null);

  const loadUsers = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/users');
      if (!res.ok) throw new Error('Failed to load users');
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      setLoadError('Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetch('/api/auth/me')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.role === 'admin') {
          setAuthorized(true);
        } else {
          router.replace('/');
        }
      })
      .catch(() => router.replace('/'))
      .finally(() => setAuthChecked(true));
  }, [router]);

  React.useEffect(() => {
    if (authorized) loadUsers();
  }, [authorized, loadUsers]);

  async function updateUser(id: number, patch: { role?: string; status?: string }) {
    setRowError(null);
    setSavingIds(prev => new Set(prev).add(id));
    const previous = users;
    setUsers(prev => prev.map(u => (u.id === id ? { ...u, ...patch } as User : u)));
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update user');
      }
    } catch (e: any) {
      setUsers(previous);
      setRowError(e?.message || 'Failed to update user');
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  if (!authChecked || !authorized) {
    return (
      <main>
        <div className="text-muted small p-4">Loading…</div>
      </main>
    );
  }

  return (
    <main>
      <div style={{ maxWidth: '90%', margin: '0 auto' }}>
        <div className="card">
          <div className="card-header fw-semibold">User Management</div>
          <div className="card-body">
            <div className="alert alert-secondary py-2 small">
              Role and status changes take effect the next time the user logs in — not immediately.
            </div>

            {rowError && <div className="alert alert-danger py-2">{rowError}</div>}

            {loading && <div className="text-muted small">Loading users…</div>}

            {!loading && loadError && (
              <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
                <span>{loadError}</span>
                <button className="btn btn-sm btn-outline-danger" onClick={loadUsers}>Retry</button>
              </div>
            )}

            {!loading && !loadError && users.length === 0 && (
              <div className="text-muted small">No users found.</div>
            )}

            {!loading && !loadError && users.length > 0 && (
              <div className="table-responsive">
                <table className="table table-sm table-hover mb-0">
                  <thead className="table-light">
                    <tr>
                      <th>Username</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => {
                      const saving = savingIds.has(u.id);
                      return (
                        <tr key={u.id}>
                          <td>{u.username}</td>
                          <td>{u.email || <span className="text-muted">—</span>}</td>
                          <td style={{ width: 160 }}>
                            <select
                              className="form-select form-select-sm"
                              value={u.role}
                              disabled={saving}
                              onChange={e => updateUser(u.id, { role: e.target.value })}
                            >
                              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </td>
                          <td style={{ width: 160 }}>
                            <select
                              className="form-select form-select-sm"
                              value={u.status}
                              disabled={saving}
                              onChange={e => updateUser(u.id, { status: e.target.value })}
                            >
                              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                          </td>
                          <td>{fmt(u.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
