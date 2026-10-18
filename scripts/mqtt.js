const path = require('node:path');
const { randomUUID } = require('node:crypto');

function mqttReady(backend, config) {
  const mqtt = require(path.join(backend, 'node_modules', 'mqtt'));
  return new Promise((resolve) => {
    let finished = false;
    const client = mqtt.connect(config.MQTT_HOST || 'mqtt://localhost', {
      port: Number(config.MQTT_PORT || 1883),
      username: config.MQTT_USERNAME || undefined,
      password: config.MQTT_PASSWORD || undefined,
      clientId: `iot-health-${randomUUID()}`,
      connectTimeout: 1500,
      reconnectPeriod: 0,
    });
    const timer = setTimeout(() => finish(false), 2000);
    function finish(ready) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      client.end(true);
      resolve(ready);
    }
    client.once('connect', () => finish(true));
    client.once('error', () => finish(false));
    client.once('close', () => finish(false));
  });
}
module.exports = { mqttReady };
