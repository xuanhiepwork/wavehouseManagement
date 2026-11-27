import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { palette, metrics } from '../design/tokens.ts';
import { BrandBottomNav } from '../navigation/BrandBottomNav.tsx';
import { roleLabel } from '../navigation/work-items.ts';
import { Link } from 'expo-router';
import { createMobileAuthClient, MobileAuthError } from './auth.api.ts';
import { getAuthSnapshot, subscribeAuth } from './session.ts';

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: palette.canvas },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 30 },
  content: { width: '100%', maxWidth: 460, alignSelf: 'center', gap: 22 },
  markRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.primary, alignItems: 'center', justifyContent: 'center' },
  markText: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
  brand: { color: palette.ink, fontWeight: '800', fontSize: 19 },
  brandSub: { color: palette.muted, fontSize: 13, fontWeight: '600', letterSpacing: 0.7 },
  headingArea: { gap: 8 },
  heading: { color: palette.ink, fontSize: 30, fontWeight: '800', lineHeight: 38 },
  help: { color: palette.muted, fontSize: 16, lineHeight: 24 },
  card: { backgroundColor: palette.surface, padding: 22, borderRadius: 22, borderWidth: 1, borderColor: palette.border, gap: 17 },
  field: { gap: 8 },
  label: { color: palette.ink, fontWeight: '700', fontSize: 15 },
  input: { minHeight: 54, backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1.5,
    borderRadius: 13, paddingHorizontal: 15, color: palette.ink, fontSize: 17 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: palette.border, borderRadius: 13 },
  passwordInput: { flex: 1, minWidth: 0, borderWidth: 0 },
  reveal: { minWidth: 62, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  revealText: { color: palette.primary, fontSize: 15, fontWeight: '700' },
  primary: { minHeight: 56, borderRadius: 14, backgroundColor: palette.primary,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  primaryText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  textButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  textButtonLabel: { color: palette.primary, fontWeight: '700', fontSize: 15 },
  notice: { padding: 15, borderRadius: 13, backgroundColor: palette.primarySoft, gap: 6 },
  noticeText: { color: palette.ink, fontSize: 15, lineHeight: 23 },
  error: { color: palette.danger, fontSize: 15, lineHeight: 22 },
  foot: { color: palette.muted, fontSize: 13, lineHeight: 21, textAlign: 'center' },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10,
    paddingHorizontal: 18, paddingVertical: 10, backgroundColor: palette.surface,
    borderBottomWidth: 1, borderBottomColor: palette.border, minHeight: 66 },
  badge: { width: 40, height: 40, borderRadius: 14, backgroundColor: palette.primarySoft,
    alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: palette.primary, fontWeight: '900', fontSize: 15 },
  account: { flex: 1, minWidth: 0, gap: 3 },
  accountName: { color: palette.ink, fontSize: 15, fontWeight: '800' },
  accountRole: { color: palette.muted, fontSize: 12 },
  signOut: { minHeight: metrics.touch, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 12,
    borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  signOutText: { color: palette.primary, fontSize: 14, fontWeight: '800' },
});

function Brand() {
  return <View style={styles.markRow}>
    <View style={styles.mark}><Text style={styles.markText}>ĐL</Text></View>
    <View>
      <Text allowFontScaling style={styles.brand}>ĐỘC LẬP</Text>
      <Text allowFontScaling style={styles.brandSub}>CÀ PHÊ · ỨNG DỤNG NHÂN VIÊN</Text>
    </View>
  </View>;
}

