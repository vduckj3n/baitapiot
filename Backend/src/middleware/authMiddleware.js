import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

export function authenticate(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res
      .status(401)
      .json({ success: false, message: 'Yêu cầu token xác thực' });
  }
  try {
    req.user = jwt.verify(token, env.jwtSecret);
    return next();
  } catch {
    return res
      .status(401)
      .json({ success: false, message: 'Token không hợp lệ hoặc đã hết hạn' });
  }
}
