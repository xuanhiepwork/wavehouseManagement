import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BrandIcon } from '../design/BrandIcon.tsx';
import { palette } from '../design/tokens.ts';
import type { WorkItem } from './work-items.ts';

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexBasis: '46%', flexGrow: 1, minWidth: 138, minHeight: 136,
    backgroundColor: palette.surface, borderRadius: 18, borderWidth: 1, borderColor: palette.border,
    padding: 15, justifyContent: 'space-between', gap: 8 },
  icon: { width: 42, height: 42, borderRadius: 13, justifyContent: 'center', alignItems: 'center',
    backgroundColor: palette.accentSoft },
  title: { fontSize: 16, lineHeight: 22, color: palette.ink, fontWeight: '800' },
  detail: { fontSize: 13, lineHeight: 18, color: palette.muted },
  recommend: { minHeight: 70, backgroundColor: palette.surface, borderRadius: 16, borderColor: palette.border,
    borderWidth: 1, paddingHorizontal: 15, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12 },
  recommendIcon: { backgroundColor: palette.primarySoft, height: 42, width: 42,
    borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 3 }, arrow: { fontSize: 25, fontWeight: '500', color: palette.primary },
});
export function WorkGrid({ items }: { items: readonly WorkItem[] }) {
  return <View style={styles.grid}>{items.map(item =>
    <Link key={item.href} href={item.href as Href} asChild><Pressable accessibilityRole="link"
      accessibilityLabel={`${item.title}. ${item.subtitle}`}
      style={({ pressed }) => [styles.tile, pressed && { borderColor: palette.accent, backgroundColor: palette.beigeLight }]}>
      <View style={styles.icon}><BrandIcon name={item.icon} color={palette.primary} size={25} /></View>
      <View style={{ gap: 3 }}>
        <Text allowFontScaling style={styles.title}>{item.title}</Text>
        <Text allowFontScaling style={styles.detail}>{item.subtitle}</Text>
      </View>
    </Pressable></Link>)}</View>;
}
export function SuggestedList({ items }: { items: readonly WorkItem[] }) {
  return <View style={{ gap: 10 }}>{items.map(item =>
    <Link key={item.href} href={item.href as Href} asChild><Pressable accessibilityRole="link"
      accessibilityLabel={`${item.title}. ${item.subtitle}`}
      style={({ pressed }) => [styles.recommend, pressed && { backgroundColor: palette.primarySoft }]}>
      <View style={styles.recommendIcon}><BrandIcon name={item.icon} color={palette.primary} size={23} /></View>
      <View style={styles.info}>
        <Text allowFontScaling style={styles.title}>{item.title}</Text>
        <Text allowFontScaling style={styles.detail}>{item.subtitle}</Text>
      </View>
      <Text style={styles.arrow} accessibilityElementsHidden>›</Text>
    </Pressable></Link>)}</View>;
}
