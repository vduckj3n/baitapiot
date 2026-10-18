const { test } = require('node:test');
const assert = require('node:assert/strict');

async function fixture(t) {
  const { pool } = await import('../../Backend/src/config/database.js');
  const { deviceService } = await import('../../Backend/src/services/deviceService.js');
  const { deviceRepository } = await import('../../Backend/src/repositories/deviceRepository.js');
  const { actionRepository } = await import('../../Backend/src/repositories/actionRepository.js');
  const original = [];
  const calls = [];
  const events = [];
  function replace(object, name, method) {
    original.push(() => { object[name] = method.original; });
    method.original = object[name];
    object[name] = method;
  }
  const connection = Object.fromEntries(['beginTransaction', 'commit', 'rollback', 'release'].map((name) =>
    [name, async () => { calls.push(name); }],
  ));
  replace(pool, 'getConnection', async () => connection);
  replace(deviceRepository, 'lockById', async (_connection, id) => { calls.push(['lock', id]); });
  replace(deviceRepository, 'findById', async (id) => ({ id, connection_status: 'ONLINE' }));
  replace(deviceRepository, 'getRestoreStates', async () => ['ON', 'OFF', 'ON']);
  replace(deviceRepository, 'setConnectionStatus', async (id, status, state) => { calls.push(['connection', id, status, state]); return true; });
  replace(deviceRepository, 'markSeen', async (id) => { calls.push(['seen', id]); });
  replace(deviceRepository, 'updateLedState', async (id, state) => { calls.push(['state', id, state]); });
  replace(actionRepository, 'findPendingByDeviceForUpdate', async () => null);
  replace(actionRepository, 'getUnexpiredPending', async () => []);
  replace(actionRepository, 'createPending', async (_connection, action) => { calls.push(['create', action]); return 42; });
  replace(actionRepository, 'findPendingById', async (_connection, actionId, deviceId, timeoutMs) => {
    calls.push(['match', actionId, deviceId, timeoutMs]); return { id: actionId, action: 'OFF' };
  });
  replace(actionRepository, 'complete', async (_connection, id, status) => { calls.push(['complete', id, status]); });
  deviceService.configure({
    io: { emit: (name, payload) => events.push({ name, payload }) },
    publishControl: async (payload) => { calls.push(['publish', payload]); },
  });
  t.after(() => { original.reverse().forEach((restore) => restore()); });
  return { deviceService, deviceRepository, actionRepository, calls, events, replace };
}

test('Backend keeps the selected LED ID from request through MQTT acknowledgement', async (t) => {
  const f = await fixture(t);
  const result = await f.deviceService.requestAction({ userId: 7, deviceId: 2, command: 'OFF' });
  assert.equal(result.device_id, 2);
  assert.equal(f.calls.find((call) => Array.isArray(call) && call[0] === 'publish')[1].action_id, 42);
  assert(f.calls.some((call) => Array.isArray(call) && call[0] === 'publish' && call[1].device_id === 2));
  const response = await f.deviceService.processDeviceResponse({ action_id: 42, device_id: 2, led_state: 'OFF', status: 'SUCCESS' });
  assert.equal(response.action_id, 42);
  assert.deepEqual(f.calls.find((call) => Array.isArray(call) && call[0] === 'state'), ['state', 2, 'OFF']);
  assert.equal(f.calls.filter((call) => call === 'commit').length, 2);
  await assert.rejects(f.deviceService.requestAction({ userId: 7, deviceId: 4, command: 'OFF' }), /deviceId/);
});

test('Duplicate or late MQTT acknowledgements cannot change another action or LED', async (t) => {
  const f = await fixture(t);
  f.replace(f.actionRepository, 'findPendingById', async () => null);
  const response = await f.deviceService.processDeviceResponse({ action_id: 42, device_id: 3, led_state: 'ON', status: 'SUCCESS' });
  assert.equal(response, null);
  assert(f.calls.includes('rollback'));
  assert(!f.calls.some((call) => Array.isArray(call) && ['state', 'complete'].includes(call[0])));
});

