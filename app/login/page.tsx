'use client';

import React, { useRef, useState } from 'react';
import { validatePassword } from '@/lib/password-policy';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [showRegister, setShowRegister] = useState(false);
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regErrors, setRegErrors] = useState<{ password?: string; confirm?: string }>({});
  const [regError, setRegError] = useState('');
  const [regLoading, setRegLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        window.location.href = '/';
      } else {
        const data = await res.json();
        setError(data.error ?? 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  }

  function validatePasswordField(): string | undefined {
    const result = validatePassword(regPassword, regUsername);
    return result.valid ? undefined : result.reason;
  }

  function validateConfirmField(): string | undefined {
    if (regConfirm !== regPassword) return 'Passwords do not match.';
    return undefined;
  }

  function handlePasswordBlur() {
    setRegErrors(prev => ({ ...prev, password: validatePasswordField() }));
  }

  function handleConfirmBlur() {
    setRegErrors(prev => ({ ...prev, confirm: validateConfirmField() }));
  }

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setRegError('');

    const passwordErr = validatePasswordField();
    const confirmErr = validateConfirmField();
    setRegErrors({ password: passwordErr, confirm: confirmErr });
    if (passwordErr || confirmErr) return;

    setRegLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: regUsername, email: regEmail, password: regPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRegistered(true);
        setTimeout(() => successHeadingRef.current?.focus(), 0);
      } else {
        setRegError(data.error ?? 'Registration failed');
      }
    } finally {
      setRegLoading(false);
    }
  }

  function backToSignIn() {
    setShowRegister(false);
    setRegistered(false);
    setRegError('');
    setRegErrors({});
    setRegUsername('');
    setRegEmail('');
    setRegPassword('');
    setRegConfirm('');
  }

  return (
    <div className="d-flex align-items-center justify-content-center vh-100 bg-light">
      <div className="card shadow" style={{ width: '100%', maxWidth: showRegister ? 440 : 380 }}>
        <div className="card-body p-4">
          {!showRegister && (
            <>
              <h4 className="card-title mb-4 text-center">Sign in</h4>
              <form onSubmit={handleSubmit}>
                <div className="mb-3">
                  <label className="form-label">Username</label>
                  <input
                    className="form-control"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">Password</label>
                  <input
                    type="password"
                    className="form-control"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                </div>
                {error && <div className="alert alert-danger py-2">{error}</div>}
                <button className="btn btn-dark w-100" type="submit" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
              <hr className="my-3" />
              <div className="text-center">
                <button
                  type="button"
                  className="btn btn-link p-0 small"
                  onClick={() => setShowRegister(true)}
                >
                  Request access
                </button>
              </div>
            </>
          )}

          {showRegister && !registered && (
            <>
              <button type="button" className="btn btn-link p-0 small mb-3" onClick={backToSignIn}>
                ← Back to sign in
              </button>
              <h4 className="card-title mb-4">Request access</h4>
              <form onSubmit={handleRegisterSubmit}>
                <div className="mb-3">
                  <label className="form-label">Username</label>
                  <input
                    className="form-control"
                    value={regUsername}
                    onChange={e => setRegUsername(e.target.value)}
                    autoFocus
                    required
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">Email</label>
                  <input
                    type="email"
                    className="form-control"
                    placeholder="you@example.com"
                    value={regEmail}
                    onChange={e => setRegEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="mb-3">
                  <label className="form-label">Password</label>
                  <input
                    type="password"
                    className={`form-control${regErrors.password ? ' is-invalid' : ''}`}
                    value={regPassword}
                    onChange={e => setRegPassword(e.target.value)}
                    onBlur={handlePasswordBlur}
                    required
                  />
                  <div className="form-text">
                    At least 12 characters, not a common password, and different from your username.
                  </div>
                  {regErrors.password && (
                    <div className="invalid-feedback d-block">{regErrors.password}</div>
                  )}
                </div>
                <div className="mb-3">
                  <label className="form-label">Confirm password</label>
                  <input
                    type="password"
                    className={`form-control${regErrors.confirm ? ' is-invalid' : ''}`}
                    value={regConfirm}
                    onChange={e => setRegConfirm(e.target.value)}
                    onBlur={handleConfirmBlur}
                    required
                  />
                  {regErrors.confirm && (
                    <div className="invalid-feedback d-block">{regErrors.confirm}</div>
                  )}
                </div>
                {regError && <div className="alert alert-danger py-2">{regError}</div>}
                <button className="btn btn-dark w-100" type="submit" disabled={regLoading}>
                  {regLoading ? 'Submitting…' : 'Request access'}
                </button>
              </form>
            </>
          )}

          {showRegister && registered && (
            <div className="text-center py-3">
              <div className="mb-3">
                <i className="fas fa-circle-check text-success" style={{ fontSize: '2.5rem' }} />
              </div>
              <h4 className="mb-3" tabIndex={-1} ref={successHeadingRef}>
                Request received
              </h4>
              <p className="text-muted mb-4">
                Your account has been created and is pending admin activation. You&apos;ll be able to sign in
                once an administrator activates your account.
              </p>
              <button type="button" className="btn btn-dark w-100" onClick={backToSignIn}>
                Back to sign in
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
