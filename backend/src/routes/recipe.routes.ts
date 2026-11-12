import { Router } from 'express';
import * as controller from '../controllers/recipe.controller';

export const recipeRouter = Router();
recipeRouter.route('/').post(controller.create).get(controller.list);
recipeRouter.get('/:id', controller.get);
recipeRouter.post('/:id/activate', controller.activate);
recipeRouter.post('/:id/deactivate', controller.deactivate);

export function postgresRecipeRouter(service: Parameters<typeof controller.postgresRecipeController>[0]) {
    const handlers = controller.postgresRecipeController(service);
    const router = Router();
    router.route('/').post(handlers.create).get(handlers.list);
    router.get('/:id', handlers.get);
    router.post('/:id/activate', handlers.activate);
    router.post('/:id/deactivate', handlers.deactivate);
    return router;
}
