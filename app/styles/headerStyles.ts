// app/styles/headerStyles.ts
import { CSSProperties } from 'react';

/**
 * Style definitions for the header component.
 * These styles control the header bar and amello icon positioning.
 */

// Header bar styles with theme support
export const getHeaderStyle = (isDark: boolean): CSSProperties => ({
  width: '100%',
  height: '50px',
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
export const getToggleButtonStyle = (isDark: boolean, active = false): CSSProperties => ({
  border: 'none',
  borderLeft: `2px solid`,
  cursor: 'pointer',
  fontSize: '1rem',
  padding: '12px 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.2s ease',
  backgroundColor: active? (isDark ? '#485648' : '#0b0b0b')  // active: blue for both modes
  : (isDark ? '#2d333b' : '#f0f0f0'),
  color: active ? '#ffffff' : 'inherit',
  fontWeight: active ? '600' : '400',
});

export const getToggleButtonGroupStyle = (isDark: boolean): CSSProperties => ({
  border: '1px solid',
  color: isDark ? '#ffffff' : '#30363d',
  backgroundColor: isDark ? '#30363d' : '#ffffff',
  cursor: 'pointer',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'all 0.2s ease'
});
