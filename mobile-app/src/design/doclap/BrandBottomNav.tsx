import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BOTTOM_ITEMS, type BottomItem, type TabItem } from './navigation';
import { controls, palette, radii, spacing } from './theme';

export interface BrandBottomNavProps {
  /** Camera has no selected standard tab, so null is supported. */
  activeTab: TabItem | null;
  onTabPress: (tab: TabItem) => void;
  onCameraPress: () => void;
  renderIcon: (item: BottomItem, color: string, size: number) => React.ReactNode;
  /** Insets from useSafeAreaInsets().bottom, supplied by the host shell. */
  bottomInset?: number;
  cameraDisabled?: boolean;
  cameraHint?: string;
  testID?: string;
}

/**
 * Five equal positions. The 66pt Camera button is visually raised relative
 * to the white toolbar surface, yet stays inside the parent touch bounds.
 * No data requests, permissions, or routing are performed here.
 */
export function BrandBottomNav({
  activeTab,
  onTabPress,
  onCameraPress,
  renderIcon,
  bottomInset = 0,
  cameraDisabled = false,
  cameraHint = 'Mở trung tâm minh chứng',
  testID,
}: BrandBottomNavProps) {
  const safeBottom = Number.isFinite(bottomInset) ? Math.max(0, bottomInset) : 0;

  return (
    <View testID={testID} style={[styles.container, { paddingBottom: Math.max(spacing.sm, safeBottom) }]}>
      <View pointerEvents="none" style={styles.toolbarSurface} />
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
                  hitSlop={4}
                  style={({ pressed }) => [
                    styles.cameraButton,
                    cameraDisabled && styles.cameraDisabled,
                    pressed && styles.pressed,
                  ]}
                >
                  {renderIcon('camera', palette.white, controls.navFabIcon)}
                </Pressable>
                <Text allowFontScaling numberOfLines={1} style={styles.cameraLabel}>{label}</Text>
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
              <Text allowFontScaling numberOfLines={1}
                style={[styles.label, { color }, selected && styles.selectedLabel]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'visible',
    paddingHorizontal: spacing.xs,
    paddingTop: 21,
    backgroundColor: palette.canvas,
  },
  toolbarSurface: {
    position: 'absolute',
    top: 26,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.white,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 68,
  },
  slot: {
    position: 'relative',
    width: '20%',
    height: 68,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xxs,
  },
  tab: { paddingTop: 8, paddingBottom: 7, minHeight: 60 },
  label: { fontSize: controls.navLabel, fontWeight: '500', textAlign: 'center', flexShrink: 1 },
  selectedLabel: { fontWeight: '700' },
  cameraButton: {
    position: 'absolute',
    top: -18,
    left: '50%',
    transform: [{ translateX: -controls.navFab / 2 }],
    width: controls.navFab,
    height: controls.navFab,
    borderRadius: radii.pill,
    borderWidth: 4,
    borderColor: palette.white,
    backgroundColor: palette.orange,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: palette.burgundy,
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 7,
    elevation: 6,
  },
  cameraDisabled: { backgroundColor: palette.disabled },
  cameraLabel: {
    color: palette.burgundy,
    fontSize: controls.navLabel,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 5,
  },
  pressed: { opacity: 0.7 },
});
