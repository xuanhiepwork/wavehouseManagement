import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BrandIcon } from '../design/BrandIcon.tsx';
import { palette } from '../design/tokens.ts';
import type { WorkItem } from './work-items.ts';

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexBasis: '46%', flexGrow: 1, minWidth: 130, minHeight: 134,
    backgroundColor: palette.surface, borderRadius: 18, borderWidth: 1, borderColor: palette.border,
    padding: 14, justifyContent: 'space-between', gap: 11 },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  tileIcon: { width: 44, height: 44, borderRadius: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: palette.accentSoft },
  tileChevron: { fontSize: 24, fontWeight: '600', color: palette.primary },
  title: { fontSize: 16, lineHeight: 22, color: palette.ink, fontWeight: '800' },
  detail: { fontSize: 13, lineHeight: 19, color: palette.muted },
  itemCopy: { gap: 3 },
  recommend: { minHeight: 78, backgroundColor: palette.surface, borderRadius: 16, borderColor: palette.border,
    borderWidth: 1, paddingHorizontal: 15, paddingVertical: 13,
    flexDirection: 'row', alignItems: 'center', gap: 12 },
  recommendIcon: { backgroundColor: palette.primarySoft, height: 44, width: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0, gap: 3 },
  arrow: { fontSize: 25, fontWeight: '600', color: palette.primary },
});

/** WorkItem paths already come from role-scoped navigation/work-items.ts. */
export function WorkGrid({ items }: { items: readonly WorkItem[] }) {
  return <View style={styles.grid}>{items.map(item =>
    <Link key={item.href} href={item.href as Href} asChild><Pressable
      accessibilityRole="link" accessibilityLabel={`${item.title}. ${item.subtitle}`}
      style={({ pressed }) => [styles.tile, pressed && { borderColor: palette.accent, backgroundColor: palette.beigeLight }]}>
      <View style={styles.tileTop}>
        <View style={styles.tileIcon}><BrandIcon name={item.icon} color={palette.primary} size={26} /></View>
        <Text style={styles.tileChevron} accessibilityElementsHidden>›</Text>
      </View>
      <View style={styles.itemCopy}>
        <Text allowFontScaling style={styles.title}>{item.title}</Text>
        <Text allowFontScaling style={styles.detail}>{item.subtitle}</Text>
      </View>
    </Pressable></Link>)}</View>;
}

export function SuggestedList({ items }: { items: readonly WorkItem[] }) {
  return <View style={{ gap: 10 }}>{items.map(item =>
    <Link key={item.href} href={item.href as Href} asChild><Pressable
      accessibilityRole="link" accessibilityLabel={`${item.title}. ${item.subtitle}`}
      style={({ pressed }) => [styles.recommend, pressed && { backgroundColor: palette.primarySoft }]}>
      <View style={styles.recommendIcon}><BrandIcon name={item.icon} color={palette.primary} size={24} /></View>
      <View style={styles.info}>
        <Text allowFontScaling style={styles.title}>{item.title}</Text>
        <Text allowFontScaling style={styles.detail}>{item.subtitle}</Text>
      </View>
      <Text style={styles.arrow} accessibilityElementsHidden>›</Text>
    </Pressable></Link>)}</View>;
}
