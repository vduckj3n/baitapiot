const { test } = require('node:test');
const assert = require('node:assert/strict');

async function fixture() {
  const { dispatchMqttMessage } = await import('../../Backend/src/services/mqttService.js');
  const { MQTT_TOPICS } = await import('../../Backend/src/config/mqtt.js');
  const calls = [];
  const handlers = Object.fromEntries(['onSensorData', 'onDeviceResponse', 'onDeviceStatus', 'onSyncRequest'].map((name) =>
    [name, async (payload) => { calls.push({ name, payload }); }],
  ));
  return { MQTT_TOPICS, calls, dispatch: (topic, payload, retain = false) =>
    dispatchMqttMessage(topic, Buffer.from(JSON.stringify(payload)), { retain }, handlers) };
}

test('Only three MQTT topics are configured and sensor data uses its own handler', async () => {
  const f = await fixture();
  assert.deepEqual(Object.values(f.MQTT_TOPICS).sort(), ['data_sensor', 'device_control', 'device_status']);
  await f.dispatch('data_sensor', { device_id: 1, temperature: 25 });
  assert.equal(f.calls[0].name, 'onSensorData');
});

test('Online, offline and heartbeat snapshots never invoke the action-response handler', async () => {
  const f = await fixture();
  for (const status of ['ONLINE', 'OFFLINE']) {
    await f.dispatch('device_status', { type: 'status', device_id: 1, connection_status: status }, true);
  }
  await f.dispatch('device_status', { type: 'status', device_id: 1, connection_status: 'ONLINE', led_states: ['ON', 'OFF', 'ON'] });
  assert.equal(f.calls.length, 3);
  assert(f.calls.every((call) => call.name === 'onDeviceStatus'));
});

test('Only a fresh response invokes the action handler; retained responses are ignored', async () => {
  const f = await fixture();
  const response = { type: 'response', action_id: 42, device_id: 2, led_state: 'OFF', status: 'SUCCESS' };
  await f.dispatch('device_status', response, true);
  assert.equal(f.calls.length, 0);
  await f.dispatch('device_status', response);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].name, 'onDeviceResponse');
  assert.equal(f.calls[0].payload.action_id, 42);
  await assert.rejects(f.dispatch('device_status', { type: 'unknown' }), /type/);
});


test('Sync requests use their own handler and cannot complete an action', async () => {
  const f = await fixture();
  const request = { type: 'sync_request', device_id: 1, sync_id: 123 };
  await f.dispatch('device_status', request, true);
  assert.equal(f.calls.length, 0);
  await f.dispatch('device_status', request);
  assert.equal(f.calls[0].name, 'onSyncRequest');
});
