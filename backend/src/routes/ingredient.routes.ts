import { Router } from 'express';
import * as controller from '../controllers/ingredient.controller';

export const ingredientRouter = Router();
ingredientRouter.route('/').post(controller.create).get(controller.list);
ingredientRouter.route('/:id').get(controller.get).patch(controller.update).delete(controller.remove);
