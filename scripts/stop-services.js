const fs = require('node:fs');
const path = require('node:path');
const { portOpen, sleep } = require('./runtime.js');
const { stopMysql, windowsMysql } = require('./mysql.js');
const { stopPort } = require('./stop-port.js');

async function stopConfiguredServices(root) {
  const backend = path.join(root, 'Backend');
  const dotenv = require(path.join(backend, 'node_modules', 'dotenv'));
  const config = { ...dotenv.parse(fs.readFileSync(path.join(backend, '.env'))), ...process.env };
  const windowsLink = windowsMysql(config, backend);
  const mqtt = new URL(config.MQTT_HOST || 'mqtt://localhost');
  const local = (host) => ['localhost', '127.0.0.1', '::1'].includes(host);
  const services = [
    { name: 'Frontend', host: '127.0.0.1', port: Number(config.FRONTEND_PORT || 5500) },
    { name: 'Backend', host: '127.0.0.1', port: Number(config.PORT || 3000) },
    { name: 'MQTT', host: mqtt.hostname, port: Number(config.MQTT_PORT || mqtt.port || 1883) },
    { name: 'MySQL', host: config.DB_HOST || 'localhost', port: Number(config.DB_PORT || 3307) },
  ];
  const up = async (service, ignoreWindowsProxy = false) => {
    if (await portOpen(service.host, service.port)) return true;
    if (windowsLink && local(service.host) && !ignoreWindowsProxy) {
      try { await windowsLink.call('port', service.port); return true; }
      catch (error) { if (error.code === 'ECONNREFUSED') return false; throw error; }
    }
    return false;
  };
  const results = await Promise.allSettled(services.map(async (service) => {
    if (!await up(service)) return;
    if (!local(service.host)) throw new Error(`${service.name} ở máy khác; không thể dừng từ máy này.`);
    let forwardingOnly = false;
    if (service.name === 'MySQL') {
      // Use MySQL SHUTDOWN so committed data is flushed safely; never kill mysqld.
      await stopMysql({ type: 'external', windowsFromWsl: Boolean(windowsLink) }, config, backend);
    } else {
      await stopPort(service.port, service.name);
      if (windowsLink) {
        const result = await windowsLink.call('stopPort', service.port, service.name);
        forwardingOnly = Boolean(result?.proxyOnly);
      }
    }
    for (let i = 0; i < 80; i++) {
      if (!await up(service, forwardingOnly)) return;
      await sleep(100);
    }
    throw new Error(`${service.name} vẫn đang lắng nghe ở cổng ${service.port}.`);
  }));
  const errors = results.flatMap((result, index) => result.status === 'rejected' ? [`${services[index].name}: ${result.reason.message}`] : []);
  if (errors.length) throw new Error(errors.join('; '));
}
module.exports = { stopConfiguredServices };
