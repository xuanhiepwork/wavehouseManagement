import { Router } from 'express';
import * as controller from '../controllers/product.controller';

export const productRouter = Router();
productRouter.route('/').post(controller.create).get(controller.list);
productRouter.route('/:id').get(controller.get).patch(controller.update).delete(controller.remove);

export function postgresProductRouter(service: Parameters<typeof controller.postgresProductController>[0]) {
    const handlers = controller.postgresProductController(service);
    const router = Router();
    router.route('/').post(handlers.create).get(handlers.list);
    router.route('/:id').get(handlers.get).patch(handlers.update).delete(handlers.remove);
    return router;
}
