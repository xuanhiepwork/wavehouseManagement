import React from 'react';
import { type Href, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandBottomNav } from './BrandBottomNav';
import { BrandNavIcon } from './BrandNavIcon';
import type { TabItem } from './navigation';

export interface BrandNavigationBridgeProps {
  /** null for Camera and other routes that are not a standard tab. */
  activeTab: TabItem | null;
  /** Existing authorized Expo Router paths only. */
  tabRoutes: Record<TabItem, Href>;
  /** The existing Camera hub. Actual capture belongs to Phase D. */
  cameraRoute: Href;
  cameraDisabled?: boolean;
}

/**
 * Host-agnostic BrandBottomNav wired to the real authenticated router.
 * Replacing tabs prevents duplicate top-level pages in back history.
 */
export function BrandNavigationBridge({
  activeTab,
  tabRoutes,
  cameraRoute,
  cameraDisabled = false,
}: BrandNavigationBridgeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { bottom } = useSafeAreaInsets();

  return (
    <BrandBottomNav
      activeTab={activeTab}
      onTabPress={(tab) => {
        const destination = tabRoutes[tab];
        if (typeof destination === 'string' && pathname === destination) return;
        router.replace(destination);
      }}
      onCameraPress={() => {
        if (typeof cameraRoute === 'string' && pathname === cameraRoute) return;
        router.push(cameraRoute);
      }}
      renderIcon={BrandNavIcon}
      bottomInset={bottom}
      cameraDisabled={cameraDisabled}
      cameraHint="Mở trung tâm minh chứng; chức năng chụp ảnh sẽ được bổ sung sau"
    />
  );
}
