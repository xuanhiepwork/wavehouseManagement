import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { controls, palette, radii, spacing, typography } from './theme';

export interface BrandActionTileProps {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  note?: string;
  disabled?: boolean;
  testID?: string;
}

export function BrandActionTile({ label, icon, note, onPress, disabled = false, testID }: BrandActionTileProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={note}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <View style={styles.iconWrap}>{icon}</View>
      <Text style={styles.label}>{label}</Text>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    minHeight: controls.tileMinHeight,
    minWidth: controls.minTouch,
    padding: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  iconWrap: { minHeight: 34, alignItems: 'center', justifyContent: 'center' },
  label: { color: palette.text, fontWeight: '700', fontSize: typography.label, textAlign: 'center' },
  note: { color: palette.textSecondary, fontSize: typography.caption, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
