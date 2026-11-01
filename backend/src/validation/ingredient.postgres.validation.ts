import type { BaseUnit } from '../generated/prisma/client';
import { RequestError, validateQuery as legacyQuery } from './ingredient.validation';
import { decimalInput } from './decimal';

export interface PostgresIngredientInput {
    code?: string; name?: string; category?: string; unit?: BaseUnit;
    costPrice?: string; minStock?: string; isActive?: boolean;
}
const invalid = (): never => { throw new RequestError(400, 'Invalid request'); };
export function validateId(id: unknown): string {
    if (typeof id !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)) return invalid();
    return id.toLowerCase();
}
export function validateBody(body: unknown, patch = false): PostgresIngredientInput {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
    const values = body as Record<string, unknown>;
    const keys = Object.keys(values);
    const fields = ['code', 'name', 'category', 'unit', 'costPrice', 'minStock', 'isActive'];
    if (!keys.length || keys.some(key => !fields.includes(key))) return invalid();
    if (!patch && ['code', 'name', 'category', 'unit', 'costPrice'].some(key => !Object.hasOwn(values, key))) return invalid();
    const output: Record<string, unknown> = {};
    for (const key of keys) {
        const value = values[key];
        if (['code', 'name', 'category'].includes(key)) {
            if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return invalid();
            const normalized = key === 'code' ? value.trim().toUpperCase() : value.trim();
            const max = key === 'code' ? 64 : key === 'name' ? 200 : 100;
            if ([...normalized].length > max) return invalid();
            output[key] = normalized;
        } else if (key === 'costPrice' || key === 'minStock') {
            output[key] = decimalInput(value, key === 'costPrice' ? 4 : 6);
        } else if (key === 'unit') {
            if (!['g', 'ml', 'piece'].includes(value as string)) return invalid();
            output[key] = value;
        } else {
            if (typeof value !== 'boolean') return invalid();
            output[key] = value;
        }
    }
    return output as PostgresIngredientInput;
}
export function validateQuery(query: Record<string, unknown>) {
    // Reuse the established public query checks, not its MongoDB filter/sort output.
    const { page, limit } = legacyQuery(query);
    if ((page - 1) * limit > 2147483647) return invalid();
    for (const key of ['category', 'search']) {
        if (typeof query[key] === 'string' && query[key].includes('\0')) return invalid();
    }
    return {
        page, limit, category: typeof query.category === 'string' ? query.category.trim() : undefined,
        unit: query.unit as BaseUnit | undefined, isActive: query.isActive !== 'false',
        search: typeof query.search === 'string' ? query.search.trim() : undefined,
        sortBy: (query.sortBy ?? 'name') as string, sortOrder: (query.sortOrder ?? 'asc') as 'asc' | 'desc',
    };
}
