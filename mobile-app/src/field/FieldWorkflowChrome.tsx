import type { ReactNode } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BrandIcon } from '../design/BrandIcon.tsx';
import { palette } from '../design/tokens.ts';
import type { BrandIconName } from '../design/BrandIcon.tsx';
import { FieldFormNotice } from './FieldFormLayout.tsx';

export type FieldWorkflowId =
  | 'sales' | 'sales-edit' | 'sales-detail' | 'schedule' | 'roster'
  | 'deliveries' | 'trip-detail' | 'receiving' | 'receive-stop'
  | 'inventory' | 'count-new' | 'count-edit' | 'count-detail'
  | 'manager' | 'plan-detail';

type WorkflowGuide = {
  readonly title: string;
  readonly icon: BrandIconName;
  readonly hint: string;
  readonly reminder: string;
};

/** Context messages only. The existing field screens remain responsible for permission checks, API, validation and writes. */
const guides: Readonly<Record<FieldWorkflowId, WorkflowGuide>> = {
  sales: {
    title: 'Báo cáo bán hàng', icon: 'sales',
    hint: 'Kiểm tra đúng quầy và ca trước khi ghi nhận số liệu.',
    reminder: 'Nếu mạng gián đoạn sau khi gửi, kiểm tra báo cáo hiện có trước khi gửi lại.',
  },
  'sales-edit': {
    title: 'Nhập doanh thu', icon: 'sales',
    hint: 'Đối chiếu số liệu với chứng từ trước khi xác nhận.',
    reminder: 'Không gửi lại dữ liệu khi chưa xác minh kết quả lần gửi trước.',
  },
  'sales-detail': {
    title: 'Chi tiết báo cáo', icon: 'sales',
    hint: 'Đối chiếu đúng ngày, ca và quầy của báo cáo.',
    reminder: 'Các kết quả được xác nhận bởi nghiệp vụ trên màn hình, không phải hướng dẫn này.',
  },
  schedule: {
    title: 'Lịch làm việc', icon: 'schedule',
    hint: 'Kiểm tra ngày, quầy và ca được phân công trong hệ thống.',
    reminder: 'Nếu lịch thay đổi, ưu tiên thông tin hiển thị sau khi tải mới.',
  },
  roster: {
    title: 'Phân ca', icon: 'roster',
    hint: 'Đối chiếu quầy, ngày và nhân sự trước khi cập nhật phân ca.',
    reminder: 'Xác nhận kết quả trước khi thao tác lại trong trường hợp mạng yếu.',
  },
  deliveries: {
    title: 'Danh sách chuyến giao', icon: 'delivery',
    hint: 'Kiểm tra chuyến và các điểm giao trong danh sách được phân công.',
    reminder: 'Chỉ thao tác trên điện thoại khi phương tiện đã dừng an toàn.',
  },
  'trip-detail': {
    title: 'Chi tiết chuyến giao', icon: 'delivery',
    hint: 'Đối chiếu đúng điểm giao, hàng hóa và số lượng trước khi xác nhận.',
    reminder: 'Nếu xảy ra sai lệch, ghi nhận bằng chức năng nghiệp vụ được cấp quyền.',
  },
  receiving: {
    title: 'Danh sách nhận hàng', icon: 'receiving',
    hint: 'Kiểm tra chứng từ và điểm giao trước khi tiếp nhận.',
    reminder: 'Đối chiếu thực nhận thay vì mặc định bằng số lượng dự kiến.',
  },
  'receive-stop': {
    title: 'Kiểm hàng tại điểm giao', icon: 'receiving',
    hint: 'Xác nhận đúng chuyến, điểm dừng và số lượng thực tế.',
    reminder: 'Không xác nhận hoàn tất nếu còn sai lệch chưa được xử lý.',
  },
  inventory: {
    title: 'Tồn kho', icon: 'inventory',
    hint: 'Kiểm tra đúng quầy và thời điểm của số liệu tồn.',
    reminder: 'Phân biệt số liệu hiển thị với kết quả kiểm đếm thực tế.',
  },
  'count-new': {
    title: 'Tạo phiếu kiểm kê', icon: 'inventory',
    hint: 'Kiểm tra quầy, ca và số lượng thực đếm trước khi lưu.',
    reminder: 'Nếu mất mạng sau khi gửi, kiểm tra danh sách phiếu trước khi tạo lại.',
  },
  'count-edit': {
    title: 'Sửa phiếu kiểm kê', icon: 'inventory',
    hint: 'Đọc lại thông tin của phiếu trước khi điều chỉnh.',
    reminder: 'Chỉ cập nhật các trường nghiệp vụ cho phép chỉnh sửa.',
  },
  'count-detail': {
    title: 'Chi tiết kiểm kê', icon: 'inventory',
    hint: 'Đối chiếu phiếu, quầy và chênh lệch kiểm đếm.',
    reminder: 'Thông tin duyệt và trạng thái do hệ thống nghiệp vụ xác nhận.',
  },
  manager: {
    title: 'Quản lý khu vực', icon: 'manager',
    hint: 'Xem xét đúng khu vực và quầy trước khi xử lý nghiệp vụ.',
    reminder: 'Các quyết định phê duyệt phải thực hiện trong form nghiệp vụ tương ứng.',
  },
  'plan-detail': {
    title: 'Kế hoạch bổ sung', icon: 'manager',
    hint: 'Đối chiếu số lượng, điểm nhận và trạng thái của kế hoạch.',
    reminder: 'Không suy diễn trạng thái hoàn tất từ phần hướng dẫn.',
  },
};

