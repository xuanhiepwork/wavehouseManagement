import type { Ingredient, Product, Recipe } from '../../src/api/catalog.types.ts';

export const ingredientId = '12345678-1234-1234-1234-123456789abc';
export const productId = '22345678-1234-1234-1234-123456789abc';
export const recipeId = '32345678-1234-1234-1234-123456789abc';
export const otherId = '42345678-1234-1234-1234-123456789abc';
export const metadata = {
  createdAt: '2026-11-05T00:00:00.000Z',
  updatedAt: '2026-11-05T01:00:00.000Z',
};

export const ingredient: Ingredient = {
  ...metadata, _id: ingredientId, code: 'MILK', name: 'Milk', category: 'Dairy', unit: 'ml',
  costPrice: '99999999999999.9999', minStock: '999999999999.999999', isActive: false,
};
export const product: Product = {
  ...metadata, _id: productId, code: 'TEA', name: 'Tea', category: 'Drinks', isAvailable: false,
  prices: [{ size: 'L', price: '99999999999999.9999' }, { size: 'S', price: '0' }, { size: 'M', price: '0.0001' }],
};
export const recipe: Recipe = {
  ...metadata, _id: recipeId, productId, size: 'L', version: 2, isActive: false,
  ingredients: [{ ingredientId: otherId, quantity: '999999999999.999999' }, { ingredientId, quantity: '0.000001' }],
};
export const pagination = { page: 1, limit: 20, total: 1, totalPages: 1 };
