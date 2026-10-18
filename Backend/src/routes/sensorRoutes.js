import { Router } from 'express';
import { getSensorData } from '../controllers/sensorController.js';

export const sensorRoutes = Router();
sensorRoutes.get('/data', getSensorData);
