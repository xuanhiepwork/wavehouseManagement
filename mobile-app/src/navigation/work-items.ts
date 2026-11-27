import type { MobileUser } from '../auth/session.ts';
import type { BrandIconName } from '../design/BrandIcon.tsx';

/** Visible links only. Backend remains the authority for permission checks. */
export interface WorkItem {
  readonly href: string;
  readonly title: string;
  readonly subtitle: string;
  readonly icon: BrandIconName;
}

const sales: readonly WorkItem[] = [
  { href: '/field/sales', title: 'Bán hàng', subtitle: 'Ghi nhận báo cáo ca', icon: 'sales' },
  { href: '/field/receiving', title: 'Nhận hàng', subtitle: 'Đối chiếu số lượng', icon: 'receiving' },
  { href: '/field/inventory', title: 'Tồn tại quầy', subtitle: 'Kiểm kê và sai lệch', icon: 'inventory' },
  { href: '/field/schedule', title: 'Lịch làm', subtitle: 'Xem ca được phân công', icon: 'schedule' },
];
const delivery: readonly WorkItem[] = [
  { href: '/field/deliveries', title: 'Chuyến giao', subtitle: 'Danh sách và điểm giao', icon: 'delivery' },
  { href: '/field/schedule', title: 'Lịch làm', subtitle: 'Xem lịch được phân công', icon: 'schedule' },
];
const manager: readonly WorkItem[] = [
  { href: '/field/manager', title: 'Quản lý khu', subtitle: 'Tổng quan vận hành', icon: 'manager' },
  { href: '/field/sales', title: 'Duyệt báo cáo', subtitle: 'Theo dõi doanh thu ca', icon: 'sales' },
  { href: '/field/receiving', title: 'Giao nhận', subtitle: 'Theo dõi chênh lệch', icon: 'receiving' },
  { href: '/field/roster', title: 'Phân ca', subtitle: 'Lập và quản lý lịch', icon: 'roster' },
  { href: '/field/inventory', title: 'Tồn kho', subtitle: 'Theo dõi các quầy', icon: 'inventory' },
  { href: '/field/schedule', title: 'Lịch làm', subtitle: 'Ca làm trong ngày', icon: 'schedule' },
];
const recommendations: readonly WorkItem[] = [
  { href: '/ingredients', title: 'Nguyên liệu', subtitle: 'Tra cứu đơn vị và tồn tối thiểu', icon: 'ingredients' },
  { href: '/products', title: 'Sản phẩm', subtitle: 'Giá bán theo kích cỡ', icon: 'products' },
  { href: '/recipes', title: 'Công thức', subtitle: 'Định lượng và phiên bản', icon: 'recipes' },
];
export function roleLabel(user: MobileUser): string {
  if (user.role === 'ADMIN') return 'Quản trị viên';
  if (user.role === 'BRANCH_MANAGER') return 'Quản lý khu';
  if (user.workKind === 'KITCHEN_DELIVERY') return 'Nhân viên giao hàng';
  if (user.workKind === 'SALES') return 'Nhân viên bán hàng';
  return 'Nhân viên';
}
export function workItemsFor(user: MobileUser): readonly WorkItem[] {
  if (user.role === 'ADMIN') {
    return [...manager, { href: '/field/deliveries', title: 'Phân phối', subtitle: 'Theo dõi chuyến giao', icon: 'delivery' }];
  }
  if (user.role === 'BRANCH_MANAGER') return manager;
  if (user.role === 'STAFF' && user.workKind === 'SALES') return sales;
  if (user.role === 'STAFF' && user.workKind === 'KITCHEN_DELIVERY') return delivery;
  return [];
}
export function suggestedItems(): readonly WorkItem[] { return recommendations; }
export function historyItemsFor(user: MobileUser): readonly WorkItem[] {
  if (user.role !== 'STAFF') return [manager[1], manager[2], manager[4]];
  if (user.workKind === 'SALES') return [sales[0], sales[1], sales[2]];
  if (user.workKind === 'KITCHEN_DELIVERY') return [delivery[0]];
  return [];
}