/** Slim shared context strip for live field routes; never submits or alters business data. */
export function FieldWorkflowChrome({ workflow, children }: { workflow: FieldWorkflowId; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const info = guides[workflow];
  return <View style={styles.root}>
    <View style={styles.strip}>
      <View style={styles.iconBox}><BrandIcon name={info.icon} color={palette.primary} size={20} /></View>
      <Text allowFontScaling numberOfLines={1} style={styles.label}>{info.title}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? 'Ẩn' : 'Xem'} hướng dẫn: ${info.title}`}
        accessibilityState={{ expanded }} onPress={() => setExpanded(value => !value)}
        style={({ pressed }) => [styles.hintButton, pressed && styles.pressed]}>
        <Text allowFontScaling style={styles.hintLabel}>{expanded ? 'Thu gọn' : 'Lưu ý'}</Text>
      </Pressable>
    </View>
    {expanded ? <View style={styles.details}>
      <FieldFormNotice title="Trước khi thao tác" message={info.hint} />
      <FieldFormNotice tone="warning" title="Cần lưu ý" message={info.reminder} />
      <Text allowFontScaling style={styles.disclaimer}>Đây chỉ là hướng dẫn; xác nhận thực tế do màn hình nghiệp vụ và Backend xử lý.</Text>
    </View> : null}
    <View style={styles.content}>{children}</View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.canvas },
  strip: { minHeight: 49, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
    borderBottomColor: palette.border, borderBottomWidth: 1, backgroundColor: palette.beigeLight, gap: 8 },
  iconBox: { backgroundColor: palette.primarySoft, borderRadius: 10, width: 32, height: 32,
    justifyContent: 'center', alignItems: 'center' },
  label: { minWidth: 0, flex: 1, fontSize: 13, fontWeight: '800', color: palette.primary },
  hintButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 7, borderRadius: 10 },
  hintLabel: { color: palette.primary, fontWeight: '800', fontSize: 12 },
  pressed: { backgroundColor: palette.primarySoft },
  details: { borderBottomWidth: 1, borderBottomColor: palette.border, paddingHorizontal: 16,
    paddingVertical: 12, gap: 8, backgroundColor: palette.surface },
  hintText: { fontSize: 14, color: palette.ink, lineHeight: 21, fontWeight: '600' },
  reminderText: { fontSize: 13, color: palette.muted, lineHeight: 19 },
  disclaimer: { fontSize: 11, lineHeight: 16, color: palette.muted },
  content: { flex: 1 },
});
