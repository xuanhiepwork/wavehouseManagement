import type { Recipe, RecipeIngredient, ProductVariant } from '../generated/prisma/client';

export type RecipeRecord = Recipe & { ingredients: RecipeIngredient[]; productVariant: ProductVariant };
export function serializeRecipe(row: RecipeRecord) {
    return { _id: row.id, productId: row.productVariant.productId, size: row.productVariant.size,
        ingredients: [...row.ingredients].sort((a, b) => a.ingredientId < b.ingredientId ? -1 : a.ingredientId > b.ingredientId ? 1 : 0)
            .map(item => ({ ingredientId: item.ingredientId, quantity: item.quantity.toFixed().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') })),
        version: row.version, isActive: row.productVariant.activeRecipeId === row.id,
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
