// app/styles/layoutStyles.ts
import { CSSProperties } from 'react';

export const getBodyStyle = (isDark: boolean): CSSProperties => ({
  margin: 0, padding: 0,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  backgroundColor: isDark ? '#0d1117' : '#f5f5f5',
  color: isDark ? '#e0e0e0' : '#333',
  minHeight: '100vh',
  display: 'flex', flexDirection: 'column',
  transition: 'background-color 0.3s ease, color 0.3s ease',
});

export const contentWrapperStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
};

export const layoutContainerStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  gap: '0',
  minHeight: 0,
};

export const getNavStyle = (isDark: boolean): CSSProperties => ({
  width: '200px',
  backgroundColor: isDark ? '#0d1117' : '#ffffff',
  borderRight: `1px solid ${isDark ? '#30363d' : '#e0e0e0'}`,
  padding: '20px 0',
  display: 'flex', flexDirection: 'column', gap: '8px',
  flexShrink: 0,
  transition: 'background-color 0.3s ease, border-color 0.3s ease',
});

export const getMainContentStyle = (isDark: boolean): CSSProperties => ({
  flex: 1, padding: '20px',
  backgroundColor: isDark ? '#0d1117' : '#ffffff',
  color: isDark ? '#e0e0e0' : '#333',
  overflowY: 'auto', minWidth: 0,
  transition: 'background-color 0.3s ease, color 0.3s ease',
});

const getBaseNavLinkStyle = (isDark: boolean): CSSProperties => ({
  display: 'block', padding: '12px 20px',
  textDecoration: 'none',
  color: isDark ? '#c9d1d9' : '#333',
  transition: 'all 0.2s ease',
  borderLeft: '3px solid transparent', fontSize: '14px',
});

const getActiveNavLinkStyle = (isDark: boolean): CSSProperties => ({
  ...getBaseNavLinkStyle(isDark),
  backgroundColor: isDark ? '#161b22' : '#f0f0f0',
  borderLeft: '3px solid #007bff',
  color: '#007bff', fontWeight: '500',
});

export const getHeatMapToggleStyle = (isDark: boolean): CSSProperties => ({
  backgroundColor: isDark ? '#161b22' : '#f0f0f0',
  borderLeft: '3px solid #ffffff',
  color: '#ffffff', fontWeight: '500',
});

export function getDashboardLinkStyle(isActive: boolean, isDark: boolean): CSSProperties {
  return isActive ? getActiveNavLinkStyle(isDark) : getBaseNavLinkStyle(isDark);
}

export function getNavLinkStyle(isActive: boolean, isDark: boolean): CSSProperties {
  return isActive ? getActiveNavLinkStyle(isDark) : getBaseNavLinkStyle(isDark);
}
