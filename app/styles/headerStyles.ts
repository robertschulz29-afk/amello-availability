// app/styles/headerStyles.ts
import { CSSProperties } from 'react';

/**
 * Style definitions for the header component.
 * These styles control the header bar and amello icon positioning.
 */

// Header bar styles
export const headerStyle: CSSProperties = {
  width: '100%',
  height: '70px',
  backgroundColor: '#f8f9fa',
  borderBottom: '1px solid #e0e0e0',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  padding: '0 20px',
  boxSizing: 'border-box',
  flexShrink: 0
};

// Header icon container styles
export const headerIconStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: '100%'
};
