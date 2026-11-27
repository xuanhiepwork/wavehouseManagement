import { usePathname } from 'expo-router';
import { BrandNavigationBridge } from '../design/doclap/BrandNavigationBridge';
import { LIVE_CAMERA_ROUTE, LIVE_TAB_ROUTES, resolveLiveTab } from './doclap-tabs';

/**
 * AuthGate already mounts this shell only for a signed-in user.
 * Keep that auth boundary intact: swap presentation, not authentication.
 */
export function BrandBottomNav() {
  const pathname = usePathname();
  return (
    <BrandNavigationBridge
      activeTab={resolveLiveTab(pathname)}
      tabRoutes={LIVE_TAB_ROUTES}
      cameraRoute={LIVE_CAMERA_ROUTE}
    />
  );
}
