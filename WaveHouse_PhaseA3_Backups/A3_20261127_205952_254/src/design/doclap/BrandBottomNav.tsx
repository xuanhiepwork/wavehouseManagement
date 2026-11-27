import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BOTTOM_ITEMS, type BottomItem, type TabItem } from './navigation';
import { controls, palette, radii, spacing } from './theme';

export interface BrandBottomNavProps {
  activeTab: TabItem;
  onTabPress: (tab: TabItem) => void;
  onCameraPress: () => void;
  /** Use the icon package already present in the host project; icon color is supplied. */
  renderIcon: (item: BottomItem, color: string, size: number) => React.ReactNode;
  /** Pass useSafeAreaInsets().bottom from the parent shell. */
  bottomInset?: number;
  cameraDisabled?: boolean;
  cameraHint?: string;
  testID?: string;
}

/** Five positions, central 66pt Camera primary action; no routing or camera permission side effects. */
export function BrandBottomNav({
  activeTab,
  onTabPress,
  onCameraPress,
  renderIcon,
  bottomInset = 0,
  cameraDisabled = false,
  cameraHint = 'Mở camera để chụp hoặc quét mã',
  testID,
}: BrandBottomNavProps) {
  const safeBottom = Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : 0;

  return (
    <View testID={testID} style={[styles.container, { paddingBottom: Math.max(spacing.sm, safeBottom) }]}>
      <View style={styles.row}>
        {BOTTOM_ITEMS.map(({ key, label }) => {
          if (key === 'camera') {
            return (
              <View key={key} style={styles.slot}>
                <Pressable
                  testID="bottom-nav-camera"
                  accessibilityRole="button"
                  accessibilityLabel="Camera"
                  accessibilityHint={cameraHint}
                  accessibilityState={{ disabled: cameraDisabled }}
                  disabled={cameraDisabled}
                  onPress={onCameraPress}
                  hitSlop={6}
                  style={({ pressed }) => [styles.cameraButton, cameraDisabled && styles.cameraDisabled, pressed && styles.pressed]}
                >
                  {renderIcon('camera', palette.white, controls.navFabIcon)}
                </Pressable>
                <Text style={styles.cameraLabel}>{label}</Text>
              </View>
            );
          }

          const selected = activeTab === key;
          const color = selected ? palette.burgundy : palette.textSecondary;
          return (
            <Pressable
              key={key}
              testID={`bottom-nav-${key}`}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected }}
              onPress={() => onTabPress(key)}
              style={({ pressed }) => [styles.slot, styles.tab, pressed && styles.pressed]}
            >
              {renderIcon(key, color, controls.navIcon)}
              <Text style={[styles.label, { color }, selected && styles.selectedLabel]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.white,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.md,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  slot: {
    width: '20%',
    minHeight: 69,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xxs,
  },
  tab: { paddingVertical: 10 },
  label: { fontSize: controls.navLabel, fontWeight: '500', textAlign: 'center', flexShrink: 1 },
  selectedLabel: { fontWeight: '700' },
  cameraButton: {
    width: controls.navFab,
    height: controls.navFab,
    borderRadius: radii.pill,
    backgroundColor: palette.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -28,
    shadowColor: palette.burgundy,
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 5,
  },
  cameraDisabled: { backgroundColor: palette.disabled },
  cameraLabel: { color: palette.burgundy, fontSize: controls.navLabel, fontWeight: '700', textAlign: 'center' },
  pressed: { opacity: 0.72 },
});
