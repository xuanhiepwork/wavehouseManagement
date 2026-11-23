import type { RequestHandler } from 'express';
import type { createPostgresIngredientService } from '../services/ingredient.postgres.service';
import type { createPostgresProductService } from '../services/product.postgres.service';
import type { createPostgresRecipeService } from '../services/recipe.postgres.service';
import * as ingredients from '../validation/ingredient.postgres.validation';
import * as products from '../validation/product.postgres.validation';
import * as recipes from '../validation/recipe.postgres.validation';

export function postgresIngredientController(pg: ReturnType<typeof createPostgresIngredientService>) {
    const create: RequestHandler = async (req, res) => { res.status(201).json({ data: await pg.createIngredient(ingredients.validateBody(req.body)) }); };
    const list: RequestHandler = async (req, res) => { res.json(await pg.listIngredients(ingredients.validateQuery(req.query))); };
    const get: RequestHandler = async (req, res) => { res.json({ data: await pg.getIngredient(ingredients.validateId(req.params.id)) }); };
    const update: RequestHandler = async (req, res) => {
        const id = ingredients.validateId(req.params.id);
        res.json({ data: await pg.updateIngredient(id, ingredients.validateBody(req.body, true)) });
    };
    const remove: RequestHandler = async (req, res) => { res.json({ data: await pg.deleteIngredient(ingredients.validateId(req.params.id)) }); };
    return { create, list, get, update, remove };
}

export function postgresProductController(pg: ReturnType<typeof createPostgresProductService>) {
    const create: RequestHandler = async (req, res) => { res.status(201).json({ data: await pg.createProduct(products.validateBody(req.body)) }); };
    const list: RequestHandler = async (req, res) => { res.json(await pg.listProducts(products.validateQuery(req.query))); };
    const get: RequestHandler = async (req, res) => { res.json({ data: await pg.getProduct(products.validateId(req.params.id)) }); };
    const update: RequestHandler = async (req, res) => {
        const id = products.validateId(req.params.id);
        res.json({ data: await pg.updateProduct(id, products.validateBody(req.body, true)) });
    };
    const remove: RequestHandler = async (req, res) => { res.json({ data: await pg.deleteProduct(products.validateId(req.params.id)) }); };
    return { create, list, get, update, remove };
}

export function postgresRecipeController(pg: ReturnType<typeof createPostgresRecipeService>) {
    const create: RequestHandler = async (req, res) => {
        recipes.validateQuery(req.query, false);
        res.status(201).json({ data: await pg.createRecipe(recipes.validateBody(req.body)) });
    };
    const list: RequestHandler = async (req, res) => { res.json(await pg.listRecipes(recipes.validateQuery(req.query))); };
    const get: RequestHandler = async (req, res) => {
        recipes.validateQuery(req.query, false);
        res.json({ data: await pg.getRecipe(recipes.validateId(req.params.id)) });
    };
    const action = (method: 'activateRecipe' | 'deactivateRecipe'): RequestHandler => async (req, res) => {
        const id = recipes.validateId(req.params.id);
        recipes.validateQuery(req.query, false);
        recipes.validateActionBody(req.body);
        res.json({ data: await pg[method](id) });
    };
    return { create, list, get, activate: action('activateRecipe'), deactivate: action('deactivateRecipe') };
}
