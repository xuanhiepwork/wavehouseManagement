import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { getAuthSnapshot, subscribeAuth } from './session.ts';
import { BrandBottomNav } from '../navigation/BrandBottomNav.tsx';
import { roleLabel } from '../navigation/work-items.ts';
import { BrandSignIn } from '../design/doclap/BrandSignIn';
import { palette } from '../design/tokens.ts';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.canvas },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 62, paddingHorizontal: 16,
    backgroundColor: palette.surface, borderBottomWidth: 1, borderBottomColor: palette.border },
  monogram: { width: 42, height: 42, borderRadius: 13, backgroundColor: palette.primary, justifyContent: 'center', alignItems: 'center' },
  monogramText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  identity: { flex: 1, minWidth: 0, gap: 3 },
  brand: { color: palette.primary, fontWeight: '900', fontSize: 16 },
  detail: { color: palette.muted, fontSize: 12 },
  account: { minWidth: 52, minHeight: 48, borderColor: palette.border, borderWidth: 1, borderRadius: 13, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  accountText: { color: palette.primary, fontSize: 14, fontWeight: '800' },
});

/** Keep the same route-level auth boundary and unchanged session implementation. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user } = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  if (!user) return <BrandSignIn />;
  return <View style={styles.root}>
    <View style={styles.header}>
      <View style={styles.monogram}><Text style={styles.monogramText}>ĐL</Text></View>
      <View style={styles.identity}>
        <Text allowFontScaling numberOfLines={1} style={styles.brand}>ĐỘC LẬP Cà Phê</Text>
        <Text allowFontScaling numberOfLines={1} style={styles.detail}>{roleLabel(user)} · {user.displayName}</Text>
      </View>
      <Link href="/account" asChild>
        <Pressable accessibilityRole="link" accessibilityLabel="Mở tài khoản của tôi" style={styles.account}>
          <Text allowFontScaling style={styles.accountText}>Tôi</Text>
        </Pressable>
      </Link>
    </View>
    <View style={{ flex: 1 }}>{children}</View>
    <BrandBottomNav />
  </View>;
}
