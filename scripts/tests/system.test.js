const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { createFrontend } = require('../frontend.js');
const { acquireStartLock } = require('../start-lock.js');

test('Startup lock recovers abandoned locks and protects a live launcher', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-lock-'));
  const lock = path.join(root, 'start.lock');
  let release;
  try {
    // Legacy empty directories left by an interrupted launcher.
    fs.mkdirSync(lock);
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(lock, old, old);
    release = acquireStartLock(lock);
    assert.throws(() => acquireStartLock(lock), /đang chạy/);
    release();
    assert.equal(fs.existsSync(lock), false);
    // A dead launcher in the same OS can be recovered immediately.
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({
      id: 'dead', pid: 2147483647, platform: process.platform, hostname: os.hostname(),
    }));
    release = acquireStartLock(lock);
    release();
    // Cross-OS PID namespaces use heartbeat expiry instead of local PID lookup.
    fs.mkdirSync(lock);
    const ownerFile = path.join(lock, 'owner.json');
    fs.writeFileSync(ownerFile, JSON.stringify({
      id: 'other-os', pid: process.pid, platform: 'other', hostname: os.hostname(),
    }));
    assert.throws(() => acquireStartLock(lock), /đang chạy/);
    fs.utimesSync(ownerFile, old, old);
    release = acquireStartLock(lock);
    release();
  } finally {
    release?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const close = (server) => new Promise((resolve) => server.close(resolve));
const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

function command(root, action) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(root, 'scripts', 'system.js'), action],
      { cwd: root },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output }));
  });
}

function write(root, name, text) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test('Frontend serves pages, HEAD and session while rejecting private paths and traversal', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-http-'));
  write(root, 'index.html', '<h1>IoT</h1>');
  write(root, 'runtime-session.json', '{"id":"session"}');
  write(root, '.env', 'PRIVATE');
  const server = createFrontend(root);
  await listen(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await (await fetch(base)).text(), '<h1>IoT</h1>');
    assert.equal(
      (await fetch(base, { method: 'HEAD' })).headers.get('content-length'),
      '12',
    );
    assert.equal(
      await (await fetch(`${base}/runtime-session.json`)).text(),
      '{"id":"session"}',
    );
    assert.equal((await fetch(`${base}/.env`)).status, 403);
    assert.equal((await fetch(`${base}/%2e%2e%5csecret`)).status, 403);
    assert.equal((await fetch(`${base}/missing.js`)).status, 404);
    assert.equal((await fetch(`${base}/%ZZ`)).status, 400);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  } finally {
    server.closeAllConnections();
    await close(server);
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 30,
      retryDelay: 100,
    });
  }
});

test(
  'Native supervisor starts, reuses session, stops watcher children, rotates session and rolls back failed startup',
  { timeout: 60000 },
  async () => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'iot lifecycle spaces '),
    );
    fs.cpSync(path.resolve(__dirname, '..'), path.join(root, 'scripts'), {
      recursive: true,
    });
    // Only hardware/database boundaries are simulated; the supervisor and HTTP server are real.
    write(
      root,
      'Backend/node_modules/dotenv/index.js',
      'exports.parse = data => Object.fromEntries(data.toString().trim().split(/\\n/).map(line => { const i = line.indexOf("="); return [line.slice(0,i), line.slice(i+1)]; }));',
    );
    write(
      root,
      'Backend/node_modules/mysql2/promise.js',
      'exports.createConnection = async () => ({query: async () => {}, end: async () => {}});',
    );
    write(
      root,
      'Backend/src/server.js',
      `const env=require('../node_modules/dotenv').parse(require('node:fs').readFileSync('.env')); require('node:http').createServer((req,res)=>res.end('{}')).listen(Number(env.PORT), '127.0.0.1');`,
    );
    write(
      root,
      'Backend/node_modules/nodemon/bin/nodemon.js',
      `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['src/server.js'],{stdio:'inherit'}); child.on('exit',()=>process.exit()); process.on('SIGTERM',()=>child.kill());`,
    );
    write(root, 'Frontend/index.html', '<h1>Fixture</h1>');
    write(
      root,
      'Backend/node_modules/mqtt/index.js',
      `module.exports = require(${JSON.stringify(path.resolve(__dirname, '../../Backend/node_modules/mqtt'))});`,
    );
    const mqtt = net.createServer((socket) => {
      socket.on('data', (data) => {
        if ((data[0] & 0xf0) === 0x10)
          socket.write(Buffer.from([0x20, 0x02, 0x00, 0x00]));
      });
    });
    const db = net.createServer((socket) => socket.end());
    const freeBackend = net.createServer();
    const freeFrontend = net.createServer();
    await listen(mqtt);
    await listen(db);
    await listen(freeBackend);
    await listen(freeFrontend);
    const backendPort = freeBackend.address().port;
    const frontendPort = freeFrontend.address().port;
    await close(freeBackend);
    await close(freeFrontend);
    write(
      root,
      'Backend/.env',
      `JWT_SECRET=fixture-secret-at-least-16\nPORT=${backendPort}\nFRONTEND_PORT=${frontendPort}\nDB_HOST=127.0.0.1\nDB_PORT=${db.address().port}\nMQTT_HOST=mqtt://127.0.0.1\nMQTT_PORT=${mqtt.address().port}\n`,
    );
    const marker = path.join(root, 'Frontend', 'runtime-session.json');
    const readMarker = () => JSON.parse(fs.readFileSync(marker)).id;
    try {
      let result = await command(root, 'dev');
      assert.equal(result.code, 0, result.output);
      const first = readMarker();
      result = await command(root, 'dev');
      assert.equal(result.code, 0, result.output);
      assert.equal(readMarker(), first);
      result = await command(root, 'status');
      assert.equal(result.code, 0, result.output);
      result = await command(root, 'stop');
      assert.equal(result.code, 0, result.output);
      assert.equal(fs.existsSync(marker), false);
      await assert.rejects(fetch(`http://127.0.0.1:${backendPort}/api/health`));
      await assert.rejects(fetch(`http://127.0.0.1:${frontendPort}/`));
      assert(mqtt.listening);
      assert(db.listening);
      result = await command(root, 'dev');
      assert.equal(result.code, 0, result.output);
      assert.notEqual(readMarker(), first);
      result = await command(root, 'stop');
      assert.equal(result.code, 0, result.output);
      write(root, 'Backend/src/server.js', 'process.exit(2);');
      result = await command(root, 'dev');
      assert.equal(result.code, 1, result.output);
      // Launcher may see the failure before the worker has finished removing resources.
      for (let i = 0; i < 50 && fs.existsSync(marker); i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(fs.existsSync(marker), false);
      await assert.rejects(fetch(`http://127.0.0.1:${frontendPort}/`));
    } finally {
      await command(root, 'stop');
      await close(mqtt);
      await close(db);
      fs.rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 30,
        retryDelay: 100,
      });
    }
  },
);

