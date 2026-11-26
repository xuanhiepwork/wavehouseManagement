import { RequestError } from './request-error';

// Shared HTTP query rules; this module has no persistence dependency.
export function catalogQuery(query: Record<string, unknown>, ingredients = false) {
    const invalid = (): never => { throw new RequestError(400, 'Invalid request'); };
    const allowed = ['page', 'limit', 'category', 'search', ...(ingredients
        ? ['unit', 'isActive', 'sortBy', 'sortOrder'] : ['isAvailable'])];
    if (Object.keys(query).some(key => !allowed.includes(key) || typeof query[key] !== 'string')) invalid();
    function integer(key: string, fallback: number, maximum: number) {
        if (query[key] === undefined) return fallback;
        const value = query[key] as string;
        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) return invalid();
        return Number(value);
    }
    const page = integer('page', 1, Number.MAX_SAFE_INTEGER), limit = integer('limit', 20, 100);
    if (!Number.isSafeInteger((page - 1) * limit) || (page - 1) * limit > 2147483647) invalid();
    for (const key of ['category', 'search']) {
        const value = query[key];
        if (value !== undefined && (!(value as string).trim() || (value as string).includes('\0'))) invalid();
    }
    for (const key of ['isActive', 'isAvailable']) {
        if (query[key] !== undefined && !['true', 'false'].includes(query[key] as string)) invalid();
    }
    if (query.unit !== undefined && !['g', 'ml', 'piece'].includes(query.unit as string)) invalid();
    if (query.sortBy !== undefined && !['name', 'code', 'category', 'unit', 'costPrice', 'minStock', 'createdAt', 'updatedAt'].includes(query.sortBy as string)) invalid();
    if (query.sortOrder !== undefined && !['asc', 'desc'].includes(query.sortOrder as string)) invalid();
    return { page, limit };
}
