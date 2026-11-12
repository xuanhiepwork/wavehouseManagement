import { Schema, model } from 'mongoose';
import type { Types } from 'mongoose';
import { PRODUCT_SIZES } from './Product';
import type { ProductSize } from './Product';

export interface IRecipeIngredient {
    ingredientId: Types.ObjectId;
    quantity: number;
}

export interface IRecipe {
    productId: Types.ObjectId;
    size: ProductSize;
    ingredients: IRecipeIngredient[];
    version: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const recipeIngredientSchema = new Schema<IRecipeIngredient>({
    ingredientId: { type: Schema.Types.ObjectId, required: true, ref: 'Ingredient' },
    quantity: {
        type: Number, required: true,
        validate: {
            validator: (quantity: number) => Number.isFinite(quantity) && quantity > 0,
            message: 'quantity must be finite and strictly positive',
        },
    },
}, { _id: false });

const recipeSchema = new Schema<IRecipe>({
    productId: { type: Schema.Types.ObjectId, required: true, ref: 'Product' },
    size: { type: String, required: true, enum: PRODUCT_SIZES },
    ingredients: {
        type: [recipeIngredientSchema], required: true, default: undefined,
        validate: [
            {
                validator: (ingredients: IRecipeIngredient[]) => Array.isArray(ingredients) && ingredients.length > 0,
                message: 'A recipe must have at least one ingredient',
            },
            {
                validator: (ingredients: IRecipeIngredient[]) => Array.isArray(ingredients)
                    && ingredients.every(ingredient => ingredient != null)
                    && new Set(ingredients.map(ingredient => ingredient.ingredientId?.toString())).size === ingredients.length,
                message: 'Recipe entries must be non-null and reference distinct ingredients',
            },
        ],
    },
    version: {
        type: Number, required: true, default: 1,
        validate: {
            validator: (version: number) => Number.isInteger(version) && version > 0,
            message: 'version must be a positive integer',
        },
    },
    isActive: { type: Boolean, required: true, default: true },
}, { timestamps: true });

recipeSchema.index({ productId: 1, size: 1, version: 1 }, { unique: true });
// Inactive versions remain stored without conflicting with the active recipe.
recipeSchema.index({ productId: 1, size: 1 }, {
    unique: true,
    partialFilterExpression: { isActive: true },
});

// Reference existence, version transitions and historical immutability need service rules.
export const Recipe = model<IRecipe>('Recipe', recipeSchema);
export default Recipe;
