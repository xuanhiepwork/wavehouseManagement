import { StyleSheet } from 'react-native';
import { palette } from '../design/tokens.ts';

/** Shared readable brand styling across Ingredient, Product and Recipe read screens. */
export const catalogColors = {
  background: palette.canvas,
  surface: palette.surface,
  text: palette.ink,
  muted: palette.muted,
  accent: palette.primary,
  border: palette.border,
};
export const catalogStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: catalogColors.background },
  scroll: { flex: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, gap: 18 },
  introduction: { gap: 12 },
  eyebrow: { color: palette.accent, fontSize: 12, lineHeight: 19, fontWeight: '800', letterSpacing: 0.8 },
  title: { color: palette.primary, fontSize: 28, lineHeight: 36, fontWeight: '800', flexShrink: 1 },
  body: { color: catalogColors.muted, fontSize: 15, lineHeight: 24, flexShrink: 1 },
  links: { gap: 12 },
  link: { minHeight: 62, padding: 18, gap: 8, borderWidth: 1, borderColor: catalogColors.border,
    borderRadius: 18, backgroundColor: catalogColors.surface, justifyContent: 'center' },
  linkPressed: { backgroundColor: palette.primarySoft, borderColor: palette.primary },
  linkLabel: { color: catalogColors.accent, fontSize: 17, lineHeight: 24, fontWeight: '800', flexShrink: 1 },
  linkDescription: { color: catalogColors.muted, fontSize: 14, lineHeight: 22, flexShrink: 1 },
  notice: { padding: 19, gap: 12, borderWidth: 1, borderColor: catalogColors.border, borderRadius: 18, backgroundColor: catalogColors.surface },
  noticeTitle: { color: catalogColors.text, fontSize: 18, lineHeight: 26, fontWeight: '800' },
  identifierLabel: { color: catalogColors.muted, fontSize: 14, lineHeight: 22, fontWeight: '700' },
  identifier: { color: catalogColors.text, fontSize: 16, lineHeight: 25, flexShrink: 1 },
});
