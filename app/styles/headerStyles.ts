// app/styles/headerStyles.ts
import { CSSProperties } from 'react';

/**
 * Style definitions for the header component.
 * These styles control the header bar and amello icon positioning.
 */

// Header bar styles with theme support
export const getHeaderStyle = (isDark: boolean): CSSProperties => ({
  width: '100%',
  height: '70px',
  backgroundColor: isDark ? '#161b22' : '#f8f9fa',
  borderBottom: `1px solid ${isDark ? '#30363d' : '#e0e0e0'}`,
  display: 'flex',
  alignItems: 'center',
  //justifyContent: 'flex-end',
  padding: '0 20px',
  boxSizing: 'border-box',
  flexShrink: 0,
  transition: 'background-color 0.3s ease, border-color 0.3s ease'
});

// Header icon container styles
export const headerIconStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: '100%'
};

// Dark mode toggle button styles
export const getToggleButtonStyle = (isDark: boolean): CSSProperties => ({
  marginRight: '20px',
  backgroundColor: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontSize: '20px',
  color: isDark ? '#e0e0e0' : '#333',
  padding: '8px 12px',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.2s ease'
});
