import { CatalogApiError } from '../api/catalog.errors.ts';
import type { Ingredient, IngredientQuery } from '../api/catalog.types.ts';

export interface IngredientDraft {
  readonly search: string;
  readonly category: string;
  readonly unit: '' | 'g' | 'ml' | 'piece';
  readonly status: 'default' | 'active' | 'inactive';
  readonly sortBy: NonNullable<IngredientQuery['sortBy']>;
  readonly sortOrder: 'asc' | 'desc';
}
export type IngredientListQuery = IngredientQuery & { readonly page: number; readonly limit: number };
export const DEFAULT_INGREDIENT_DRAFT: IngredientDraft = Object.freeze({
  search: '', category: '', unit: '', status: 'default', sortBy: 'name', sortOrder: 'asc',
});
const sorts = ['name', 'code', 'category', 'unit', 'costPrice', 'minStock', 'createdAt', 'updatedAt'];

/** Only applied filters reach the existing wire client. Blank optional text means omission. */
export function ingredientQuery(draft: IngredientDraft, page = 1): IngredientListQuery {
  if (typeof draft.search !== 'string' || typeof draft.category !== 'string'
    || draft.search.includes('\0') || draft.category.includes('\0')
    || !['', 'g', 'ml', 'piece'].includes(draft.unit) || !['default', 'active', 'inactive'].includes(draft.status)
    || !sorts.includes(draft.sortBy) || !['asc', 'desc'].includes(draft.sortOrder)
    || !Number.isSafeInteger(page) || page < 1 || (page - 1) * 20 > 2_147_483_647) {
    throw new CatalogApiError('BAD_REQUEST');
  }
  return Object.freeze({ page, limit: 20,
    ...(draft.search.trim() ? { search: draft.search.trim() } : {}),
    ...(draft.category.trim() ? { category: draft.category.trim() } : {}),
    ...(draft.unit ? { unit: draft.unit } : {}),
    ...(draft.status === 'default' ? {} : { isActive: draft.status === 'active' }),
    sortBy: draft.sortBy, sortOrder: draft.sortOrder,
  });
}

export interface IngredientField { readonly label: string; readonly value: string }
/** UI and logic tests share presentation values; decimal/timestamp/UUID strings stay intact. */
export function ingredientListFields(record: Ingredient): readonly IngredientField[] {
  return [
    { label: 'Name', value: record.name }, { label: 'Code', value: record.code },
    { label: 'Category', value: record.category }, { label: 'Unit', value: record.unit },
    { label: 'Status', value: record.isActive ? 'Active' : 'Inactive' },
    { label: 'Cost price', value: record.costPrice }, { label: 'Minimum stock', value: record.minStock },
  ];
}
export function ingredientDetailFields(record: Ingredient): readonly IngredientField[] {
  return [{ label: 'UUID', value: record._id }, ...ingredientListFields(record),
    { label: 'Created', value: record.createdAt }, { label: 'Updated', value: record.updatedAt }];
}
