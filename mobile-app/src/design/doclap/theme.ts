/**
 * ĐỘC LẬP Cà Phê — Mobile design tokens, Phase A.
 * Brand colors follow the supplied identity board exactly.
 * This module contains no API, session, or navigation side effects.
 */
export const brand = {
  burgundy: '#5B070D',
  orange: '#D64027',
  coffeeCream: '#F0DCBC',
  canvas: '#FBF6EE',
} as const;

export const palette = {
  ...brand,
  white: '#FFFFFF',
  text: '#251B19',
  textSecondary: '#675D59',
  border: '#E7DCD0',
  subtle: '#F7EFE4',
  disabled: '#B8B0AA',
  disabledBackground: '#EFEAE4',
  success: '#176B43',
  successBackground: '#E6F5EA',
  warning: '#8A5100',
  warningBackground: '#FFF3DB',
  danger: '#A32626',
  dangerBackground: '#FCE8E6',
  information: '#245C89',
  informationBackground: '#E8F2FB',
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  card: 16,
  xl: 20,
  pill: 999,
} as const;

// React Native uses logical density-independent points (dp/pt), not CSS pixels.
export const typography = {
  caption: 12,
  label: 14,
  body: 16,
  bodyLarge: 18,
  section: 20,
  heading: 24,
  hero: 30,
} as const;

export const controls = {
  minTouch: 48,
  buttonHeight: 54,
  inputHeight: 54,
  navIcon: 26,
  navLabel: 12,
  navFab: 66,
  navFabIcon: 29,
  tileMinHeight: 112,
  contentMaxWidth: 720,
} as const;

export type SemanticTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
