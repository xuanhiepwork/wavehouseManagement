import type { RequestHandler } from 'express';
import * as service from '../services/product.service';
import { validateBody, validateId, validateQuery } from '../validation/product.validation';
import * as postgresValidation from '../validation/product.postgres.validation';
import type { createPostgresProductService } from '../services/product.postgres.service';

export const create: RequestHandler = async (req, res) => {
    res.status(201).json({ data: await service.createProduct(validateBody(req.body)) });
};
export const list: RequestHandler = async (req, res) => {
    res.json(await service.listProducts(validateQuery(req.query)));
};
export const get: RequestHandler = async (req, res) => {
    res.json({ data: await service.getProduct(validateId(req.params.id)) });
};
export const update: RequestHandler = async (req, res) => {
    const id = validateId(req.params.id);
    const input = validateBody(req.body, true);
    res.json({ data: await service.updateProduct(id, input) });
};
export const remove: RequestHandler = async (req, res) => {
    res.json({ data: await service.deleteProduct(validateId(req.params.id)) });
};

export function postgresProductController(pg: ReturnType<typeof createPostgresProductService>) {
    const create: RequestHandler = async (req, res) => {
        res.status(201).json({ data: await pg.createProduct(postgresValidation.validateBody(req.body)) });
    };
    const list: RequestHandler = async (req, res) => { res.json(await pg.listProducts(postgresValidation.validateQuery(req.query))); };
    const get: RequestHandler = async (req, res) => { res.json({ data: await pg.getProduct(postgresValidation.validateId(req.params.id)) }); };
    const update: RequestHandler = async (req, res) => {
        const id = postgresValidation.validateId(req.params.id);
        res.json({ data: await pg.updateProduct(id, postgresValidation.validateBody(req.body, true)) });
    };
    const remove: RequestHandler = async (req, res) => { res.json({ data: await pg.deleteProduct(postgresValidation.validateId(req.params.id)) }); };
    return { create, list, get, update, remove };
}
