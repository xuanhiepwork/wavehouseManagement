import { Router } from 'express';
import * as controller from '../controllers/ingredient.controller';

export const ingredientRouter = Router();
ingredientRouter.route('/').post(controller.create).get(controller.list);
ingredientRouter.route('/:id').get(controller.get).patch(controller.update).delete(controller.remove);

export function postgresIngredientRouter(service: Parameters<typeof controller.postgresIngredientController>[0]) {
    const handlers = controller.postgresIngredientController(service);
    const router = Router();
    router.route('/').post(handlers.create).get(handlers.list);
    router.route('/:id').get(handlers.get).patch(handlers.update).delete(handlers.remove);
    return router;
}
