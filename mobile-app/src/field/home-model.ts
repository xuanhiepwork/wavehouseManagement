import type { MobileUser } from '../auth/session.ts';
import { roleLabel, suggestedItems, workItemsFor, type WorkItem } from '../navigation/work-items.ts';

export interface LiveHomeModel {
  readonly roleLabel: string;
  readonly heroDescription: string;
  readonly work: readonly WorkItem[];
  readonly recommendations: readonly WorkItem[];
}

/**
 * All operational links originate from the existing, role-scoped work-items module.
 * This model intentionally contains no guessed KPIs, sample tasks or new API routes.
 */
export function liveHomeFor(user: MobileUser): LiveHomeModel {
  const manager = user.role === 'ADMIN' || user.role === 'BRANCH_MANAGER';
  const delivery = user.role === 'STAFF' && user.workKind === 'KITCHEN_DELIVERY';
  return {
    roleLabel: roleLabel(user),
    heroDescription: manager
      ? 'Theo dõi tình hình các quầy và xử lý công việc được phân quyền.'
      : delivery
        ? 'Kiểm tra danh sách chuyến giao và xác nhận khi đã dừng xe an toàn.'
        : user.role === 'STAFF' && user.workKind === 'SALES'
          ? 'Xem ca làm, cập nhật doanh thu và theo dõi hàng hóa tại quầy.'
          : 'Xem các chức năng đã được cấp quyền cho tài khoản.',
    work: workItemsFor(user),
    recommendations: suggestedItems(),
  };
}

/** businessToday() provides YYYY-MM-DD in the business timezone; never parse via UTC Date. */
export function displayBusinessDay(isoDay: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : isoDay;
}
