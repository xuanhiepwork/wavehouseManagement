import type {
  DataEnvelope, Ingredient, PageEnvelope, Product, ProductPrice, ProductSize,
  Recipe, RecipeIngredient, UUID,
} from './catalog.types.ts';

export type Guard<T> = (value: unknown) => value is T;
type ObjectValue = Record<string, unknown>;

const isObject = (value: unknown): value is ObjectValue => value !== null
  && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isNonnegativeInteger = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0;
const isSize = (value: unknown): value is ProductSize => value === 'S' || value === 'M' || value === 'L';

export const isUuid: Guard<UUID> = (value): value is UUID => isText(value)
  && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value);

function isTimestamp(value: unknown): value is string {
  if (!isText(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString() === value;
}

/** Canonical nonnegative NUMERIC(18, scale), checked without decimal coercion. */
function isDecimal(value: unknown, scale: number, positive = false): value is string {
  if (!isText(value) || value.length > 100 || !/^(0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value)) return false;
  const [whole, fraction = ''] = value.split('.');
  return whole.length <= 18 - scale && fraction.length <= scale && (!positive || value !== '0');
}

function hasMetadata(value: ObjectValue): boolean {
  return isUuid(value._id) && isTimestamp(value.createdAt) && isTimestamp(value.updatedAt) && !('__v' in value);
}

function hasCatalogMetadata(value: ObjectValue): boolean {
  return hasMetadata(value) && isText(value.code) && isText(value.name) && isText(value.category);
}

export const ingredientGuard: Guard<Ingredient> = (value): value is Ingredient => isObject(value)
  && hasCatalogMetadata(value) && (value.unit === 'g' || value.unit === 'ml' || value.unit === 'piece')
  && isDecimal(value.costPrice, 4) && isDecimal(value.minStock, 6) && typeof value.isActive === 'boolean';

const productPriceGuard: Guard<ProductPrice> = (value): value is ProductPrice => isObject(value)
  && isSize(value.size) && isDecimal(value.price, 4);

export const productGuard: Guard<Product> = (value): value is Product => {
  if (!isObject(value) || !hasCatalogMetadata(value)
    || (value.description !== undefined && !isText(value.description))
    || (value.imageUrl !== undefined && !isText(value.imageUrl))
    || typeof value.isAvailable !== 'boolean' || !Array.isArray(value.prices)
    || value.prices.length === 0 || value.prices.length > 3 || !value.prices.every(productPriceGuard)) return false;
  return new Set(value.prices.map(price => price.size)).size === value.prices.length;
};

const recipeIngredientGuard: Guard<RecipeIngredient> = (value): value is RecipeIngredient => isObject(value)
  && isUuid(value.ingredientId) && isDecimal(value.quantity, 6, true);

/** Empty membership is valid historical Recipe data. */
export const recipeGuard: Guard<Recipe> = (value): value is Recipe => {
  if (!isObject(value) || !hasMetadata(value) || !isUuid(value.productId) || !isSize(value.size)
    || !isNonnegativeInteger(value.version) || value.version === 0 || typeof value.isActive !== 'boolean'
    || !Array.isArray(value.ingredients) || !value.ingredients.every(recipeIngredientGuard)) return false;
  return new Set(value.ingredients.map(item => item.ingredientId.toLowerCase())).size === value.ingredients.length;
};

export function isDataEnvelope<T>(value: unknown, guard: Guard<T>): value is DataEnvelope<T> {
  return isObject(value) && guard(value.data);
}

export function isPageEnvelope<T>(value: unknown, guard: Guard<T>): value is PageEnvelope<T> {
  if (!isObject(value) || !Array.isArray(value.data) || !value.data.every(guard) || !isObject(value.pagination)) return false;
  const pagination = value.pagination;
  return isNonnegativeInteger(pagination.page) && pagination.page > 0
    && isNonnegativeInteger(pagination.limit) && pagination.limit > 0 && pagination.limit <= 100
    && isNonnegativeInteger(pagination.total) && isNonnegativeInteger(pagination.totalPages)
    && pagination.totalPages === Math.ceil(pagination.total / pagination.limit)
    && value.data.length <= pagination.limit;
}
