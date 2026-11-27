import { Link, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandIcon } from '../design/BrandIcon.tsx';
import type { BrandIconName } from '../design/BrandIcon.tsx';
import { metrics, palette } from '../design/tokens.ts';

const tabs: readonly { href: '/' | '/work' | '/camera' | '/history' | '/account'; label: string; icon: BrandIconName }[] = [
  { href: '/', label: 'Trang chủ', icon: 'home' },
  { href: '/work', label: 'Công việc', icon: 'work' },
  { href: '/camera', label: 'Camera', icon: 'camera' },
  { href: '/history', label: 'Lịch sử', icon: 'history' },
  { href: '/account', label: 'Tài khoản', icon: 'account' },
];
const styles = StyleSheet.create({
  safe: { backgroundColor: palette.surface, borderTopWidth: 1, borderTopColor: palette.border },
  tabs: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', height: 70,
    paddingHorizontal: 5, overflow: 'visible' },
  tab: { flex: 1, minWidth: 0, height: 62, alignItems: 'center', justifyContent: 'center', gap: 4 },
  label: { fontSize: metrics.navLabel, lineHeight: 16, fontWeight: '600', textAlign: 'center' },
  fabTab: { height: 86, justifyContent: 'flex-start', paddingTop: 1 },
  fab: { width: metrics.cameraFab, height: metrics.cameraFab, borderRadius: 33, borderWidth: 4,
    borderColor: palette.surface, backgroundColor: palette.accent,
    alignItems: 'center', justifyContent: 'center', elevation: 5,
    shadowColor: '#481011', shadowOpacity: 0.19, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  fabLabel: { marginTop: -2 },
});
export function BrandBottomNav() {
  const path = usePathname();
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.safe}>
    <View style={styles.tabs}>
      {tabs.map(tab => {
        const center = tab.icon === 'camera';
        const selected = tab.href === '/' ? path === '/' || path === '/index'
          : tab.href === '/work' ? path === '/work' || path.startsWith('/field/')
            : path === tab.href;
        const color = selected ? palette.primary : palette.muted;
        return <Link href={tab.href} replace asChild key={tab.href}>
          <Pressable accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{ selected }}
            style={({ pressed }) => [styles.tab, center && styles.fabTab, pressed && { opacity: 0.72 }]}>
            {center ? <View style={styles.fab}><BrandIcon name="camera" size={31} color="#FFFFFF" /></View>
              : <BrandIcon name={tab.icon} size={metrics.navIcon} color={color} />}
            <Text allowFontScaling numberOfLines={1} style={[styles.label, center ? styles.fabLabel : undefined,
              { color: center ? palette.primary : color, fontWeight: selected ? '800' : '600' }]}>{tab.label}</Text>
          </Pressable>
        </Link>;
      })}
    </View>
  </SafeAreaView>;
}
