// lib/scrapers/utils/scrape-logger.ts
// Utility for logging and monitoring scrape attempts

import { sql } from '@/lib/db';

/**
 * Scrape log event data
 */
export interface ScrapeLogEvent {
  timestamp?: Date;
  scrape_status: 'success' | 'error' | 'timeout' | 'block' | 'manual_review';
  hotel_id?: number;
  hotel_name?: string;
  scan_id?: number;
  check_in_date?: string;
  url?: string;
  http_status?: number;
  delay_ms?: number;
  retry_count?: number;
  error_message?: string | null;
  user_agent?: string;
  reason?: string;
  response_time_ms?: number;
  session_id?: string;
}

/**
 * Aggregated metrics for a scan
 */
export interface ScrapeMetrics {
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

/**
 * Log a single scrape event to the database
 */
export async function logScrapeEvent(event: ScrapeLogEvent): Promise<void> {
  try {
    // Truncate user agent to first 50 chars
    const userAgent = event.user_agent 
      ? event.user_agent.substring(0, 50) 
      : null;

    await sql`
      INSERT INTO scrape_logs (
        timestamp,
        scan_id,
        hotel_id,
        hotel_name,
        scrape_status,
        http_status,
        delay_ms,
        retry_count,
        error_message,
        user_agent,
        reason,
        response_time_ms,
        session_id,
        url,
        check_in_date
      )
      VALUES (
        ${event.timestamp || new Date()},
        ${event.scan_id || null},
        ${event.hotel_id || null},
        ${event.hotel_name || null},
        ${event.scrape_status},
        ${event.http_status || null},
        ${event.delay_ms || null},
        ${event.retry_count || 0},
        ${event.error_message || null},
        ${userAgent},
        ${event.reason || null},
        ${event.response_time_ms || null},
        ${event.session_id || null},
        ${event.url || null},
        ${event.check_in_date || null}
      )
    `;
  } catch (error) {
    // Don't throw - logging should not break the scraping flow
    console.error('[scrape-logger] Failed to log event:', error);
  }
}

/**
 * Get aggregated metrics for a specific scan
 */
export async function getScrapeMetrics(scanId: number): Promise<ScrapeMetrics> {
  const result = await sql<any>`
    SELECT 
      COUNT(*) as total_attempts,
      COUNT(*) FILTER (WHERE scrape_status = 'success') as success_count,
      COUNT(*) FILTER (WHERE scrape_status = 'error') as error_count,
      COUNT(*) FILTER (WHERE scrape_status = 'timeout') as timeout_count,
      COUNT(*) FILTER (WHERE scrape_status = 'block') as block_count,
      COUNT(*) FILTER (WHERE scrape_status = 'manual_review') as manual_review_count,
      AVG(response_time_ms) FILTER (WHERE response_time_ms IS NOT NULL) as avg_response_time_ms,
      AVG(retry_count) as avg_retry_count,
      MIN(delay_ms) FILTER (WHERE delay_ms IS NOT NULL) as min_delay_ms,
      MAX(delay_ms) FILTER (WHERE delay_ms IS NOT NULL) as max_delay_ms
    FROM scrape_logs
    WHERE scan_id = ${scanId}
  `;

  const row = result.rows[0];
  const totalAttempts = parseInt(row?.total_attempts || '0');

  return {
    total_attempts: totalAttempts,
    success_count: parseInt(row?.success_count || '0'),
    success_percentage: totalAttempts > 0 
      ? (parseInt(row?.success_count || '0') / totalAttempts) * 100 
      : 0,
    error_count: parseInt(row?.error_count || '0'),
    error_percentage: totalAttempts > 0 
      ? (parseInt(row?.error_count || '0') / totalAttempts) * 100 
      : 0,
    timeout_count: parseInt(row?.timeout_count || '0'),
    timeout_percentage: totalAttempts > 0 
      ? (parseInt(row?.timeout_count || '0') / totalAttempts) * 100 
      : 0,
    block_count: parseInt(row?.block_count || '0'),
    block_percentage: totalAttempts > 0 
      ? (parseInt(row?.block_count || '0') / totalAttempts) * 100 
      : 0,
    manual_review_count: parseInt(row?.manual_review_count || '0'),
    manual_review_percentage: totalAttempts > 0 
      ? (parseInt(row?.manual_review_count || '0') / totalAttempts) * 100 
      : 0,
    avg_response_time_ms: parseFloat(row?.avg_response_time_ms || '0'),
    avg_retry_count: parseFloat(row?.avg_retry_count || '0'),
    min_delay_ms: parseInt(row?.min_delay_ms || '0'),
    max_delay_ms: parseInt(row?.max_delay_ms || '0'),
  };
}

/**
 * Check thresholds and alert if needed
 */
export async function alertOnThresholds(scanId: number): Promise<void> {
  const metrics = await getScrapeMetrics(scanId);

  // Alert if success rate drops below 80%
  if (metrics.total_attempts >= 10 && metrics.success_percentage < 80) {
    console.warn(
      `[WARN] Low success rate for scan ${scanId}: ${metrics.success_percentage.toFixed(1)}% ` +
      `(${metrics.success_count}/${metrics.total_attempts})`
    );
  }

  // Alert if >20% of requests result in bot blocks
  if (metrics.total_attempts >= 10 && metrics.block_percentage > 20) {
    console.error(
      `[ERROR] High block rate for scan ${scanId}: ${metrics.block_percentage.toFixed(1)}% ` +
      `(${metrics.block_count}/${metrics.total_attempts})`
    );
  }

  // Check for potential IP bans (3+ 403 errors on same hotel)
  const blocksByHotel = await sql<any>`
    SELECT 
      hotel_id,
      hotel_name,
      COUNT(*) as block_count
    FROM scrape_logs
    WHERE scan_id = ${scanId}
      AND scrape_status = 'block'
      AND http_status = 403
    GROUP BY hotel_id, hotel_name
    HAVING COUNT(*) >= 3
  `;

  if (blocksByHotel.rows.length > 0) {
    for (const row of blocksByHotel.rows) {
      console.error(
        `[ERROR] Potential IP ban detected for hotel ${row.hotel_name} ` +
        `(ID: ${row.hotel_id}): ${row.block_count} x 403 errors`
      );
    }
  }
}

/**
 * Get daily metrics for the last N days
 */
export async function getDailyMetrics(days: number = 7): Promise<any[]> {
  const result = await sql<any>`
    SELECT 
      DATE(timestamp) as date,
      COUNT(*) as total_attempts,
      COUNT(*) FILTER (WHERE scrape_status = 'success') as success_count,
      ROUND(
        (COUNT(*) FILTER (WHERE scrape_status = 'success')::numeric / COUNT(*)::numeric * 100), 
        2
      ) as success_percentage,
      COUNT(*) FILTER (WHERE scrape_status = 'block') as block_count,
      COUNT(*) FILTER (WHERE scrape_status = 'error') as error_count,
      COUNT(*) FILTER (WHERE scrape_status = 'timeout') as timeout_count
    FROM scrape_logs
    WHERE timestamp >= NOW() - INTERVAL '${days} days'
    GROUP BY DATE(timestamp)
    ORDER BY date DESC
  `;

  return result.rows;
}

/**
 * Get top failure reasons
 */
export async function getTopFailureReasons(scanId?: number, limit: number = 10): Promise<any[]> {
  let result;
  
  if (scanId) {
    result = await sql<any>`
      SELECT 
        reason,
        scrape_status,
        COUNT(*) as count
      FROM scrape_logs
      WHERE scan_id = ${scanId}
        AND scrape_status != 'success'
        AND reason IS NOT NULL
      GROUP BY reason, scrape_status
      ORDER BY count DESC
      LIMIT ${limit}
    `;
  } else {
    result = await sql<any>`
      SELECT 
        reason,
        scrape_status,
        COUNT(*) as count
      FROM scrape_logs
      WHERE scrape_status != 'success'
        AND reason IS NOT NULL
        AND timestamp >= NOW() - INTERVAL '7 days'
      GROUP BY reason, scrape_status
      ORDER BY count DESC
      LIMIT ${limit}
    `;
  }

  return result.rows;
}
