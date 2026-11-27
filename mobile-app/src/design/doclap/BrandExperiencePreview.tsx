import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandBadge } from './BrandBadge';
import { BrandBottomNav } from './BrandBottomNav';
import { BrandCard } from './BrandCard';
import { BrandDashboard, type DashboardAction, type DashboardNotice } from './BrandDashboard';
import { BrandHeader } from './BrandHeader';
import { BrandNavIcon } from './BrandNavIcon';
import { BrandScreenShell } from './BrandScreenShell';
import type { TabItem } from './navigation';
import { controls, palette, radii, spacing, typography } from './theme';

type PreviewRole = 'sales' | 'courier' | 'manager';

const roles: { id: PreviewRole; label: string }[] = [
  { id: 'sales', label: 'Bán hàng' },
  { id: 'courier', label: 'Giao hàng' },
  { id: 'manager', label: 'Quản lý khu' },
];

const roleName: Record<PreviewRole, string> = {
  sales: 'Nhân viên bán hàng',
  courier: 'Nhân viên kho / giao hàng',
  manager: 'Quản lý khu vực',
};

const actionDefinitions: Record<PreviewRole, { id: string; title: string; short: string }[]> = {
  sales: [
    { id: 'sale', title: 'Bán hàng', short: 'BH' },
    { id: 'shift', title: 'Ca làm', short: 'CA' },
    { id: 'stock', title: 'Tồn tại quầy', short: 'TK' },
    { id: 'receive', title: 'Nhận hàng', short: 'NH' },
    { id: 'report-damage', title: 'Báo thiếu / hỏng', short: 'BC' },
    { id: 'sales-report', title: 'Báo cáo cuối ca', short: 'DT' },
  ],
  courier: [
    { id: 'trips', title: 'Chuyến giao', short: 'CG' },
    { id: 'route', title: 'Chi tiết tuyến', short: 'TL' },
    { id: 'handover', title: 'Xác nhận bàn giao', short: 'BG' },
    { id: 'discrepancy', title: 'Báo sai lệch', short: 'SL' },
    { id: 'evidence', title: 'Ảnh minh chứng', short: 'AH' },
    { id: 'delivery-schedule', title: 'Lịch giao', short: 'LG' },
  ],
  manager: [
    { id: 'overview', title: 'Tổng quan khu', short: 'TQ' },
    { id: 'approve', title: 'Phê duyệt', short: 'PD' },
    { id: 'variance', title: 'Chênh lệch', short: 'CL' },
    { id: 'roster', title: 'Phân ca', short: 'PC' },
    { id: 'inventory', title: 'Kiểm kê', short: 'KK' },
    { id: 'booth-health', title: 'Tình trạng quầy', short: 'QD' },
  ],
};

function ActionGlyph({ short }: { short: string }) {
  return (
    <View style={styles.actionGlyph}>
      <Text style={styles.actionGlyphText}>{short}</Text>
    </View>
  );
}

function toActions(role: PreviewRole): DashboardAction[] {
  return actionDefinitions[role].map(({ id, title, short }) => ({
    id,
    title,
    icon: <ActionGlyph short={short} />,
  }));
}

const previewNotices: Record<PreviewRole, DashboardNotice[]> = {
  sales: [{ id: 'demo-sales', title: 'Kiểm tra tồn đầu ca', description: 'Minh họa việc cần làm trước khi bán hàng.', tone: 'warning', status: 'Cần xử lý' }],
  courier: [{ id: 'demo-courier', title: 'Kiểm tra hàng trước khi giao', description: 'Minh họa bước xác nhận khi nhận chuyến.', tone: 'warning', status: 'Cần xử lý' }],
  manager: [{ id: 'demo-manager', title: 'Báo cáo chờ xét duyệt', description: 'Minh họa nhóm công việc ưu tiên của quản lý.', tone: 'info', status: 'Chờ duyệt' }],
};

/**
 * A safe, isolated UX preview; not the live home or authenticated router.
 * Role switching is only to compare layouts, never a permission switch.
 */
