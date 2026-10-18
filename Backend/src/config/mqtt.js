import { env } from './env.js';

export const MQTT_TOPICS = Object.freeze({
  SENSOR_DATA: 'data_sensor',
  DEVICE_CONTROL: 'device_control',
  DEVICE_STATUS: 'device_status',
});

export const mqttOptions = Object.freeze({
  port: env.mqtt.port,
  clientId: env.mqtt.clientId,
  username: env.mqtt.username,
  password: env.mqtt.password,
  clean: true,
  reconnectPeriod: 2000,
  connectTimeout: 10000,
});
