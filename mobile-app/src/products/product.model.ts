import { CatalogApiError } from '../api/catalog.errors.ts';
import type { Product, ProductPrice, ProductQuery } from '../api/catalog.types.ts';

export interface ProductDraft {
  readonly search: string;
  readonly category: string;
  readonly availability: 'all' | 'available' | 'unavailable';
}
export type ProductListQuery = ProductQuery & { readonly page: number; readonly limit: number };
export const DEFAULT_PRODUCT_DRAFT: ProductDraft = Object.freeze({ search: '', category: '', availability: 'all' });

/** Product ordering belongs to the backend; this query deliberately exposes no sorting. */
export function productQuery(draft: ProductDraft, page = 1): ProductListQuery {
  if (typeof draft.search !== 'string' || typeof draft.category !== 'string'
    || draft.search.includes('\0') || draft.category.includes('\0')
    || !['all', 'available', 'unavailable'].includes(draft.availability)
    || !Number.isSafeInteger(page) || page < 1 || (page - 1) * 20 > 2_147_483_647) {
    throw new CatalogApiError('BAD_REQUEST');
  }
  return Object.freeze({ page, limit: 20,
    ...(draft.search.trim() ? { search: draft.search.trim() } : {}),
    ...(draft.category.trim() ? { category: draft.category.trim() } : {}),
    ...(draft.availability === 'all' ? {} : { isAvailable: draft.availability === 'available' }),
  });
}

/** Select only supported sizes, without mutating the wire array or converting decimal strings. */
export function orderedProductPrices(record: Product): readonly ProductPrice[] {
  return (['S', 'M', 'L'] as const).flatMap(size => record.prices.filter(price => price.size === size));
}
export interface ProductField { readonly label: string; readonly value: string }
export function productListFields(record: Product): readonly ProductField[] {
  return [
    { label: 'Name', value: record.name }, { label: 'Code', value: record.code },
    { label: 'Category', value: record.category },
    { label: 'Availability', value: record.isAvailable ? 'Available' : 'Unavailable' },
    ...orderedProductPrices(record).map(item => ({ label: `Price (${item.size})`, value: item.price })),
  ];
}
export function productDetailFields(record: Product): readonly ProductField[] {
  return [{ label: 'UUID', value: record._id }, ...productListFields(record),
    { label: 'Created', value: record.createdAt }, { label: 'Updated', value: record.updatedAt }];
}
