import type { IIngredient } from '../models/Ingredient';

export class RequestError extends Error {
    constructor(public readonly status: number, message: string) { super(message); }
}

export type IngredientInput = Partial<Pick<IIngredient,
    'code' | 'name' | 'category' | 'unit' | 'costPrice' | 'minStock' | 'isActive'>>;
const fields = ['code', 'name', 'category', 'unit', 'costPrice', 'minStock', 'isActive'];
const invalid = (): never => { throw new RequestError(400, 'Invalid request'); };

export function validateBody(body: unknown, patch = false): IngredientInput {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
    const values = body as Record<string, unknown>;
    const keys = Object.keys(values);
    if (!keys.length || keys.some(key => !fields.includes(key))) return invalid();
    if (!patch && ['code', 'name', 'category', 'unit', 'costPrice'].some(key => !Object.hasOwn(values, key))) return invalid();
    for (const key of keys) {
        const value = values[key];
        if (['code', 'name', 'category'].includes(key) && (typeof value !== 'string' || !value.trim())) return invalid();
        if (key === 'unit' && !['g', 'ml', 'piece'].includes(value as string)) return invalid();
        if (['costPrice', 'minStock'].includes(key) && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) return invalid();
        if (key === 'isActive' && typeof value !== 'boolean') return invalid();
    }
    return Object.fromEntries(keys.map(key => [key, values[key]])) as IngredientInput;
}

export function validateId(id: unknown): string {
    if (typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id)) return invalid();
    return id;
}

export function validateQuery(query: Record<string, unknown>) {
    const allowed = ['page', 'limit', 'category', 'unit', 'isActive', 'search', 'sortBy', 'sortOrder'];
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
    const filter: Record<string, unknown> = { isActive: true };
    if (query.isActive !== undefined) {
        if (!['true', 'false'].includes(query.isActive as string)) return invalid();
        filter.isActive = query.isActive === 'true';
    }
    if (query.unit !== undefined) {
        if (!['g', 'ml', 'piece'].includes(query.unit as string)) return invalid();
        filter.unit = query.unit;
    }
    for (const key of ['category', 'search']) {
        if (query[key] !== undefined && !(query[key] as string).trim()) return invalid();
    }
    if (query.category !== undefined) filter.category = (query.category as string).trim();
    if (query.search !== undefined) {
        const literal = (query.search as string).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.$or = ['code', 'name'].map(key => ({ [key]: { $regex: literal, $options: 'i' } }));
    }
    const sortBy = query.sortBy ?? 'name';
    if (!['name', 'code', 'category', 'unit', 'costPrice', 'minStock', 'createdAt', 'updatedAt'].includes(sortBy as string)) return invalid();
    const sortOrder = query.sortOrder ?? 'asc';
    if (!['asc', 'desc'].includes(sortOrder as string)) return invalid();
    const direction = sortOrder === 'asc' ? 1 : -1;
    const sort: Record<string, 1 | -1> = { [sortBy as string]: direction, _id: direction };
    return { page, limit, filter, sort };
}
