import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Product } from '../api/catalog.types';
import { catalogDetailHref } from '../navigation/catalog.routes';
import { useProductDetail, useProductList } from './ProductState';
import { productDetailFields, productListFields } from './product.model';
import { productStyles as styles } from './product.styles';

function ActionButton({ label, onPress, disabled = false, primary = false }: {
  label: string; onPress: () => void; disabled?: boolean; primary?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, styles.actionButton,
      primary && styles.buttonPrimary, pressed && styles.buttonPressed, disabled && styles.buttonDisabled]}>
    <Text allowFontScaling style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
  </Pressable>;
}

function NavigationLink({ href, label, dismissTo = false }: { href: Href; label: string; dismissTo?: boolean }) {
  return <Link href={href} asChild dismissTo={dismissTo} accessibilityRole="button">
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
      <Text allowFontScaling style={styles.buttonText}>{label}</Text>
    </Pressable>
  </Link>;
}

function ProductFields({ fields }: { fields: readonly { label: string; value: string }[] }) {
  return <>
    {fields.map(field => <View key={field.label} style={styles.field}>
      <Text allowFontScaling style={styles.label}>{field.label}</Text>
      <Text allowFontScaling selectable accessibilityRole={field.label === 'Name' ? 'header' : undefined}
        style={field.label === 'Name' ? styles.name : field.label.startsWith('Price (') ? styles.priceValue : styles.fieldValue}>{field.value}</Text>
    </View>)}
  </>;
}

function LoadingFeedback({ label }: { label: string }) {
  return <View style={[styles.feedback, styles.loading]}>
    <ActivityIndicator accessibilityLabel={label} />
    <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>{label}</Text>
  </View>;
}

function ErrorFeedback({ title, message, retry, label }: { title: string; message: string; retry: () => void; label: string }) {
  return <View style={styles.feedback}>
    <Text allowFontScaling accessibilityRole="header" style={[styles.sectionTitle, styles.error]}>{title}</Text>
    <Text allowFontScaling accessibilityRole="alert" accessibilityLiveRegion="assertive" style={[styles.body, styles.error]}>{message}</Text>
    <ActionButton label={label} onPress={retry} />
  </View>;
}

function ProductCard({ product }: { product: Product }) {
  const href = catalogDetailHref('products', product._id);
  return <View style={styles.panel}>
    <ProductFields fields={productListFields(product)} />
    {href && <Link href={href} asChild accessibilityRole="button">
      <Pressable accessibilityRole="button" accessibilityLabel={`View details for ${product.name} (${product.code})`}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
        <Text allowFontScaling style={styles.buttonText}>View details</Text>
      </Pressable>
    </Link>}
  </View>;
}

function ItemSeparator() { return <View style={styles.separator} />; }

