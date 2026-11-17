/** PostgreSQL wire values. Display decimals without numeric conversion. */
export type UUID = string;
export type DecimalString = string;
export type BaseUnit = 'g' | 'ml' | 'piece';
export type IngredientUnit = BaseUnit;
export type ProductSize = 'S' | 'M' | 'L';

interface RecordMetadata {
  readonly _id: UUID;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Ingredient extends RecordMetadata {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly unit: BaseUnit;
  readonly costPrice: DecimalString;
  readonly minStock: DecimalString;
  readonly isActive: boolean;
}

export interface ProductPrice {
  readonly size: ProductSize;
  readonly price: DecimalString;
}

export interface Product extends RecordMetadata {
  readonly code: string;
  readonly name: string;
  readonly category: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly prices: readonly ProductPrice[];
  readonly isAvailable: boolean;
}

export interface RecipeIngredient {
  readonly ingredientId: UUID;
  readonly quantity: DecimalString;
}

export interface Recipe extends RecordMetadata {
  readonly productId: UUID;
  readonly size: ProductSize;
  readonly ingredients: readonly RecipeIngredient[];
  readonly version: number;
  readonly isActive: boolean;
}

export interface DataEnvelope<T> {
  readonly data: T;
}

export interface Pagination {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface PageEnvelope<T> extends DataEnvelope<readonly T[]> {
  readonly pagination: Pagination;
}

/** Backend wire shape; clients must sanitize messages before exposing errors. */
export interface ErrorEnvelope {
  readonly error: string;
}

export interface PageQuery {
  readonly page?: number;
  readonly limit?: number;
}

export interface IngredientQuery extends PageQuery {
  readonly category?: string;
  readonly unit?: BaseUnit;
  readonly isActive?: boolean;
  readonly search?: string;
  readonly sortBy?: 'name' | 'code' | 'category' | 'unit' | 'costPrice' | 'minStock' | 'createdAt' | 'updatedAt';
  readonly sortOrder?: 'asc' | 'desc';
}

export interface ProductQuery extends PageQuery {
  readonly category?: string;
  readonly search?: string;
  readonly isAvailable?: boolean;
}

export interface RecipeQuery extends PageQuery {
  readonly productId?: UUID;
  readonly size?: ProductSize;
  readonly isActive?: boolean;
}
