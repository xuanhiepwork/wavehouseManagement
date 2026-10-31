import { Router } from 'express';
import * as controller from '../controllers/product.controller';

export const productRouter = Router();
productRouter.route('/').post(controller.create).get(controller.list);
productRouter.route('/:id').get(controller.get).patch(controller.update).delete(controller.remove);
