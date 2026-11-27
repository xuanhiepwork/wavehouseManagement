import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, metrics } from '../design/tokens.ts';

/** Caller supplies status based on real API/form lifecycle. Component never fabricates completion. */
export type FieldFormStatus = 'loading' | 'empty' | 'error' | 'success';
export function FieldFormFeedback({ status, message, onRetry }: {
  status: FieldFormStatus; message: string; onRetry?: () => void;
}) {
  return <View style={styles.feedback} accessibilityLiveRegion="polite">
    {status === 'loading' ? <ActivityIndicator color={palette.primary} size="small" /> : null}
    <Text style={[styles.feedbackText,
      status === 'error' && styles.errorText,
      status === 'success' && styles.successText]} allowFontScaling>{message}</Text>
    {status === 'error' && onRetry ? <Pressable onPress={onRetry} accessibilityRole="button"
      accessibilityLabel="Thử lại" style={styles.retry}><Text style={styles.retryText}>Thử lại</Text></Pressable> : null}
  </View>;
}

/** A confirmation dialog is optional; actual submission and server acknowledgement are caller-owned. */
export function FieldFormActions({ primaryLabel, onPrimaryPress, secondaryLabel, onSecondaryPress,
  submitting = false, disabled = false, confirmation }: {
  primaryLabel: string; onPrimaryPress: () => void;
  secondaryLabel?: string; onSecondaryPress?: () => void;
  submitting?: boolean; disabled?: boolean;
  confirmation?: { readonly title: string; readonly message: string; readonly confirmLabel?: string };
}) {
  const inactive = submitting || disabled;
  const handleSubmit = () => {
    if (confirmation) {
      Alert.alert(confirmation.title, confirmation.message, [
        { text: 'Hủy', style: 'cancel' },
        { text: confirmation.confirmLabel ?? 'Xác nhận', onPress: onPrimaryPress },
      ]);
    } else onPrimaryPress();
  };
  return <View style={styles.actions}>
    {onSecondaryPress && secondaryLabel ? <Pressable onPress={onSecondaryPress}
      disabled={submitting} accessibilityRole="button" accessibilityLabel={secondaryLabel}
      accessibilityState={{ disabled: submitting }}
      style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
      <Text style={styles.secondaryText} allowFontScaling>{secondaryLabel}</Text>
    </Pressable> : null}
    <Pressable onPress={handleSubmit} disabled={inactive} accessibilityRole="button"
      accessibilityLabel={primaryLabel} accessibilityState={{ disabled: inactive, busy: submitting }}
      style={({ pressed }) => [styles.primary, inactive && styles.inactive, pressed && styles.pressed]}>
      {submitting ? <ActivityIndicator size="small" color={palette.surface} /> : null}
      <Text style={styles.primaryText} allowFontScaling>{primaryLabel}</Text>
    </Pressable>
  </View>;
}

/** Displays a step number only; no step or approval is advanced automatically. */
export function FieldFormProgress({ current, steps }: {
  current: number; steps: ReadonlyArray<string>;
}) {
  if (steps.length === 0) return null;
  return <View style={styles.progress} accessibilityRole="summary"
    accessibilityLabel={`Bước ${Math.min(Math.max(current, 1), steps.length)} trên ${steps.length}`}>
    {steps.map((step, index) => <View key={`${index}-${step}`} style={styles.progressStep}>
      <View style={[styles.progressDot, index + 1 <= current && styles.progressDotOn]} />
      <Text style={[styles.progressLabel, index + 1 === current && styles.progressActive]}
        numberOfLines={2} allowFontScaling>{step}</Text>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  feedback: { minHeight: 80, padding: 16, borderWidth: 1, borderColor: palette.border,
    backgroundColor: palette.beigeLight, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center', gap: 8 },
  feedbackText: { color: palette.ink, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  errorText: { color: palette.danger }, successText: { color: palette.success },
  retry: { paddingHorizontal: 20, minHeight: 44, justifyContent: 'center', borderRadius: 12,
    backgroundColor: palette.primarySoft },
  retryText: { color: palette.primary, fontWeight: '700' },
  actions: { gap: 10, paddingVertical: 8 },
  primary: { minHeight: metrics.touch, flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    backgroundColor: palette.primary, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, gap: 9 },
  primaryText: { color: palette.surface, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  secondary: { minHeight: metrics.touch, justifyContent: 'center', alignItems: 'center',
    borderColor: palette.primary, borderWidth: 1, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 10 },
  secondaryText: { color: palette.primary, fontWeight: '700', fontSize: 15 },
  inactive: { opacity: 0.5 }, pressed: { opacity: 0.75 },
  progress: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10 },
  progressStep: { flex: 1, alignItems: 'center', gap: 7 },
  progressDot: { width: 13, height: 13, borderRadius: 7,
    borderColor: palette.border, borderWidth: 2, backgroundColor: palette.surface },
  progressDotOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  progressLabel: { color: palette.muted, fontSize: 11, textAlign: 'center', lineHeight: 15 },
  progressActive: { color: palette.primary, fontWeight: '700' },
});
