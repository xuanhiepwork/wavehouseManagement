import { Ingredient } from '../models/Ingredient';
import { RequestError } from '../validation/ingredient.validation';
import type { IngredientInput, validateQuery } from '../validation/ingredient.validation';

// Index creation follows the existing Mongoose connection/autoIndex lifecycle.
// Production deployments with autoIndex disabled must provision the unique code
// index before serving traffic. A schema declaration alone cannot ensure uniqueness.
export async function createIngredient(input: IngredientInput) {
    return new Ingredient(input).save();
}

export async function listIngredients(query: ReturnType<typeof validateQuery>) {
    const { page, limit, filter, sort } = query;
    const [data, total] = await Promise.all([
        Ingredient.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).exec(),
        Ingredient.countDocuments(filter).exec(),
    ]);
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getIngredient(id: string) {
    const ingredient = await Ingredient.findById(id).exec();
    if (!ingredient) throw new RequestError(404, 'Ingredient not found');
    return ingredient;
}

export async function updateIngredient(id: string, input: IngredientInput) {
    const ingredient = await getIngredient(id);
    Object.assign(ingredient, input);
    return ingredient.save();
}

export async function deleteIngredient(id: string) {
    const ingredient = await getIngredient(id);
    if (ingredient.isActive) {
        ingredient.isActive = false;
        await ingredient.save();
    }
    return ingredient;
}
