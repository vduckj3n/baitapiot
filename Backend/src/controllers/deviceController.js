import { deviceRepository } from '../repositories/deviceRepository.js';
import { deviceService } from '../services/deviceService.js';
import { createHttpError } from '../utils/response.js';

export async function getDevice(req, res, next) {
  try {
    const device = await deviceRepository.findById(Number(req.params.deviceId));
    if (!device) {
      throw createHttpError(404, 'Không tìm thấy thiết bị');
    }
    return res.json({ success: true, data: device });
  } catch (error) {
    return next(error);
  }
}

export async function createDeviceAction(req, res, next) {
  try {
    const deviceId = Number(req.params.deviceId);
    const command = String(req.body.command || '').toUpperCase();
    if (!Number.isInteger(deviceId) || deviceId <= 0) {
      throw createHttpError(400, 'deviceId không hợp lệ');
    }
    if (!['ON', 'OFF'].includes(command)) {
      throw createHttpError(400, 'command chỉ nhận ON hoặc OFF');
    }
    const action = await deviceService.requestAction({
      userId: req.user.id,
      deviceId,
      command,
    });
    return res.status(201).json({ success: true, action });
  } catch (error) {
    return next(error);
  }
}
