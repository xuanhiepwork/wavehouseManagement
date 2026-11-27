import { useSyncExternalStore } from 'react';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { SuggestedList } from '../navigation/WorkCards.tsx';
import { historyItemsFor } from '../navigation/work-items.ts';
import { Copy, Header, Page, Panel } from './field.ui.tsx';

export function HistoryHub() {
  const { user } = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  if (!user) return null;
  const items = historyItemsFor(user);
  return <Page title="Lịch sử" lead="Tra cứu chứng từ và báo cáo đã ghi nhận">
    <Panel><Copy>Chọn loại báo cáo để xem dữ liệu thực tế từ hệ thống. Ứng dụng chưa có luồng lịch sử tổng hợp riêng.</Copy></Panel>
    <Header>Tra cứu theo nghiệp vụ</Header>
    {items.length ? <SuggestedList items={items} /> : <Panel><Copy>Chưa có mục tra cứu phù hợp với quyền của bạn.</Copy></Panel>}
  </Page>;
}
