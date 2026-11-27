/** Camera is a primary ACTION, not a selected destination. */
export const BOTTOM_ITEMS = [
  { key: 'home', label: 'Trang chủ' },
  { key: 'work', label: 'Công việc' },
  { key: 'camera', label: 'Camera' },
  { key: 'history', label: 'Lịch sử' },
  { key: 'account', label: 'Tài khoản' },
] as const;

export type BottomItem = (typeof BOTTOM_ITEMS)[number]['key'];
export type TabItem = Exclude<BottomItem, 'camera'>;
