import type { TabItem } from '../design/doclap/navigation';

/** Only existing, authenticated Expo Router tabs. No role or permission guessing. */
export const LIVE_TAB_ROUTES = {
  home: '/',
  work: '/work',
  history: '/history',
  account: '/account',
} as const satisfies Record<TabItem, string>;

/** Camera is a primary action, not a selected tab. */
export const LIVE_CAMERA_ROUTE = '/camera' as const;

/**
 * Keep the Work tab selected on authorized detail and catalogue screens.
 * The Camera hub and unknown routes have no selected standard tab.
 */
export function resolveLiveTab(pathname: string): TabItem | null {
  const route = pathname.replace(/\/+$/, '') || '/';
  if (route === '/') return 'home';
  if (route === '/history') return 'history';
  if (route === '/account') return 'account';
  if (route === '/work' || route === '/field' || route.startsWith('/field/')) return 'work';
  for (const resource of ['/ingredients', '/products', '/recipes']) {
    if (route === resource || route.startsWith(`${resource}/`)) return 'work';
  }
  return null;
}
