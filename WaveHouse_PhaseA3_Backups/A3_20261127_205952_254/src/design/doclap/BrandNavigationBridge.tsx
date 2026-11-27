import React from 'react';
import { type Href, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandBottomNav } from './BrandBottomNav';
import { BrandNavIcon } from './BrandNavIcon';
import type { TabItem } from './navigation';

export interface BrandNavigationBridgeProps {
  /** Determine from the existing authenticated route; never infer a role from UI. */
  activeTab: TabItem;
  /** Set EACH destination to the existing, authorized Expo Router path. */
  tabRoutes: Record<TabItem, Href>;
  /** Existing camera hub route; actual capture is handled in Phase D. */
  cameraRoute: Href;
  cameraDisabled?: boolean;
}

/**
 * Opt-in adapter for the existing Expo Router shell. Does not mount itself
 * or modify any routes until the current host navigation imports it.
 */
export function BrandNavigationBridge({
  activeTab,
  tabRoutes,
  cameraRoute,
  cameraDisabled = false,
}: BrandNavigationBridgeProps) {
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();

  return (
    <BrandBottomNav
      activeTab={activeTab}
      onTabPress={(tab) => router.push(tabRoutes[tab])}
      onCameraPress={() => router.push(cameraRoute)}
      renderIcon={BrandNavIcon}
      bottomInset={bottom}
      cameraDisabled={cameraDisabled}
    />
  );
}
