'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[App Error Boundary]', error);
  }, [error]);

  return (
    <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '50vh' }}>
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="card-body text-center">
          <i className="fas fa-exclamation-triangle text-danger mb-3" style={{ fontSize: '2rem' }} />
          <h5 className="mb-2">Something went wrong</h5>
          <p className="text-muted small mb-3">
            An unexpected error occurred. Try refreshing the page.
          </p>
          <button className="btn btn-primary btn-sm" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
