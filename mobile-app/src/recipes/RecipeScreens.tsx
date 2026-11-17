import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Recipe } from '../api/catalog.types';
import { catalogDetailHref } from '../navigation/catalog.routes';
import { ingredientMetadata, productMetadata, recipeDetailFields, recipeListFields } from './recipe.model';
import { readRecipeReference } from './recipe.references';
import type { RecipeReferenceEntry, RecipeReferenceSnapshot } from './recipe.references';
import { useRecipeDetail, useRecipeList } from './RecipeState';
import { recipeStyles as styles } from './recipe.styles';

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
    <Pressable accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
      <Text allowFontScaling style={styles.buttonText}>{label}</Text>
    </Pressable>
  </Link>;
}

function Fields({ fields }: { fields: readonly { label: string; value: string }[] }) {
  return <>{fields.map(field => <View key={field.label} style={styles.field}>
    <Text allowFontScaling style={styles.label}>{field.label}</Text>
    <Text allowFontScaling selectable style={[field.label.includes('UUID') ? styles.identifier : styles.fieldValue,
      field.label === 'Status' && (field.value === 'Active' ? styles.active : styles.inactive)]}>{field.value}</Text>
  </View>)}</>;
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

function ProductReference({ productId, entry, retry }: {
  productId: string; entry?: RecipeReferenceEntry<import('../api/catalog.types').Product>; retry: () => void;
}) {
  if (!entry || entry.status === 'idle' || entry.status === 'loading') {
    return <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>Loading current Product metadata...</Text>;
  }
  if (entry.status === 'error') return <View style={styles.referenceError}>
    <Text allowFontScaling accessibilityRole="alert" style={[styles.body, styles.error]}>Current Product metadata is unavailable. Recipe data remains available.</Text>
    <ActionButton label={`Retry current Product metadata for ${productId}`} onPress={retry} />
  </View>;
  return <View style={styles.nestedPanel}>
    <Text allowFontScaling accessibilityRole="header" style={styles.sectionTitle}>Current Product metadata</Text>
    <Fields fields={productMetadata(entry.data!)} />
  </View>;
}

function MembershipSummary({ recipe }: { recipe: Recipe }) {
  if (recipe.ingredients.length === 0) return <Text allowFontScaling style={styles.body}>This historical Recipe has no Ingredient membership.</Text>;
  return <View style={styles.headingGroup}>{recipe.ingredients.map(item => <View key={item.ingredientId} style={styles.nestedPanel}>
    <Fields fields={[{ label: 'Ingredient UUID', value: item.ingredientId }]} />
    <View style={styles.field}>
      <Text allowFontScaling style={styles.label}>Quantity</Text>
      <Text allowFontScaling selectable style={styles.quantity}>{item.quantity}</Text>
    </View>
  </View>)}</View>;
}

function RecipeCard({ recipe, references, retryProduct }: {
  recipe: Recipe; references: RecipeReferenceSnapshot; retryProduct: (id: string) => void;
}) {
  const href = catalogDetailHref('recipes', recipe._id);
  const product = readRecipeReference(references.products, recipe.productId);
  return <View style={styles.panel}>
    <Fields fields={recipeListFields(recipe)} />
    <ProductReference productId={recipe.productId} entry={product} retry={() => retryProduct(recipe.productId)} />
    <MembershipSummary recipe={recipe} />
    {href && <Link href={href} asChild accessibilityRole="button">
      <Pressable accessibilityRole="button" accessibilityLabel={`View Recipe version ${recipe.version} details`}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
        <Text allowFontScaling style={styles.buttonText}>View details</Text>
      </Pressable>
    </Link>}
  </View>;
}

function ItemSeparator() { return <View style={styles.separator} />; }

export function RecipeListScreen() {
  const model = useRecipeList();
  const [showFilters, setShowFilters] = useState(false);
  const list = useRef<FlatList<Recipe>>(null);
  const { draft, query, snapshot } = model;
  const loading = snapshot.status === 'idle' || snapshot.status === 'loading';
  const response = snapshot.status === 'success' ? snapshot.data : undefined;
  const status = query.isActive === undefined ? 'All statuses' : query.isActive ? 'Active' : 'Inactive';
  function act(action: () => void) { Keyboard.dismiss(); action(); list.current?.scrollToOffset({ offset: 0, animated: false }); }
  const header = <View style={styles.header}>
    <View style={styles.headingGroup}>
      <Text allowFontScaling accessibilityRole="header" style={styles.title}>Recipes</Text>
      <Text allowFontScaling style={styles.body}>Browse immutable Recipe versions and their current Catalog references.</Text>
    </View>
    <NavigationLink href="/" label="Return to Catalog home" dismissTo />
    <View style={styles.panel}>
      <View style={styles.field}>
        <Text allowFontScaling style={styles.label}>Product UUID</Text>
        <TextInput allowFontScaling accessibilityLabel="Filter Recipes by Product UUID" value={draft.productId}
          onChangeText={productId => model.updateDraft({ productId })} onSubmitEditing={() => act(model.apply)}
          autoCapitalize="none" autoCorrect={false} returnKeyType="done" placeholder="Any Product UUID"
          placeholderTextColor="#61776a" underlineColorAndroid="transparent" style={styles.input} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={showFilters ? 'Hide Recipe filters' : 'Show Recipe filters'}
        accessibilityState={{ expanded: showFilters }} onPress={() => setShowFilters(value => !value)}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
        <Text allowFontScaling style={styles.buttonText}>{showFilters ? 'Hide filters' : 'Show filters'}</Text>
      </Pressable>
      {showFilters && <>
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label}>Size</Text>
          <View style={styles.choices}>{(['all', 'S', 'M', 'L'] as const).map(value => <Pressable key={value}
            accessibilityRole="radio" accessibilityLabel={`Recipe size: ${value === 'all' ? 'All' : value}`}
            accessibilityState={{ checked: draft.size === value }} onPress={() => model.updateDraft({ size: value })}
            style={({ pressed }) => [styles.choice, draft.size === value && styles.choiceSelected, pressed && styles.buttonPressed]}>
            <Text allowFontScaling style={[styles.choiceText, draft.size === value && styles.choiceTextSelected]}>{value === 'all' ? 'All' : value}</Text>
          </Pressable>)}</View>
        </View>
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label}>Status</Text>
          <View style={styles.choices}>{(['all', 'active', 'inactive'] as const).map(value => <Pressable key={value}
            accessibilityRole="radio" accessibilityLabel={`Recipe status: ${value[0].toUpperCase()}${value.slice(1)}`}
            accessibilityState={{ checked: draft.status === value }} onPress={() => model.updateDraft({ status: value })}
            style={({ pressed }) => [styles.choice, draft.status === value && styles.choiceSelected, pressed && styles.buttonPressed]}>
            <Text allowFontScaling style={[styles.choiceText, draft.status === value && styles.choiceTextSelected]}>{value[0].toUpperCase()}{value.slice(1)}</Text>
          </Pressable>)}</View>
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
      <Text allowFontScaling style={styles.body}>{status} · Size {query.size ?? 'All'}</Text>
      {query.productId && <Text allowFontScaling selectable style={styles.body}>Product UUID: {query.productId}</Text>}
      {response && <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>{response.pagination.total} matching Recipes</Text>}
    </View>
  </View>;
  const empty = loading ? <LoadingFeedback label="Loading Recipes..." />
    : snapshot.status === 'error' ? <ErrorFeedback title="Recipes could not be loaded"
      message={snapshot.error?.message ?? 'The Recipe read failed.'} label="Retry Recipes" retry={() => { void model.retry(); }} />
      : <View style={styles.feedback}>
        <Text allowFontScaling accessibilityRole="header" style={styles.sectionTitle}>No Recipes found</Text>
        <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>{response && response.pagination.total > 0
          ? 'There are no Recipes on this page. Use Previous or change the filters.' : 'No Recipes match the applied filters.'}</Text>
      </View>;
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
    <FlatList ref={list} style={styles.list} contentContainerStyle={styles.content} data={response?.data ?? []}
      renderItem={({ item }) => <RecipeCard recipe={item} references={model.references} retryProduct={model.retryProduct} />}
      keyExtractor={item => item._id} keyboardShouldPersistTaps="handled" ListHeaderComponent={header}
      ListEmptyComponent={empty} ItemSeparatorComponent={ItemSeparator} ListFooterComponent={<View style={styles.footer}>
        <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>Page {query.page}{response
          ? response.pagination.totalPages === 0 ? ' · No result pages' : ` of ${response.pagination.totalPages}` : ''}</Text>
        <View style={styles.actions}>
          <ActionButton label="Previous Recipe page" disabled={loading || !model.canPrevious} onPress={() => act(model.previousPage)} />
          <ActionButton label="Next Recipe page" disabled={loading || !model.canNext} onPress={() => act(model.nextPage)} />
        </View>
      </View>} />
  </SafeAreaView>;
}

