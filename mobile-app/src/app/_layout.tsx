import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { catalogColors } from '../navigation/catalog.styles';
import { IngredientStateProvider } from '../ingredients/IngredientState';

export default function CatalogLayout() {
  return <IngredientStateProvider>
    <StatusBar style="dark" />
    <Stack screenOptions={{
      headerStyle: { backgroundColor: catalogColors.surface },
      headerTintColor: catalogColors.text,
      headerTitleStyle: { fontWeight: '600' },
      contentStyle: { backgroundColor: catalogColors.background },
    }}>
      <Stack.Screen name="index" options={{ title: 'Catalog' }} />
      <Stack.Screen name="ingredients/index" options={{ title: 'Ingredients' }} />
      <Stack.Screen name="ingredients/[id]" options={{ title: 'Ingredient detail' }} />
      <Stack.Screen name="products/index" options={{ title: 'Products' }} />
      <Stack.Screen name="products/[id]" options={{ title: 'Product detail' }} />
      <Stack.Screen name="recipes/index" options={{ title: 'Recipes' }} />
      <Stack.Screen name="recipes/[id]" options={{ title: 'Recipe detail' }} />
      <Stack.Screen name="+not-found" options={{ title: 'Screen unavailable' }} />
    </Stack>
  </IngredientStateProvider>;
}
