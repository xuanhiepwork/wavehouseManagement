import { mongo } from 'mongoose';
import type { HydratedDocument } from 'mongoose';
import { Product } from '../models/Product';
import type { IProduct } from '../models/Product';
import { RequestError } from '../validation/ingredient.validation';
import type { ProductInput, validateQuery } from '../validation/product.validation';

async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
            if (error instanceof mongo.MongoServerError && error.keyPattern
                && Object.keys(error.keyPattern).length === 1 && error.keyPattern.code === 1
                && typeof error.keyValue?.code === 'string') {
                throw new RequestError(409, 'Product code already exists');
            }
            // The existing shared handler treats every raw 11000 as an Ingredient
            // conflict. Keep unrelated/ambiguous Product database failures at 500.
            throw new Error('Unexpected Product database conflict', { cause: error });
        }
        throw error;
    }
}

function saveProduct(product: HydratedDocument<IProduct>) {
    return databaseOperation(() => product.save());
}

// Indexes follow the existing connection/autoIndex lifecycle. Deployments with
// autoIndex disabled must provision the unique code index before serving traffic.
// No request calls init/createIndexes; a schema declaration is not enforcement.
export async function createProduct(input: ProductInput) {
    return saveProduct(new Product(input));
}

export async function listProducts(query: ReturnType<typeof validateQuery>) {
    const { page, limit, filter } = query;
    const [data, total] = await databaseOperation(() => Promise.all([
        Product.find(filter).sort({ code: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).exec(),
        Product.countDocuments(filter).exec(),
    ]));
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getProduct(id: string) {
    const product = await databaseOperation(() => Product.findById(id).exec());
    if (!product) throw new RequestError(404, 'Product not found');
    return product;
}

export async function updateProduct(id: string, input: ProductInput) {
    const product = await getProduct(id);
    Object.assign(product, input);
    return saveProduct(product);
}

export async function deleteProduct(id: string) {
    const product = await getProduct(id);
    if (product.isAvailable) {
        product.isAvailable = false;
        await saveProduct(product);
    }
    return product;
}
