import { Router } from 'express';
import { getLatest } from '../controllers/sensorController.js';

export const dashboardRoutes = Router();
dashboardRoutes.get('/summary', getLatest);