export function ProductListScreen() {
  const model = useProductList();
  const [showFilters, setShowFilters] = useState(false);
  const list = useRef<FlatList<Product>>(null);
  const { draft, query, snapshot } = model;
  const loading = snapshot.status === 'idle' || snapshot.status === 'loading';
  const response = snapshot.status === 'success' ? snapshot.data : undefined;
  const availability = query.isAvailable === undefined ? 'All availability states' : query.isAvailable ? 'Available' : 'Unavailable';
  function act(action: () => void) {
    Keyboard.dismiss();
    action();
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }
  const header = <View style={styles.header}>
    <View style={styles.headingGroup}>
      <Text allowFontScaling accessibilityRole="header" style={styles.title}>Products</Text>
      <Text allowFontScaling style={styles.body}>Browse Products and their supported size prices.</Text>
    </View>
    <NavigationLink href="/" label="Return to Catalog home" dismissTo />
    <View style={styles.panel}>
      <View style={styles.field}>
        <Text allowFontScaling style={styles.label}>Search by code or name</Text>
        <TextInput allowFontScaling accessibilityLabel="Search Products by code or name" value={draft.search}
          onChangeText={search => model.updateDraft({ search })} onSubmitEditing={() => act(model.apply)}
          autoCapitalize="none" autoCorrect={false} returnKeyType="search" placeholder="Code or name"
          placeholderTextColor="#61776a" underlineColorAndroid="transparent" style={styles.input} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={showFilters ? 'Hide Product filters' : 'Show Product filters'}
        accessibilityState={{ expanded: showFilters }} onPress={() => setShowFilters(value => !value)}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
        <Text allowFontScaling style={styles.buttonText}>{showFilters ? 'Hide filters' : 'Show filters'}</Text>
      </Pressable>
      {showFilters && <>
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label}>Category (exact match)</Text>
          <TextInput allowFontScaling accessibilityLabel="Product category" value={draft.category}
            onChangeText={category => model.updateDraft({ category })} onSubmitEditing={() => act(model.apply)}
            autoCapitalize="none" autoCorrect={false} placeholder="Any category" returnKeyType="done"
            placeholderTextColor="#61776a" underlineColorAndroid="transparent" style={styles.input} />
        </View>
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label}>Availability</Text>
          <View style={styles.choices}>
            {([{ value: 'all', label: 'All' }, { value: 'available', label: 'Available' },
              { value: 'unavailable', label: 'Unavailable' }] as const).map(option => <Pressable key={option.value}
              accessibilityRole="radio" accessibilityLabel={`Product availability: ${option.label}`}
              accessibilityState={{ checked: draft.availability === option.value }}
              onPress={() => model.updateDraft({ availability: option.value })}
              style={({ pressed }) => [styles.choice, draft.availability === option.value && styles.choiceSelected,
                pressed && styles.buttonPressed]}>
              <Text allowFontScaling style={[styles.choiceText, draft.availability === option.value && styles.choiceTextSelected]}>{option.label}</Text>
            </Pressable>)}
          </View>
        </View>
      </>}
      <Text allowFontScaling style={styles.body}>Choose Apply filters to update the results.</Text>
      {model.validationError && <Text allowFontScaling accessibilityRole="alert" style={[styles.body, styles.error]}>{model.validationError}</Text>}
      <View style={styles.actions}>
        <ActionButton label="Apply filters" primary onPress={() => act(model.apply)} />
        <ActionButton label="Reset filters" onPress={() => act(model.reset)} />
      </View>
    </View>
    <View style={styles.headingGroup}>
      <Text allowFontScaling accessibilityRole="header" style={styles.sectionTitle}>Applied results</Text>
      <Text allowFontScaling style={styles.body}>{availability}</Text>
      {query.search && <Text allowFontScaling style={styles.body}>Search: {query.search}</Text>}
      {query.category && <Text allowFontScaling style={styles.body}>Category: {query.category}</Text>}
      {response && <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>{response.pagination.total} matching Products</Text>}
    </View>
  </View>;
  const empty = loading ? <LoadingFeedback label="Loading Products..." />
    : snapshot.status === 'error' ? <ErrorFeedback title="Products could not be loaded"
      message={snapshot.error?.message ?? 'The Product read failed.'} label="Retry Products" retry={() => { void model.retry(); }} />
      : <View style={styles.feedback}>
        <Text allowFontScaling accessibilityRole="header" style={styles.sectionTitle}>No Products found</Text>
        <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>{response && response.pagination.total > 0
          ? 'There are no Products on this page. Use Previous or change the filters.' : 'No Products match the applied filters.'}</Text>
      </View>;
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
    <FlatList ref={list} style={styles.list} contentContainerStyle={styles.content} data={response?.data ?? []}
      renderItem={({ item }) => <ProductCard product={item} />} keyExtractor={item => item._id}
      keyboardShouldPersistTaps="handled" ListHeaderComponent={header} ListEmptyComponent={empty}
      ItemSeparatorComponent={ItemSeparator} ListFooterComponent={<View style={styles.footer}>
        <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>Page {query.page}{response
          ? response.pagination.totalPages === 0 ? ' · No result pages' : ` of ${response.pagination.totalPages}` : ''}</Text>
        <View style={styles.actions}>
          <ActionButton label="Previous Product page" disabled={loading || !model.canPrevious} onPress={() => act(model.previousPage)} />
          <ActionButton label="Next Product page" disabled={loading || !model.canNext} onPress={() => act(model.nextPage)} />
        </View>
      </View>} />
  </SafeAreaView>;
}

export function ProductDetailScreen({ id }: { id: unknown }) {
  const model = useProductDetail(id);
  const { snapshot } = model;
  const product = snapshot.status === 'success' ? snapshot.data?.data : undefined;
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
    <ScrollView style={styles.list} contentContainerStyle={[styles.content, styles.detailContent]}>
      <Text allowFontScaling accessibilityRole="header" style={styles.title}>Product detail</Text>
      {model.invalidId ? <View style={styles.feedback}>
        <Text allowFontScaling accessibilityRole="header" style={styles.sectionTitle}>This link is unavailable</Text>
        <Text allowFontScaling accessibilityRole="alert" style={[styles.body, styles.error]}>A single valid Product UUID is required. Open the Products list to choose a record.</Text>
      </View> : <>
        {!product && model.id && <View style={styles.panel}><ProductFields fields={[{ label: 'Requested Product UUID', value: model.id }]} /></View>}
        {(snapshot.status === 'idle' || snapshot.status === 'loading') && <LoadingFeedback label="Loading Product details..." />}
        {snapshot.status === 'error' && <ErrorFeedback title={snapshot.error?.code === 'NOT_FOUND' ? 'Product not found' : 'Product details could not be loaded'}
          message={snapshot.error?.message ?? 'The Product read failed.'} label="Retry Product details" retry={() => { void model.retry(); }} />}
        {product && <View style={styles.panel}><ProductFields fields={productDetailFields(product)} /></View>}
      </>}
      <View style={styles.headingGroup}>
        <NavigationLink href="/products" label="Return to Products list" dismissTo />
        <NavigationLink href="/" label="Return to Catalog home" dismissTo />
      </View>
    </ScrollView>
  </SafeAreaView>;
}
