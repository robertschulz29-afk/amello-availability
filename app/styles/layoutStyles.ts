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
  fontFamily: 'Helvetica, Arial, sans-serif'
};

// Main layout container styles
export const layoutContainerStyle: CSSProperties = {
  display: 'flex',
  minHeight: '100vh'
};

// Navigation sidebar styles
export const navStyle: CSSProperties = {
  width: '10rem',
  backgroundColor: '#eeeeee',
  padding: '0px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  flexShrink: 0
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
  backgroundColor: isActive ? '#b8b8b8' : 'transparent',
  fontWeight: isActive ? '600' : '400'
});

// Special case for dashboard link (different active background)
// Note: #fffffe is slightly off-white, preserved from original design
export const getDashboardLinkStyle = (isActive: boolean): CSSProperties => ({
  ...navLinkBaseStyle,
  color: isActive ? '#000' : '#555',
  backgroundColor: isActive ? '#fffffe' : 'transparent',
  fontWeight: isActive ? '600' : '400'
});

// Main content area styles
// Note: width:'80%' preserved from original, though flex:1 typically handles sizing
export const mainContentStyle: CSSProperties = {
  width: '80%',
  flex: 1,
  padding: '20px',
  backgroundColor: '#ffffff'
};
