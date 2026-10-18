import { pool } from '../config/database.js';
import { env } from '../config/env.js';
import { actionRepository } from '../repositories/actionRepository.js';
import { deviceRepository } from '../repositories/deviceRepository.js';
import { createHttpError } from '../utils/response.js';

let ioServer;
let mqttPublisher;
let syncSession = null;
let completedSyncId = null;

const emitResponse = (payload) => ioServer?.emit('device_response', payload);

export const deviceService = {
  configure({ io, publishControl }) {
    ioServer = io;
    mqttPublisher = publishControl;
    syncSession = null;
    completedSyncId = null;
  },

  async restoreTimeoutState() {
    const expired = await actionRepository.failExpiredPending(
      env.deviceResponseTimeout,
    );
    for (const row of expired) {
      emitResponse({
        action_id: row.id,
        device_id: row.device_id,
        status: 'FAILED',
        message: 'Device response timeout',
        timestamp: new Date().toISOString(),
      });
    }
  },

  async replayPendingActions() {
    const actions = await actionRepository.getUnexpiredPending(env.deviceResponseTimeout);
    for (const action of actions) {
      await mqttPublisher({
        action_id: action.id, device_id: action.device_id, command: action.action,
      });
    }
  },

  async synchronizeLeds(payload) {
    if (payload?.device_id !== 1 || !Number.isInteger(payload.sync_id) ||
        payload.sync_id < 0 || payload.sync_id > 4294967295) {
      throw new Error('Yêu cầu đồng bộ không hợp lệ');
    }
    if (!mqttPublisher) throw new Error('MQTT chưa sẵn sàng');
    if (payload.sync_id === completedSyncId) return;
    if (!syncSession || syncSession.id !== payload.sync_id) {
      const states = await deviceRepository.getRestoreStates();
      if (states.length !== 3 || states.some((state) => !['ON', 'OFF'].includes(state))) {
        throw new Error('Không đọc được trạng thái ba đèn');
      }
      syncSession = { id: payload.sync_id, states };
    }
    await mqttPublisher({
      type: 'sync', device_id: 1, sync_id: syncSession.id,
      led_states: syncSession.states,
    });
  },

  async processDeviceStatus(payload) {
    const deviceId = payload?.device_id;
    const status = payload?.connection_status;
    const ledState = payload?.led_state;
    if (
      !Number.isInteger(deviceId) ||
      deviceId <= 0 ||
      !['ONLINE', 'OFFLINE'].includes(status)
    ) {
      throw new Error('Payload device_status không hợp lệ');
    }
    if (ledState !== undefined && !['ON', 'OFF'].includes(ledState)) {
      throw new Error('led_state không hợp lệ');
    }
    const states = payload.led_states;
    if (payload.synchronized !== undefined && typeof payload.synchronized !== 'boolean') {
      throw new Error('synchronized không hợp lệ');
    }
    if (status === 'OFFLINE' && deviceId === 1) syncSession = null;
    if (status === 'ONLINE' && payload.synchronized === false && (states !== undefined || ledState !== undefined)) {
      throw new Error('ESP chưa đồng bộ không được ghi đè trạng thái đèn');
    }
    if (
      states !== undefined &&
      (!Array.isArray(states) ||
        states.length !== 3 ||
        deviceId !== 1 ||
        states.some((state) => !['ON', 'OFF'].includes(state)))
    ) {
      throw new Error('led_states không hợp lệ');
    }
    let restored = false;
    if (payload.synchronized === true && syncSession) {
      if (payload.sync_id !== syncSession.id) return;
      if (!states || states.some((state, index) => state !== syncSession.states[index])) {
        throw new Error('Trạng thái khôi phục không khớp');
      }
      completedSyncId = syncSession.id;
      syncSession = null;
      restored = true;
    }
    // Firmware báo kết nối của cả ESP; mỗi đèn vẫn có trạng thái riêng.
    const ids = deviceId === 1 ? [1, 2, 3] : [deviceId];
    for (const id of ids) {
      const state = states
        ? states[id - 1]
        : id === deviceId ? ledState : undefined;
      const updated = await deviceRepository.setConnectionStatus(id, status, state);
      if (!updated) throw new Error(`Không tồn tại device_id ${id}`);
      ioServer?.emit('device_status', {
        device_id: id,
        connection_status: status,
        ...(state && { led_state: state }),
      });
    }
    // Giữ nguyên action_id và thời hạn ban đầu, không tạo lệnh/lịch sử mới.
    if (restored) await this.replayPendingActions();
  },

  async requestAction({ userId, deviceId, command }) {
    if (![1, 2, 3].includes(deviceId)) {
      throw createHttpError(400, 'deviceId phải là 1, 2 hoặc 3');
    }
    if (!mqttPublisher) {
      throw createHttpError(503, 'MQTT service chưa sẵn sàng');
    }
    const connection = await pool.getConnection();
    let actionId;
    try {
      await connection.beginTransaction();
      await deviceRepository.lockById(connection, deviceId);
      const device = await deviceRepository.findById(deviceId, connection);
      if (!device) {
        throw createHttpError(404, 'Không tìm thấy thiết bị');
      }
      if (syncSession && device.connection_status === 'ONLINE') {
        throw createHttpError(409, 'ESP đang khôi phục trạng thái đèn, vui lòng thử lại');
      }
      const existing = await actionRepository.findPendingByDeviceForUpdate(
        connection,
        deviceId,
      );
      if (existing) {
        throw createHttpError(409, 'Thiết bị đang xử lý một lệnh khác');
      }
      actionId = await actionRepository.createPending(connection, {
        userId,
        deviceId,
        action: command,
      });
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    try {
      await mqttPublisher({ action_id: actionId, device_id: deviceId, command });
    } catch (error) {
      await actionRepository.failIfPending(
        actionId,
        'Không thể gửi lệnh tới MQTT Broker',
      );
      emitResponse({
        action_id: actionId,
        device_id: deviceId,
        status: 'FAILED',
        message: 'Không thể gửi lệnh tới MQTT Broker',
        timestamp: new Date().toISOString(),
      });
      throw createHttpError(503, 'Không thể gửi lệnh tới MQTT Broker');
    }

    return {
      id: actionId,
      device_id: deviceId,
      action: command,
      status: 'PENDING',
    };
  },

  async processDeviceResponse(payload) {
    const validDeviceId =
      [1, 2, 3].includes(payload?.device_id);
    const validActionId = Number.isSafeInteger(payload?.action_id) && payload.action_id > 0;
    const validLedState = ['ON', 'OFF'].includes(payload?.led_state);
    const validStatus = ['SUCCESS', 'FAILED'].includes(payload?.status);
    if (!validDeviceId || !validActionId || !validLedState || !validStatus) {
      throw new Error('Payload phản hồi lệnh không hợp lệ');
    }

    const connection = await pool.getConnection();
    const timestamp = new Date();
    let action;
    let becameOnline = false;
    try {
      await connection.beginTransaction();
      await deviceRepository.lockById(connection, payload.device_id);
      const device = await deviceRepository.findById(
        payload.device_id,
        connection,
      );
      if (!device) {
        throw new Error(`Không tồn tại device_id ${payload.device_id}`);
      }
      becameOnline = device.connection_status !== 'ONLINE';
      action = await actionRepository.findPendingById(
        connection,
        payload.action_id,
        payload.device_id,
        env.deviceResponseTimeout,
      );
      if (!action) {
        // Bỏ qua phản hồi lặp hoặc đến sau khi lệnh đã hết hạn.
        await connection.rollback();
        return null;
      }
      if (payload.status === 'SUCCESS' && action.action !== payload.led_state) {
        throw new Error('Trạng thái đèn không khớp lệnh đang chờ');
      }
      await actionRepository.complete(
        connection,
        action.id,
        payload.status,
        payload.message || null,
      );
      if (payload.status === 'SUCCESS') {
        await deviceRepository.updateLedState(
          payload.device_id,
          payload.led_state,
          connection,
        );
      }
      await deviceRepository.markSeen(payload.device_id, connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return {
      action_id: action.id,
      device_id: payload.device_id,
      led_state: payload.led_state,
      status: payload.status,
      timestamp: timestamp.toISOString(),
      becameOnline,
    };
  },
};
