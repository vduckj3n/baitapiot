import { pool } from '../config/database.js';

const SEARCH_EXPRESSIONS = Object.freeze({
  action: 'ah.action',
  device: "CONCAT('LED ', ah.device_id)",
  // Hỗ trợ định dạng lưu trữ, định dạng hiển thị và ngày/giờ không có số 0 ở đầu.
  timestamp: `CONCAT_WS(' ',
    DATE_FORMAT(ah.timestamp, '%Y-%m-%d %H:%i:%s'),
    DATE_FORMAT(ah.timestamp, '%d/%m/%Y %H:%i:%s'),
    DATE_FORMAT(ah.timestamp, '%e/%c/%Y %k:%i:%s')
  )`,
});

export const actionRepository = {
  async findPendingByDeviceForUpdate(connection, deviceId) {
    const [rows] = await connection.execute(
      "SELECT id FROM action_history WHERE device_id = ? AND status = 'PENDING' ORDER BY timestamp DESC LIMIT 1 FOR UPDATE",
      [deviceId],
    );
    return rows[0] || null;
  },

  async createPending(connection, { userId, deviceId, action }) {
    const [result] = await connection.execute(
      "INSERT INTO action_history (user_id, device_id, action, status) VALUES (?, ?, ?, 'PENDING')",
      [userId, deviceId, action],
    );
    return result.insertId;
  },

  async getUnexpiredPending(timeoutMs, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT id, device_id, action FROM action_history
       WHERE device_id IN (1, 2, 3) AND status = 'PENDING'
         AND timestamp >= DATE_SUB(NOW(3), INTERVAL ? MICROSECOND)
       ORDER BY id`,
      [timeoutMs * 1000],
    );
    return rows;
  },

  async findPendingById(connection, actionId, deviceId, timeoutMs) {
    const [rows] = await connection.execute(
      `SELECT id, action FROM action_history
       WHERE id = ? AND device_id = ? AND status = 'PENDING'
         AND timestamp >= DATE_SUB(NOW(3), INTERVAL ? MICROSECOND)
       LIMIT 1 FOR UPDATE`,
      [actionId, deviceId, timeoutMs * 1000],
    );
    return rows[0] || null;
  },

  async complete(connection, actionId, status, message = null) {
    const [result] = await connection.execute(
      "UPDATE action_history SET status = ?, message = ?, completed_at = NOW(3) WHERE id = ? AND status = 'PENDING'",
      [status, message, actionId],
    );
    return result.affectedRows > 0;
  },

  async failIfPending(actionId, message) {
    const [result] = await pool.execute(
      "UPDATE action_history SET status = 'FAILED', message = ?, completed_at = NOW(3) WHERE id = ? AND status = 'PENDING'",
      [message, actionId],
    );
    return result.affectedRows > 0;
  },

  async failExpiredPending(timeoutMs) {
    const [rows] = await pool.execute(
      `SELECT id, device_id FROM action_history
       WHERE status = 'PENDING' AND timestamp < DATE_SUB(NOW(3), INTERVAL ? MICROSECOND)`,
      [timeoutMs * 1000],
    );
    const updated = [];
    for (const row of rows) {
      if (await this.failIfPending(row.id, 'Device response timeout')) {
        updated.push(row);
      }
    }
    return updated;
  },

  async list({
    page,
    limit,
    action,
    status,
    deviceId,
    search,
    searchBy,
    sort,
  }) {
    const where = [];
    const params = [];
    if (action) {
      where.push('ah.action = ?');
      params.push(action);
    }
    if (status) {
      where.push('ah.status = ?');
      params.push(status);
    }
    if (deviceId) {
      where.push('ah.device_id = ?');
      params.push(deviceId);
    }
    if (search) {
      const expression =
        SEARCH_EXPRESSIONS[searchBy] || SEARCH_EXPRESSIONS.action;
      where.push(`${expression} LIKE ?`);
      params.push(`%${search}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM action_history ah JOIN devices d ON d.id = ah.device_id
       ${whereSql}`,
      params,
    );
    const offset = (page - 1) * limit;
    const order = sort === 'oldest' ? 'ASC' : 'DESC';
    const [rows] = await pool.execute(
      `SELECT ah.id, ah.device_id, CONCAT('LED ', ah.device_id) AS device_name,
              ah.action, ah.status, ah.message, ah.timestamp
       FROM action_history ah JOIN devices d ON d.id = ah.device_id
       ${whereSql} ORDER BY ah.timestamp ${order}, ah.id ${order} LIMIT ${Number(limit)} OFFSET ${offset}`,
      params,
    );
    return { rows, total: countRows[0].total };
  },
};
