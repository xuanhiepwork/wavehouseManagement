import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, typography, type SemanticTone } from './theme';

export interface BrandBadgeProps {
  label: string;
  tone: SemanticTone;
  testID?: string;
}

const toneStyles: Record<SemanticTone, { backgroundColor: string; color: string }> = {
  neutral: { backgroundColor: palette.subtle, color: palette.burgundy },
  success: { backgroundColor: palette.successBackground, color: palette.success },
  warning: { backgroundColor: palette.warningBackground, color: palette.warning },
  danger: { backgroundColor: palette.dangerBackground, color: palette.danger },
  info: { backgroundColor: palette.informationBackground, color: palette.information },
};

/** Status is ALWAYS conveyed by a readable label, not color alone. */
export function BrandBadge({ label, tone, testID }: BrandBadgeProps) {
  const colors = toneStyles[tone];
  return (
    <View testID={testID} style={[styles.container, { backgroundColor: colors.backgroundColor }]}>
      <Text style={[styles.label, { color: colors.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  label: { fontSize: typography.caption, fontWeight: '700' },
});