function IngredientReference({ id, quantity, entry, retry }: {
  id: string; quantity: string; entry?: RecipeReferenceEntry<import('../api/catalog.types').Ingredient>; retry: () => void;
}) {
  return <View style={styles.nestedPanel}>
    <Fields fields={[{ label: 'Ingredient UUID', value: id }]} />
    <View style={styles.field}><Text allowFontScaling style={styles.label}>Quantity</Text>
      <Text allowFontScaling selectable style={styles.quantity}>{quantity}</Text></View>
    {(!entry || entry.status === 'idle' || entry.status === 'loading')
      ? <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>Loading current Ingredient metadata...</Text>
      : entry.status === 'error' ? <View style={styles.referenceError}>
        <Text allowFontScaling accessibilityRole="alert" style={[styles.body, styles.error]}>Current Ingredient metadata is unavailable. Historical membership remains available.</Text>
        <ActionButton label={`Retry current Ingredient metadata for ${id}`} onPress={retry} />
      </View> : <View style={styles.headingGroup}>
        <Text allowFontScaling accessibilityRole="header" style={styles.sectionTitle}>Current Ingredient metadata</Text>
        <Fields fields={ingredientMetadata(entry.data!)} />
      </View>}
  </View>;
}

export function RecipeDetailScreen({ id }: { id: unknown }) {
  const model = useRecipeDetail(id);
  const { snapshot } = model;
  const recipe = snapshot.status === 'success' ? snapshot.data?.data : undefined;
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
    <ScrollView style={styles.list} contentContainerStyle={[styles.content, styles.detailContent]}>
      <Text allowFontScaling accessibilityRole="header" style={styles.title}>Recipe detail</Text>
      {model.invalidId ? <View style={styles.feedback}>
        <Text allowFontScaling accessibilityRole="header" style={styles.sectionTitle}>This link is unavailable</Text>
        <Text allowFontScaling accessibilityRole="alert" style={[styles.body, styles.error]}>A single valid Recipe UUID is required. Open the Recipes list to choose a record.</Text>
      </View> : <>
        {!recipe && model.id && <View style={styles.panel}><Fields fields={[{ label: 'Requested Recipe UUID', value: model.id }]} /></View>}
        {(snapshot.status === 'idle' || snapshot.status === 'loading') && <LoadingFeedback label="Loading Recipe details..." />}
        {snapshot.status === 'error' && <ErrorFeedback title={snapshot.error?.code === 'NOT_FOUND' ? 'Recipe not found' : 'Recipe details could not be loaded'}
          message={snapshot.error?.message ?? 'The Recipe read failed.'} label="Retry Recipe details" retry={() => { void model.retry(); }} />}
        {recipe && <>
          <View style={styles.panel}><Fields fields={recipeDetailFields(recipe)} /></View>
          <View style={styles.panel}>
            <Text allowFontScaling accessibilityRole="header" style={styles.sectionTitle}>Product reference</Text>
            <ProductReference productId={recipe.productId} entry={readRecipeReference(model.references.products, recipe.productId)}
              retry={() => model.retryProduct(recipe.productId)} />
          </View>
          <View style={styles.panel}>
            <Text allowFontScaling accessibilityRole="header" style={styles.sectionTitle}>Ingredient membership</Text>
            {recipe.ingredients.length === 0
              ? <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>This valid historical Recipe has no Ingredient membership. No current Ingredient metadata is available to resolve.</Text>
              : recipe.ingredients.map(item => <IngredientReference key={item.ingredientId} id={item.ingredientId} quantity={item.quantity}
                entry={readRecipeReference(model.references.ingredients, item.ingredientId)}
                retry={() => model.retryIngredient(item.ingredientId)} />)}
          </View>
        </>}
      </>}
      <View style={styles.headingGroup}>
        <NavigationLink href="/recipes" label="Return to Recipes list" dismissTo />
        <NavigationLink href="/" label="Return to Catalog home" dismissTo />
      </View>
    </ScrollView>
  </SafeAreaView>;
}
