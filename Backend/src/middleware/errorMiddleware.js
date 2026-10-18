import { logger } from '../utils/logger.js';

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) {
    logger.error(error.message, { stack: error.stack, path: req.originalUrl });
  }
  return res.status(status).json({
    success: false,
    message: status === 500 ? 'Lỗi máy chủ nội bộ' : error.message,
  });
}
