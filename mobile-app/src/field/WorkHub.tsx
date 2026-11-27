import { useSyncExternalStore } from 'react';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { SuggestedList, WorkGrid } from '../navigation/WorkCards.tsx';
import { roleLabel, suggestedItems, workItemsFor } from '../navigation/work-items.ts';
import { Copy, Header, Page, Panel } from './field.ui.tsx';

export function WorkHub() {
  const { user } = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  if (!user) return null;
  const work = workItemsFor(user);
  return <Page title="Công việc" lead={`${roleLabel(user)} · Chọn việc cần thực hiện`}>
    <Header>Nhiệm vụ của bạn</Header>
    {work.length ? <WorkGrid items={work} /> : <Panel><Copy>Chưa có nghiệp vụ được phân công cho tài khoản này.</Copy></Panel>}
    <Header>Độc Lập đề xuất</Header>
    <SuggestedList items={suggestedItems()} />
    <Copy small>Các thao tác thay đổi dữ liệu sẽ yêu cầu xác nhận ở màn hình nghiệp vụ tương ứng.</Copy>
  </Page>;
}
