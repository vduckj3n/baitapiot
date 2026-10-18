import { env } from '../config/env.js';
import { userRepository } from '../repositories/userRepository.js';
import { createHttpError } from '../utils/response.js';

export async function getUser(req, res, next) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      throw createHttpError(400, 'userId không hợp lệ');
    }
    if (userId !== Number(req.user.id) && req.user.role !== 'ADMIN') {
      throw createHttpError(403, 'Không có quyền xem thông tin người dùng này');
    }
    const user = await userRepository.findPublicById(userId);
    if (!user) {
      throw createHttpError(404, 'Không tìm thấy người dùng');
    }
    return res.json({ success: true, data: { ...user, links: env.profileLinks } });
  } catch (error) {
    return next(error);
  }
}
