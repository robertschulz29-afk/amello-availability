// app/styles/layoutStyles.ts
import { CSSProperties } from 'react';

/**
 * Style definitions for the root layout component.
 * These styles control the overall page structure, navigation, and content areas.
 */

// Body styles
export const bodyStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  backgroundColor: '#ffffff',
  fontFamily: 'Helvetica, Arial, sans-serif',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh'
};

// Wrapper for content below header
export const contentWrapperStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  width: '100%',
  boxSizing: 'border-box'
};

// Main layout container styles
export const layoutContainerStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  width: '100%',
  boxSizing: 'border-box'
};

// Navigation sidebar styles
export const navStyle: CSSProperties = {
  width: '10rem',
  backgroundColor: '#eeeeee',
  padding: '0px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  flexShrink: 0,
  boxSizing: 'border-box'
};

// Navigation link base styles
const navLinkBaseStyle: CSSProperties = {
  padding: '12px 16px',
  textDecoration: 'none',
  borderRadius: '4px'
};

// Function to get navigation link styles based on active state
export const getNavLinkStyle = (isActive: boolean): CSSProperties => ({
  ...navLinkBaseStyle,
  color: isActive ? '#000' : '#555',
  backgroundColor: isActive ? '#ffffff' : 'transparent',
  fontWeight: isActive ? '600' : '400'
});

// Special case for dashboard link (different active background)
export const getDashboardLinkStyle = (isActive: boolean): CSSProperties => ({
  ...navLinkBaseStyle,
  color: isActive ? '#000' : '#555',
  backgroundColor: isActive ? '#ffffff' : 'transparent',
  fontWeight: isActive ? '600' : '400'
});

// Main content area styles
export const mainContentStyle: CSSProperties = {
  flex: 1,
  padding: '20px',
  backgroundColor: '#ffffff',
  boxSizing: 'border-box'
};
