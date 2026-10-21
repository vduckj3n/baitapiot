import { pool } from '../config/database.js';
import { deviceRepository } from '../repositories/deviceRepository.js';
import { sensorRepository } from '../repositories/sensorRepository.js';

const isFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value);

export function validateSensorPayload(payload) {
  if (!Number.isInteger(payload?.device_id) || payload.device_id <= 0) {
    throw new Error('device_id không hợp lệ');
  }
  if (!isFiniteNumber(payload.temperature)) {
    throw new Error('temperature không hợp lệ');
  }
  if (
    !isFiniteNumber(payload.humidity) ||
    payload.humidity < 0 ||
    payload.humidity > 100
  ) {
    throw new Error('humidity không hợp lệ');
  }
  if (!isFiniteNumber(payload.light) || payload.light < 0 || payload.light > 1000) {
    throw new Error('light phải là số trong khoảng 0–1000 lux');
  }
}

export const sensorService = {
  async processTelemetry(payload) {
    validateSensorPayload(payload);
    const connection = await pool.getConnection();
    const timestamp = new Date();
    let becameOnline = false;
    try {
      await connection.beginTransaction();
      const device = await deviceRepository.findById(
        payload.device_id,
        connection,
      );
      if (!device) {
        throw new Error(`Không tồn tại device_id ${payload.device_id}`);
      }
      becameOnline = device.connection_status !== 'ONLINE';
      await sensorRepository.insertTelemetry(
        connection,
        payload.device_id,
        payload,
        timestamp,
      );
      await deviceRepository.markSeen(payload.device_id, connection);
      await connection.commit();
      return { ...payload, timestamp: timestamp.toISOString(), becameOnline };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  },

  async getDashboard(deviceId = 1) {
    const [device, latest, history, leds] = await Promise.all([
      deviceRepository.findById(deviceId),
      sensorRepository.getLatest(deviceId),
      sensorRepository.getChartHistory(deviceId, 20),
      deviceRepository.getLeds(),
    ]);
    if (!device) {
      return null;
    }
    return {
      device: {
        id: device.id,
        name: device.device_name,
        status: device.connection_status,
        last_seen: device.last_seen,
      },
      latest,
      leds,
      history,
    };
  },
};
