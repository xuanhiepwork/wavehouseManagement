import { useRouter, type Href } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { BrandIcon } from '../design/BrandIcon.tsx';
import { BrandCard } from '../design/doclap/BrandCard.tsx';
import { BrandDashboard, type DashboardAction } from '../design/doclap/BrandDashboard.tsx';
import { palette as brandPalette } from '../design/doclap/theme.ts';
import { fieldApi } from './field.api.ts';
import { Copy, LoadControl, Status, Warning, businessToday, formatShift, useFieldRead } from './field.ui.tsx';
import type { WorkContext } from './field.types.ts';
import { displayBusinessDay, liveHomeFor } from './home-model.ts';
import type { WorkItem } from '../navigation/work-items.ts';

const styles = StyleSheet.create({
  dailyCard: { gap: 11 },
  assignmentGroup: { gap: 8 },
  assignmentTitle: { color: brandPalette.burgundy, fontSize: 15, fontWeight: '800' },
});

/** One source of truth for destination paths is navigation/work-items.ts. */
function toActions(items: readonly WorkItem[]): DashboardAction[] {
  return items.map((item) => ({
    id: item.href,
    title: item.title,
    description: item.subtitle,
    icon: <BrandIcon name={item.icon} color={brandPalette.burgundy} size={26} />,
  }));
}

/** Live, signed-in Home: role-specific links plus the existing real shift API read. */
export function FieldHome() {
  const { user } = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  const router = useRouter();
  const day = businessToday();
  const sales = user?.role === 'STAFF' && user.workKind === 'SALES';
  const courier = user?.role === 'STAFF' && user.workKind === 'KITCHEN_DELIVERY';
  const manager = user?.role === 'ADMIN' || user?.role === 'BRANCH_MANAGER';

  // Preserve the existing behavior: sales assignments come from the real API,
  // while other roles do not trigger a sales-specific operational request.
  const read = useFieldRead(useCallback((signal: AbortSignal) => sales
    ? fieldApi.workContext(day, signal)
    : Promise.resolve<WorkContext>({ branches: [], assignments: [] }), [sales, day]));

  if (!user) return null;
  const model = liveHomeFor(user);
  const destinations = [...model.work, ...model.recommendations];
  const onActionPress = (action: DashboardAction) => {
    const destination = destinations.find((item) => item.href === action.id);
    if (destination) router.push(destination.href as Href);
  };

  const todayContent = (
    <BrandCard style={styles.dailyCard}>
      {sales ? <>
        <Copy small>Ca làm được lấy theo phân công thực tế từ hệ thống.</Copy>
        {read.value?.assignments.length ? (
          <View style={styles.assignmentGroup}>
            {read.value.assignments.map((assignment, index) => (
              <View key={`${assignment.branchId}-${assignment.shift}-${index}`} style={styles.assignmentGroup}>
                <Text allowFontScaling style={styles.assignmentTitle}>
                  {read.value?.branches.find((branch) => branch.id === assignment.branchId)?.name ?? 'Quầy'}
                </Text>
                <Status>{formatShift(assignment.shift)}</Status>
              </View>
            ))}
          </View>
        ) : !read.loading && !read.error ? <Copy>Chưa có ca được phân công hôm nay.</Copy> : null}
        <LoadControl loading={read.loading} error={read.error} onRefresh={() => { void read.refresh(); }} />
      </> : courier ? (
        <Warning>Vì an toàn, chỉ xem hoặc cập nhật chuyến giao khi đã dừng xe.</Warning>
      ) : manager ? (
        <Copy>Mở mục Công việc để theo dõi báo cáo, kiểm kê và các nghiệp vụ cần xử lý. Chưa có số liệu tổng hợp trực tiếp trên Trang chủ.</Copy>
      ) : (
        <Copy>Chưa có nhóm công việc phù hợp. Vui lòng liên hệ quản lý.</Copy>
      )}
    </BrandCard>
  );

  return (
    <BrandDashboard
      displayName={user.displayName}
      roleLabel={model.roleLabel}
      dayLabel={displayBusinessDay(day)}
      heroDescription={model.heroDescription}
      todayContent={todayContent}
      actions={toActions(model.work.slice(0, 4))}
      recommendations={toActions(model.recommendations)}
      onActionPress={onActionPress}
      onViewAllWork={() => router.push('/work')}
      footerNote="Mạng yếu? Hãy kiểm tra kết quả trước khi gửi lại thao tác ghi dữ liệu. Ứng dụng không tự gửi lại thao tác ghi."
    />
  );
}
