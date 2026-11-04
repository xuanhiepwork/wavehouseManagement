/** PostgreSQL wire values. Decimal values must never pass through Number/parseFloat. */
export type UUID = string
export type DecimalString = string
export type BaseUnit = 'g' | 'ml' | 'piece'
export type ProductSize = 'S' | 'M' | 'L'

interface RecordMetadata {
  _id: UUID
  createdAt: string
  updatedAt: string
}

export interface IngredientInput {
  code: string
  name: string
  category: string
  unit: BaseUnit
  costPrice: DecimalString
  minStock?: DecimalString
  isActive?: boolean
}
export interface Ingredient extends RecordMetadata, IngredientInput {
  minStock: DecimalString
  isActive: boolean
}
export interface ProductPrice { size: ProductSize; price: DecimalString }
export interface ProductInput {
  code: string
  name: string
  category: string
  description?: string
  imageUrl?: string
  prices: ProductPrice[]
  isAvailable?: boolean
}
export interface Product extends RecordMetadata, ProductInput { isAvailable: boolean }
export interface RecipeIngredient { ingredientId: UUID; quantity: DecimalString }
export interface RecipeInput {
  productId: UUID
  size: ProductSize
  ingredients: RecipeIngredient[]
}
export interface Recipe extends RecordMetadata, RecipeInput {
  version: number
  isActive: boolean
}

export interface DataEnvelope<T> { data: T }
export interface Pagination { page: number; limit: number; total: number; totalPages: number }
export interface PageEnvelope<T> extends DataEnvelope<T[]> { pagination: Pagination }
/** Backend wire format; its message is never exposed directly to consumers. */
export interface ErrorEnvelope { error: string }

export interface PageQuery { page?: number; limit?: number }
export interface IngredientQuery extends PageQuery {
  category?: string
  unit?: BaseUnit
  isActive?: boolean
  search?: string
  sortBy?: 'name' | 'code' | 'category' | 'unit' | 'costPrice' | 'minStock' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}
export interface ProductQuery extends PageQuery {
  category?: string
  search?: string
  isAvailable?: boolean
}
export interface RecipeQuery extends PageQuery {
  productId?: UUID
  size?: ProductSize
  isActive?: boolean
}
