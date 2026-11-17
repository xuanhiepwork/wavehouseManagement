import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Ingredient, IngredientQuery } from '../api/catalog.types';
import { catalogDetailHref } from '../navigation/catalog.routes';
import { useIngredientDetail, useIngredientList } from './IngredientState';
import { ingredientDetailFields, ingredientListFields } from './ingredient.model';
import { ingredientStyles as styles } from './ingredient.styles';

const sortOptions: readonly { value: NonNullable<IngredientQuery['sortBy']>; label: string }[] = [
  { value: 'name', label: 'Name' }, { value: 'code', label: 'Code' },
  { value: 'category', label: 'Category' }, { value: 'unit', label: 'Unit' },
  { value: 'costPrice', label: 'Cost price' }, { value: 'minStock', label: 'Minimum stock' },
  { value: 'createdAt', label: 'Created' }, { value: 'updatedAt', label: 'Updated' },
];

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

function ChoiceGroup<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return <View style={styles.field}>
    <Text allowFontScaling style={styles.label}>{label}</Text>
    <View style={styles.choices}>
      {options.map(option => <Pressable key={option.value} accessibilityRole="radio"
        accessibilityLabel={`${label}: ${option.label}`} accessibilityState={{ checked: value === option.value }}
        onPress={() => onChange(option.value)} style={({ pressed }) => [styles.choice,
          value === option.value && styles.choiceSelected, pressed && styles.buttonPressed]}>
        <Text allowFontScaling style={[styles.choiceText, value === option.value && styles.choiceTextSelected]}>{option.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}

function IngredientFields({ fields }: { fields: readonly { label: string; value: string }[] }) {
  return <>
    {fields.map(field => <View key={field.label} style={styles.field}>
      <Text allowFontScaling style={styles.label}>{field.label}</Text>
      <Text allowFontScaling selectable accessibilityRole={field.label === 'Name' ? 'header' : undefined}
        style={field.label === 'Name' ? styles.name : styles.fieldValue}>{field.value}</Text>
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

function IngredientCard({ ingredient }: { ingredient: Ingredient }) {
  const href = catalogDetailHref('ingredients', ingredient._id);
  return <View style={styles.panel}>
    <IngredientFields fields={ingredientListFields(ingredient)} />
    {href && <Link href={href} asChild accessibilityRole="button">
      <Pressable accessibilityRole="button" accessibilityLabel={`View details for ${ingredient.name} (${ingredient.code})`}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
        <Text allowFontScaling style={styles.buttonText}>View details</Text>
      </Pressable>
    </Link>}
  </View>;
}

function ItemSeparator() { return <View style={styles.separator} />; }

export function IngredientListScreen() {
  const model = useIngredientList();
  const [showFilters, setShowFilters] = useState(false);
  const list = useRef<FlatList<Ingredient>>(null);
  const { draft, query, snapshot } = model;
  const loading = snapshot.status === 'idle' || snapshot.status === 'loading';
  const response = snapshot.status === 'success' ? snapshot.data : undefined;
  const status = query.isActive === undefined ? 'Active (default)' : query.isActive ? 'Active' : 'Inactive';
  const appliedSort = sortOptions.find(option => option.value === (query.sortBy ?? 'name'))?.label ?? 'Name';
  function act(action: () => void) {
    Keyboard.dismiss();
    action();
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }
  const header = <View style={styles.header}>
    <View style={styles.headingGroup}>
      <Text allowFontScaling accessibilityRole="header" style={styles.title}>Ingredients</Text>
      <Text allowFontScaling style={styles.body}>Browse Ingredient records and open their details.</Text>
    </View>
    <NavigationLink href="/" label="Return to Catalog home" dismissTo />
    <View style={styles.panel}>
      <View style={styles.field}>
        <Text allowFontScaling style={styles.label}>Search by code or name</Text>
        <TextInput allowFontScaling accessibilityLabel="Search Ingredients by code or name" value={draft.search}
          onChangeText={search => model.updateDraft({ search })} onSubmitEditing={() => act(model.apply)}
          autoCapitalize="none" autoCorrect={false} returnKeyType="search" placeholder="Code or name"
          placeholderTextColor="#61776a" underlineColorAndroid="transparent" style={styles.input} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={showFilters ? 'Hide Ingredient filters and sorting' : 'Show Ingredient filters and sorting'}
        accessibilityState={{ expanded: showFilters }} onPress={() => setShowFilters(value => !value)}
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}>
        <Text allowFontScaling style={styles.buttonText}>{showFilters ? 'Hide filters and sorting' : 'Show filters and sorting'}</Text>
      </Pressable>
      {showFilters && <>
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label}>Category (exact match)</Text>
          <TextInput allowFontScaling accessibilityLabel="Ingredient category" value={draft.category}
            onChangeText={category => model.updateDraft({ category })} onSubmitEditing={() => act(model.apply)}
            autoCapitalize="none" autoCorrect={false} placeholder="Any category" returnKeyType="done"
            placeholderTextColor="#61776a" underlineColorAndroid="transparent" style={styles.input} />
        </View>
        <ChoiceGroup label="Unit" value={draft.unit} options={[
          { value: '', label: 'Any unit' }, { value: 'g', label: 'Grams (g)' },
          { value: 'ml', label: 'Millilitres (ml)' }, { value: 'piece', label: 'Pieces' },
        ]} onChange={unit => model.updateDraft({ unit })} />
        <ChoiceGroup label="Ingredient status" value={draft.status} options={[
          { value: 'default', label: 'Default (active)' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' },
        ]} onChange={status => model.updateDraft({ status })} />
        <Text allowFontScaling style={styles.body}>Default shows active Ingredients. Choose Inactive to browse inactive Ingredients separately.</Text>
        <ChoiceGroup label="Sort by" value={draft.sortBy} options={sortOptions}
          onChange={sortBy => model.updateDraft({ sortBy })} />
        <ChoiceGroup label="Sort order" value={draft.sortOrder} options={[
          { value: 'asc', label: 'Ascending' }, { value: 'desc', label: 'Descending' },
        ]} onChange={sortOrder => model.updateDraft({ sortOrder })} />
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
      <Text allowFontScaling style={styles.body}>{status} · {appliedSort}, {query.sortOrder === 'desc' ? 'descending' : 'ascending'}</Text>
      {query.search && <Text allowFontScaling style={styles.body}>Search: {query.search}</Text>}
      {query.category && <Text allowFontScaling style={styles.body}>Category: {query.category}</Text>}
      {query.unit && <Text allowFontScaling style={styles.body}>Unit: {query.unit}</Text>}
      {response && <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>{response.pagination.total} matching Ingredients</Text>}
    </View>
  </View>;
  const empty = loading ? <LoadingFeedback label="Loading Ingredients..." />
    : snapshot.status === 'error' ? <ErrorFeedback title="Ingredients could not be loaded"
      message={snapshot.error?.message ?? 'The Ingredient read failed.'} label="Retry Ingredients" retry={() => { void model.retry(); }} />
      : <View style={styles.feedback}>
        <Text allowFontScaling accessibilityRole="header" style={styles.sectionTitle}>No Ingredients found</Text>
        <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>{response && response.pagination.total > 0
          ? 'There are no Ingredients on this page. Use Previous or change the filters.' : 'No Ingredients match the applied filters.'}</Text>
      </View>;
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
    <FlatList ref={list} style={styles.list} contentContainerStyle={styles.content} data={response?.data ?? []}
      renderItem={({ item }) => <IngredientCard ingredient={item} />} keyExtractor={item => item._id}
      keyboardShouldPersistTaps="handled" ListHeaderComponent={header} ListEmptyComponent={empty}
      ItemSeparatorComponent={ItemSeparator} ListFooterComponent={<View style={styles.footer}>
        <Text allowFontScaling accessibilityLiveRegion="polite" style={styles.body}>Page {query.page}{response
          ? response.pagination.totalPages === 0 ? ' · No result pages' : ` of ${response.pagination.totalPages}` : ''}</Text>
        <View style={styles.actions}>
          <ActionButton label="Previous Ingredient page" disabled={loading || !model.canPrevious} onPress={() => act(model.previousPage)} />
          <ActionButton label="Next Ingredient page" disabled={loading || !model.canNext} onPress={() => act(model.nextPage)} />
        </View>
      </View>} />
  </SafeAreaView>;
}

export function IngredientDetailScreen({ id }: { id: unknown }) {
  const model = useIngredientDetail(id);
  const { snapshot } = model;
  const ingredient = snapshot.status === 'success' ? snapshot.data?.data : undefined;
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.screen}>
    <ScrollView style={styles.list} contentContainerStyle={[styles.content, styles.detailContent]}>
      <Text allowFontScaling accessibilityRole="header" style={styles.title}>Ingredient detail</Text>
      {model.invalidId ? <View style={styles.feedback}>
        <Text allowFontScaling accessibilityRole="header" style={styles.sectionTitle}>This link is unavailable</Text>
        <Text allowFontScaling accessibilityRole="alert" style={[styles.body, styles.error]}>A single valid Ingredient UUID is required. Open the Ingredients list to choose a record.</Text>
      </View> : <>
        {!ingredient && model.id && <View style={styles.panel}><IngredientFields fields={[{ label: 'Requested Ingredient UUID', value: model.id }]} /></View>}
        {(snapshot.status === 'idle' || snapshot.status === 'loading') && <LoadingFeedback label="Loading Ingredient details..." />}
        {snapshot.status === 'error' && <ErrorFeedback title={snapshot.error?.code === 'NOT_FOUND' ? 'Ingredient not found' : 'Ingredient details could not be loaded'}
          message={snapshot.error?.message ?? 'The Ingredient read failed.'} label="Retry Ingredient details" retry={() => { void model.retry(); }} />}
        {ingredient && <View style={styles.panel}><IngredientFields fields={ingredientDetailFields(ingredient)} /></View>}
      </>}
      <View style={styles.headingGroup}>
        <NavigationLink href="/ingredients" label="Return to Ingredients list" dismissTo />
        <NavigationLink href="/" label="Return to Catalog home" dismissTo />
      </View>
    </ScrollView>
  </SafeAreaView>;
}
