/**
 * Display-only statuses for field workflows.
 * Unknown API statuses remain unchanged; no status may change permissions.
 */
export type FieldStatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const codes: Readonly<Record<string, {label: string; tone: FieldStatusTone}>> = {
  DRAFT: {label: 'Bản nháp', tone: 'neutral'},
  SUBMITTED: {label: 'Chờ duyệt', tone: 'warning'},
  RETURNED: {label: 'Cần bổ sung', tone: 'danger'},
  APPROVED: {label: 'Đã duyệt', tone: 'success'},
  REJECTED: {label: 'Đã từ chối', tone: 'danger'},
  PLANNED: {label: 'Đã lên kế hoạch', tone: 'neutral'},
  DISPATCHED: {label: 'Đã xuất kho', tone: 'info'},
  RECEIVED: {label: 'Đã nhận hàng', tone: 'success'},
  IN_TRANSIT: {label: 'Đang giao', tone: 'info'},
  COMPLETE: {label: 'Đã hoàn thành', tone: 'success'},
  SCHEDULED: {label: 'Đã phân công', tone: 'info'},
  CANCELLED: {label: 'Đã hủy', tone: 'danger'},
};
const visible: Readonly<Record<string, FieldStatusTone>> = {
  'Bản nháp': 'neutral',
  'Chờ duyệt': 'warning',
  'Cần bổ sung': 'danger',
  'Đã duyệt': 'success',
  'Đã từ chối': 'danger',
  'Chờ xuất kho': 'warning',
  'Đang giao': 'info',
  'Đã hoàn tất': 'success',
  'Đã hoàn thành': 'success',
  'Đã nhận hàng': 'success',
  'Quầy đã nhận': 'success',
  'ĐÃ XÁC NHẬN': 'success',
  'Chờ quầy xác nhận': 'warning',
  'Chờ đối chiếu': 'warning',
  'Chưa xuất kho': 'neutral',
};

export function fieldStatusPresentation(value: string): {label: string; tone: FieldStatusTone} {
  const key = value.trim();
  const known = codes[key];
  if (known) return known;
  return {label: value, tone: visible[key] ?? 'neutral'};
}
