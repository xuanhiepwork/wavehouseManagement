import { useSyncExternalStore } from 'react';
import { StyleSheet, Text } from 'react-native';
import { getAuthSnapshot, subscribeAuth } from '../../auth/session.ts';
import { WorkGrid } from '../../navigation/WorkCards.tsx';
import { historyItemsFor, roleLabel } from '../../navigation/work-items.ts';
import { BrandCard } from './BrandCard';
import { BrandHubLayout, BrandSectionTitle } from './BrandHubLayout';
import { palette, spacing } from './theme';

/** These are existing record-list routes, NOT a fabricated chronological audit feed. */
export function BrandHistoryScreen() {
  const { user } = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  if (!user) return null;
  const items = historyItemsFor(user);
  return <BrandHubLayout eyebrow="ĐỘC LẬP · LỊCH SỬ" title="Tra cứu công việc"
    description={`${roleLabel(user)} · Xem danh sách báo cáo, giao nhận và kiểm kê có sẵn trong hệ thống`}
    footer="Lịch sử tại đây là các đường dẫn tới danh sách nghiệp vụ hiện có; không phải nhật ký hoạt động thời gian thực.">
    <BrandSectionTitle subtitle="Mở màn hình nghiệp vụ để lọc hoặc xem chi tiết dữ liệu">Danh sách có thể tra cứu</BrandSectionTitle>
    {items.length ? <WorkGrid items={items} /> : <BrandCard><Text style={styles.copy}>Chưa có danh sách lịch sử phù hợp với quyền của bạn.</Text></BrandCard>}
    <BrandCard variant="subtle" style={styles.note}>
      <Text style={styles.noteTitle}>Lưu ý khi xem lịch sử</Text>
      <Text style={styles.copy}>Thông tin hiển thị được lấy từ các màn hình nghiệp vụ. Trạng thái cập nhật phụ thuộc kết nối máy chủ và quyền tài khoản.</Text>
    </BrandCard>
  </BrandHubLayout>;
}
const styles = StyleSheet.create({
  note: { gap: spacing.xs },
  noteTitle: { fontSize: 15, fontWeight: '800', color: palette.burgundy },
  copy: { color: palette.textSecondary, fontSize: 14, lineHeight: 22 },
});
