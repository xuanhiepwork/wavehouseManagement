import type { RequestHandler } from 'express';
import * as service from '../services/recipe.service';
import { validateActionBody, validateBody, validateId, validateQuery } from '../validation/recipe.validation';
import * as postgresValidation from '../validation/recipe.postgres.validation';
import type { createPostgresRecipeService } from '../services/recipe.postgres.service';

export const create: RequestHandler = async (req, res) => {
    validateQuery(req.query, false);
    const data = await service.createRecipe(validateBody(req.body));
    res.status(201).json({ data });
};
export const list: RequestHandler = async (req, res) => {
    res.json(await service.listRecipes(validateQuery(req.query)));
};
export const get: RequestHandler = async (req, res) => {
    validateQuery(req.query, false);
    res.json({ data: await service.getRecipe(validateId(req.params.id)) });
};
export const activate: RequestHandler = async (req, res) => {
    const id = validateId(req.params.id);
    validateQuery(req.query, false);
    validateActionBody(req.body);
    res.json({ data: await service.activateRecipe(id) });
};
export const deactivate: RequestHandler = async (req, res) => {
    const id = validateId(req.params.id);
    validateQuery(req.query, false);
    validateActionBody(req.body);
    res.json({ data: await service.deactivateRecipe(id) });
};

export function postgresRecipeController(pg: ReturnType<typeof createPostgresRecipeService>) {
    const create: RequestHandler = async (req, res) => {
        postgresValidation.validateQuery(req.query, false);
        res.status(201).json({ data: await pg.createRecipe(postgresValidation.validateBody(req.body)) });
    };
    const list: RequestHandler = async (req, res) => { res.json(await pg.listRecipes(postgresValidation.validateQuery(req.query))); };
    const get: RequestHandler = async (req, res) => {
        postgresValidation.validateQuery(req.query, false);
        res.json({ data: await pg.getRecipe(postgresValidation.validateId(req.params.id)) });
    };
    const action = (method: 'activateRecipe' | 'deactivateRecipe'): RequestHandler => async (req, res) => {
        const id = postgresValidation.validateId(req.params.id);
        postgresValidation.validateQuery(req.query, false);
        postgresValidation.validateActionBody(req.body);
        res.json({ data: await pg[method](id) });
    };
    return { create, list, get, activate: action('activateRecipe'), deactivate: action('deactivateRecipe') };
}
