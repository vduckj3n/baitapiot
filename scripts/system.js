const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { printMqttIpStatus } = require('./network.js');
const { workerCommand } = require('./worker-command.js');
const { acquireStartLock } = require('./start-lock.js');
const {
  root,
  runtime,
  readState,
  request,
  sleep,
} = require('./runtime.js');

async function activeState() {
  const state = readState();
  if (!state?.controlPort) {
    return null;
  }
  try {
    await request(state, '/ping');
    return state;
  } catch {
    return null;
  }
}

async function printSummary(state) {
  const status = await request(state, '/status');
  const missing = Object.entries(status.services)
    .filter(([, up]) => !up)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(
      `Dịch vụ chưa sẵn sàng: ${missing.join(', ')}. Xem log hệ thống.`,
    );
  }
  console.log('HỆ THỐNG IOT ĐÃ SẴN SÀNG');
  console.log(`[UP] Frontend: http://localhost:${state.frontendPort || 5500}`);
  console.log(`[UP] Backend : http://localhost:${state.backendPort}`);
  console.log(
    `[UP] MySQL   : ${state.dbHost || 'localhost'}:${state.dbPort || 3307}`,
  );
  console.log(`[UP] MQTT    : ${state.mqttHost}:${state.mqttPort}`);
  if (state.firmwareMqttHost && state.firmwareMqttPort) {
    console.log(
      `MQTT ESP32   : ${state.firmwareMqttHost}:${state.firmwareMqttPort}`,
    );
  }
  await printMqttIpStatus(state.firmwareMqttHost);
}

async function start(mode) {
  fs.mkdirSync(runtime, { recursive: true });
  const releaseLock = acquireStartLock(path.join(runtime, 'start.lock'));
  try {
    const existing = await activeState();
    if (existing) {
      await printSummary(existing);
      console.log('Hệ thống đã chạy. Dùng npm stop trước khi đổi chế độ.');
      return;
    }
    const id = randomUUID();
    const logDir = path.join(runtime, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const log = fs.openSync(path.join(logDir, 'system.log'), 'a');
    let child;
    try {
      const command = workerCommand(root, mode, id);
      child = spawn(command.executable, command.args, {
        cwd: root,
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', log, log],
      });
    } finally {
      fs.closeSync(log);
    }
    let spawnError;
    child.on('error', (error) => {
      spawnError = error;
    });
    child.unref();
    for (let i = 0; i < 360; i++) {
      if (spawnError) {
        throw spawnError;
      }
      const state = readState();
      if (state?.id === id && state.error) {
        throw new Error(state.error);
      }
      if (state?.id === id && state.ready) {
        await printSummary(state);
        return;
      }
      await sleep(250);
    }
    const state = readState();
    if (state?.id === id && state.controlPort) {
      await request(state, '/stop').catch(() => {});
    }
    throw new Error(
      'Khởi động quá thời gian chờ. Xem Backend/runtime/logs/system.log.',
    );
  } finally {
    releaseLock();
  }
}

async function stop() {
  const state = await activeState();
  if (!state) {
    const last = readState();
    if (last?.stopError) throw new Error(last.stopError);
    console.log('Hệ thống đã dừng.');
    return;
  }
  await request(state, '/stop');
  for (let i = 0; i < 160; i++) {
    if (!(await activeState())) {
      const last = readState();
      if (last?.id === state.id && last.stopError) {
        throw new Error(last.stopError);
      }
      console.log('HỆ THỐNG IOT ĐÃ DỪNG');
      return;
    }
    await sleep(250);
  }
  throw new Error('Không dừng được hệ thống. Xem log hệ thống.');
}

async function main(action) {
  if (action === 'dev') {
    return start(action);
  }
  if (action === 'stop') {
    return stop();
  }
  if (action === 'restart') {
    await stop();
    return start('dev');
  }
  if (action === 'status') {
    const state = await activeState();
    if (!state) {
      console.log('[DOWN] Hệ thống chưa chạy bằng script Node.js.');
      process.exitCode = 1;
      return;
    }
    const status = await request(state, '/status');
    for (const [name, up] of Object.entries(status.services)) {
      console.log(`[${up ? 'UP' : 'DOWN'}] ${name}`);
    }
    if (!Object.values(status.services).every(Boolean)) {
      process.exitCode = 1;
    }
    return;
  }
  throw new Error('Lệnh hợp lệ: dev, stop, restart, status.');
}

if (require.main === module) {
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
module.exports = { main };
