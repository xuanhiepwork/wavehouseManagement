import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette } from '../design/tokens.ts';

/** Visual-only section. Domain permissions, validation and persistence remain in the calling screen. */
export function FieldFormSection({ title, description, children }: {
  title: string; description?: string; children: ReactNode;
}) {
  return <View style={styles.section}>
    <Text style={styles.sectionTitle} allowFontScaling>{title}</Text>
    {description ? <Text style={styles.sectionDescription} allowFontScaling>{description}</Text> : null}
    <View style={styles.stack}>{children}</View>
  </View>;
}

export type FieldNoticeTone = 'information' | 'warning' | 'error' | 'success';
export function FieldFormNotice({ title, message, tone = 'information' }: {
  title?: string; message: string; tone?: FieldNoticeTone;
}) {
  return <View accessibilityRole="summary" style={[styles.notice,
    tone === 'warning' && styles.warning,
    tone === 'error' && styles.error,
    tone === 'success' && styles.success]}>
    {title ? <Text style={styles.noticeTitle} allowFontScaling>{title}</Text> : null}
    <Text style={styles.noticeMessage} allowFontScaling>{message}</Text>
  </View>;
}

export type FieldReviewItem = { readonly label: string; readonly value: string | number | null | undefined; readonly emphasis?: boolean };
export function FieldFormReview({ title = 'Kiểm tra trước khi xác nhận', items, description }: {
  title?: string; description?: string; items: ReadonlyArray<FieldReviewItem>;
}) {
  return <FieldFormSection title={title} description={description}>
    {items.map((item, index) => <View key={`${index}-${item.label}`} style={styles.reviewRow}>
      <Text style={styles.reviewLabel} allowFontScaling>{item.label}</Text>
      <Text style={[styles.reviewValue, item.emphasis && styles.reviewEmphasis]} allowFontScaling>
        {item.value === null || item.value === undefined || item.value === '' ? '—' : String(item.value)}
      </Text>
    </View>)}
  </FieldFormSection>;
}

const styles = StyleSheet.create({
  section: { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1,
    borderRadius: 18, padding: 16, gap: 8 },
  sectionTitle: { color: palette.primary, fontSize: 17, fontWeight: '800', lineHeight: 24 },
  sectionDescription: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  stack: { gap: 14, marginTop: 4 },
  notice: { borderRadius: 12, backgroundColor: palette.primarySoft,
    borderLeftWidth: 3, borderLeftColor: palette.primary, padding: 12, gap: 4 },
  warning: { backgroundColor: palette.warningSurface, borderLeftColor: palette.warningInk },
  error: { backgroundColor: palette.dangerSurface, borderLeftColor: palette.danger },
  success: { backgroundColor: palette.successSurface, borderLeftColor: palette.success },
  noticeTitle: { color: palette.ink, fontSize: 13, fontWeight: '800', lineHeight: 19 },
  noticeMessage: { color: palette.ink, fontSize: 13, lineHeight: 19 },
  reviewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border, paddingVertical: 8 },
  reviewLabel: { flex: 1, color: palette.muted, fontSize: 13, lineHeight: 19 },
  reviewValue: { flex: 1, textAlign: 'right', color: palette.ink, fontSize: 14,
    lineHeight: 20, fontWeight: '600' },
  reviewEmphasis: { color: palette.primary, fontWeight: '800' },
});
