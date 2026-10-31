import { Router } from 'express';
import * as controller from '../controllers/recipe.controller';

export const recipeRouter = Router();
recipeRouter.route('/').post(controller.create).get(controller.list);
recipeRouter.get('/:id', controller.get);
recipeRouter.post('/:id/activate', controller.activate);
recipeRouter.post('/:id/deactivate', controller.deactivate);
