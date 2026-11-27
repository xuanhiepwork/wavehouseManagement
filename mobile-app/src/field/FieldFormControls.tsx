import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type KeyboardTypeOptions, type TextInputProps } from 'react-native';
import { palette, metrics } from '../design/tokens.ts';

type SharedFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  multiline?: boolean;
  maxLength?: number;
  keyboardType?: KeyboardTypeOptions;
  testID?: string;
  autoCapitalize?: TextInputProps['autoCapitalize'];
};

/** Controlled text field; never persists or transforms business data. */
export function FieldFormTextInput({ label, value, onChangeText, placeholder, helperText,
  error, required = false, disabled = false, multiline = false, maxLength,
  keyboardType = 'default', testID, autoCapitalize = 'sentences' }: SharedFieldProps) {
  const [focused, setFocused] = useState(false);
  return <View style={styles.field}>
    <Text style={styles.label} allowFontScaling>{label}{required ? ' *' : ''}</Text>
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder}
      editable={!disabled} multiline={multiline} maxLength={maxLength} testID={testID}
      keyboardType={keyboardType} autoCapitalize={autoCapitalize}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      accessibilityLabel={label} accessibilityHint={error || helperText}
      placeholderTextColor={palette.muted} selectionColor={palette.primary}
      style={[styles.input, focused && styles.focused, Boolean(error) && styles.invalid,
        disabled && styles.disabled, multiline && styles.multiline]}/>
    {error ? <Text style={styles.error} accessibilityRole="alert" allowFontScaling>{error}</Text>
      : helperText ? <Text style={styles.helper} allowFontScaling>{helperText}</Text> : null}
  </View>;
}

/** Quantity is deliberately a string: no float rounding, auto-clamping or fabricated unit conversion. */
export function FieldFormQuantityInput({ unit, ...props }: SharedFieldProps & { unit?: string }) {
  return <View style={styles.quantityRow}>
    <View style={styles.quantityInput}>
      <FieldFormTextInput {...props} keyboardType="decimal-pad" autoCapitalize="none" />
    </View>
    {unit ? <View style={styles.unitPill}><Text allowFontScaling style={styles.unitText}>{unit}</Text></View> : null}
  </View>;
}

export type FieldFormOption = { readonly value: string; readonly label: string; readonly description?: string };
export function FieldFormChoice({ label, value, onChange, options, error, disabled = false }: {
  label: string; value: string | null; onChange: (value: string) => void;
  options: ReadonlyArray<FieldFormOption>; error?: string; disabled?: boolean;
}) {
  return <View style={styles.field} accessibilityRole="radiogroup" accessibilityLabel={label}>
    <Text style={styles.label} allowFontScaling>{label}</Text>
    <View style={styles.choiceGroup}>
      {options.map(option => {
        const selected = value === option.value;
        return <Pressable key={option.value} accessibilityRole="radio"
          accessibilityLabel={option.label} accessibilityState={{ checked: selected, disabled }}
          disabled={disabled} onPress={() => onChange(option.value)}
          style={({ pressed }) => [styles.choice, selected && styles.choiceActive,
            (pressed || disabled) && styles.dimmed]}>
          <View style={[styles.radioOuter, selected && styles.radioSelected]}>
            {selected ? <View style={styles.radioDot}/> : null}
          </View>
          <View style={styles.choiceText}>
            <Text style={styles.choiceLabel} allowFontScaling>{option.label}</Text>
            {option.description ? <Text style={styles.choiceDescription} allowFontScaling>{option.description}</Text> : null}
          </View>
        </Pressable>;
      })}
    </View>
    {error ? <Text accessibilityRole="alert" style={styles.error} allowFontScaling>{error}</Text> : null}
  </View>;
}

export function FieldFormToggle({ label, value, onChange, description, disabled = false }: {
  label: string; value: boolean; onChange: (next: boolean) => void;
  description?: string; disabled?: boolean;
}) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label}
    accessibilityState={{ checked: value, disabled }} disabled={disabled}
    onPress={() => onChange(!value)} style={({ pressed }) => [styles.toggle,
      (pressed || disabled) && styles.dimmed]}>
    <View style={styles.choiceText}>
      <Text style={styles.choiceLabel} allowFontScaling>{label}</Text>
      {description ? <Text style={styles.choiceDescription} allowFontScaling>{description}</Text> : null}
    </View>
    <View style={[styles.switchTrack, value && styles.switchTrackOn]}>
      <View style={[styles.switchThumb, value && styles.switchThumbOn]} />
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  field: { gap: 7 },
  label: { color: palette.ink, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  input: { minHeight: metrics.touch, paddingHorizontal: 14, paddingVertical: 11,
    borderColor: palette.border, borderWidth: 1, borderRadius: 14,
    backgroundColor: palette.surface, color: palette.ink, fontSize: 16 },
  focused: { borderColor: palette.primary, borderWidth: 2 },
  invalid: { borderColor: palette.danger, borderWidth: 2 },
  disabled: { backgroundColor: palette.beigeLight, opacity: 0.65 },
  multiline: { minHeight: 94, textAlignVertical: 'top' },
  helper: { color: palette.muted, fontSize: 12, lineHeight: 17 },
  error: { color: palette.danger, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  quantityRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  quantityInput: { flex: 1 },
  unitPill: { minWidth: 52, minHeight: metrics.touch, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 12, backgroundColor: palette.beigeLight, borderRadius: 12, borderWidth: 1,
    borderColor: palette.border, marginTop: 20 },
  unitText: { color: palette.primary, fontWeight: '800', fontSize: 13 },
  choiceGroup: { gap: 8 },
  choice: { minHeight: metrics.touch, borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.surface, borderRadius: 14, flexDirection: 'row', gap: 10,
    alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  choiceActive: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
  dimmed: { opacity: 0.65 },
  radioOuter: { width: 22, height: 22, borderWidth: 2, borderColor: palette.muted, borderRadius: 11,
    justifyContent: 'center', alignItems: 'center' },
  radioSelected: { borderColor: palette.primary },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: palette.primary },
  choiceText: { flex: 1, gap: 3 },
  choiceLabel: { color: palette.ink, fontWeight: '700', fontSize: 14, lineHeight: 20 },
  choiceDescription: { color: palette.muted, fontSize: 12, lineHeight: 17 },
  toggle: { minHeight: metrics.touch, flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1,
    borderRadius: 14, padding: 12 },
  switchTrack: { width: 46, height: 27, borderRadius: 14, backgroundColor: palette.border,
    paddingHorizontal: 3, justifyContent: 'center' },
  switchTrackOn: { backgroundColor: palette.primary },
  switchThumb: { width: 21, height: 21, backgroundColor: palette.surface, borderRadius: 11 },
  switchThumbOn: { alignSelf: 'flex-end' },
});
