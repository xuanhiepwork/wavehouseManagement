import { Types } from 'mongoose';
import { PRODUCT_SIZES } from '../models/Product';
import type { ProductSize } from '../models/Product';
import { RequestError, validateId } from './ingredient.validation';
export { validateId } from './ingredient.validation';

export interface RecipeInput {
    productId: string;
    size: ProductSize;
    ingredients: { ingredientId: string; quantity: number }[];
}
const invalid = (): never => { throw new RequestError(400, 'Invalid request'); };
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
    return value as Record<string, unknown>;
}
function size(value: unknown): ProductSize {
    if (typeof value !== 'string' || !PRODUCT_SIZES.some(item => item === value)) return invalid();
    return value as ProductSize;
}
export function validateBody(body: unknown): RecipeInput {
    const values = object(body);
    if (Object.keys(values).length !== 3 || !['productId', 'size', 'ingredients'].every(key => Object.hasOwn(values, key))) return invalid();
    const productId = validateId(values.productId).toLowerCase();
    const recipeSize = size(values.size);
    if (!Array.isArray(values.ingredients) || !values.ingredients.length) return invalid();
    const seen = new Set<string>();
    const ingredients = [];
    for (const item of values.ingredients) {
        const entry = object(item);
        if (Object.keys(entry).length !== 2 || !Object.hasOwn(entry, 'ingredientId') || !Object.hasOwn(entry, 'quantity')) return invalid();
        const ingredientId = validateId(entry.ingredientId).toLowerCase();
        if (seen.has(ingredientId)) return invalid();
        if (typeof entry.quantity !== 'number' || !Number.isFinite(entry.quantity) || entry.quantity <= 0) return invalid();
        seen.add(ingredientId);
        ingredients.push({ ingredientId, quantity: entry.quantity });
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
    const page = integer('page', 1, Number.MAX_SAFE_INTEGER);
    const limit = integer('limit', 20, 100);
    if (!Number.isSafeInteger((page - 1) * limit)) return invalid();
    const filter: Record<string, unknown> = {};
    if (query.productId !== undefined) filter.productId = new Types.ObjectId(validateId(query.productId));
    if (query.size !== undefined) filter.size = size(query.size);
    if (query.isActive !== undefined) {
        if (query.isActive !== 'true' && query.isActive !== 'false') return invalid();
        filter.isActive = query.isActive === 'true';
    }
    return { page, limit, filter };
}
