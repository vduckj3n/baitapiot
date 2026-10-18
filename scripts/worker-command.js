const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function workerCommand(root, mode, id) {
  const native = {
    executable: process.execPath,
    args: [path.join(root, 'scripts', 'worker.js'), mode, id],
  };
  if (process.platform !== 'win32') return native;
  const dotenv = require(path.join(root, 'Backend', 'node_modules', 'dotenv'));
  const config = {
    ...dotenv.parse(fs.readFileSync(path.join(root, 'Backend', '.env'))),
    ...process.env,
  };
  const installed = path.join(
    process.env.ProgramFiles || 'C:\\Program Files',
    'mosquitto',
    'mosquitto.exe',
  );
  if (
    config.MOSQUITTO_BIN ||
    fs.existsSync(installed) ||
    spawnSync('where.exe', ['mosquitto'], {
      windowsHide: true,
      stdio: 'ignore',
    }).status === 0
  )
    return native;
  const distribution = config.MYSQL_DATA_DIR?.match(
    /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\/i,
  )?.[1];
  if (!distribution) return native;
  // Reuse an explicitly configured WSL installation when the Windows broker is absent.
  console.log('Sử dụng Mosquitto trong WSL theo cấu hình hiện có.');
  return {
    executable: 'wsl.exe',
    args: [
      '--distribution',
      distribution,
      '--exec',
      'bash',
      '-c',
      'cd -- "$(wslpath -u "$1")" && exec setsid -f sh -c \'exec node ./scripts/worker.js "$1" "$2" </dev/null >>Backend/runtime/logs/system.log 2>&1\' iot-worker "$2" "$3"',
      'iot-system',
      root,
      mode,
      id,
    ],
  };
}
module.exports = { workerCommand };
