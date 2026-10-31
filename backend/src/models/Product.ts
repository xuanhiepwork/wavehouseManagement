import { Schema, model } from 'mongoose';

export const PRODUCT_SIZES = ['S', 'M', 'L'] as const;
export type ProductSize = typeof PRODUCT_SIZES[number];

export interface IProductPrice {
    size: ProductSize;
    price: number;
}

export interface IProduct {
    code: string;
    name: string;
    category: string;
    description?: string;
    imageUrl?: string;
    prices: IProductPrice[];
    isAvailable: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const priceSchema = new Schema<IProductPrice>({
    size: { type: String, required: true, enum: PRODUCT_SIZES },
    price: {
        type: Number, required: true, min: 0,
        validate: { validator: Number.isFinite, message: 'price must be finite' },
    },
}, { _id: false });

const productSchema = new Schema<IProduct>({
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    prices: {
        type: [priceSchema], required: true, default: undefined,
        validate: [
            {
                validator: (prices: IProductPrice[]) => Array.isArray(prices) && prices.length > 0,
                message: 'A product must have at least one price configuration',
            },
            {
                validator: (prices: IProductPrice[]) => Array.isArray(prices)
                    && prices.every(price => price != null)
                    && new Set(prices.map(price => price.size)).size === prices.length,
                message: 'Price entries must be non-null and have unique sizes',
            },
        ],
    },
    isAvailable: { type: Boolean, required: true, default: true },
}, { timestamps: true });

productSchema.index({ code: 1 }, { unique: true });

export const Product = model<IProduct>('Product', productSchema);
export default Product;
