import { Link } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { palette } from '../design/tokens.ts';
import { WorkGrid, SuggestedList } from '../navigation/WorkCards.tsx';
import { roleLabel, suggestedItems, workItemsFor } from '../navigation/work-items.ts';
import { fieldApi } from './field.api.ts';
import { Header, Panel, Page, Copy, Warning, LoadControl, Status, businessToday, formatShift, useFieldRead } from './field.ui.tsx';
import type { WorkContext } from './field.types.ts';

const styles = StyleSheet.create({
  hero: { borderRadius: 21, backgroundColor: palette.primary, padding: 21, gap: 9, overflow: 'hidden' },
  brand: { fontSize: 13, fontWeight: '900', color: palette.beige, letterSpacing: 1.3 },
  hello: { fontSize: 26, lineHeight: 33, fontWeight: '900', color: '#FFFFFF' },
  heroDetail: { fontSize: 15, lineHeight: 23, color: '#FFEDE4' },
  accent: { height: 5, width: 55, borderRadius: 3, backgroundColor: palette.accent },
  section: { marginTop: 4, marginBottom: 0 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  more: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 5 },
  moreText: { fontSize: 14, color: palette.primary, fontWeight: '800' },
});
export function FieldHome() {
  const { user } = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  const day = businessToday();
  const sales = user?.role === 'STAFF' && user.workKind === 'SALES';
  const courier = user?.role === 'STAFF' && user.workKind === 'KITCHEN_DELIVERY';
  const manager = user?.role === 'BRANCH_MANAGER' || user?.role === 'ADMIN';
  const read = useFieldRead(useCallback((signal: AbortSignal) => sales ? fieldApi.workContext(day, signal)
    : Promise.resolve<WorkContext>({ branches: [], assignments: [] }), [sales, day]));
  if (!user) return null;
  const work = workItemsFor(user);
  return <Page title="Trang chủ" lead={`${day} · ${roleLabel(user)}`}>
    <View style={styles.hero}>
      <Text allowFontScaling style={styles.brand}>ĐỘC LẬP · CÀ PHÊ</Text>
      <View style={styles.accent} />
      <Text allowFontScaling style={styles.hello} numberOfLines={2}>
        {manager ? 'Công việc trong tầm tay' : courier ? 'Chúc bạn một chuyến giao thuận lợi' : 'Chào mừng đến ca làm'}
      </Text>
      <Text allowFontScaling style={styles.heroDetail}>
        {manager ? 'Theo dõi các quầy và ưu tiên xử lý công việc cần duyệt.'
          : courier ? 'Kiểm tra chứng từ và xác nhận giao nhận khi đã dừng xe an toàn.'
            : 'Xem ca làm, cập nhật doanh thu và theo dõi hàng hóa dễ dàng.'}
      </Text>
    </View>
    <View style={styles.section}><Header>Thông tin hôm nay</Header></View>
    <Panel>
      {sales ? <>
        <Copy small>Ca làm được lấy theo phân công của hệ thống.</Copy>
        {read.value?.assignments.length ? read.value.assignments.map((assignment, index) =>
          <Status key={`${assignment.branchId}-${assignment.shift}-${index}`}>
            {read.value?.branches.find(branch => branch.id === assignment.branchId)?.name ?? 'Quầy'} · {formatShift(assignment.shift)}
          </Status>) : !read.loading && !read.error ? <Copy>Chưa có ca được phân công hôm nay.</Copy> : null}
        <LoadControl loading={read.loading} error={read.error} onRefresh={() => { void read.refresh(); }} />
      </> : courier ? <Warning>Vì an toàn, chỉ xem và cập nhật chuyến giao khi đã dừng xe.</Warning>
        : manager ? <Copy>Kiểm tra các báo cáo và sai lệch cần xử lý trước khi kết thúc ngày.</Copy>
          : <Copy>Chưa có nhóm công việc phù hợp. Vui lòng liên hệ quản lý.</Copy>}
    </Panel>
    <View style={[styles.section, styles.row]}>
      <Header>Công việc của bạn</Header>
      <Link href="/work" asChild><Pressable accessibilityRole="link" accessibilityLabel="Xem tất cả công việc"
        style={styles.more}><Text style={styles.moreText}>Xem tất cả ›</Text></Pressable></Link>
    </View>
    {work.length > 0 ? <WorkGrid items={work.slice(0, 4)} /> : <Panel><Copy>Chưa có công việc được cấp quyền.</Copy></Panel>}
    <View style={styles.section}><Header>Độc Lập đề xuất</Header></View>
    <SuggestedList items={suggestedItems()} />
    <Copy small>Mạng yếu? Kiểm tra trạng thái trước khi gửi lại một thao tác ghi dữ liệu. Ứng dụng không tự gửi lại thao tác ghi.</Copy>
  </Page>;
}
