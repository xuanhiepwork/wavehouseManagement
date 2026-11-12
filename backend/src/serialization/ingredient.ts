import type { Ingredient } from '../generated/prisma/client';

export function serializeIngredient(row: Ingredient) {
    return {
        _id: row.id, code: row.code, name: row.name, category: row.category, unit: row.unit,
        costPrice: row.costPrice.toFixed().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''),
        minStock: row.minStock.toFixed().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''),
        isActive: row.isActive, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
}