function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const signIn = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await createMobileAuthClient().signIn(email.trim(), password);
    } catch (cause) {
      setError(cause instanceof MobileAuthError ? cause.message : 'Không đăng nhập được. Vui lòng kiểm tra kết nối.');
    } finally {
      lock.current = false;
      setPassword('');
      setBusy(false);
    }
  }, [email, password]);

  return <SafeAreaView style={styles.frame}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.frame}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Brand />
          <View style={styles.headingArea}>
            <Text allowFontScaling accessibilityRole="header" style={styles.heading}>
              {forgotPassword ? 'Cần hỗ trợ mật khẩu?' : 'Chào mừng trở lại'}
            </Text>
            <Text allowFontScaling style={styles.help}>
              {forgotPassword ? 'Bảo vệ tài khoản làm việc của bạn.' : 'Đăng nhập để xem ca làm và công việc hôm nay.'}
            </Text>
          </View>
          {forgotPassword ? <View style={styles.card}>
            <Text allowFontScaling style={styles.label}>Hỗ trợ khôi phục tài khoản</Text>
            <View style={styles.notice}>
              <Text allowFontScaling style={styles.noticeText}>
                Chức năng tự đặt lại mật khẩu qua email chưa được hỗ trợ. Vui lòng liên hệ quản lý hoặc quản trị viên để được xác minh và hỗ trợ đổi mật khẩu theo quy trình nội bộ.
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Quay lại đăng nhập"
              onPress={() => { setForgotPassword(false); setError(''); }}
              style={({ pressed }) => [styles.primary, pressed && { backgroundColor: palette.primaryPressed }]}>
              <Text allowFontScaling style={styles.primaryText}>Quay lại đăng nhập</Text>
            </Pressable>
          </View> : <View style={styles.card}>
            <View style={styles.field}>
              <Text allowFontScaling style={styles.label}>Email làm việc</Text>
              <TextInput allowFontScaling accessibilityLabel="Email" value={email} onChangeText={setEmail}
                placeholder="ten@congty.vn" keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                autoComplete="email" editable={!busy} placeholderTextColor={palette.muted} style={styles.input} />
            </View>
            <View style={styles.field}>
              <Text allowFontScaling style={styles.label}>Mật khẩu</Text>
              <View style={styles.passwordRow}>
                <TextInput allowFontScaling accessibilityLabel="Mật khẩu" value={password} onChangeText={setPassword}
                  placeholder="Nhập mật khẩu" secureTextEntry={!showPassword} autoCapitalize="none"
                  autoComplete="current-password" editable={!busy} onSubmitEditing={() => { void signIn(); }}
                  placeholderTextColor={palette.muted} style={[styles.input, styles.passwordInput]} />
                <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  onPress={() => setShowPassword(v => !v)} style={styles.reveal}>
                  <Text allowFontScaling style={styles.revealText}>{showPassword ? 'Ẩn' : 'Hiện'}</Text>
                </Pressable>
              </View>
            </View>
            {error ? <Text allowFontScaling accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Đăng nhập" accessibilityState={{ disabled: busy }} disabled={busy}
              onPress={() => { void signIn(); }}
              style={({ pressed }) => [styles.primary, (busy || pressed) && { opacity: 0.75 }]}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text allowFontScaling style={styles.primaryText}>Đăng nhập</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Quên mật khẩu" disabled={busy}
              onPress={() => { setForgotPassword(true); setError(''); }} style={styles.textButton}>
              <Text allowFontScaling style={styles.textButtonLabel}>Quên mật khẩu?</Text>
            </Pressable>
          </View>}
          <Text allowFontScaling style={styles.foot}>Ứng dụng nội bộ ĐỘC LẬP Cà Phê. Không chia sẻ mật khẩu với người khác.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

/** Route-level guard: no operational API is mounted without an active session. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { user } = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  if (!user) return <SignInScreen />;
  return <View style={styles.frame}>
    <View style={styles.bar}>
      <View style={styles.badge}><Text style={styles.badgeText}>ĐL</Text></View>
      <View style={styles.account}>
        <Text allowFontScaling numberOfLines={1} style={styles.accountName}>ĐỘC LẬP Cà Phê</Text>
        <Text allowFontScaling numberOfLines={1} style={styles.accountRole}>{roleLabel(user)} · {user.displayName}</Text>
      </View>
      <Link href="/account" asChild><Pressable accessibilityRole="link" accessibilityLabel="Mở tài khoản của tôi"
        style={styles.signOut}><Text allowFontScaling style={styles.signOutText}>Tôi</Text></Pressable></Link>
    </View>
    <View style={{ flex: 1 }}>{children}</View>
    <BrandBottomNav />
  </View>;
}
