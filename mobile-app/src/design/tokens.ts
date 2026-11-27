/** ĐỘC LẬP Cà Phê: application UI tokens derived from the owner's brand artwork.
 * Keep promotional textures and cup photography out of operational forms.
 */
export const palette = {
  canvas: '#FBF6EE',       // warm paper, near-white for readable screens
  surface: '#FFFFFF',
  ink: '#35211D',
  muted: '#665751',
  primary: '#5B070D',      // ĐỘC LẬP brand wine red
  primaryPressed: '#430509',
  primarySoft: '#F9EDE7',
  accent: '#D64027',       // orange-red from the brand poster
  accentPressed: '#B92F1B',
  accentSoft: '#FCEAE2',
  beige: '#F0DCBC',
  beigeLight: '#FFF8EA',
  border: '#E9DACE',
  warningSurface: '#FFF3DA',
  warningInk: '#78500E',
  danger: '#B4232A',
  dangerSurface: '#FFF0F0',
  success: '#22704A',
  successSurface: '#EAF6EC',
} as const;

export const metrics = {
  touch: 52,
  navTouch: 48,
  navIcon: 25,
  navLabel: 11,
  cameraFab: 66,
  radiusSmall: 12,
  radiusMedium: 16,
  radiusLarge: 22,
  contentPadding: 20,
  contentMaxWidth: 680,
} as const;
