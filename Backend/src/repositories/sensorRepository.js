import { pool } from '../config/database.js';

const SEARCH_EXPRESSIONS = Object.freeze({
  value: 'CAST(sd.value AS CHAR)',
  name: 's.sensor_name',
  type: 's.sensor_type',
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
    const [sensors] = await connection.execute(
      'SELECT id, sensor_type FROM sensors WHERE device_id = ?', [deviceId],
    );
    const sensorIds = new Map(sensors.map((sensor) => [sensor.sensor_type, sensor.id]));
    if (entries.some(([type]) => !sensorIds.has(type))) {
      throw new Error(`Thiếu cấu hình cảm biến cho device_id ${deviceId}`);
    }
    for (const [type, value] of entries) {
      await connection.execute(
        'INSERT INTO data_sensor (sensor_id, value, timestamp) VALUES (?, ?, ?)',
        [sensorIds.get(type), value, timestamp],
      );
    }
  },

  async getLatest(deviceId = 1) {
    const [rows] = await pool.execute(
      `SELECT s.device_id,
        MAX(CASE WHEN s.sensor_type = 'Temperature' THEN value END) AS temperature,
        MAX(CASE WHEN s.sensor_type = 'Humidity' THEN value END) AS humidity,
        MAX(CASE WHEN s.sensor_type = 'Light' THEN value END) AS light,
        timestamp
       FROM data_sensor sd JOIN sensors s ON s.id = sd.sensor_id WHERE s.device_id = ?
       GROUP BY s.device_id, timestamp ORDER BY timestamp DESC LIMIT 1`,
      [deviceId],
    );
    return rows[0] || null;
  },

  async getChartHistory(deviceId = 1, limit = 20) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const [rows] = await pool.execute(
      `SELECT * FROM (
        SELECT s.device_id,
          MAX(CASE WHEN s.sensor_type = 'Temperature' THEN value END) AS temperature,
          MAX(CASE WHEN s.sensor_type = 'Humidity' THEN value END) AS humidity,
          MAX(CASE WHEN s.sensor_type = 'Light' THEN value END) AS light,
          timestamp
        FROM data_sensor sd JOIN sensors s ON s.id = sd.sensor_id WHERE s.device_id = ?
        GROUP BY s.device_id, timestamp ORDER BY timestamp DESC LIMIT ${safeLimit}
      ) recent ORDER BY timestamp ASC`,
      [deviceId],
    );
    return rows;
  },

  async list({ page, limit, type, search, searchBy, sort }) {
    const where = [];
    const params = [];
    if (type) {
      where.push('s.sensor_type = ?');
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
       JOIN sensors s ON s.id = sd.sensor_id ${whereSql}`,
      params,
    );
    const offset = (page - 1) * limit;
    const order = sort === 'oldest' ? 'ASC' : 'DESC';
    const [rows] = await pool.execute(
      `SELECT sd.id, s.sensor_name, s.sensor_type, sd.value,
              CASE s.sensor_type
                WHEN 'Temperature' THEN '°C' WHEN 'Humidity' THEN '%' WHEN 'Light' THEN 'Lux'
              END AS unit, sd.timestamp, 'Normal' AS status
       FROM data_sensor sd
       JOIN sensors s ON s.id = sd.sensor_id
       ${whereSql} ORDER BY sd.timestamp ${order}, sd.id ${order} LIMIT ${Number(limit)} OFFSET ${offset}`,
      params,
    );
    return { rows, total: countRows[0].total };
  },
};
