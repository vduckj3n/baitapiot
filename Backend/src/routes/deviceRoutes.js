import { Router } from 'express';
import {
  createDeviceAction,
  getDevice,
} from '../controllers/deviceController.js';

export const deviceRoutes = Router();
deviceRoutes.get('/:deviceId/status', getDevice);
deviceRoutes.post('/:deviceId/actions', createDeviceAction);
