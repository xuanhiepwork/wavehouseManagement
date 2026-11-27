import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BrandActionTile } from './BrandActionTile';
import { BrandBadge } from './BrandBadge';
import { BrandCard } from './BrandCard';
import { controls, palette, radii, spacing, typography, type SemanticTone } from './theme';

export interface DashboardAction {
  id: string;
  title: string;
  description?: string;
  /** Render a small brand-compatible icon supplied by the caller. */
  icon: React.ReactNode;
  disabled?: boolean;
}

export interface DashboardNotice {
  id: string;
  title: string;
  description?: string;
  tone: SemanticTone;
  status: string;
}

export interface BrandDashboardProps {
  displayName?: string;
  roleLabel: string;
  locationLabel?: string;
  workTitle?: string;
  workSubtitle?: string;
  actions: DashboardAction[];
  notices?: DashboardNotice[];
  recommendations?: DashboardAction[];
  onActionPress: (action: DashboardAction) => void;
  /** True only on a static demo: NEVER display test data as real operations. */
  isPreview?: boolean;
}

/**
 * Presentation-only Home. Receives already authorized work/actions from the host.
 * No hard-coded API route, user role claims, session state or counts.
 */
export function BrandDashboard({
  displayName,
  roleLabel,
  locationLabel,
  workTitle = 'Công việc của bạn',
  workSubtitle = 'Chọn công việc cần thực hiện',
  actions,
  notices = [],
  recommendations = [],
  onActionPress,
  isPreview = false,
}: BrandDashboardProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {isPreview ? <Text style={styles.preview}>BẢN XEM TRƯỚC · DỮ LIỆU MINH HỌA</Text> : null}
      <View style={styles.hero}>
        <Text style={styles.greeting}>Xin chào{displayName ? `, ${displayName}` : ''}</Text>
        <Text style={styles.heroTitle}>Hôm nay bạn cần làm gì?</Text>
        <View style={styles.chips}>
          <View style={styles.chip}><Text style={styles.chipText}>{roleLabel}</Text></View>
          {locationLabel ? <View style={styles.chip}><Text style={styles.chipText}>{locationLabel}</Text></View> : null}
        </View>
      </View>

      {notices.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cần chú ý</Text>
          {notices.map((notice) => (
            <BrandCard key={notice.id} style={styles.notice}>
              <View style={styles.noticeTop}>
                <Text style={styles.noticeTitle}>{notice.title}</Text>
                <BrandBadge tone={notice.tone} label={notice.status} />
              </View>
              {notice.description ? <Text style={styles.description}>{notice.description}</Text> : null}
            </BrandCard>
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{workTitle}</Text>
        <Text style={styles.sectionSubtitle}>{workSubtitle}</Text>
        {actions.length ? (
          <View style={styles.grid}>
            {actions.map((action) => (
              <View key={action.id} style={styles.gridSlot}>
                <BrandActionTile
                  testID={`doclap-action-${action.id}`}
                  label={action.title}
                  icon={action.icon}
                  note={action.description}
                  disabled={action.disabled}
                  onPress={() => onActionPress(action)}
                />
              </View>
            ))}
          </View>
        ) : (
          <BrandCard variant="subtle"><Text style={styles.description}>Hiện chưa có công việc được phân công.</Text></BrandCard>
        )}
      </View>

      {recommendations.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ĐỘC LẬP đề xuất</Text>
          {recommendations.map((action) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={action.title}
              disabled={action.disabled}
              onPress={() => onActionPress(action)}
              key={action.id}
              style={({ pressed }) => [styles.recommendation, pressed && styles.pressed, action.disabled && styles.inactive]}
            >
              <View style={styles.recommendationIcon}>{action.icon}</View>
              <View style={styles.recommendationText}>
                <Text style={styles.recommendationTitle}>{action.title}</Text>
                {action.description ? <Text style={styles.description}>{action.description}</Text> : null}
              </View>
              <Text style={styles.chevron} accessibilityElementsHidden>›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xxl, gap: spacing.lg, width: '100%', maxWidth: controls.contentMaxWidth, alignSelf: 'center' },
  preview: { fontSize: typography.caption, fontWeight: '800', color: palette.warning, letterSpacing: 0.4 },
  hero: { backgroundColor: palette.burgundy, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.sm },
  greeting: { fontSize: typography.body, color: palette.coffeeCream, fontWeight: '600' },
  heroTitle: { fontSize: typography.heading, color: palette.white, fontWeight: '800', lineHeight: 31 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  chip: { borderRadius: radii.pill, borderWidth: 1, borderColor: '#E4BBAF', paddingHorizontal: spacing.sm, paddingVertical: 6 },
  chipText: { color: palette.white, fontSize: typography.caption, fontWeight: '700' },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: typography.section, fontWeight: '800', color: palette.burgundy },
  sectionSubtitle: { fontSize: typography.label, color: palette.textSecondary, marginTop: -spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridSlot: { width: '48%', flexGrow: 1 },
  notice: { gap: spacing.sm },
  noticeTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap' },
  noticeTitle: { color: palette.text, fontSize: typography.body, fontWeight: '700', flexShrink: 1 },
  description: { fontSize: typography.label, color: palette.textSecondary, lineHeight: 20 },
  recommendation: { minHeight: controls.minTouch, padding: spacing.sm, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  recommendationIcon: { width: 38, height: 38, borderRadius: radii.md, backgroundColor: palette.subtle, alignItems: 'center', justifyContent: 'center' },
  recommendationText: { flex: 1, gap: 3 },
  recommendationTitle: { color: palette.text, fontWeight: '700', fontSize: typography.body },
  chevron: { fontSize: 28, color: palette.burgundy },
  pressed: { opacity: 0.74 },
  inactive: { opacity: 0.5 },
});
