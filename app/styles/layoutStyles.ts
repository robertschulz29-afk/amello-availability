// app/styles/layoutStyles.ts
import { CSSProperties } from 'react';

/**
 * Style definitions for the main layout structure.
 * These styles control the body, navigation, and content areas.
 */

// Body styles
export const bodyStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  backgroundColor: '#f5f5f5',
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column'
};

// Content wrapper - constrains the entire layout (nav + content) to 90% width centered
export const contentWrapperStyle: CSSProperties = {
  maxWidth: '90%',
  margin: '0 auto',
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

// Navigation styles
export const navStyle: CSSProperties = {
  width: '200px',
  backgroundColor: '#ffffff',
  borderRight: '1px solid #e0e0e0',
  padding: '20px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  flexShrink: 0
};

// Main content area styles
export const mainContentStyle: CSSProperties = {
  flex: 1,
  padding: '20px',
  backgroundColor: '#ffffff',
  overflowY: 'auto',
  minWidth: 0
};

// Base nav link styles
const baseNavLinkStyle: CSSProperties = {
  display: 'block',
  padding: '12px 20px',
  textDecoration: 'none',
  color: '#333',
  transition: 'all 0.2s ease',
  borderLeft: '3px solid transparent',
  fontSize: '14px'
};

// Active nav link styles
const activeNavLinkStyle: CSSProperties = {
  ...baseNavLinkStyle,
  backgroundColor: '#f0f0f0',
  borderLeft: '3px solid #007bff',
  color: '#007bff',
  fontWeight: '500'
};

// Dashboard link style function
export function getDashboardLinkStyle(isActive: boolean): CSSProperties {
  return isActive ? activeNavLinkStyle : baseNavLinkStyle;
}

// Nav link style function
export function getNavLinkStyle(isActive: boolean): CSSProperties {
  return isActive ? activeNavLinkStyle : baseNavLinkStyle;
}