import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, spacing, typography } from './theme';

export interface BrandHeaderProps {
  title?: string;
  subtitle?: string;
  rightAccessory?: React.ReactNode;
}

export function BrandHeader({ title = 'ĐỘC LẬP', subtitle, rightAccessory }: BrandHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.copy}>
        <Text style={styles.brand}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {rightAccessory ? <View style={styles.right}>{rightAccessory}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: palette.canvas,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  copy: { flex: 1, gap: 2 },
  brand: { color: palette.burgundy, fontSize: typography.section, fontWeight: '900' },
  subtitle: { color: palette.textSecondary, fontSize: typography.label },
  right: { alignItems: 'flex-end' },
});
