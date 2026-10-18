import { sensorRepository } from '../repositories/sensorRepository.js';
import { sensorService } from '../services/sensorService.js';
import { createHttpError } from '../utils/response.js';

const SENSOR_TYPES = ['Temperature', 'Humidity', 'Light'];
const SEARCH_BY = ['value', 'name', 'type', 'timestamp'];

export async function getLatest(req, res, next) {
  try {
    const deviceId = Number(req.query.deviceId || 1);
    if (!Number.isInteger(deviceId) || deviceId <= 0) {
      throw createHttpError(400, 'deviceId không hợp lệ');
    }
    const dashboard = await sensorService.getDashboard(deviceId);
    if (!dashboard) {
      throw createHttpError(404, 'Không tìm thấy thiết bị');
    }
    return res.json({ success: true, data: dashboard });
  } catch (error) {
    return next(error);
  }
}

export async function getSensorData(req, res, next) {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    if (!Number.isInteger(page) || page < 1) {
      throw createHttpError(400, 'page không hợp lệ');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw createHttpError(400, 'limit phải từ 1 đến 100');
    }
    const type =
      req.query.type && req.query.type !== 'ALL'
        ? String(req.query.type)
        : null;
    if (type && !SENSOR_TYPES.includes(type)) {
      throw createHttpError(400, 'type không hợp lệ');
    }
    const searchBy = String(req.query.searchBy || 'value').toLowerCase();
    if (!SEARCH_BY.includes(searchBy)) {
      throw createHttpError(400, 'searchBy không hợp lệ');
    }
    const sort = String(req.query.sort || 'newest').toLowerCase();
    if (!['newest', 'oldest'].includes(sort)) {
      throw createHttpError(400, 'sort không hợp lệ');
    }
    const search = String(req.query.search || '')
      .trim()
      .slice(0, 100);
    const { rows, total } = await sensorRepository.list({
      page,
      limit,
      type,
      search,
      searchBy,
      sort,
    });
    return res.json({
      success: true,
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return next(error);
  }
}
