import type { RequestHandler } from 'express';
import * as service from '../services/recipe.service';
import { validateActionBody, validateBody, validateId, validateQuery } from '../validation/recipe.validation';

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
