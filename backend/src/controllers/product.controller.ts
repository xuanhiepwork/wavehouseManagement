import type { RequestHandler } from 'express';
import * as service from '../services/product.service';
import { validateBody, validateId, validateQuery } from '../validation/product.validation';

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
