import { useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { getAuthSnapshot, subscribeAuth } from '../auth/session.ts';
import { BrandCard } from '../design/doclap/BrandCard';
import { BrandHubLayout, BrandSectionTitle } from '../design/doclap/BrandHubLayout';
import { palette, spacing } from '../design/doclap/theme';
import { SuggestedList, WorkGrid } from '../navigation/WorkCards.tsx';
import { roleLabel, suggestedItems, workItemsFor } from '../navigation/work-items.ts';
import type { WorkItem } from '../navigation/work-items.ts';

function matchItem(item: WorkItem, query: string): boolean {
  const text = `${item.title} ${item.subtitle}`.toLocaleLowerCase('vi-VN');
  return text.includes(query);
}

/** Uses role-scoped links only; this is a client-side filter, not a permission grant or a new backend search. */
export function WorkHub() {
  const { user } = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  const [search, setSearch] = useState('');
  const items = useMemo(() => user ? workItemsFor(user) : [], [user]);
  const recommendations = useMemo(() => suggestedItems(), []);
  const query = search.trim().toLocaleLowerCase('vi-VN');
  const shown = items.filter(item => matchItem(item, query));
  const shownRecommendations = recommendations.filter(item => matchItem(item, query));
  if (!user) return null;
  return <BrandHubLayout eyebrow="ĐỘC LẬP · CÔNG VIỆC" title="Nhiệm vụ của bạn"
    description={`${roleLabel(user)} · Chỉ hiển thị thao tác thuộc nhóm quyền của tài khoản`}
    footer="Thông tin và quyền thực hiện cuối cùng được xác nhận tại màn hình nghiệp vụ và máy chủ. Khi mạng yếu, kiểm tra trạng thái trước khi gửi lại thao tác ghi.">
    <BrandCard>
      <View style={styles.searchGroup}>
        <Text allowFontScaling style={styles.searchLabel}>Tìm nghiệp vụ</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          accessibilityLabel="Tìm trong công việc và danh mục"
          placeholder="Ví dụ: bán hàng, kiểm kê, phân ca..."
          placeholderTextColor={palette.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
        {query ? <Pressable accessibilityRole="button" accessibilityLabel="Xóa nội dung tìm kiếm"
          onPress={() => setSearch('')} style={styles.clearButton}>
          <Text allowFontScaling style={styles.clearLabel}>Xóa tìm kiếm</Text>
        </Pressable> : <Text allowFontScaling style={styles.helper}>Tra cứu nhanh các công việc được cấp quyền. Không tạo giao dịch.</Text>}
      </View>
    </BrandCard>
    <BrandSectionTitle subtitle={`${shown.length} / ${items.length} mục nghiệp vụ được hiển thị`}>Công việc chính</BrandSectionTitle>
    {shown.length ? <WorkGrid items={shown} />
      : <BrandCard><Text allowFontScaling style={styles.empty}>{items.length === 0
        ? 'Tài khoản chưa được phân công công việc. Vui lòng liên hệ quản lý.'
        : 'Không có công việc phù hợp từ khóa. Bạn có thể xóa tìm kiếm để xem tất cả.'}</Text></BrandCard>}
    <BrandSectionTitle subtitle="Tra cứu danh mục nguyên liệu, sản phẩm và công thức">ĐỘC LẬP đề xuất</BrandSectionTitle>
    <View style={styles.list}>{shownRecommendations.length ? <SuggestedList items={shownRecommendations} />
      : <BrandCard><Text allowFontScaling style={styles.empty}>Không có danh mục phù hợp từ khóa.</Text></BrandCard>}</View>
  </BrandHubLayout>;
}
const styles = StyleSheet.create({
  searchGroup: { gap: spacing.sm },
  searchLabel: { color: palette.burgundy, fontWeight: '800', fontSize: 15 },
  input: { minHeight: 52, borderWidth: 1, borderColor: palette.border, borderRadius: 14,
    backgroundColor: palette.white, paddingHorizontal: 14, fontSize: 15, color: palette.text },
  clearButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 2 },
  clearLabel: { fontSize: 14, fontWeight: '800', color: palette.orange },
  helper: { fontSize: 12, lineHeight: 18, color: palette.textSecondary },
  empty: { color: palette.textSecondary, fontSize: 15, lineHeight: 23 },
  list: { marginBottom: spacing.xs },
});
