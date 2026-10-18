import { pool } from '../config/database.js';

export const deviceRepository = {
  // Mỗi đèn có một ID riêng để lưu trạng thái và lịch sử độc lập.
  async ensureLedDevices() {
    await pool.execute(
      `INSERT INTO devices (id, device_code, device_name)
       VALUES (2, 'ESP32_01_LED_2', 'LED 2'), (3, 'ESP32_01_LED_3', 'LED 3')
       ON DUPLICATE KEY UPDATE id = id`,
    );
  },

  async getRestoreStates(connection = pool) {
    const [rows] = await connection.execute(
      `SELECT d.id, COALESCE(
         (SELECT a.action FROM action_history a
          WHERE a.device_id = d.id AND a.status = 'SUCCESS'
          ORDER BY a.completed_at DESC, a.id DESC LIMIT 1), 'OFF') AS state
       FROM devices d WHERE d.id IN (1, 2, 3) ORDER BY d.id`,
    );
    return rows.map((row) => row.state);
  },

  async getLeds() {
    const [rows] = await pool.execute(
      `SELECT d.id, d.led_state AS state,
              EXISTS(SELECT 1 FROM action_history a
                     WHERE a.device_id = d.id AND a.status = 'PENDING') AS pending
       FROM devices d WHERE d.id IN (1, 2, 3) ORDER BY d.id`,
    );
    return rows;
  },

  async findById(id, connection = pool) {
    const [rows] = await connection.execute(
      `SELECT d.id, d.device_code, d.device_name, d.led_state, d.connection_status,
              d.last_seen
       FROM devices d WHERE d.id = ? LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  },

  async lockById(connection, id) {
    const [rows] = await connection.execute(
      'SELECT id FROM devices WHERE id = ? LIMIT 1 FOR UPDATE',
      [id],
    );
    return rows[0] || null;
  },

  async markSeen(deviceId, connection = pool) {
    const [result] = await connection.execute(
      "UPDATE devices SET last_seen = NOW(3), connection_status = 'ONLINE' WHERE id = ?",
      [deviceId],
    );
    return result.affectedRows > 0;
  },

  async updateLedState(deviceId, ledState, connection = pool) {
    await connection.execute('UPDATE devices SET led_state = ? WHERE id = ?', [
      ledState,
      deviceId,
    ]);
  },

  async setConnectionStatus(deviceId, status, ledState, connection = pool) {
    const [result] =
      status === 'ONLINE'
        ? await connection.execute(
            `UPDATE devices
         SET connection_status = 'ONLINE', last_seen = NOW(3),
             led_state = COALESCE(?, led_state)
         WHERE id = ?`,
            [ledState || null, deviceId],
          )
        : await connection.execute(
            "UPDATE devices SET connection_status = 'OFFLINE' WHERE id = ?",
            [deviceId],
          );
    return result.affectedRows > 0;
  },

  async markStaleDevicesOffline(timeoutMs) {
    const [rows] = await pool.execute(
      `SELECT id FROM devices
       WHERE connection_status = 'ONLINE'
         AND (last_seen IS NULL OR last_seen < DATE_SUB(NOW(3), INTERVAL ? MICROSECOND))`,
      [timeoutMs * 1000],
    );
    if (rows.length) {
      const ids = rows.map((row) => row.id);
      const placeholders = ids.map(() => '?').join(',');
      await pool.execute(
        `UPDATE devices SET connection_status = 'OFFLINE' WHERE id IN (${placeholders})`,
        ids,
      );
    }
    return rows.map((row) => row.id);
  },
};
