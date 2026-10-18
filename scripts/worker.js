const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const {
  root,
  runtime,
  readState,
  writeState,
  portOpen,
} = require('./runtime.js');
const { createFrontend } = require('./frontend.js');
const { mqttReady } = require('./mqtt.js');
const { startMysql, stopMysql, windowsMysql } = require('./mysql.js');
const backend = path.join(root, 'Backend');
const logDir = path.join(runtime, 'logs');
const sessionFile = path.join(root, 'Frontend', 'runtime-session.json');
const children = [];
let windowsLink;
let managedMysql,
  frontend,
  control,
  config,
  startupError,
  stopping = false,
  markerCreated = false;
const state = {
  id: process.argv[3],
  token: randomUUID(),
  ready: false,
  backendPort: 3000,
};

function launch(name, executable, args, cwd) {
  const log = fs.openSync(path.join(logDir, `${name}.log`), 'a');
  let child;
  try {
    child = spawn(executable, args, {
      cwd,
      env: { ...process.env, IOT_MANAGED_LOG: name === 'backend' ? 'true' : 'false' },
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
  } finally {
    fs.closeSync(log);
  }
  children.push(child);
  const unexpected = (error) => {
    if (stopping) {
      return;
    }
    if (state.ready) {
      fail(error);
    } else {
      startupError = error;
    }
  };
  child.once('error', (error) =>
    unexpected(new Error(`Không khởi động được ${name}: ${error.message}`)),
  );
  child.once('exit', (code) => {
    unexpected(new Error(`${name} đã dừng (exit ${code}). Xem ${name}.log.`));
  });
  return child;
}

async function killChild(child) {
  if (!child.pid) return;
  const exited = child.exitCode !== null || child.signalCode != null;
  if (process.platform === 'win32') {
    if (exited) return;
    await new Promise((resolve) => {
      const killer = spawn(
        'taskkill.exe',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' },
      );
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error;
      }
    }
    if (!exited) await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    // Also clean up a watcher child if its parent exited before the backend.
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error;
      }
    }
  }
}

async function shutdown(error) {
  if (stopping) {
    return;
  }
  stopping = true;
  state.ready = false;
  if (error) {
    state.error = error.message;
  }
  try {
    writeState(state);
  } catch (writeError) {
    console.error('Không ghi được trạng thái:', writeError.message);
  }
  if (frontend) {
    await new Promise((resolve) => {
      frontend.close(resolve);
      frontend.closeAllConnections();
    });
  }
  const results = await Promise.allSettled(
    children.filter((child) => child !== managedMysql?.child).map(killChild),
  );
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length) {
    state.stopError = failures.map((result) => result.reason.message).join('; ');
    console.error(state.stopError);
  }
  if (managedMysql) {
    try {
      await stopMysql(managedMysql, config, backend);
    } catch (error) {
      state.stopError = [state.stopError, `Không dừng được MySQL an toàn: ${error.message}`]
        .filter(Boolean).join('; ');
      console.error(state.stopError);
    }
  }
  if (markerCreated) {
    try {
      if (JSON.parse(fs.readFileSync(sessionFile, 'utf8')).id === state.id) {
        fs.unlinkSync(sessionFile);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Không dọn được phiên frontend:', error.message);
      }
    }
  }
  if (state.stopError) {
    writeState(state);
  } else if (!error && readState()?.id === state.id) {
    fs.unlinkSync(path.join(runtime, 'system.json'));
  }
  if (control) {
    await new Promise((resolve) => {
      control.close(resolve);
      control.closeAllConnections();
    });
  }
  process.exit(error ? 1 : 0);
}

function fail(error) {
  console.error(error.message);
  shutdown(error).catch((cleanupError) => {
    console.error(cleanupError.message);
    process.exit(1);
  });
}

async function databasePortOpen() {
  if (windowsLink) {
    try {
      await windowsLink.call('port');
      return true;
    } catch {
      return false;
    }
  }
  return portOpen(
    config?.DB_HOST || 'localhost',
    Number(config?.DB_PORT || 3307),
  );
}

