// app/monitoring/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { useTheme } from '../context/ThemeContext';

interface DailyMetric {
  date: string;
  total_attempts: number;
  success_count: number;
  success_percentage: number;
  block_count: number;
  error_count: number;
  timeout_count: number;
}

interface FailureReason {
  reason: string;
  scrape_status: string;
  count: number;
}

interface ScrapeLog {
  id: number;
  timestamp: string;
  hotel_name: string;
  scrape_status: string;
  http_status: number;
  reason: string;
  check_in_date: string;
  response_time_ms: number;
}

export default function MonitoringPage() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  
  const [dailyMetrics, setDailyMetrics] = useState<DailyMetric[]>([]);
  const [failureReasons, setFailureReasons] = useState<FailureReason[]>([]);
  const [logs, setLogs] = useState<ScrapeLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [hotelFilter, setHotelFilter] = useState<string>('');

  useEffect(() => {
    fetchHealthData();
  }, [days]);

  const fetchHealthData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/scrape-health?days=${days}`);
      const data = await response.json();
      setDailyMetrics(data.daily_metrics || []);
      setFailureReasons(data.failure_reasons || []);
      
      // Fetch recent logs
      const logsResponse = await fetch('/api/scrape-logs?limit=50');
      const logsData = await logsResponse.json();
      setLogs(logsData.logs || []);
    } catch (error) {
      console.error('Failed to fetch health data:', error);
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    const filteredLogs = logs.filter(log => {
      const statusMatch = statusFilter === 'all' || log.scrape_status === statusFilter;
      const hotelMatch = !hotelFilter || log.hotel_name?.toLowerCase().includes(hotelFilter.toLowerCase());
      return statusMatch && hotelMatch;
    });

    const headers = ['Timestamp', 'Hotel', 'Status', 'HTTP Status', 'Reason', 'Check-In Date', 'Response Time (ms)'];
    const rows = filteredLogs.map(log => [
      new Date(log.timestamp).toLocaleString(),
      log.hotel_name || '',
      log.scrape_status,
      log.http_status || '',
      log.reason || '',
      log.check_in_date || '',
      log.response_time_ms || ''
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scrape-logs-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'success': return 'bg-success';
      case 'error': return 'bg-danger';
      case 'timeout': return 'bg-warning';
      case 'block': return 'bg-danger';
      case 'manual_review': return 'bg-info';
      default: return 'bg-secondary';
    }
  };

  const cardClass = isDark ? 'card bg-dark text-light' : 'card';
  const tableClass = isDark ? 'table table-dark table-striped table-hover' : 'table table-striped table-hover';

  return (
    <div className={isDark ? 'bg-dark text-light min-vh-100' : 'min-vh-100'}>
      <Header />
      <div className="container-fluid py-4">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <h2>
            <i className="fas fa-chart-line me-2"></i>
            Scrape Health Monitoring
          </h2>
          <div>
            <select 
              className="form-select form-select-sm d-inline-block w-auto"
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-5">
            <div className="spinner-border" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
          </div>
        ) : (
          <>
            {/* Daily Metrics Overview */}
            <div className="row mb-4">
              <div className="col-12">
                <div className={cardClass}>
                  <div className="card-header">
                    <h5 className="mb-0">Daily Success Rates</h5>
                  </div>
                  <div className="card-body">
                    {dailyMetrics.length === 0 ? (
                      <p className="text-muted">No data available for the selected period</p>
                    ) : (
                      <div className="table-responsive">
                        <table className={tableClass}>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Total Attempts</th>
                              <th>Success</th>
                              <th>Success Rate</th>
                              <th>Blocks</th>
                              <th>Errors</th>
                              <th>Timeouts</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dailyMetrics.map((metric, idx) => (
                              <tr key={idx}>
                                <td>{new Date(metric.date).toLocaleDateString()}</td>
                                <td>{metric.total_attempts}</td>
                                <td>{metric.success_count}</td>
                                <td>
                                  <span className={`badge ${
                                    metric.success_percentage >= 90 ? 'bg-success' :
                                    metric.success_percentage >= 80 ? 'bg-warning' :
                                    'bg-danger'
                                  }`}>
                                    {metric.success_percentage}%
                                  </span>
                                </td>
                                <td>
                                  {metric.block_count > 0 && (
                                    <span className="badge bg-danger">{metric.block_count}</span>
                                  )}
                                  {metric.block_count === 0 && '-'}
                                </td>
                                <td>
                                  {metric.error_count > 0 && (
                                    <span className="badge bg-warning">{metric.error_count}</span>
                                  )}
                                  {metric.error_count === 0 && '-'}
                                </td>
                                <td>
                                  {metric.timeout_count > 0 && (
                                    <span className="badge bg-info">{metric.timeout_count}</span>
                                  )}
                                  {metric.timeout_count === 0 && '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Failure Reasons */}
            <div className="row mb-4">
              <div className="col-md-6">
                <div className={cardClass}>
                  <div className="card-header">
                    <h5 className="mb-0">Top Failure Reasons</h5>
                  </div>
                  <div className="card-body">
                    {failureReasons.length === 0 ? (
                      <p className="text-muted">No failures recorded</p>
                    ) : (
                      <ul className="list-group list-group-flush">
                        {failureReasons.map((reason, idx) => (
                          <li key={idx} className={isDark ? 'list-group-item bg-dark text-light' : 'list-group-item'}>
                            <div className="d-flex justify-content-between align-items-center">
                              <div>
                                <span className={`badge ${getStatusBadgeClass(reason.scrape_status)} me-2`}>
                                  {reason.scrape_status}
                                </span>
                                <span>{reason.reason}</span>
                              </div>
                              <span className="badge bg-secondary">{reason.count}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              {/* Quick Stats */}
              <div className="col-md-6">
                <div className={cardClass}>
                  <div className="card-header">
                    <h5 className="mb-0">Summary Statistics</h5>
                  </div>
                  <div className="card-body">
                    {dailyMetrics.length > 0 && (
                      <div className="row g-3">
                        <div className="col-6">
                          <div className="text-center p-3 bg-success bg-opacity-10 rounded">
                            <h3 className="mb-0 text-success">
                              {dailyMetrics.reduce((acc, m) => acc + m.success_count, 0)}
                            </h3>
                            <small className="text-muted">Total Successes</small>
                          </div>
                        </div>
                        <div className="col-6">
                          <div className="text-center p-3 bg-danger bg-opacity-10 rounded">
                            <h3 className="mb-0 text-danger">
                              {dailyMetrics.reduce((acc, m) => acc + m.block_count, 0)}
                            </h3>
                            <small className="text-muted">Total Blocks</small>
                          </div>
                        </div>
                        <div className="col-6">
                          <div className="text-center p-3 bg-warning bg-opacity-10 rounded">
                            <h3 className="mb-0 text-warning">
                              {dailyMetrics.reduce((acc, m) => acc + m.error_count, 0)}
                            </h3>
                            <small className="text-muted">Total Errors</small>
                          </div>
                        </div>
                        <div className="col-6">
                          <div className="text-center p-3 bg-info bg-opacity-10 rounded">
                            <h3 className="mb-0 text-info">
                              {dailyMetrics.reduce((acc, m) => acc + m.timeout_count, 0)}
                            </h3>
                            <small className="text-muted">Total Timeouts</small>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Recent Logs */}
            <div className="row">
              <div className="col-12">
                <div className={cardClass}>
                  <div className="card-header d-flex justify-content-between align-items-center">
                    <h5 className="mb-0">Recent Scrape Logs</h5>
                    <button 
                      className="btn btn-sm btn-primary"
                      onClick={exportToCSV}
                    >
                      <i className="fas fa-download me-1"></i>
                      Export CSV
                    </button>
                  </div>
                  <div className="card-body">
                    <div className="row mb-3">
                      <div className="col-md-6">
                        <input 
                          type="text"
                          className="form-control form-control-sm"
                          placeholder="Filter by hotel name..."
                          value={hotelFilter}
                          onChange={(e) => setHotelFilter(e.target.value)}
                        />
                      </div>
                      <div className="col-md-6">
                        <select 
                          className="form-select form-select-sm"
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value)}
                        >
                          <option value="all">All Statuses</option>
                          <option value="success">Success</option>
                          <option value="error">Error</option>
                          <option value="timeout">Timeout</option>
                          <option value="block">Block</option>
                          <option value="manual_review">Manual Review</option>
                        </select>
                      </div>
                    </div>
                    
                    <div className="table-responsive">
                      <table className={tableClass}>
                        <thead>
                          <tr>
                            <th>Timestamp</th>
                            <th>Hotel</th>
                            <th>Status</th>
                            <th>HTTP</th>
                            <th>Reason</th>
                            <th>Check-In</th>
                            <th>Response (ms)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs
                            .filter(log => {
                              const statusMatch = statusFilter === 'all' || log.scrape_status === statusFilter;
                              const hotelMatch = !hotelFilter || log.hotel_name?.toLowerCase().includes(hotelFilter.toLowerCase());
                              return statusMatch && hotelMatch;
                            })
                            .slice(0, 50)
                            .map((log) => (
                              <tr key={log.id}>
                                <td className="small">{new Date(log.timestamp).toLocaleString()}</td>
                                <td>{log.hotel_name || '-'}</td>
                                <td>
                                  <span className={`badge ${getStatusBadgeClass(log.scrape_status)}`}>
                                    {log.scrape_status}
                                  </span>
                                </td>
                                <td>{log.http_status || '-'}</td>
                                <td className="small text-truncate" style={{ maxWidth: '200px' }}>
                                  {log.reason || '-'}
                                </td>
                                <td>{log.check_in_date || '-'}</td>
                                <td>{log.response_time_ms || '-'}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
