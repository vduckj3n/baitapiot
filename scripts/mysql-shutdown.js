// WSL interoperability: credentials arrive on stdin, never in command arguments.
const fs = require('node:fs');
const path = require('node:path');
let operation = 'input';

async function main() {
  const options = JSON.parse(fs.readFileSync(0, 'utf8'));
  operation = options.action;
  if (options.action === 'port') {
    await new Promise((resolve, reject) => {
      const socket = require('node:net').connect({
        host: '127.0.0.1',
        port: options.port,
      });
      socket.setTimeout(1000);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', reject);
      socket.once('timeout', () => {
        socket.destroy();
        reject(new Error());
      });
    });
    return;
  }
  if (options.action === 'health') {
    await new Promise((resolve, reject) => {
      const req = require('node:http').get(
        `http://127.0.0.1:${options.port}/api/health`,
        { timeout: 1000 },
        (res) => {
          res.resume();
          res.statusCode === 200 ? resolve() : reject(new Error());
        },
      );
      req.once('error', reject);
      req.once('timeout', () => req.destroy(new Error()));
    });
    return;
  }
  const mysql = require(
    path.join(options.backend, 'node_modules', 'mysql2', 'promise'),
  );
  const connection = await mysql.createConnection({
    host: '127.0.0.1',
    port: options.port,
    user: options.user,
    password: options.password,
    database: options.database,
    connectTimeout: 5000,
  });
  try {
    await connection.query(
      options.action === 'database' ? 'SELECT 1' : 'SHUTDOWN',
    );
  } catch (error) {
    if (
      options.action !== 'shutdown' ||
      !['PROTOCOL_CONNECTION_LOST', 'ECONNRESET'].includes(error.code)
    ) {
      throw error;
    }
  } finally {
    await connection.end().catch(() => {});
  }
}

main().catch((error) => {
  // Return only an error code; credentials and connection options stay private.
  console.error(
    JSON.stringify({ code: error.code || 'UNKNOWN', action: operation }),
  );
  process.exitCode = 1;
});
