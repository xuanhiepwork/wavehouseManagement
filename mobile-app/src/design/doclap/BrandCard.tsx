import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { palette, radii, spacing } from './theme';

export interface BrandCardProps {
  children: React.ReactNode;
  variant?: 'white' | 'cream' | 'subtle';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function BrandCard({ children, variant = 'white', style, testID }: BrandCardProps) {
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        variant === 'cream' && styles.cream,
        variant === 'subtle' && styles.subtle,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.white,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: spacing.md,
  },
  cream: { backgroundColor: palette.coffeeCream },
  subtle: { backgroundColor: palette.subtle },
});
