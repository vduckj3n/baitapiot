const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function dashboard() {
  const elements = new Map();
  const handlers = {};
  const requests = [];
  const context = vm.createContext({
    window: { APP_CONFIG: { DEVICE_ID: 1, API_BASE_URL: '/api', SOCKET_URL: '/', CHART_MAX_POINTS: 20 } },
    document: { getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, { classList: { toggle(name, active) { this[name] = active; } } });
      }
      return elements.get(id);
    } },
    console,
    io: () => ({ on(name, callback) { handlers[name] = callback; } }),
    filterActionData() {},
    alert(message) { throw new Error(message); },
    updateChartTheme() {},
    Chart: class {
      constructor(_element, options) { this.data = options.data; this.updates = 0; }
      update() { this.updates++; }
      destroy() {}
    },
    request: async (route, options) => { requests.push({ route, options }); return {}; },
  });
  for (const file of ['api.js', 'dashboard.js']) {
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../Frontend/js', file), 'utf8'), context);
  }
  vm.runInContext('apiRequest = (...args) => request(...args);', context);
  return { context, elements, handlers, requests, read: (source) => vm.runInContext(source, context) };
}

const snapshot = (pending = false) => ({ data: {
  device: { status: 'ONLINE' }, latest: null, history: [],
  leds: [1, 2, 3].map((id) => ({ id, state: 'OFF', pending: id === 2 && pending })),
} });

test('LED buttons send separate commands, allow other LEDs and recover from timeout', async () => {
  const d = dashboard();
  for (const id of [1, 2, 3]) d.context.renderLed(id, 'ON');
  d.context.request = async (route, options) => {
    d.requests.push({ route, options });
    return options ? {} : snapshot();
  };
  d.context.connectSocket();
  await d.context.toggleLED(2);
  await d.context.toggleLED(2);
  await d.context.toggleLED(3);
  assert.equal(d.requests.length, 2);
  assert.equal(d.requests[0].route, '/devices/2/actions');
  assert.equal(JSON.parse(d.requests[0].options.body).command, 'OFF');
  assert.equal(d.elements.get('btn-led-1').disabled, false);
  d.handlers.device_response({ device_id: 2, status: 'SUCCESS', led_state: 'OFF' });
  assert.equal(d.read('ledStates[1]'), 'ON');
  assert.equal(d.read('ledStates[2]'), 'OFF');
  assert.equal(d.read('ledStates[3]'), 'ON');
  d.handlers.device_response({ device_id: 3, status: 'FAILED' });
  assert.equal(d.read('ledStates[3]'), 'ON');
  assert.equal(d.elements.get('btn-led-3').disabled, false);
});

test('Dashboard restores pending state, unlocks expired commands and reuses its chart', async () => {
  const d = dashboard();
  d.context.request = async () => snapshot(true);
  await d.context.loadDashboard();
  assert.equal(d.elements.get('btn-led-2').disabled, true);
  const chart = d.read('combinedChart');
  d.context.request = async () => snapshot(false);
  await d.context.loadDashboard();
  assert.equal(d.elements.get('btn-led-2').disabled, false);
  assert.equal(d.read('combinedChart'), chart);
  assert.equal(chart.updates, 1);
});

test('An older HTTP snapshot cannot overwrite a newer MQTT state or another snapshot', async () => {
  const d = dashboard();
  let resolve;
  d.context.request = () => new Promise((done) => { resolve = done; });
  const loading = d.context.loadDashboard();
  d.context.renderLed(2, 'ON');
  resolve(snapshot());
  await loading;
  assert.equal(d.read('ledStates[2]'), 'ON');
  const older = d.context.loadDashboard();
  const resolveOlder = resolve;
  const newer = d.context.loadDashboard();
  const data = snapshot();
  data.data.leds[2].state = 'ON';
  resolve(data);
  await newer;
  resolveOlder(snapshot());
  await older;
  assert.equal(d.read('ledStates[3]'), 'ON');
});