test('Managed MySQL uses the existing data directory and requests graceful shutdown', async () => {
  const { EventEmitter } = require('node:events');
  const { startMysql, stopMysql } = require('../mysql.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iot mysql spaces '));
  fs.mkdirSync(path.join(root, 'data', 'mysql'), { recursive: true });
  const child = new EventEmitter();
  child.pid = 123;
  child.exitCode = null;
  const config = {
    DB_HOST: '127.0.0.1',
    DB_PORT: '3307',
    MYSQL_BIN: 'fixture-mysqld',
    MYSQL_DATA_DIR: 'data',
    MYSQL_ADMIN_USER: 'fixture-admin',
    MYSQL_ADMIN_PASSWORD: 'fixture-password',
  };
  let launched;
  const managed = await startMysql(config, root, (name, executable, args) => {
    launched = { name, executable, args };
    return child;
  });
  assert.equal(launched.name, 'mysql');
  assert.equal(launched.executable, 'fixture-mysqld');
  assert(launched.args.includes(`--datadir=${path.join(root, 'data')}`));
  assert(launched.args.includes('--port=3307'));
  assert.equal(fs.readdirSync(path.join(root, 'data')).length, 1); // No initialization or data replacement.
  const backend = path.join(root, 'Backend');
  const fixtureModule = path.join(
    backend,
    'node_modules',
    'mysql2',
    'promise.js',
  );
  write(root, 'Backend/node_modules/mysql2/promise.js', 'module.exports = {};');
  const mysql = require(fixtureModule);
  let shutdownRequested = false;
  mysql.createConnection = async (options) => {
    assert.equal(options.user, 'fixture-admin');
    assert.equal(options.password, 'fixture-password');
    return {
      query: async (sql) => {
        assert.equal(sql, 'SHUTDOWN');
        shutdownRequested = true;
        setTimeout(() => {
          child.exitCode = 0;
          child.emit('exit', 0);
        }, 20);
      },
      end: async () => {},
    };
  };
  try {
    await stopMysql(managed, config, backend);
    assert(shutdownRequested);
    child.exitCode = null;
    mysql.createConnection = async () => {
      throw Object.assign(new Error('fixture'), { code: 'ECONNREFUSED' });
    };
    await assert.doesNotReject(stopMysql(managed, config, backend));
    mysql.createConnection = async () => {
      throw Object.assign(new Error('fixture'), {
        code: 'ER_ACCESS_DENIED_ERROR',
      });
    };
    await assert.rejects(
      stopMysql(managed, config, backend),
      /MYSQL_ADMIN_PASSWORD/,
    );

    await assert.rejects(
      startMysql({ ...config, DB_HOST: 'remote.example' }, root, () => {}),
      /máy khác/,
    );
    await assert.rejects(
      startMysql({ ...config, MYSQL_DATA_DIR: 'missing' }, root, () => {}),
      /đã khởi tạo/,
    );
  } finally {
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 30,
      retryDelay: 100,
    });
  }
});

test('MQTT health rejects a TCP listener without MQTT and invalid credentials', async () => {
  const { mqttReady } = require('../mqtt.js');
  const backend = path.resolve(__dirname, '../../Backend');
  for (const rejectLogin of [false, true]) {
    const server = net.createServer((socket) => {
      socket.resume();
      if (rejectLogin) {
        socket.on('data', () =>
          socket.write(Buffer.from([0x20, 0x02, 0x00, 0x05])),
        );
      }
    });
    await listen(server);
    try {
      assert.equal(
        await mqttReady(backend, {
          MQTT_HOST: 'mqtt://127.0.0.1',
          MQTT_PORT: server.address().port,
        }),
        false,
      );
    } finally {
      await close(server);
    }
  }
});
