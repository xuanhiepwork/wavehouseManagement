import { Router } from 'express';
import { postgresIngredientController, postgresProductController, postgresRecipeController } from '../controllers/catalog.postgres.controller';

export function postgresIngredientRouter(service: Parameters<typeof postgresIngredientController>[0]) {
    const handlers = postgresIngredientController(service), router = Router();
    router.route('/').post(handlers.create).get(handlers.list);
    router.route('/:id').get(handlers.get).patch(handlers.update).delete(handlers.remove);
    return router;
}
export function postgresProductRouter(service: Parameters<typeof postgresProductController>[0]) {
    const handlers = postgresProductController(service), router = Router();
    router.route('/').post(handlers.create).get(handlers.list);
    router.route('/:id').get(handlers.get).patch(handlers.update).delete(handlers.remove);
    return router;
}
export function postgresRecipeRouter(service: Parameters<typeof postgresRecipeController>[0]) {
    const handlers = postgresRecipeController(service), router = Router();
    router.route('/').post(handlers.create).get(handlers.list);
    router.get('/:id', handlers.get);
    router.post('/:id/activate', handlers.activate);
    router.post('/:id/deactivate', handlers.deactivate);
    return router;
}