export function BrandExperiencePreview() {
  const insets = useSafeAreaInsets();
  const [role, setRole] = useState<PreviewRole>('sales');
  const [tab, setTab] = useState<TabItem>('home');
  const actions = useMemo(() => toActions(role), [role]);
  const recommendations = useMemo<DashboardAction[]>(() => [
    { id: 'catalog', title: 'Danh mục nguyên liệu', description: 'Tham khảo nguyên liệu và định mức', icon: <ActionGlyph short="DM" /> },
    { id: 'help', title: 'Hướng dẫn sử dụng', description: 'Các thao tác cơ bản tại hiện trường', icon: <ActionGlyph short="HD" /> },
  ], []);

  const showPreviewNotice = (name: string) => {
    Alert.alert('Bản xem trước ĐỘC LẬP', `${name} chỉ đang minh họa giao diện. Chưa thực hiện giao dịch hoặc gọi API.`, [{ text: 'Đã hiểu' }]);
  };

  return (
    <BrandScreenShell
      topInset={insets.top}
      header={<BrandHeader title="ĐỘC LẬP" subtitle="Cà Phê · Bản xem trước" rightAccessory={<BrandBadge tone="info" label="UI Demo" />} />}
      bottomNavigation={
        <BrandBottomNav
          activeTab={tab}
          onTabPress={setTab}
          onCameraPress={() => showPreviewNotice('Camera')}
          renderIcon={BrandNavIcon}
          bottomInset={insets.bottom}
        />
      }
    >
      <StatusBar barStyle="dark-content" />
      <View style={styles.roles}>
        {roles.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Xem bố cục ${item.label}`}
            accessibilityState={{ selected: role === item.id }}
            style={[styles.roleButton, role === item.id && styles.roleSelected]}
            onPress={() => { setRole(item.id); setTab('home'); }}
          >
            <Text style={[styles.roleLabel, role === item.id && styles.roleSelectedLabel]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>
      {(tab === 'home' || tab === 'work') ? (
        <BrandDashboard
          roleLabel={roleName[role]}
          locationLabel="Địa điểm minh họa"
          workTitle={tab === 'work' ? 'Danh sách công việc' : 'Công việc hôm nay'}
          workSubtitle={tab === 'work' ? 'Chọn một nghiệp vụ để xem thao tác' : 'Các thao tác thường dùng'}
          actions={actions}
          notices={tab === 'home' ? previewNotices[role] : []}
          recommendations={tab === 'home' ? recommendations : []}
          onActionPress={(action) => showPreviewNotice(action.title)}
          isPreview
        />
      ) : (
        <ScrollView contentContainerStyle={styles.otherContent}>
          <Text style={styles.demoWarning}>BẢN XEM TRƯỚC · KHÔNG DÙNG DỮ LIỆU THẬT</Text>
          <BrandCard>
            <Text style={styles.otherTitle}>{tab === 'history' ? 'Lịch sử' : 'Tài khoản'}</Text>
            <Text style={styles.otherDescription}>
              {tab === 'history'
                ? 'Đây là bố cục xem trước cho lịch sử giao dịch, kiểm kê và báo cáo. Dữ liệu sẽ lấy từ quyền và API hiện có khi tích hợp.'
                : 'Đây là bố cục xem trước cho hồ sơ, đổi mật khẩu, hỗ trợ và đăng xuất. Không can thiệp phiên đăng nhập hiện tại.'}
            </Text>
          </BrandCard>
        </ScrollView>
      )}
    </BrandScreenShell>
  );
}

const styles = StyleSheet.create({
  roles: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, alignItems: 'center' },
  roleButton: { flex: 1, minHeight: controls.minTouch, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm, backgroundColor: palette.white, borderColor: palette.border, borderWidth: 1, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  roleSelected: { borderColor: palette.burgundy, backgroundColor: palette.burgundy },
  roleLabel: { color: palette.text, fontWeight: '700', fontSize: typography.caption, textAlign: 'center' },
  roleSelectedLabel: { color: palette.white },
  actionGlyph: { width: 38, height: 38, borderRadius: radii.md, backgroundColor: palette.subtle, alignItems: 'center', justifyContent: 'center' },
  actionGlyphText: { color: palette.burgundy, fontSize: typography.label, fontWeight: '800' },
  otherContent: { padding: spacing.md, gap: spacing.md },
  demoWarning: { color: palette.warning, fontSize: typography.caption, fontWeight: '800' },
  otherTitle: { color: palette.burgundy, fontSize: typography.heading, fontWeight: '800', marginBottom: spacing.xs },
  otherDescription: { color: palette.textSecondary, fontSize: typography.body, lineHeight: 24 },
});
