import { useSyncExternalStore } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { getAuthSnapshot, subscribeAuth, clearAuthSession } from '../auth/session.ts';
import { createMobileAuthClient } from '../auth/auth.api.ts';
import { roleLabel } from '../navigation/work-items.ts';
import { palette } from '../design/tokens.ts';
import { Copy, Header, Page, Panel } from './field.ui.tsx';

const styles = StyleSheet.create({
  name: { fontSize: 20, lineHeight: 28, color: palette.ink, fontWeight: '800' },
  label: { fontSize: 13, fontWeight: '600', color: palette.muted },
  value: { fontSize: 16, lineHeight: 23, color: palette.ink },
  line: { gap: 4, paddingVertical: 4 },
  logout: { minHeight: 54, backgroundColor: palette.surface, borderWidth: 1.5,
    borderColor: palette.primary, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  logoutText: { color: palette.primary, fontSize: 16, fontWeight: '800' },
});
function signOut() {
  Alert.alert('Đăng xuất?', 'Bạn cần đăng nhập lại để tiếp tục công việc.', [
    { text: 'Ở lại', style: 'cancel' },
    { text: 'Đăng xuất', style: 'destructive', onPress: () => {
      try { void createMobileAuthClient().signOut().catch(() => { clearAuthSession(); }); }
      catch { clearAuthSession(); }
    } },
  ]);
}
export function AccountHub() {
  const { user } = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  if (!user) return null;
  return <Page title="Tài khoản" lead="Thông tin công việc và hỗ trợ">
    <Panel>
      <Text allowFontScaling style={styles.name}>{user.displayName}</Text>
      <Text allowFontScaling style={styles.label}>{roleLabel(user)}</Text>
      <View style={styles.line}><Text style={styles.label}>Email làm việc</Text>
        <Text allowFontScaling selectable style={styles.value}>{user.email}</Text></View>
    </Panel>
    <Header>Bảo mật & hỗ trợ</Header>
    <Panel>
      <Copy>Để đổi hoặc đặt lại mật khẩu, vui lòng liên hệ quản lý hoặc quản trị viên theo quy trình xác minh nội bộ.</Copy>
      <Copy small>Chức năng đặt lại mật khẩu tự động chưa có API Backend; ứng dụng không giả lập gửi email.</Copy>
    </Panel>
    <Pressable accessibilityRole="button" accessibilityLabel="Đăng xuất" onPress={signOut}
      style={({ pressed }) => [styles.logout, pressed && { backgroundColor: palette.primarySoft }]}>
      <Text allowFontScaling style={styles.logoutText}>Đăng xuất</Text>
    </Pressable>
    <Copy small>ĐỘC LẬP Cà Phê · Ứng dụng nội bộ dành cho nhân viên.</Copy>
  </Page>;
}
