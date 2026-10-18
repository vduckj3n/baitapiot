import { Router } from 'express';
import { getActions } from '../controllers/actionController.js';

export const actionRoutes = Router();
actionRoutes.get('/', getActions);
