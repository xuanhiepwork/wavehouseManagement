import type { RequestHandler } from 'express';
import * as service from '../services/ingredient.service';
import { validateBody, validateId, validateQuery } from '../validation/ingredient.validation';
import * as postgresValidation from '../validation/ingredient.postgres.validation';
import type { createPostgresIngredientService } from '../services/ingredient.postgres.service';

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

export function postgresIngredientController(pg: ReturnType<typeof createPostgresIngredientService>) {
    const create: RequestHandler = async (req, res) => {
        res.status(201).json({ data: await pg.createIngredient(postgresValidation.validateBody(req.body)) });
    };
    const list: RequestHandler = async (req, res) => { res.json(await pg.listIngredients(postgresValidation.validateQuery(req.query))); };
    const get: RequestHandler = async (req, res) => { res.json({ data: await pg.getIngredient(postgresValidation.validateId(req.params.id)) }); };
    const update: RequestHandler = async (req, res) => {
        const id = postgresValidation.validateId(req.params.id);
        res.json({ data: await pg.updateIngredient(id, postgresValidation.validateBody(req.body, true)) });
    };
    const remove: RequestHandler = async (req, res) => { res.json({ data: await pg.deleteIngredient(postgresValidation.validateId(req.params.id)) }); };
    return { create, list, get, update, remove };
}
