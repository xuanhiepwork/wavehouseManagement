import { CatalogApiError } from '../api/catalog.errors.ts';
import type { Ingredient, Product, Recipe, RecipeQuery } from '../api/catalog.types.ts';
import { isUuid } from '../api/catalog.validation.ts';

export interface RecipeDraft {
  readonly productId: string;
  readonly size: 'all' | 'S' | 'M' | 'L';
  readonly status: 'all' | 'active' | 'inactive';
}

export type RecipeListQuery = RecipeQuery & { readonly page: number; readonly limit: number };
export const DEFAULT_RECIPE_DRAFT: RecipeDraft = Object.freeze({ productId: '', size: 'all', status: 'all' });

/** Recipe ordering belongs to the backend; this query deliberately exposes no search or sorting. */
export function recipeQuery(draft: RecipeDraft, page = 1): RecipeListQuery {
  const productId = typeof draft.productId === 'string' ? draft.productId.trim() : '';
  if ((productId && !isUuid(productId)) || !['all', 'S', 'M', 'L'].includes(draft.size)
    || !['all', 'active', 'inactive'].includes(draft.status)
    || !Number.isSafeInteger(page) || page < 1 || (page - 1) * 20 > 2_147_483_647) {
    throw new CatalogApiError('BAD_REQUEST');
  }
  return Object.freeze({ page, limit: 20,
    ...(productId ? { productId } : {}),
    ...(draft.size === 'all' ? {} : { size: draft.size }),
    ...(draft.status === 'all' ? {} : { isActive: draft.status === 'active' }),
  });
}

export function recipeListFields(record: Recipe) {
  return Object.freeze([
    { label: 'Recipe UUID', value: record._id },
    { label: 'Product UUID', value: record.productId },
    { label: 'Size', value: record.size },
    { label: 'Version', value: String(record.version) },
    { label: 'Status', value: record.isActive ? 'Active' : 'Inactive' },
    { label: 'Ingredient membership', value: record.ingredients.length === 0
      ? 'No ingredients in this historical version' : `${record.ingredients.length} ingredient${record.ingredients.length === 1 ? '' : 's'}` },
  ] as const);
}

export function recipeDetailFields(record: Recipe) {
  return Object.freeze([
    { label: 'Recipe UUID', value: record._id },
    { label: 'Product UUID', value: record.productId },
    { label: 'Size', value: record.size },
    { label: 'Version', value: String(record.version) },
    { label: 'Status', value: record.isActive ? 'Active' : 'Inactive' },
    { label: 'Created', value: record.createdAt },
    { label: 'Updated', value: record.updatedAt },
  ] as const);
}

export function productMetadata(record: Product) {
  return Object.freeze([
    { label: 'Current Product name', value: record.name },
    { label: 'Current Product code', value: record.code },
    { label: 'Current Product availability', value: record.isAvailable ? 'Available' : 'Unavailable' },
  ] as const);
}

export function ingredientMetadata(record: Ingredient) {
  return Object.freeze([
    { label: 'Current Ingredient name', value: record.name },
    { label: 'Current Ingredient code', value: record.code },
    { label: 'Current Ingredient unit', value: record.unit },
    { label: 'Current Ingredient status', value: record.isActive ? 'Active' : 'Inactive' },
  ] as const);
}