async function database() {
  if (windowsLink) {
    return windowsLink.call('database');
  }
  const mysql = require(
    path.join(backend, 'node_modules', 'mysql2', 'promise'),
  );
  const connection = await mysql.createConnection({
    host: config.DB_HOST || 'localhost',
    port: Number(config.DB_PORT || 3307),
    user: config.DB_USER || 'iot_user',
    password: config.DB_PASSWORD || '',
    database: config.DB_NAME || 'iot_system',
    connectTimeout: 5000,
  });
  try {
    await connection.query('SELECT 1');
  } finally {
    await connection.end();
  }
}

async function health() {
  if (windowsLink) {
    try {
      await windowsLink.call('health', state.backendPort);
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${state.backendPort}/api/health`,
      { timeout: 1000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => req.destroy());
  });
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

function mosquittoExecutable() {
  if (config.MOSQUITTO_BIN) {
    return config.MOSQUITTO_BIN;
  }
  if (process.platform === 'win32') {
    const installed = path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'mosquitto',
      'mosquitto.exe',
    );
    if (fs.existsSync(installed)) {
      return installed;
    }
  }
  return 'mosquitto';
}

async function start() {
  fs.mkdirSync(logDir, { recursive: true });
  control = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${state.token}`) {
      res.writeHead(403);
      return res.end();
    }
    if (req.url === '/ping') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ id: state.id }));
    } else if (req.url === '/stop') {
      res.setHeader('Content-Type', 'application/json');
      res.end('{"stopping":true}');
      setImmediate(() => shutdown().catch(fail));
    } else if (req.url === '/status') {
      const [mysql, mqtt, backendUp] = await Promise.all([
        databasePortOpen(),
        config ? mqttReady(backend, config) : false,
        health(),
      ]);
      const services = {
        MySQL: mysql, MQTT: mqtt, Backend: backendUp,
        Frontend: Boolean(frontend?.listening),
      };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ready: state.ready, services }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await listen(control, 0, '127.0.0.1');
  state.controlPort = control.address().port;
  writeState(state);
  const envFile = path.join(backend, '.env');
  if (!fs.existsSync(envFile)) {
    throw new Error(
      'Thiếu Backend/.env. Sao chép Backend/.env.example và điền cấu hình.',
    );
  }
  const dotenv = require(path.join(backend, 'node_modules', 'dotenv'));
  config = { ...dotenv.parse(fs.readFileSync(envFile)), ...process.env };
  state.backendPort = Number(config.PORT || 3000);
  state.frontendPort = Number(config.FRONTEND_PORT || 5500);
  state.dbHost = config.DB_HOST || 'localhost';
  state.dbPort = Number(config.DB_PORT || 3307);
  if (!config.JWT_SECRET || config.JWT_SECRET.length < 16) {
    throw new Error('JWT_SECRET cần ít nhất 16 ký tự.');
  }
  if (
    !Number.isInteger(state.backendPort) ||
    state.backendPort < 1 ||
    state.backendPort > 65535
  ) {
    throw new Error('PORT không hợp lệ.');
  }
  if (!Number.isInteger(state.frontendPort) || state.frontendPort < 1 || state.frontendPort > 65535) {
    throw new Error('FRONTEND_PORT không hợp lệ.');
  }
  const mqttUrl = new URL(config.MQTT_HOST || 'mqtt://localhost');
  state.mqttHost = mqttUrl.hostname;
  state.mqttPort = Number(config.MQTT_PORT || mqttUrl.port || 1883);
  const firmwareFile = [
    path.join(root, 'ESP32', 'esp32_iot', 'esp32_iot.ino'),
    path.join(root, 'ESP32', 'esp32_iot.ino'),
  ].find((file) => fs.existsSync(file));
  if (firmwareFile) {
    const firmware = fs.readFileSync(firmwareFile, 'utf8');
    state.firmwareMqttHost = firmware.match(
      /const\s+char\s*\*\s*mqtt_server\s*=\s*"([^"]+)"/,
    )?.[1];
    state.firmwareMqttPort =
      Number(firmware.match(/const\s+int\s+mqtt_port\s*=\s*(\d+)/)?.[1]) ||
      undefined;
  }
  writeState(state);
  windowsLink = windowsMysql(config, backend);
  if (!(await databasePortOpen())) {
    console.log('Đang khởi động MySQL...');
    managedMysql = await startMysql(config, root, launch);
    for (let i = 0; i < 120; i++) {
      if (startupError) {
        throw startupError;
      }
      if (await databasePortOpen()) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  try {
    await database();
  } catch {
    throw new Error(
      'Không kết nối được MySQL. Kiểm tra DB_*, schema/seed và mysql.log.',
    );
  }
  console.log('MySQL đã sẵn sàng.');
  if (
    windowsLink
      ? await windowsLink.call('port', state.backendPort).then(() => true, () => false)
      : await portOpen('127.0.0.1', state.backendPort)
  ) {
    throw new Error(`Port Backend ${state.backendPort} đang được sử dụng.`);
  }
  if (await portOpen('127.0.0.1', state.frontendPort)) {
    throw new Error(
      `Port Frontend ${state.frontendPort} đang được sử dụng. Dừng server cũ trước.`,
    );
  }
  if (!(await portOpen(state.mqttHost, state.mqttPort))) {
    if (!['localhost', '127.0.0.1', '::1'].includes(state.mqttHost)) {
      throw new Error('MQTT broker bên ngoài không kết nối được.');
    }
    const passwordFile = path.resolve(
      root,
      config.MQTT_PASSWORD_FILE || 'Backend/mosquitto/passwd',
    );
    if (!fs.existsSync(passwordFile)) {
      throw new Error(
        'Thiếu file mật khẩu MQTT. Tạo bằng mosquitto_passwd trước khi chạy.',
      );
    }
    const brokerConfig = path.join(runtime, 'mosquitto.conf');
    fs.writeFileSync(
      brokerConfig,
      `listener ${state.mqttPort} 0.0.0.0\nallow_anonymous false\npassword_file ${passwordFile.replace(/\\/g, '/')}\npersistence false\n`,
    );
    launch('mosquitto', mosquittoExecutable(), ['-c', brokerConfig], root);
  } else {
    if (!(await mqttReady(backend, config))) {
      throw new Error(
        'Port MQTT đang mở nhưng broker không phản hồi hoặc tài khoản MQTT không hợp lệ.',
      );
    }
    console.log('Sử dụng MQTT broker đang chạy; npm stop sẽ giữ broker này.');
  }
  let args = [path.join(backend, 'src', 'server.js'), '--managed-log'];
  if (process.argv[2] === 'dev') {
    const watcher = path.join(
      backend,
      'node_modules',
      'nodemon',
      'bin',
      'nodemon.js',
    );
    if (!fs.existsSync(watcher)) {
      throw new Error('Thiếu nodemon. Chạy npm install.');
    }
    args = [watcher, '--watch', 'src', '--watch', '.env', 'src/server.js', '--managed-log'];
  }
  launch(
    'backend',
    windowsLink?.nodeExecutable || process.execPath,
    windowsLink
      ? args.map((argument) =>
          path.isAbsolute(argument) ? windowsLink.convert(argument) : argument,
        )
      : args,
    backend,
  );
  frontend = createFrontend(path.join(root, 'Frontend'));
  await listen(frontend, state.frontendPort, '0.0.0.0');
  frontend.on('error', fail);
  fs.writeFileSync(sessionFile, JSON.stringify({ id: state.id }));
  markerCreated = true;
  const readinessDeadline = Date.now() + 25000;
  while (Date.now() < readinessDeadline) {
    if (stopping) {
      return;
    }
    if (startupError) {
      throw startupError;
    }
    if ((await health()) && (await mqttReady(backend, config))) {
      state.ready = true;
      writeState(state);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    'Backend hoặc MQTT chưa sẵn sàng. Xem backend.log và mosquitto.log.',
  );
}

process.on('SIGINT', () => shutdown().catch(fail));
process.on('SIGTERM', () => shutdown().catch(fail));
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
start().catch(fail);
