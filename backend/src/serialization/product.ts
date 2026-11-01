import type { Product, ProductVariant } from '../generated/prisma/client';

const sizes = ['S', 'M', 'L'];
export function serializeProduct(row: Product & { variants: ProductVariant[] }) {
    return {
        _id: row.id, code: row.code, name: row.name, category: row.category,
        ...(row.description === null ? {} : { description: row.description }),
        ...(row.imageUrl === null ? {} : { imageUrl: row.imageUrl }),
        prices: [...row.variants].sort((a, b) => sizes.indexOf(a.size) - sizes.indexOf(b.size))
            .map(variant => ({ size: variant.size, price: variant.price.toFixed().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') })),
        isAvailable: row.isAvailable, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
}
