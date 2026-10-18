import { pool } from '../config/database.js';

const SENSOR_META = Object.freeze({
  Temperature: { name: 'Temperature', unit: '°C' },
  Humidity: { name: 'Humidity Sensor', unit: '%' },
  Light: { name: 'Light Sensor', unit: 'Lux' },
});

const SEARCH_EXPRESSIONS = Object.freeze({
  value: 'CAST(sd.value AS CHAR)',
  name: 's.sensor_name',
  type: 'sd.sensor_type',
  timestamp: `CONCAT_WS(' ',
    DATE_FORMAT(sd.timestamp, '%Y-%m-%d %H:%i:%s'),
    DATE_FORMAT(sd.timestamp, '%d/%m/%Y %H:%i:%s'),
    DATE_FORMAT(sd.timestamp, '%e/%c/%Y %k:%i:%s')
  )`,
});

export const sensorRepository = {
  async insertTelemetry(
    connection,
    deviceId,
    telemetry,
    timestamp = new Date(),
  ) {
    const entries = [
      ['Temperature', telemetry.temperature],
      ['Humidity', telemetry.humidity],
      ['Light', telemetry.light],
    ];
    const sql = `INSERT INTO data_sensor
      (device_id, sensor_type, value, unit, status, timestamp) VALUES (?, ?, ?, ?, 'Normal', ?)`;
    for (const [type, value] of entries) {
      await connection.execute(sql, [
        deviceId,
        type,
        value,
        SENSOR_META[type].unit,
        timestamp,
      ]);
    }
  },

  async getLatest(deviceId = 1) {
    const [rows] = await pool.execute(
      `SELECT device_id,
        MAX(CASE WHEN sensor_type = 'Temperature' THEN value END) AS temperature,
        MAX(CASE WHEN sensor_type = 'Humidity' THEN value END) AS humidity,
        MAX(CASE WHEN sensor_type = 'Light' THEN value END) AS light,
        timestamp
       FROM data_sensor WHERE device_id = ?
       GROUP BY device_id, timestamp ORDER BY timestamp DESC LIMIT 1`,
      [deviceId],
    );
    return rows[0] || null;
  },

  async getChartHistory(deviceId = 1, limit = 20) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const [rows] = await pool.execute(
      `SELECT * FROM (
        SELECT device_id,
          MAX(CASE WHEN sensor_type = 'Temperature' THEN value END) AS temperature,
          MAX(CASE WHEN sensor_type = 'Humidity' THEN value END) AS humidity,
          MAX(CASE WHEN sensor_type = 'Light' THEN value END) AS light,
          timestamp
        FROM data_sensor WHERE device_id = ?
        GROUP BY device_id, timestamp ORDER BY timestamp DESC LIMIT ${safeLimit}
      ) recent ORDER BY timestamp ASC`,
      [deviceId],
    );
    return rows;
  },

  async list({ page, limit, type, search, searchBy, sort }) {
    const where = [];
    const params = [];
    if (type) {
      where.push('sd.sensor_type = ?');
      params.push(type);
    }
    if (search) {
      const expression =
        SEARCH_EXPRESSIONS[searchBy] || SEARCH_EXPRESSIONS.value;
      where.push(`${expression} LIKE ?`);
      params.push(`%${search}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRows] = await pool.execute(
      `SELECT COUNT(*) AS total FROM data_sensor sd
       LEFT JOIN sensors s ON s.device_id = sd.device_id AND s.sensor_type = sd.sensor_type ${whereSql}`,
      params,
    );
    const offset = (page - 1) * limit;
    const order = sort === 'oldest' ? 'ASC' : 'DESC';
    const [rows] = await pool.execute(
      `SELECT sd.id, COALESCE(s.sensor_name, sd.sensor_type) AS sensor_name,
              sd.sensor_type, sd.value, sd.unit, sd.timestamp, sd.status
       FROM data_sensor sd
       LEFT JOIN sensors s ON s.device_id = sd.device_id AND s.sensor_type = sd.sensor_type
       ${whereSql} ORDER BY sd.timestamp ${order}, sd.id ${order} LIMIT ${Number(limit)} OFFSET ${offset}`,
      params,
    );
    return { rows, total: countRows[0].total };
  },
};
