// app/components/ScrapeHealthWidget.tsx
'use client';

import { useEffect, useState } from 'react';

interface ScrapeMetrics {
  total_attempts: number;
  success_count: number;
  success_percentage: number;
  error_count: number;
  error_percentage: number;
  timeout_count: number;
  timeout_percentage: number;
  block_count: number;
  block_percentage: number;
  manual_review_count: number;
  manual_review_percentage: number;
  avg_response_time_ms: number;
  avg_retry_count: number;
  min_delay_ms: number;
  max_delay_ms: number;
}

interface ScrapeHealthWidgetProps {
  scanId: number;
  autoRefresh?: boolean;
  refreshInterval?: number; // in milliseconds
}

export function ScrapeHealthWidget({ 
  scanId, 
  autoRefresh = false, 
  refreshInterval = 5000 
}: ScrapeHealthWidgetProps) {
  const [metrics, setMetrics] = useState<ScrapeMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = async () => {
    try {
      const response = await fetch(`/api/scrape-metrics?scan_id=${scanId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch metrics');
      }
      const data = await response.json();
      setMetrics(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();

    if (autoRefresh) {
      const interval = setInterval(fetchMetrics, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [scanId, autoRefresh, refreshInterval]);

  if (loading) {
    return (
      <div className="card">
        <div className="card-body">
          <div className="spinner-border spinner-border-sm" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <span className="ms-2">Loading scrape health...</span>
        </div>
      </div>
    );
  }

  if (error || !metrics) {
    return (
      <div className="card border-warning">
        <div className="card-body">
          <i className="fas fa-exclamation-triangle text-warning me-2"></i>
          <span>No scrape data available</span>
        </div>
      </div>
    );
  }

  // Determine status and color
  const getStatusInfo = () => {
    if (metrics.total_attempts === 0) {
      return { status: 'No Data', color: 'secondary', icon: 'fa-info-circle' };
    }
    if (metrics.success_percentage >= 90) {
      return { status: 'Healthy', color: 'success', icon: 'fa-check-circle' };
    }
    if (metrics.success_percentage >= 80) {
      return { status: 'Warning', color: 'warning', icon: 'fa-exclamation-triangle' };
    }
    return { status: 'Issues Detected', color: 'danger', icon: 'fa-times-circle' };
  };

  const statusInfo = getStatusInfo();

  return (
    <div className={`card border-${statusInfo.color}`}>
      <div className="card-body">
        <h6 className="card-title mb-3">
          <i className={`fas ${statusInfo.icon} text-${statusInfo.color} me-2`}></i>
          Scrape Health
          <span className={`badge bg-${statusInfo.color} ms-2`}>{statusInfo.status}</span>
        </h6>
        
        <div className="row g-2 small">
          <div className="col-md-6">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <span>
                <i className="fas fa-check-circle text-success me-1"></i>
                Success Rate
              </span>
              <strong className={`text-${statusInfo.color}`}>
                {metrics.success_percentage.toFixed(1)}%
              </strong>
            </div>
            <div className="progress" style={{ height: '8px' }}>
              <div 
                className={`progress-bar bg-${statusInfo.color}`}
                style={{ width: `${metrics.success_percentage}%` }}
              ></div>
            </div>
            <div className="text-muted mt-1" style={{ fontSize: '0.8rem' }}>
              {metrics.success_count} / {metrics.total_attempts} attempts
            </div>
          </div>

          <div className="col-md-6">
            <div className="d-flex justify-content-between mb-1">
              <span>
                <i className="fas fa-ban text-danger me-1"></i>
                Blocks
              </span>
              <strong>{metrics.block_count}</strong>
            </div>
            <div className="d-flex justify-content-between mb-1">
              <span>
                <i className="fas fa-exclamation-triangle text-warning me-1"></i>
                Errors
              </span>
              <strong>{metrics.error_count}</strong>
            </div>
            <div className="d-flex justify-content-between mb-1">
              <span>
                <i className="fas fa-clock text-info me-1"></i>
                Timeouts
              </span>
              <strong>{metrics.timeout_count}</strong>
            </div>
          </div>

          <div className="col-12 mt-3">
            <div className="d-flex justify-content-between text-muted" style={{ fontSize: '0.85rem' }}>
              <span>
                <i className="fas fa-stopwatch me-1"></i>
                Avg Response: {(metrics.avg_response_time_ms / 1000).toFixed(2)}s
              </span>
              <span>
                <i className="fas fa-redo me-1"></i>
                Avg Retries: {metrics.avg_retry_count.toFixed(1)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
