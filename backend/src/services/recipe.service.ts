import mongoose, { mongo } from 'mongoose';
import type { ClientSession, Types } from 'mongoose';
import { Recipe } from '../models/Recipe';
import { Product } from '../models/Product';
import { Ingredient } from '../models/Ingredient';
import type { ProductSize } from '../models/Product';
import { RequestError } from '../validation/ingredient.validation';
import type { RecipeInput, validateQuery } from '../validation/recipe.validation';

const versionKeys = { productId: 1, size: 1, version: 1 };
const activeKeys = { productId: 1, size: 1 };
function sameKeys(actual: Record<string, unknown>, expected: Record<string, number>) {
    return JSON.stringify(Object.entries(actual)) === JSON.stringify(Object.entries(expected));
}
function duplicate(error: unknown, keys: Record<string, number>): boolean {
    return error instanceof mongo.MongoServerError && error.code === 11000
        && !!error.keyPattern && sameKeys(error.keyPattern, keys)
        && !!error.keyValue && Object.keys(keys).every(key => Object.hasOwn(error.keyValue, key));
}
async function databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
        if (duplicate(error, versionKeys)) throw new RequestError(409, 'Recipe version conflict');
        if (duplicate(error, activeKeys)) throw new RequestError(409, 'Recipe activation conflict');
        if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
            // Do not pass an unclassified 11000 to the Ingredient-specific fallback.
            throw new Error('Unexpected Recipe database conflict', { cause: error });
        }
        throw error;
    }
}
async function verifyIndexes() {
    // Read metadata only, on the primary, before every mutation. Never initialize
    // or alter indexes here. Deployment tooling must provision both indexes.
    const indexes = await Recipe.collection.indexes({ readPreference: 'primary' });
    const valid = (index: typeof indexes[number]) => index.unique === true && !index.sparse
        && !index.buildUUID && (!index.collation || index.collation.locale === 'simple');
    const version = indexes.some(index => valid(index) && sameKeys(index.key, versionKeys) && !index.partialFilterExpression);
    const active = indexes.some(index => valid(index) && sameKeys(index.key, activeKeys)
        && JSON.stringify(index.partialFilterExpression) === JSON.stringify({ isActive: true }));
    if (!version || !active) throw new Error('Required Recipe indexes are unavailable');
}
async function validateReferences(recipe: {
    productId: string | Types.ObjectId;
    size: ProductSize;
    ingredients: { ingredientId: string | Types.ObjectId }[];
}, activating: boolean, session: ClientSession | null = null) {
    const product = await Product.findById(recipe.productId).select('prices isAvailable').session(session).exec();
    if (!product) throw new RequestError(404, 'Product not found');
    const ingredients = await Ingredient.find({ _id: { $in: recipe.ingredients.map(item => item.ingredientId) } })
        .select('_id isActive').session(session).lean().exec();
    if (ingredients.length !== recipe.ingredients.length) throw new RequestError(404, 'Ingredient not found');
    if (!product.prices.some(price => price.size === recipe.size)) throw new RequestError(409, 'Product size is not supported');
    if (activating && (!product.isAvailable || ingredients.some(item => !item.isActive))) {
        throw new RequestError(409, 'Recipe references are unavailable');
    }
}
export function createRecipe(input: RecipeInput) {
    return databaseOperation(async () => {
        await verifyIndexes();
        await validateReferences(input, false);
        for (let attempt = 0; attempt < 3; attempt++) {
            const latest = await Recipe.findOne({ productId: input.productId, size: input.size })
                .sort({ version: -1 }).select('version').lean().exec();
            const version = latest ? latest.version + 1 : 1;
            if (!Number.isSafeInteger(version) || version < 1 || (latest && (!Number.isSafeInteger(latest.version) || latest.version < 1))) {
                throw new Error('Recipe version range is invalid');
            }
            try { return await new Recipe({ ...input, version, isActive: false }).save(); }
            catch (error) { if (!duplicate(error, versionKeys) || attempt === 2) throw error; }
        }
        throw new Error('Recipe version allocation failed');
    });
}
export function listRecipes(query: ReturnType<typeof validateQuery>) {
    return databaseOperation(async () => {
        const { page, limit, filter } = query;
        const [data, total] = await Promise.all([
            Recipe.find(filter).sort({ productId: 1, size: 1, version: -1, _id: 1 })
                .skip((page - 1) * limit).limit(limit).exec(),
            Recipe.countDocuments(filter).exec(),
        ]);
        return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    });
}
export function getRecipe(id: string) {
    return databaseOperation(async () => {
        const recipe = await Recipe.findById(id).exec();
        if (!recipe) throw new RequestError(404, 'Recipe not found');
        return recipe;
    });
}
export function activateRecipe(id: string) {
    return databaseOperation(async () => {
        await verifyIndexes();
        const session = await mongoose.connection.startSession();
        let attempts = 0;
        try {
            // Driver handles transient transaction and uncertain commit retries.
            // Callback attempts and total transaction time are both bounded.
            return await session.withTransaction(async () => {
                if (++attempts > 3) throw new RequestError(409, 'Recipe activation conflict');
                const recipe = await Recipe.findById(id).session(session).exec();
                if (!recipe) throw new RequestError(404, 'Recipe not found');
                await validateReferences(recipe, true, session);
                if (recipe.isActive) return recipe;
                await Recipe.updateMany({ productId: recipe.productId, size: recipe.size, isActive: true, _id: { $ne: recipe._id } },
                    { $set: { isActive: false } }, { session });
                recipe.isActive = true;
                await recipe.save({ session });
                return recipe;
            }, { readPreference: 'primary', readConcern: { level: 'snapshot' },
                writeConcern: { w: 'majority' }, maxCommitTimeMS: 5000, timeoutMS: 10000 });
        } catch (error) {
            if (error instanceof mongo.MongoError && error.hasErrorLabel('UnknownTransactionCommitResult')) {
                throw new Error('Recipe activation outcome is uncertain', { cause: error });
            }
            if (error instanceof mongo.MongoError && error.hasErrorLabel('TransientTransactionError')) {
                throw new RequestError(409, 'Recipe activation conflict');
            }
            throw error;
        } finally { await session.endSession(); }
        // A timeout/uncertain commit is a sanitized 500, never a rollback claim.
    });
}
export function deactivateRecipe(id: string) {
    return databaseOperation(async () => {
        await verifyIndexes();
        const updated = await Recipe.findOneAndUpdate({ _id: id, isActive: true }, { $set: { isActive: false } },
            { new: true, runValidators: true }).exec();
        if (updated) return updated;
        return getRecipe(id);
    });
}
