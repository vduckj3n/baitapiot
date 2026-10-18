const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);

function localPath(value) {
  if (
    process.platform !== 'win32' &&
    (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\'))
  ) {
    try {
      return execFileSync('wslpath', ['-u', value], {
        encoding: 'utf8',
      }).trim();
    } catch {
      throw new Error('Đường dẫn Windows chỉ dùng được trên Windows hoặc WSL.');
    }
  }
  return value;
}

function findMysqld(config) {
  if (config.MYSQL_BIN) {
    return localPath(config.MYSQL_BIN);
  }
  if (process.platform === 'win32') {
    const base = path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'MySQL',
    );
    if (fs.existsSync(base)) {
      const directories = fs
        .readdirSync(base)
        .filter((name) => name.startsWith('MySQL Server'))
        .sort()
        .reverse();
      for (const directory of directories) {
        const file = path.join(base, directory, 'bin', 'mysqld.exe');
        if (fs.existsSync(file)) {
          return file;
        }
      }
    }
    return 'mysqld.exe';
  }
  return 'mysqld';
}

async function serviceAction(action, configuredName) {
  if (process.platform === 'win32') {
    const { stdout } = await execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$ErrorActionPreference='Stop'; $name=$env:IOT_MYSQL_SERVICE_NAME; if (-not $name) { $name=(Get-Service | Where-Object { $_.Name -match '^MySQL[0-9]*$' } | Select-Object -First 1).Name }; if (-not $name) { throw 'Không tìm thấy dịch vụ MySQL' }; ${action === 'start' ? 'Start' : 'Stop'}-Service -Name $name; Write-Output $name`,
      ],
      {
        windowsHide: true,
        timeout: 30000,
        env: { ...process.env, IOT_MYSQL_SERVICE_NAME: configuredName || '' },
      },
    );
    return stdout.trim();
  }
  const name = configuredName || 'mysql';
  if (!/^[A-Za-z0-9_.@-]+$/.test(name)) {
    throw new Error('MYSQL_SERVICE không hợp lệ.');
  }
  try {
    await execFile('systemctl', [action, name], { timeout: 30000 });
  } catch {
    await execFile('sudo', ['-n', 'systemctl', action, name], {
      timeout: 30000,
    });
  }
  return name;
}

async function startMysql(config, root, launch) {
  if (config.MYSQL_AUTO_START === 'false') {
    throw new Error('MySQL chưa chạy và MYSQL_AUTO_START=false.');
  }
  if (
    !['localhost', '127.0.0.1', '::1'].includes(config.DB_HOST || 'localhost')
  ) {
    throw new Error(
      'MySQL ở máy khác chưa chạy; không thể tự khởi động dịch vụ từ project này.',
    );
  }
  if (config.MYSQL_DATA_DIR) {
    const directory = path.resolve(root, localPath(config.MYSQL_DATA_DIR));
    if (!fs.existsSync(path.join(directory, 'mysql'))) {
      throw new Error('MYSQL_DATA_DIR phải trỏ tới thư mục MySQL đã khởi tạo.');
    }
    const executable = findMysqld(config);
    let daemonDirectory = directory;
    let windowsFromWsl = false;
    if (
      process.platform !== 'win32' &&
      executable.toLowerCase().endsWith('.exe')
    ) {
      daemonDirectory = execFileSync('wslpath', ['-w', directory], {
        encoding: 'utf8',
      }).trim();
      windowsFromWsl = true;
    }
    const child = launch(
      'mysql',
      executable,
      [
        '--no-defaults',
        `--datadir=${daemonDirectory}`,
        `--port=${Number(config.DB_PORT || 3307)}`,
        '--bind-address=127.0.0.1',
        '--console',
      ],
      root,
    );
    return { type: 'process', child, windowsFromWsl };
  }
  try {
    return {
      type: 'service',
      name: await serviceAction('start', config.MYSQL_SERVICE),
    };
  } catch {
    throw new Error(
      'Không tự bật được MySQL. Cấu hình MYSQL_BIN và MYSQL_DATA_DIR, hoặc cấp quyền khởi động MYSQL_SERVICE một lần theo README.',
    );
  }
}

async function stopMysql(managed, config, backend) {
  if (managed.type === 'service') {
    return serviceAction('stop', managed.name);
  }
  if (managed.child.exitCode !== null) {
    return;
  }
  if (managed.windowsFromWsl) {
    try {
      await windowsMysql(config, backend).call('shutdown');
    } catch (error) {
      if (error.code === 'ECONNREFUSED') return;
      throw error;
    }
  } else {
    const mysql = require(
      path.join(backend, 'node_modules', 'mysql2', 'promise'),
    );
    let connection;
    try {
      connection = await mysql.createConnection({
        host: config.DB_HOST || 'localhost',
        port: Number(config.DB_PORT || 3307),
        user: config.MYSQL_ADMIN_USER || 'root',
        password: config.MYSQL_ADMIN_PASSWORD || '',
        connectTimeout: 5000,
      });
    } catch (error) {
      if (error.code === 'ECONNREFUSED') return;
      if (error.code === 'ER_ACCESS_DENIED_ERROR') {
        throw new Error(
          'Tài khoản quản trị MySQL không đúng; kiểm tra MYSQL_ADMIN_USER và MYSQL_ADMIN_PASSWORD.',
        );
      }
      throw error;
    }
    try {
      await connection.query('SHUTDOWN');
    } catch (error) {
      if (!['PROTOCOL_CONNECTION_LOST', 'ECONNRESET'].includes(error.code)) {
        if (error.code === 'ER_SPECIFIC_ACCESS_DENIED_ERROR') {
          throw new Error('Tài khoản quản trị MySQL chưa có quyền SHUTDOWN.');
        }
        throw error;
      }
    } finally {
      await connection.end().catch(() => {});
    }
  }
  if (managed.child.exitCode !== null) {
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('MySQL chưa dừng sau 20 giây.')),
      20000,
    );
    managed.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function windowsMysql(config, backend) {
  if (
    process.platform === 'win32' ||
    !config.MYSQL_BIN ||
    !config.MYSQL_BIN.toLowerCase().endsWith('.exe')
  ) {
    return null;
  }
  const nodeExecutable = localPath(
    config.MYSQL_NODE_BIN || 'C:/Program Files/nodejs/node.exe',
  );
  const convert = (value) =>
    execFileSync('wslpath', ['-w', value], { encoding: 'utf8' }).trim();
  const script = convert(path.join(__dirname, 'mysql-shutdown.js'));
  const backendWindows = convert(backend);
  return {
    nodeExecutable,
    convert,
    async call(action, port) {
      try {
        const child = require('node:child_process').execFile(nodeExecutable, [script], {
          timeout: 10000,
          windowsHide: true,
        });
        const completed = new Promise((resolve, reject) => {
          child.once('error', reject);
          let stderr = '';
          child.stderr.on('data', chunk => { stderr += chunk; });
          child.once('close', (code) => {
            if (code === 0) resolve();
            else reject(Object.assign(new Error('Windows MySQL operation failed'), { stderr }));
          });
        });
        child.stdin.on('error', () => {});
        child.stdin.end(JSON.stringify({
            action,
            backend: backendWindows,
            port: port || Number(config.DB_PORT || 3307),
            user:
              action === 'database'
                ? config.DB_USER || 'iot_user'
                : config.MYSQL_ADMIN_USER || 'root',
            password:
              action === 'database'
                ? config.DB_PASSWORD || ''
                : config.MYSQL_ADMIN_PASSWORD || '',
            database:
              action === 'database'
                ? config.DB_NAME || 'iot_system'
                : undefined,
          }));
        await completed;
      } catch (error) {
        let code = error.code || 'UNKNOWN';
        try {
          code = JSON.parse(error.stderr.toString().trim()).code || code;
        } catch {}
        const messages = {
          ECONNREFUSED:
            'MySQL đã dừng hoặc không lắng nghe ở địa chỉ đã cấu hình.',
          ER_ACCESS_DENIED_ERROR:
            'Tài khoản quản trị MySQL không đúng; kiểm tra MYSQL_ADMIN_USER và MYSQL_ADMIN_PASSWORD.',
          ER_SPECIFIC_ACCESS_DENIED_ERROR:
            'Tài khoản quản trị MySQL chưa có quyền SHUTDOWN.',
          ETIMEDOUT: 'Kết nối MySQL quá thời gian chờ.',
          MODULE_NOT_FOUND:
            'Thiếu thư viện MySQL hoặc script kết nối; chạy npm install.',
          ENOENT: 'Không tìm thấy Node.js Windows hoặc script kết nối MySQL.',
        };
        const failure = new Error(
          messages[code] || `Không thực hiện được thao tác MySQL (${code}).`,
        );
        failure.code = code;
        throw failure;
      }
    },
  };
}

module.exports = { startMysql, stopMysql, localPath, findMysqld, windowsMysql };
