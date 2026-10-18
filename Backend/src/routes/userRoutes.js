import { Router } from 'express';
import { getUser } from '../controllers/userController.js';

export const userRoutes = Router();
userRoutes.get('/:userId', getUser);
