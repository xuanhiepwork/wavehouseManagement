import type { RequestHandler } from 'express';
import * as service from '../services/ingredient.service';
import { validateBody, validateId, validateQuery } from '../validation/ingredient.validation';

export const create: RequestHandler = async (req, res) => {
    const ingredient = await service.createIngredient(validateBody(req.body));
    res.status(201).json({ data: ingredient });
};
export const list: RequestHandler = async (req, res) => {
    res.json(await service.listIngredients(validateQuery(req.query)));
};
export const get: RequestHandler = async (req, res) => {
    res.json({ data: await service.getIngredient(validateId(req.params.id)) });
};
export const update: RequestHandler = async (req, res) => {
    const id = validateId(req.params.id);
    const input = validateBody(req.body, true);
    res.json({ data: await service.updateIngredient(id, input) });
};
export const remove: RequestHandler = async (req, res) => {
    res.json({ data: await service.deleteIngredient(validateId(req.params.id)) });
};
