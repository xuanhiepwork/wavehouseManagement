import { PRODUCT_SIZES } from '../models/Product';
import type { IProduct } from '../models/Product';
import { RequestError } from './ingredient.validation';
export { validateId } from './ingredient.validation';

export type ProductInput = Partial<Pick<IProduct,
    'code' | 'name' | 'category' | 'description' | 'imageUrl' | 'prices' | 'isAvailable'>>;
const fields = ['code', 'name', 'category', 'description', 'imageUrl', 'prices', 'isAvailable'];
const invalid = (): never => { throw new RequestError(400, 'Invalid request'); };

export function validateBody(body: unknown, patch = false): ProductInput {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
    const values = body as Record<string, unknown>;
    const keys = Object.keys(values);
    if (!keys.length || keys.some(key => !fields.includes(key))) return invalid();
    if (!patch && ['code', 'name', 'category', 'prices'].some(key => !Object.hasOwn(values, key))) return invalid();
    for (const key of keys) {
        const value = values[key];
        if (['code', 'name', 'category'].includes(key) && (typeof value !== 'string' || !value.trim())) return invalid();
        if (['description', 'imageUrl'].includes(key) && typeof value !== 'string') return invalid();
        if (key === 'isAvailable' && typeof value !== 'boolean') return invalid();
        if (key === 'prices') {
            if (!Array.isArray(value) || !value.length) return invalid();
            const sizes = new Set<string>();
            for (const entry of value) {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return invalid();
                const price = entry as Record<string, unknown>;
                if (Object.keys(price).length !== 2 || !Object.hasOwn(price, 'size') || !Object.hasOwn(price, 'price')) return invalid();
                if (typeof price.size !== 'string' || !PRODUCT_SIZES.some(size => size === price.size) || sizes.has(price.size)) return invalid();
                if (typeof price.price !== 'number' || !Number.isFinite(price.price) || price.price < 0) return invalid();
                sizes.add(price.size);
            }
        }
    }
    // Schema setters perform normalization on both creation and document PATCH.
    return Object.fromEntries(keys.map(key => [key, values[key]])) as ProductInput;
}

export function validateQuery(query: Record<string, unknown>) {
    const allowed = ['page', 'limit', 'search', 'category', 'isAvailable'];
    if (Object.keys(query).some(key => !allowed.includes(key) || typeof query[key] !== 'string')) return invalid();
    function integer(key: string, fallback: number, max: number) {
        if (query[key] === undefined) return fallback;
        const value = query[key] as string;
        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) return invalid();
        return Number(value);
    }
    const page = integer('page', 1, Number.MAX_SAFE_INTEGER);
    const limit = integer('limit', 20, 100);
    if (!Number.isSafeInteger((page - 1) * limit)) return invalid();
    const filter: Record<string, unknown> = {};
    if (query.isAvailable !== undefined) {
        if (!['true', 'false'].includes(query.isAvailable as string)) return invalid();
        filter.isAvailable = query.isAvailable === 'true';
    }
    for (const key of ['category', 'search']) {
        if (query[key] !== undefined && !(query[key] as string).trim()) return invalid();
    }
    if (query.category !== undefined) filter.category = (query.category as string).trim();
    if (query.search !== undefined) {
        const literal = (query.search as string).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = ['code', 'name'].map(key => ({ [key]: { $regex: literal, $options: 'i' } }));
    }
    return { page, limit, filter };
}
