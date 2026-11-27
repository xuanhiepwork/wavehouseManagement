import { StyleSheet } from 'react-native';
import { palette } from '../design/tokens.ts';

export const catalogColors = {
  background: palette.canvas,
  surface: palette.surface,
  text: palette.ink,
  muted: palette.muted,
  accent: palette.primary,
  border: palette.border,
};

export const catalogStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: catalogColors.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: 20,
    gap: 18,
  },
  introduction: {
    gap: 12,
  },
  eyebrow: {
    color: catalogColors.accent,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  title: {
    color: catalogColors.text,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
    flexShrink: 1,
  },
  body: {
    color: catalogColors.muted,
    fontSize: 16,
    lineHeight: 25,
    flexShrink: 1,
  },
  links: {
    gap: 12,
  },
  link: {
    minHeight: 56,
    padding: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: catalogColors.border,
    borderRadius: 18,
    backgroundColor: catalogColors.surface,
    justifyContent: 'center',
  },
  linkPressed: {
    backgroundColor: palette.primarySoft,
    borderColor: palette.primary,
  },
  linkLabel: {
    color: catalogColors.accent,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
    flexShrink: 1,
  },
  linkDescription: {
    color: catalogColors.muted,
    fontSize: 15,
    lineHeight: 23,
    flexShrink: 1,
  },
  notice: {
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: catalogColors.border,
    borderRadius: 18,
    backgroundColor: catalogColors.surface,
  },
  noticeTitle: {
    color: catalogColors.text,
    fontSize: 18,
    lineHeight: 27,
    fontWeight: '600',
  },
  identifierLabel: {
    color: catalogColors.muted,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: '600',
  },
  identifier: {
    color: catalogColors.text,
    fontSize: 16,
    lineHeight: 26,
    flexShrink: 1,
  },
});
