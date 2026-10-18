import mqtt from 'mqtt';
import { env } from '../config/env.js';
import { MQTT_TOPICS, mqttOptions } from '../config/mqtt.js';
import { logger } from '../utils/logger.js';

const incomingTopics = [MQTT_TOPICS.SENSOR_DATA, MQTT_TOPICS.DEVICE_STATUS];
let client;

// Cùng một topic, nhưng trạng thái và xác nhận lệnh có luồng xử lý riêng.
export async function dispatchMqttMessage(topic, buffer, packet, handlers) {
  const payload = JSON.parse(buffer.toString('utf8'));
  if (topic === MQTT_TOPICS.SENSOR_DATA) {
    return handlers.onSensorData(payload);
  }
  if (topic !== MQTT_TOPICS.DEVICE_STATUS) return;
  if (payload.type === 'status') {
    return handlers.onDeviceStatus(payload);
  }
  if (payload.type === 'sync_request') {
    if (packet?.retain) return;
    return handlers.onSyncRequest(payload);
  }
  if (payload.type === 'response') {
    // Phản hồi lệnh không được lưu retained hoặc xử lý lại khi subscribe.
    if (packet?.retain) return;
    return handlers.onDeviceResponse(payload);
  }
  throw new Error('type của device_status phải là status, response hoặc sync_request');
}

export const mqttService = {
  connect({ onSensorData, onDeviceResponse, onDeviceStatus, onSyncRequest }) {
    if (client) {
      return client;
    }
    client = mqtt.connect(env.mqtt.host, mqttOptions);

    client.on('connect', () => {
      logger.info('Connected to MQTT broker');
      client.subscribe(
        incomingTopics,
        { qos: 1 },
        (error) => {
          if (error) {
            logger.error('MQTT subscription failed', {
              message: error.message,
            });
          } else {
            logger.info('Subscribed to MQTT topics', {
              topics: incomingTopics,
            });
          }
        },
      );
    });
    client.on('reconnect', () => logger.warn('Reconnecting to MQTT broker'));
    client.on('offline', () => logger.warn('MQTT broker is offline'));
    client.on('error', (error) =>
      logger.error('MQTT error', { message: error.message }),
    );
    // Giữ đúng thứ tự MQTT để snapshot cũ không ghi đè phản hồi mới.
    let messages = Promise.resolve();
    const handlers = { onSensorData, onDeviceResponse, onDeviceStatus, onSyncRequest };
    client.on('message', (topic, buffer, packet) => {
      messages = messages
        .then(() => dispatchMqttMessage(topic, buffer, packet, handlers))
        .catch((error) => {
          logger.warn('Rejected MQTT message', { topic, message: error.message });
        });
    });
    return client;
  },

  async publishControl(payload) {
    if (!client?.connected) {
      throw new Error('MQTT broker is not connected');
    }
    await new Promise((resolve, reject) => {
      client.publish(
        MQTT_TOPICS.DEVICE_CONTROL,
        JSON.stringify(payload),
        { qos: 1 },
        (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        },
      );
    });
  },

  async close() {
    if (!client) {
      return;
    }
    await new Promise((resolve) => client.end(false, {}, resolve));
    client = undefined;
  },
};
