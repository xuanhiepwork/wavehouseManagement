import { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createMobileAuthClient, MobileAuthError } from '../../auth/auth.api.ts';
import { BrandCard } from './BrandCard';
import { BrandButton } from './BrandButton';
import { palette, spacing, radii, typography } from './theme';

/** Visual replacement for the existing sign-in form. Authentication is NOT reimplemented. */
export function BrandSignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const onSignIn = useCallback(async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await createMobileAuthClient().signIn(email.trim(), password);
    } catch (cause) {
      setError(cause instanceof MobileAuthError ? cause.message : 'Không đăng nhập được. Vui lòng kiểm tra kết nối.');
    } finally {
      setPassword('');
      setBusy(false);
      lock.current = false;
    }
  }, [email, password]);

  return <SafeAreaView style={styles.root}>
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.wordmark}>
            <View style={styles.monogram}><Text style={styles.monogramText}>ĐL</Text></View>
            <View style={styles.brandCopy}>
              <Text style={styles.brandName}>ĐỘC LẬP</Text>
              <Text style={styles.brandSub}>CÀ PHÊ · NHÂN VIÊN</Text>
            </View>
          </View>
          <View style={styles.brandLine} />
          <Text allowFontScaling style={styles.headline}>{help ? 'Hỗ trợ đăng nhập' : 'Chào mừng trở lại'}</Text>
          <Text allowFontScaling style={styles.intro}>{help ? 'Giữ an toàn cho tài khoản công việc của bạn.' : 'Đăng nhập để xem ca làm và thực hiện công việc hôm nay.'}</Text>
        </View>

        <BrandCard style={styles.form}>
          {help ? <>
            <Text accessibilityRole="header" style={styles.formHeading}>Quên mật khẩu?</Text>
            <Text style={styles.info}>Tính năng tự khôi phục qua email chưa được hệ thống hỗ trợ. Hãy liên hệ quản lý hoặc quản trị viên để xác minh tài khoản và được hỗ trợ đổi mật khẩu.</Text>
            <BrandButton title="Quay lại đăng nhập" onPress={() => { setHelp(false); setError(''); }} fullWidth />
          </> : <>
            <Text accessibilityRole="header" style={styles.formHeading}>Tài khoản công việc</Text>
            <View style={styles.field}>
              <Text allowFontScaling style={styles.label}>Email</Text>
              <TextInput
                accessibilityLabel="Email làm việc" value={email} onChangeText={setEmail}
                placeholder="ten@congty.vn" placeholderTextColor={palette.textSecondary}
                autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email"
                editable={!busy} returnKeyType="next" style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <Text allowFontScaling style={styles.label}>Mật khẩu</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  accessibilityLabel="Mật khẩu" value={password} onChangeText={setPassword}
                  placeholder="Nhập mật khẩu" placeholderTextColor={palette.textSecondary}
                  autoCapitalize="none" autoComplete="current-password" secureTextEntry={!visible}
                  editable={!busy} returnKeyType="go" onSubmitEditing={() => { void onSignIn(); }}
                  style={styles.passwordInput}
                />
                <Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                  onPress={() => setVisible(v => !v)} style={styles.reveal}>
                  <Text style={styles.revealText}>{visible ? 'Ẩn' : 'Hiện'}</Text>
                </Pressable>
              </View>
            </View>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <BrandButton title="Đăng nhập" onPress={() => { void onSignIn(); }} fullWidth loading={busy} disabled={busy} />
            <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Quên mật khẩu"
              onPress={() => { setHelp(true); setError(''); }} style={styles.helpAction}>
              <Text allowFontScaling style={styles.helpText}>Quên mật khẩu?</Text>
            </Pressable>
          </>}
        </BrandCard>
        <Text allowFontScaling style={styles.foot}>Ứng dụng nội bộ ĐỘC LẬP Cà Phê. Không chia sẻ mật khẩu hoặc mã xác thực với người khác.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.canvas },
  content: { flexGrow: 1, justifyContent: 'center', width: '100%', maxWidth: 520, alignSelf: 'center', padding: spacing.md, paddingVertical: 28, gap: spacing.lg },
  hero: { backgroundColor: palette.burgundy, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.sm },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  monogram: { width: 50, height: 50, backgroundColor: palette.orange, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  monogramText: { color: palette.white, fontSize: 19, fontWeight: '900' },
  brandCopy: { flexShrink: 1, gap: 3 },
  brandName: { color: palette.white, fontSize: 21, fontWeight: '900', letterSpacing: 0.5 },
  brandSub: { color: palette.coffeeCream, fontSize: typography.caption, fontWeight: '800', letterSpacing: 1 },
  brandLine: { height: 4, width: 54, borderRadius: 3, backgroundColor: palette.orange, marginTop: 12 },
  headline: { color: palette.white, fontSize: 25, lineHeight: 33, fontWeight: '800' },
  intro: { color: '#F7E7DA', fontSize: 15, lineHeight: 23 },
  form: { gap: 16, padding: spacing.lg },
  formHeading: { color: palette.burgundy, fontSize: 19, fontWeight: '800' },
  field: { gap: 7 },
  label: { fontSize: 15, fontWeight: '700', color: palette.text },
  input: { minHeight: 54, borderWidth: 1, borderColor: palette.border, borderRadius: radii.md, backgroundColor: palette.white, color: palette.text, fontSize: 16, paddingHorizontal: spacing.md },
  passwordRow: { flexDirection: 'row', borderWidth: 1, borderColor: palette.border, borderRadius: radii.md, alignItems: 'center', backgroundColor: palette.white },
  passwordInput: { flex: 1, minHeight: 52, minWidth: 0, paddingHorizontal: spacing.md, color: palette.text, fontSize: 16 },
  reveal: { minWidth: 56, minHeight: 52, paddingHorizontal: 10, justifyContent: 'center', alignItems: 'center' },
  revealText: { color: palette.burgundy, fontSize: 14, fontWeight: '800' },
  error: { color: palette.danger, fontSize: 14, lineHeight: 21 },
  info: { color: palette.text, backgroundColor: palette.subtle, borderRadius: radii.md, padding: spacing.md, fontSize: 15, lineHeight: 23 },
  helpAction: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  helpText: { color: palette.burgundy, fontWeight: '800', fontSize: 14 },
  foot: { color: palette.textSecondary, fontSize: 12, lineHeight: 19, textAlign: 'center' },
});
