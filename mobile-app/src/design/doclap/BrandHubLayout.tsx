import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, radii, typography, controls } from './theme';

interface BrandHubLayoutProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: string;
}

/** Shared signed-in shell; the existing AuthGate owns the global bottom navigation. */
export function BrandHubLayout({ eyebrow, title, description, children, footer }: BrandHubLayoutProps) {
  return <ScrollView
    style={styles.root}
    contentContainerStyle={styles.content}
    keyboardShouldPersistTaps="handled"
    showsVerticalScrollIndicator={false}
  >
    <View style={styles.hero}>
      <Text allowFontScaling style={styles.eyebrow}>{eyebrow}</Text>
      <Text allowFontScaling accessibilityRole="header" style={styles.title}>{title}</Text>
      <Text allowFontScaling style={styles.description}>{description}</Text>
      <View style={styles.rule} />
    </View>
    {children}
    {footer ? <Text allowFontScaling style={styles.footer}>{footer}</Text> : null}
  </ScrollView>;
}

export function BrandSectionTitle({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return <View style={styles.section}>
    <Text allowFontScaling accessibilityRole="header" style={styles.sectionTitle}>{children}</Text>
    {subtitle ? <Text allowFontScaling style={styles.subtitle}>{subtitle}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.canvas },
  content: { width: '100%', maxWidth: controls.contentMaxWidth, alignSelf: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 36, gap: spacing.md },
  hero: { backgroundColor: palette.burgundy, borderRadius: radii.xl, padding: spacing.lg, gap: spacing.xs },
  eyebrow: { color: palette.coffeeCream, fontSize: typography.caption, fontWeight: '800', letterSpacing: 1 },
  title: { color: palette.white, fontSize: typography.heading, lineHeight: 33, fontWeight: '800' },
  description: { color: '#F8E5D5', fontSize: typography.label, lineHeight: 22 },
  rule: { width: 45, height: 4, marginTop: spacing.sm, backgroundColor: palette.orange, borderRadius: 4 },
  section: { gap: spacing.xs, marginTop: spacing.xs },
  sectionTitle: { color: palette.burgundy, fontSize: typography.section, fontWeight: '800' },
  subtitle: { color: palette.textSecondary, fontSize: typography.label, lineHeight: 21 },
  footer: { color: palette.textSecondary, fontSize: typography.caption, lineHeight: 20, paddingHorizontal: 2 },
});
