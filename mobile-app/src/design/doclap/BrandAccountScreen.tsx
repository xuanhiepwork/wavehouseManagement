import { useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { createMobileAuthClient } from '../../auth/auth.api.ts';
import { clearAuthSession, getAuthSnapshot, subscribeAuth } from '../../auth/session.ts';
import { roleLabel } from '../../navigation/work-items.ts';
import { BrandBadge } from './BrandBadge';
import { BrandCard } from './BrandCard';
import { BrandButton } from './BrandButton';
import { BrandHubLayout, BrandSectionTitle } from './BrandHubLayout';
import { controls, palette, radii, spacing, typography } from './theme';

function AccountRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}>
    <Text style={styles.rowLabel}>{label}</Text>
    <Text selectable style={styles.rowValue}>{value}</Text>
  </View>;
}

/** Uses the current authenticated identity only; no invented profile-edit endpoint. */
export function BrandAccountScreen() {
  const { user } = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  if (!user) return null;

  const doSignOut = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await createMobileAuthClient().signOut();
    } catch {
      // Configuration may be unavailable: local sign-out still takes priority.
      clearAuthSession();
    } finally {
      lock.current = false;
      setBusy(false);
      router.replace('/');
    }
  };

  const confirmSignOut = () => Alert.alert(
    'Đăng xuất khỏi ĐỘC LẬP?',
    'Bạn cần đăng nhập lại để tiếp tục làm việc.',
    [{ text: 'Ở lại', style: 'cancel' }, { text: 'Đăng xuất', style: 'destructive', onPress: () => { void doSignOut(); } }],
  );

  return <BrandHubLayout eyebrow="ĐỘC LẬP · TÀI KHOẢN" title="Thông tin của bạn"
    description="Xem tài khoản đăng nhập và những khu vực công việc được phân quyền."
    footer="Thông tin tài khoản được lấy từ phiên đăng nhập hiện tại. Không chia sẻ mật khẩu hoặc mã xác thực.">
    <BrandCard style={styles.profile}>
      <View style={styles.identity}>
        <View style={styles.avatar}><Text style={styles.avatarLabel}>ĐL</Text></View>
        <View style={styles.identityText}>
          <Text allowFontScaling style={styles.name}>{user.displayName}</Text>
          <Text allowFontScaling style={styles.email}>{user.email}</Text>
        </View>
      </View>
      <BrandBadge label={roleLabel(user)} tone="info" />
    </BrandCard>
    <BrandSectionTitle subtitle="Chỉ các thông tin mà hệ thống xác thực đã cung cấp">Phân quyền và phiên làm việc</BrandSectionTitle>
    <BrandCard style={styles.details}>
      <AccountRow label="Vai trò" value={roleLabel(user)} />
      <View style={styles.divider} />
      <AccountRow label="Khu vực phụ trách" value={user.areaId ? 'Đã gán khu vực' : 'Chưa gán khu vực'} />
      <View style={styles.divider} />
      <AccountRow label="Quầy trực thuộc" value={user.branchId ? 'Đã gán quầy' : 'Không gắn quầy cố định'} />
      <View style={styles.divider} />
      <AccountRow label="Phiên đăng nhập" value="Đang hoạt động" />
    </BrandCard>
    <BrandSectionTitle>Điều hướng nhanh</BrandSectionTitle>
    <View style={styles.links}>
      <Pressable accessibilityRole="button" accessibilityLabel="Mở danh sách công việc" onPress={() => router.push('/work')} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
        <Text style={styles.linkText}>Công việc của tôi</Text><Text style={styles.arrow}>›</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Mở lịch sử" onPress={() => router.push('/history')} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
        <Text style={styles.linkText}>Tra cứu lịch sử</Text><Text style={styles.arrow}>›</Text>
      </Pressable>
    </View>
    <BrandCard variant="subtle"><Text style={styles.security}>Vì an toàn, phiên xác thực chỉ được giữ trong bộ nhớ của ứng dụng. Đăng xuất sẽ kết thúc phiên trên thiết bị này.</Text></BrandCard>
    <BrandButton title="Đăng xuất" variant="outline" disabled={busy} loading={busy} onPress={confirmSignOut} fullWidth />
  </BrandHubLayout>;
}

const styles = StyleSheet.create({
  profile: { gap: spacing.md },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 58, height: 58, borderRadius: 19, backgroundColor: palette.burgundy, alignItems: 'center', justifyContent: 'center' },
  avatarLabel: { color: palette.white, fontWeight: '900', fontSize: 20 },
  identityText: { flex: 1, minWidth: 0, gap: 4 },
  name: { fontWeight: '800', fontSize: typography.bodyLarge, color: palette.burgundy },
  email: { fontSize: typography.label, color: palette.textSecondary },
  details: { gap: spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  rowLabel: { color: palette.textSecondary, fontSize: typography.label, flexShrink: 1 },
  rowValue: { color: palette.text, fontSize: typography.label, fontWeight: '700', textAlign: 'right', flexShrink: 1 },
  divider: { height: 1, backgroundColor: palette.border },
  links: { gap: spacing.sm },
  link: { minHeight: controls.buttonHeight, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center' },
  linkText: { flex: 1, fontWeight: '700', fontSize: typography.body, color: palette.burgundy },
  arrow: { fontWeight: '600', fontSize: 27, color: palette.burgundy },
  security: { fontSize: typography.label, lineHeight: 22, color: palette.textSecondary },
  pressed: { backgroundColor: palette.subtle },
});