test('Database timeout monitor emits one failure for the affected LED', async (t) => {
  const f = await fixture(t);
  f.replace(f.actionRepository, 'failExpiredPending', async () => [{ id: 42, device_id: 2 }]);
  await f.deviceService.restoreTimeoutState();
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].payload.device_id, 2);
  assert.equal(f.events[0].payload.status, 'FAILED');
});

test('Action filters reject zero, nonnumeric and fractional device IDs', async (t) => {
  const { getActions } = await import('../../Backend/src/controllers/actionController.js');
  const { actionService } = await import('../../Backend/src/services/actionService.js');
  const original = actionService.list;
  actionService.list = async (query) => ({ rows: [{ device_id: query.deviceId }], total: 1 });
  t.after(() => { actionService.list = original; });
  for (const deviceId of ['0', 'abc', '1.5', '-1']) {
    let error;
    await getActions({ query: { deviceId } }, {}, (value) => { error = value; });
    assert.equal(error?.status, 400, deviceId);
  }
  let result;
  await getActions({ query: { deviceId: '2' } }, { json(value) { result = value; } }, (error) => { throw error; });
  assert.equal(result.data[0].device_id, 2);
});


test('An old acknowledgement cannot complete a newer command with the same LED and state', async (t) => {
  const f = await fixture(t);
  f.replace(f.actionRepository, 'findPendingById', async (_connection, actionId, deviceId) =>
    actionId === 43 && deviceId === 2 ? { id: 43, action: 'OFF' } : null,
  );
  const old = await f.deviceService.processDeviceResponse({ action_id: 42, device_id: 2, led_state: 'OFF', status: 'SUCCESS' });
  assert.equal(old, null);
  assert(!f.calls.some((call) => Array.isArray(call) && call[0] === 'complete'));
  const current = await f.deviceService.processDeviceResponse({ action_id: 43, device_id: 2, led_state: 'OFF', status: 'SUCCESS' });
  assert.equal(current.action_id, 43);
});

test('Invalid or mismatched responses cannot complete an action', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.deviceService.processDeviceResponse({ device_id: 2, led_state: 'OFF', status: 'SUCCESS' }), /không hợp lệ/);
  await assert.rejects(f.deviceService.processDeviceResponse({ action_id: 42, device_id: 2, led_state: 'ON', status: 'SUCCESS' }), /không khớp/);
  assert(!f.calls.some((call) => Array.isArray(call) && call[0] === 'complete'));
});


test('Replug restores ON/OFF/ON without creating history or writing boot OFF states', async (t) => {
  const f = await fixture(t);
  await f.deviceService.processDeviceStatus({ device_id: 1, connection_status: 'ONLINE', sync_id: 123, synchronized: false });
  assert(f.calls.filter((call) => Array.isArray(call) && call[0] === 'connection').every((call) => call[3] === undefined));
  await f.deviceService.synchronizeLeds({ device_id: 1, sync_id: 123 });
  const control = f.calls.find((call) => Array.isArray(call) && call[0] === 'publish')[1];
  assert.deepEqual(control, { type: 'sync', device_id: 1, sync_id: 123, led_states: ['ON', 'OFF', 'ON'] });
  assert(!f.calls.some((call) => Array.isArray(call) && ['create', 'complete'].includes(call[0])));
  await assert.rejects(f.deviceService.requestAction({ userId: 7, deviceId: 2, command: 'ON' }), /khôi phục/);
  await f.deviceService.processDeviceStatus({ device_id: 1, connection_status: 'ONLINE', sync_id: 123, synchronized: true, led_states: ['ON', 'OFF', 'ON'] });
  const restored = f.calls.filter((call) => Array.isArray(call) && call[0] === 'connection' && call[3]);
  assert.deepEqual(restored.map((call) => call[3]), ['ON', 'OFF', 'ON']);
  await f.deviceService.requestAction({ userId: 7, deviceId: 2, command: 'ON' });
});

