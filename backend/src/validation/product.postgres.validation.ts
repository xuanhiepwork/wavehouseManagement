import type { ProductSize } from '../generated/prisma/client';
import { RequestError } from './ingredient.validation';
import { validateQuery as legacyQuery } from './product.validation';
import { decimalInput } from './decimal';
export { validateId } from './ingredient.postgres.validation';

export interface PostgresProductInput {
    code?: string; name?: string; category?: string; description?: string; imageUrl?: string;
    isAvailable?: boolean; prices?: { size: ProductSize; price: string }[];
}
const invalid = (): never => { throw new RequestError(400, 'Invalid request'); };
export function validateBody(body: unknown, patch = false): PostgresProductInput {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid();
    const values = body as Record<string, unknown>;
    const keys = Object.keys(values);
    const fields = ['code', 'name', 'category', 'description', 'imageUrl', 'prices', 'isAvailable'];
    if (!keys.length || keys.some(key => !fields.includes(key))) return invalid();
    if (!patch && ['code', 'name', 'category', 'prices'].some(key => !Object.hasOwn(values, key))) return invalid();
    const output: PostgresProductInput = {};
    for (const key of keys) {
        const value = values[key];
        if (key === 'code' || key === 'name' || key === 'category' || key === 'description' || key === 'imageUrl') {
            if (typeof value !== 'string' || value.includes('\0')) return invalid();
            const normalized = key === 'code' ? value.trim().toUpperCase() : value.trim();
            if (['code', 'name', 'category'].includes(key)) {
                const maximum = key === 'code' ? 64 : key === 'name' ? 200 : 100;
                if (!normalized || [...normalized].length > maximum) return invalid();
            }
            output[key] = normalized;
        } else if (key === 'isAvailable') {
            if (typeof value !== 'boolean') return invalid();
            output.isAvailable = value;
        } else {
            if (!Array.isArray(value) || !value.length || value.length > 3) return invalid();
            const sizes = new Set<string>();
            const prices: NonNullable<PostgresProductInput['prices']> = [];
            for (const entry of value) {
                if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return invalid();
                const item = entry as Record<string, unknown>;
                if (Object.keys(item).length !== 2 || !Object.hasOwn(item, 'size') || !Object.hasOwn(item, 'price')
                    || typeof item.size !== 'string' || !['S', 'M', 'L'].includes(item.size) || sizes.has(item.size)) return invalid();
                sizes.add(item.size);
                prices.push({ size: item.size as ProductSize, price: decimalInput(item.price, 4) });
            }
            output.prices = prices;
        }
    }
    return output;
}
export function validateQuery(query: Record<string, unknown>) {
    const { page, limit } = legacyQuery(query);
    if ((page - 1) * limit > 2147483647) return invalid();
    for (const key of ['category', 'search']) {
        if (typeof query[key] === 'string' && query[key].includes('\0')) return invalid();
    }
    return {
        page, limit, category: typeof query.category === 'string' ? query.category.trim() : undefined,
        search: typeof query.search === 'string' ? query.search.trim() : undefined,
        isAvailable: query.isAvailable === undefined ? undefined : query.isAvailable === 'true',
    };
}
