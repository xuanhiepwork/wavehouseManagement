import React from 'react';
import { StyleSheet, View } from 'react-native';
import { palette } from './theme';

export interface BrandScreenShellProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  bottomNavigation?: React.ReactNode;
  /** Set this from the host screen safe-area top inset if the parent does not already apply it. */
  topInset?: number;
}

/** Keep one shared shell for all roles. Parent controls current route and permissions. */
export function BrandScreenShell({ children, header, bottomNavigation, topInset = 0 }: BrandScreenShellProps) {
  const safeTop = Number.isFinite(topInset) ? Math.max(0, topInset) : 0;
  return (
    <View style={[styles.root, { paddingTop: safeTop }]}>
      {header}
      <View style={styles.body}>{children}</View>
      {bottomNavigation}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.canvas },
  body: { flex: 1 },
});
