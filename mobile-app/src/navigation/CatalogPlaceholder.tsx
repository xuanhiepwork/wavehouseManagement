import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { catalogListHref, readCatalogDetailId } from './catalog.routes';
import type { CatalogResource } from './catalog.routes';
import { catalogStyles as styles } from './catalog.styles';

const resources: readonly { resource: CatalogResource; title: string; singular: string }[] = [
  { resource: 'ingredients', title: 'Ingredients', singular: 'Ingredient' },
  { resource: 'products', title: 'Products', singular: 'Product' },
  { resource: 'recipes', title: 'Recipes', singular: 'Recipe' },
];

function CatalogLink({ href, label, description, accessibilityLabel, dismissTo = false }: {
  href: Href; label: string; description?: string; accessibilityLabel: string; dismissTo?: boolean;
}) {
  return <Link href={href} asChild dismissTo={dismissTo}>
    <Pressable accessibilityRole="link" accessibilityLabel={accessibilityLabel} hitSlop={4}
      style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}>
      <Text allowFontScaling style={styles.linkLabel}>{label}</Text>
      {description && <Text allowFontScaling style={styles.linkDescription}>{description}</Text>}
    </Pressable>
  </Link>;
}

function PlaceholderScreen({ title, children }: { title: string; children: ReactNode }) {
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={styles.introduction}>
        <Text allowFontScaling style={styles.eyebrow}>WaveHouse · Navigation preview</Text>
        <Text allowFontScaling accessibilityRole="header" style={styles.title}>{title}</Text>
      </View>
      {children}
    </ScrollView>
  </SafeAreaView>;
}

function HomeLink() {
  return <CatalogLink href="/" label="Return to Catalog" accessibilityLabel="Return to Catalog home" dismissTo />;
}

export function CatalogHomeScreen() {
  return <PlaceholderScreen title="Catalog">
    <Text allowFontScaling style={styles.body}>Choose a section. Catalog browsing is coming soon.</Text>
    <View style={styles.links}>
      {resources.map(({ resource, title }) => {
        const href = catalogListHref(resource);
        return href && <CatalogLink key={resource} href={href} label={title}
          description={`Open the ${title.toLowerCase()} list placeholder.`} accessibilityLabel={`Open ${title} list`} />;
      })}
    </View>
  </PlaceholderScreen>;
}

export function CatalogListPlaceholder({ resource }: { resource: CatalogResource }) {
  const section = resources.find(item => item.resource === resource)!;
  return <PlaceholderScreen title={`${section.singular} list`}>
    <View style={styles.notice}>
      <Text allowFontScaling accessibilityRole="header" style={styles.noticeTitle}>{section.title} are coming soon</Text>
      <Text allowFontScaling style={styles.body}>This is a navigation placeholder. Catalog records are not displayed here yet.</Text>
    </View>
    <HomeLink />
  </PlaceholderScreen>;
}

export function CatalogDetailPlaceholder({ resource, id }: { resource: CatalogResource; id: unknown }) {
  const section = resources.find(item => item.resource === resource)!;
  const uuid = readCatalogDetailId(id);
  const listHref = catalogListHref(resource);
  return <PlaceholderScreen title={`${section.singular} detail`}>
    {uuid ? <>
      <View style={styles.notice}>
        <Text allowFontScaling style={styles.identifierLabel}>Requested {section.singular} UUID</Text>
        <Text allowFontScaling selectable style={styles.identifier}>{uuid}</Text>
      </View>
      <Text allowFontScaling style={styles.body}>{section.singular} details are coming soon. This placeholder has not loaded or verified the requested record.</Text>
    </> : <View style={styles.notice}>
      <Text allowFontScaling accessibilityRole="header" style={styles.noticeTitle}>This link is unavailable</Text>
      <Text allowFontScaling style={styles.body}>A single valid {section.singular} UUID is required to open this detail link.</Text>
    </View>}
    <View style={styles.links}>
      {listHref && <CatalogLink href={listHref} label={`Return to ${section.title}`} accessibilityLabel={`Return to ${section.title} list`} dismissTo />}
      <HomeLink />
    </View>
  </PlaceholderScreen>;
}

export function CatalogNotFoundScreen() {
  return <PlaceholderScreen title="Screen unavailable">
    <Text allowFontScaling style={styles.body}>This link does not match a Catalog screen. Return to Catalog to choose a section.</Text>
    <HomeLink />
  </PlaceholderScreen>;
}
