import type { ProductSize } from '../generated/prisma/client';
import { RequestError } from './ingredient.validation';
import { validateId } from './ingredient.postgres.validation';
import { decimalInput } from './decimal';
export { validateId } from './ingredient.postgres.validation';

export interface PostgresRecipeInput {
    productId: string; size: ProductSize; ingredients: { ingredientId: string; quantity: string }[];
}
const invalid = (): never => { throw new RequestError(400, 'Invalid request'); };
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    return value as Record<string, unknown>;
}
function size(value: unknown): ProductSize {
    if (typeof value !== 'string' || !['S', 'M', 'L'].includes(value)) return invalid();
    return value as ProductSize;
}
export function validateBody(body: unknown): PostgresRecipeInput {
    const values = object(body);
    if (Object.keys(values).length !== 3 || !['productId', 'size', 'ingredients'].every(key => Object.hasOwn(values, key))) return invalid();
    const productId = validateId(values.productId);
    const recipeSize = size(values.size);
    if (!Array.isArray(values.ingredients) || !values.ingredients.length) return invalid();
    const seen = new Set<string>();
    const ingredients = [];
    for (const entry of values.ingredients) {
        const item = object(entry);
        if (Object.keys(item).length !== 2 || !Object.hasOwn(item, 'ingredientId') || !Object.hasOwn(item, 'quantity')) return invalid();
        const ingredientId = validateId(item.ingredientId);
        if (seen.has(ingredientId)) return invalid();
        const quantity = decimalInput(item.quantity, 6);
        if (quantity === '0') return invalid();
        seen.add(ingredientId); ingredients.push({ ingredientId, quantity });
    }
    return { productId, size: recipeSize, ingredients };
}
export function validateActionBody(body: unknown): void {
    if (body !== undefined && Object.keys(object(body)).length !== 0) invalid();
}
export function validateQuery(query: Record<string, unknown>, listing = true) {
    const allowed = listing ? ['page', 'limit', 'productId', 'size', 'isActive'] : [];
    if (Object.keys(query).some(key => !allowed.includes(key) || typeof query[key] !== 'string')) return invalid();
    function integer(key: string, fallback: number, maximum: number) {
        if (query[key] === undefined) return fallback;
        const value = query[key] as string;
        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) return invalid();
        return Number(value);
    }
    const page = integer('page', 1, Number.MAX_SAFE_INTEGER), limit = integer('limit', 20, 100);
    if (!Number.isSafeInteger((page - 1) * limit) || (page - 1) * limit > 2147483647) return invalid();
    return { page, limit, productId: query.productId === undefined ? undefined : validateId(query.productId),
        size: query.size === undefined ? undefined : size(query.size),
        isActive: query.isActive === undefined ? undefined : query.isActive === 'true' ? true : query.isActive === 'false' ? false : invalid() };
}
