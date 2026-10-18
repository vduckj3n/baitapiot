import { actionService } from '../services/actionService.js';
import { createHttpError } from '../utils/response.js';

const SEARCH_BY = ['action', 'device', 'timestamp'];

export async function getActions(req, res, next) {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 10);
    if (!Number.isInteger(page) || page < 1) {
      throw createHttpError(400, 'page không hợp lệ');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw createHttpError(400, 'limit phải từ 1 đến 100');
    }
    const action =
      req.query.action && req.query.action !== 'ALL'
        ? String(req.query.action).toUpperCase()
        : null;
    const status =
      req.query.status && req.query.status !== 'ALL'
        ? String(req.query.status).toUpperCase()
        : null;
    if (action && !['ON', 'OFF'].includes(action)) {
      throw createHttpError(400, 'action không hợp lệ');
    }
    if (status && !['PENDING', 'SUCCESS', 'FAILED'].includes(status)) {
      throw createHttpError(400, 'status không hợp lệ');
    }
    const deviceId =
      req.query.deviceId && req.query.deviceId !== 'ALL'
        ? Number(req.query.deviceId)
        : null;
    if (deviceId !== null && (!Number.isInteger(deviceId) || deviceId <= 0)) {
      throw createHttpError(400, 'deviceId không hợp lệ');
    }
    const searchBy = String(req.query.searchBy || 'action').toLowerCase();
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
    const { rows, total } = await actionService.list({
      page,
      limit,
      action,
      status,
      deviceId,
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
