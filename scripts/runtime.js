const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'Backend', 'runtime');
const stateFile = path.join(runtime, 'system.json');

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function writeState(state) {
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(state), { mode: 0o600 });
  // Windows scanners/readers can briefly lock the destination during polling.
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(`${stateFile}.tmp`, stateFile);
      return;
    } catch (error) {
      if (
        process.platform !== 'win32' ||
        !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) ||
        attempt >= 39
      ) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

function request(state, route) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: state.controlPort,
        path: route,
        headers: { authorization: `Bearer ${state.token}` },
        timeout: 5000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
  });
}

function portOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
module.exports = {
  root,
  runtime,
  stateFile,
  readState,
  writeState,
  request,
  portOpen,
  sleep,
};
