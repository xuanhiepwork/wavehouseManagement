/** Shared presentation primitives for operational lists and read-only facts. */
import { StyleSheet, Text, View } from 'react-native';
import { metrics, palette } from '../design/tokens.ts';

const styles = StyleSheet.create({
  heading: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, justifyContent: 'space-between'},
  title: {color: palette.ink, fontSize: 19, lineHeight: 27, fontWeight: '800', flexShrink: 1},
  count: {backgroundColor: palette.beigeLight, borderColor: palette.border, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12},
  countText: {color: palette.primary, fontWeight: '700', fontSize: 13},
  empty: {backgroundColor: palette.surface, borderRadius: metrics.radiusLarge,
    borderColor: palette.border, borderWidth: 1, padding: 20, gap: 7},
  emptyTitle: {fontWeight: '800', color: palette.ink, fontSize: 17, lineHeight: 25},
  emptyBody: {fontSize: 14, lineHeight: 22, color: palette.muted},
  fact: {flexDirection: 'row', gap: 12, justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 7, borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth},
  factLabel: {fontSize: 14, lineHeight: 21, color: palette.muted, flex: 1},
  factValue: {fontSize: 15, lineHeight: 23, color: palette.ink, fontWeight: '700',
    flex: 1, textAlign: 'right'},
  factAccent: {color: palette.primary, fontWeight: '800'},
});

export function FieldListHeading({title, count, unit = 'mục'}:
  {title: string; count?: number; unit?: string}) {
  return <View style={styles.heading}>
    <Text accessibilityRole="header" allowFontScaling style={styles.title}>{title}</Text>
    {typeof count === 'number' ? <View style={styles.count}>
      <Text allowFontScaling style={styles.countText}>{count} {unit}</Text>
    </View> : null}
  </View>;
}

/** Render ONLY when a successful API response is present and the collection is empty. */
export function FieldEmptyRecords({title, description}:
  {title: string; description?: string}) {
  return <View style={styles.empty} accessibilityRole="summary">
    <Text allowFontScaling style={styles.emptyTitle}>{title}</Text>
    {description ? <Text allowFontScaling style={styles.emptyBody}>{description}</Text> : null}
  </View>;
}

export function FieldFactRow({label, value, emphasis = false}:
  {label: string; value: string | number | null | undefined; emphasis?: boolean}) {
  const presented = value === null || value === undefined || value === '' ? '—' : String(value);
  return <View style={styles.fact}>
    <Text allowFontScaling style={styles.factLabel}>{label}</Text>
    <Text allowFontScaling style={[styles.factValue, emphasis && styles.factAccent]}>{presented}</Text>
  </View>;
}
