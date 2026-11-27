import { StyleSheet, Text, View } from 'react-native';
import { BrandIcon } from '../design/BrandIcon.tsx';
import { palette } from '../design/tokens.ts';
import { Copy, Header, Page, Panel } from './field.ui.tsx';

const styles = StyleSheet.create({
  feature: { backgroundColor: palette.accentSoft, borderRadius: 22, padding: 22, gap: 12,
    alignItems: 'center', justifyContent: 'center' },
  icon: { width: 74, height: 74, borderRadius: 23, backgroundColor: palette.accent,
    alignItems: 'center', justifyContent: 'center' },
  title: { color: palette.primary, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  body: { color: palette.ink, fontSize: 15, lineHeight: 23, textAlign: 'center' },
});
/** Intentionally no fake camera/QR capture or fake upload.
 * Phase D requires expo-camera, permissions, safe storage and verified backend upload contract.
 */
export function CameraHub() {
  return <Page title="Camera" lead="Trung tâm minh chứng hiện trường">
    <View style={styles.feature}>
      <View style={styles.icon}><BrandIcon name="camera" color="#FFFFFF" size={37} /></View>
      <Text allowFontScaling style={styles.title}>Một chạm để ghi lại công việc</Text>
      <Text allowFontScaling style={styles.body}>
        Nút Camera đã được đặt ở giữa thanh điều hướng. Phần chụp ảnh thật sẽ được kích hoạt sau khi hoàn tất quyền truy cập camera và quy trình lưu minh chứng.
      </Text>
    </View>
    <Header>Các nghiệp vụ dự kiến</Header>
    <Panel><Copy>• Ảnh giao hàng và nhận hàng</Copy><Copy>• Ảnh kiểm kê, hư hỏng hoặc chênh lệch</Copy><Copy>• Xem lại, chụp lại và xác nhận trước khi gửi</Copy><Copy>• Quét mã QR khi nghiệp vụ và API hỗ trợ</Copy></Panel>
    <Copy small>Hiện chưa có dữ liệu ảnh nào được chụp, lưu hoặc tải lên máy chủ từ màn hình này.</Copy>
  </Page>;
}