test('Sync retries are idempotent and cannot overwrite newer successful commands', async (t) => {
  const f = await fixture(t);
  await f.deviceService.synchronizeLeds({ device_id: 1, sync_id: 123 });
  await f.deviceService.synchronizeLeds({ device_id: 1, sync_id: 123 });
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === 'publish').length, 2);
  await f.deviceService.processDeviceStatus({ device_id: 1, connection_status: 'ONLINE', sync_id: 123, synchronized: true, led_states: ['ON', 'OFF', 'ON'] });
  await f.deviceService.synchronizeLeds({ device_id: 1, sync_id: 123 });
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === 'publish').length, 2);
  await f.deviceService.processDeviceStatus({ device_id: 1, connection_status: 'OFFLINE' });
  await f.deviceService.synchronizeLeds({ device_id: 1, sync_id: 124 });
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === 'publish').length, 3);
});

test('Offline commands still become FAILED and never update restore state', async (t) => {
  const f = await fixture(t);
  f.replace(f.deviceRepository, 'findById', async (id) => ({ id, connection_status: 'OFFLINE' }));
  await f.deviceService.processDeviceStatus({ device_id: 1, connection_status: 'OFFLINE' });
  const action = await f.deviceService.requestAction({ userId: 7, deviceId: 2, command: 'ON' });
  assert.equal(action.status, 'PENDING');
  f.replace(f.actionRepository, 'failExpiredPending', async () => [{ id: action.id, device_id: 2 }]);
  await f.deviceService.restoreTimeoutState();
  assert.equal(f.events.find((event) => event.name === 'device_response').payload.status, 'FAILED');
  assert(!f.calls.some((call) => Array.isArray(call) && call[0] === 'state'));
  await f.deviceService.synchronizeLeds({ device_id: 1, sync_id: 124 });
  assert.deepEqual(f.calls.filter((call) => Array.isArray(call) && call[0] === 'publish').at(-1)[1].led_states, ['ON', 'OFF', 'ON']);
});


test('Plugging ESP in before timeout replays the original pending action after restore', async (t) => {
  const f = await fixture(t);
  f.replace(f.deviceRepository, 'findById', async (id) => ({ id, connection_status: 'OFFLINE' }));
  const pending = await f.deviceService.requestAction({ userId: 7, deviceId: 2, command: 'ON' });
  f.replace(f.actionRepository, 'getUnexpiredPending', async (timeout) => {
    assert.equal(timeout, 30000);
    return [{ id: pending.id, device_id: 2, action: 'ON' }];
  });
  await f.deviceService.synchronizeLeds({ device_id: 1, sync_id: 123 });
  let published = f.calls.filter((call) => Array.isArray(call) && call[0] === 'publish');
  assert.equal(published.length, 2);
  assert.equal(published[1][1].type, 'sync');
  await f.deviceService.processDeviceStatus({ device_id: 1, connection_status: 'ONLINE', sync_id: 123, synchronized: true, led_states: ['ON', 'OFF', 'ON'] });
  published = f.calls.filter((call) => Array.isArray(call) && call[0] === 'publish');
  assert.deepEqual(published[2][1], { action_id: pending.id, device_id: 2, command: 'ON' });
  f.replace(f.actionRepository, 'findPendingById', async () => ({ id: pending.id, action: 'ON' }));
  const response = await f.deviceService.processDeviceResponse({ action_id: pending.id, device_id: 2, led_state: 'ON', status: 'SUCCESS' });
  assert.equal(response.action_id, pending.id);
  assert.equal(response.status, 'SUCCESS');
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === 'create').length, 1);
  await f.deviceService.processDeviceStatus({ device_id: 1, connection_status: 'ONLINE', sync_id: 123, synchronized: true, led_states: ['ON', 'ON', 'ON'] });
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === 'publish').length, 3);
});

test('Expired or failed actions are not replayed after reconnect', async (t) => {
  const f = await fixture(t);
  await f.deviceService.synchronizeLeds({ device_id: 1, sync_id: 123 });
  await f.deviceService.processDeviceStatus({ device_id: 1, connection_status: 'ONLINE', sync_id: 123, synchronized: true, led_states: ['ON', 'OFF', 'ON'] });
  assert.equal(f.calls.filter((call) => Array.isArray(call) && call[0] === 'publish').length, 1);
});
