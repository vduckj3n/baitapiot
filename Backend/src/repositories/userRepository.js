import { pool } from '../config/database.js';

const publicColumns = 'id, username, full_name, email, role';

export const userRepository = {
  async findByUsername(username) {
    const [rows] = await pool.execute(
      `SELECT ${publicColumns}, password_hash FROM users WHERE username = ? LIMIT 1`,
      [username],
    );
    return rows[0] || null;
  },

  async findByUsernameOrEmail(username, email) {
    const [rows] = await pool.execute(
      'SELECT id, username, email FROM users WHERE username = ? OR (? IS NOT NULL AND email = ?) LIMIT 1',
      [username, email, email],
    );
    return rows[0] || null;
  },

  async create({ username, passwordHash, fullName, email }) {
    const [result] = await pool.execute(
      'INSERT INTO users (username, password_hash, full_name, email) VALUES (?, ?, ?, ?)',
      [username, passwordHash, fullName, email],
    );
    return result.insertId;
  },

  async findPublicById(id) {
    const [rows] = await pool.execute(
      `SELECT ${publicColumns} FROM users WHERE id = ? LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  },
};
