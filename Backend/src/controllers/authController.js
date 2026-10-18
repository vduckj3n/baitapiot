import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { userRepository } from '../repositories/userRepository.js';
import { createHttpError } from '../utils/response.js';

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,50}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function register(req, res, next) {
  try {
    const fullName = String(req.body.full_name || '').trim();
    const username = String(req.body.username || '').trim();
    const email =
      String(req.body.email || '')
        .trim()
        .toLowerCase() || null;
    const password = String(req.body.password || '');
    if (fullName.length < 2 || fullName.length > 100) {
      throw createHttpError(400, 'Họ tên phải có từ 2 đến 100 ký tự');
    }
    if (!USERNAME_PATTERN.test(username)) {
      throw createHttpError(400, 'Username phải có 3-50 ký tự hợp lệ');
    }
    if (email && !EMAIL_PATTERN.test(email)) {
      throw createHttpError(400, 'Email không hợp lệ');
    }
    if (password.length < 6 || password.length > 72) {
      throw createHttpError(400, 'Mật khẩu phải có từ 6 đến 72 ký tự');
    }

    const duplicate = await userRepository.findByUsernameOrEmail(
      username,
      email,
    );
    if (duplicate?.username === username) {
      throw createHttpError(409, 'Username đã tồn tại');
    }
    if (email && duplicate?.email === email) {
      throw createHttpError(409, 'Email đã tồn tại');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    try {
      await userRepository.create({ username, passwordHash, fullName, email });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        throw createHttpError(409, 'Username hoặc email đã tồn tại');
      }
      throw error;
    }
    return res
      .status(201)
      .json({ success: true, message: 'Đăng ký thành công' });
  } catch (error) {
    return next(error);
  }
}

export async function login(req, res, next) {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) {
      throw createHttpError(400, 'Vui lòng nhập username và password');
    }
    const user = await userRepository.findByUsername(username);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw createHttpError(401, 'Tên đăng nhập hoặc mật khẩu không đúng');
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      env.jwtSecret,
      { expiresIn: env.jwtExpiresIn },
    );
    const { password_hash, ...publicUser } = user;
    return res.json({ success: true, token, user: publicUser });
  } catch (error) {
    return next(error);
  }
}
