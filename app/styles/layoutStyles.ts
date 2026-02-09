// app/styles/layoutStyles.ts
import { CSSProperties } from 'react';

/**
 * Style definitions for the main layout structure.
 * These styles control the body, navigation, and content areas.
 */

// Body styles with theme support
export const getBodyStyle = (isDark: boolean): CSSProperties => ({
  margin: 0,
  padding: 0,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  backgroundColor: isDark ? '#0d1117' : '#f5f5f5',
  color: isDark ? '#e0e0e0' : '#333',
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  transition: 'background-color 0.3s ease, color 0.3s ease'
});

// Content wrapper - constrains the entire layout (nav + content) to 90% width centered
export const contentWrapperStyle: CSSProperties = {

  flex: 1,
  display: 'flex',
  flexDirection: 'column'
};

// Layout container - holds nav and main content side by side
export const layoutContainerStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  gap: '0',
  minHeight: 0
};

// Navigation styles with theme support
export const getNavStyle = (isDark: boolean): CSSProperties => ({
  width: '200px',
  backgroundColor: isDark ? '#0d1117' : '#ffffff',
  borderRight: `1px solid ${isDark ? '#30363d' : '#e0e0e0'}`,
  padding: '20px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  flexShrink: 0,
  transition: 'background-color 0.3s ease, border-color 0.3s ease'
});

// Main content area styles with theme support
export const getMainContentStyle = (isDark: boolean): CSSProperties => ({
  flex: 1,
  padding: '20px',
  backgroundColor: isDark ? '#0d1117' : '#ffffff',
  color: isDark ? '#e0e0e0' : '#333',
  overflowY: 'auto',
  minWidth: 0,
  transition: 'background-color 0.3s ease, color 0.3s ease'
});

// Base nav link styles with theme support
const getBaseNavLinkStyle = (isDark: boolean): CSSProperties => ({
  display: 'block',
  padding: '12px 20px',
  textDecoration: 'none',
  color: isDark ? '#c9d1d9' : '#333',
  transition: 'all 0.2s ease',
  borderLeft: '3px solid transparent',
  fontSize: '14px'
});

// Active nav link styles with theme support
const getActiveNavLinkStyle = (isDark: boolean): CSSProperties => ({
  ...getBaseNavLinkStyle(isDark),
  backgroundColor: isDark ? '#161b22' : '#f0f0f0',
  borderLeft: '3px solid #007bff',
  color: '#007bff',
  fontWeight: '500'
});

// Dashboard link style function
export function getDashboardLinkStyle(isActive: boolean, isDark: boolean): CSSProperties {
  return isActive ? getActiveNavLinkStyle(isDark) : getBaseNavLinkStyle(isDark);
}

// Nav link style function
export function getNavLinkStyle(isActive: boolean, isDark: boolean): CSSProperties {
  return isActive ? getActiveNavLinkStyle(isDark) : getBaseNavLinkStyle(isDark);
}
