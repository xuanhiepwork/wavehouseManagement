import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { controls, palette, radii, spacing, typography } from './theme';

export interface BrandInputProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  helperText?: string;
  testID?: string;
}

/** Controlled/uncontrolled input follows TextInputProps. No auth/session logic. */
export function BrandInput({
  label,
  error,
  helperText,
  onFocus,
  onBlur,
  editable = true,
  testID,
  ...inputProps
}: BrandInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...inputProps}
        testID={testID}
        editable={editable}
        accessibilityLabel={inputProps.accessibilityLabel || label}
        accessibilityHint={error || helperText}
        placeholderTextColor={palette.textSecondary}
        selectionColor={palette.burgundy}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          focused && styles.focused,
          Boolean(error) && styles.invalid,
          !editable && styles.disabled,
        ]}
      />
      {Boolean(error || helperText) && (
        <Text style={[styles.helper, Boolean(error) && styles.error]}>{error || helperText}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { color: palette.text, fontSize: typography.label, fontWeight: '700' },
  input: {
    minHeight: controls.inputHeight,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: typography.body,
    color: palette.text,
  },
  focused: { borderColor: palette.burgundy, borderWidth: 2 },
  invalid: { borderColor: palette.danger, borderWidth: 2 },
  disabled: { backgroundColor: palette.disabledBackground },
  helper: { fontSize: typography.caption, color: palette.textSecondary },
  error: { color: palette.danger },
});
