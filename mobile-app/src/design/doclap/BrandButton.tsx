import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { controls, palette, radii, typography } from './theme';

export type BrandButtonVariant = 'primary' | 'accent' | 'outline' | 'ghost';

export interface BrandButtonProps {
  title: string;
  onPress: () => void;
  variant?: BrandButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function BrandButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = false,
  icon,
  accessibilityHint,
  testID,
  style,
}: BrandButtonProps) {
  const inactive = disabled || loading;
  const textColor = inactive
    ? palette.textSecondary
    : variant === 'primary' || variant === 'accent'
      ? palette.white
      : palette.burgundy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.container,
        fullWidth && styles.fullWidth,
        variant === 'primary' && styles.primary,
        variant === 'accent' && styles.accent,
        variant === 'outline' && styles.outline,
        variant === 'ghost' && styles.ghost,
        inactive && styles.disabled,
        pressed && !inactive && styles.pressed,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={textColor} size="small" /> : icon}
        <Text style={[styles.label, { color: textColor }]}>{title}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: controls.buttonHeight,
    minWidth: controls.minTouch,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  fullWidth: { width: '100%' },
  primary: { backgroundColor: palette.burgundy },
  accent: { backgroundColor: palette.orange },
  outline: { borderWidth: 1.5, borderColor: palette.burgundy, backgroundColor: palette.white },
  ghost: { backgroundColor: 'transparent' },
  disabled: { backgroundColor: palette.disabledBackground, borderColor: palette.border },
  pressed: { opacity: 0.78 },
  content: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  label: { fontSize: typography.body, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
});
