const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const { portOpen, sleep } = require('./runtime.js');

async function mqttResponding(port) {
  return new Promise((resolve) => {
    const socket = require('node:net').connect({host:'127.0.0.1',port});
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(1200);
    socket.once('connect', () => {
      const id = Buffer.from('iot-stop-probe');
      socket.write(Buffer.concat([Buffer.from([0x10,12+id.length,0,4,77,81,84,84,4,2,0,5,0,id.length]),id]));
    });
    let response = Buffer.alloc(0);
    socket.on('data', (data) => {
      response = Buffer.concat([response,data]);
      if (response.length >= 4) finish(response[0] === 0x20 && response[1] === 2);
    });
    socket.once('error', () => finish(false));
    socket.once('end', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

async function stopPort(port, service) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Cổng dừng dịch vụ không hợp lệ.');
  if (process.platform === 'win32') {
    const brokerResponding = service === 'MQTT' && await mqttResponding(port);
    const result = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
      $ErrorActionPreference='Stop'
      $portNumber=[int]$env:IOT_STOP_PORT
      $proxyOnly=$false
      $expected=if ($env:IOT_STOP_SERVICE -eq 'MQTT') { @('mosquitto.exe') } else { @('node.exe','nodejs.exe') }
      $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $portNumber -ErrorAction SilentlyContinue)
      foreach ($ownerId in @($listeners.OwningProcess | Sort-Object -Unique)) {
        $ownerProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$ownerId"
        if (-not $ownerProcess) { continue }
        if ($ownerProcess.Name -eq 'svchost.exe' -and $env:IOT_STOP_SERVICE -eq 'MQTT') {
          $proxy=Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\PortProxy\\v4tov4\\tcp' -ErrorAction SilentlyContinue
          $mapping=@($proxy.PSObject.Properties | Where-Object { $_.Name -match "/$portNumber$" -and $_.Value -match "/$portNumber$" })
          if ($mapping.Count -gt 0 -and $env:IOT_MQTT_RESPONDING -eq 'false') { $proxyOnly=$true; continue }
          throw "MQTT forwarding on port $portNumber still responds or cannot be identified; broker is not confirmed stopped."
        }
        if ($ownerProcess.Name -notin $expected) { throw "Cổng $portNumber thuộc tiến trình khác: $($ownerProcess.Name)" }
        $services=@(Get-CimInstance Win32_Service -Filter "ProcessId=$ownerId")
        if ($services.Count -gt 0) {
          foreach ($serviceEntry in $services) { Stop-Service -Name $serviceEntry.Name -ErrorAction Stop }
        } else {
          # Stop the watcher too, otherwise it can restart the backend.
          $parentProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$($ownerProcess.ParentProcessId)"
          if ($parentProcess -and $parentProcess.Name -in @('node.exe','nodejs.exe') -and $parentProcess.CommandLine -match 'nodemon') { $ownerId=$parentProcess.ProcessId }
          & taskkill.exe /PID $ownerId /T /F | Out-Null
          if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $ownerId -ErrorAction SilentlyContinue)) { throw "Không dừng được PID $ownerId" }
        }
      }
      @{proxyOnly=$proxyOnly} | ConvertTo-Json -Compress
    `], { windowsHide: true, timeout: 15000, env: { ...process.env, IOT_STOP_PORT: String(port), IOT_STOP_SERVICE: service, IOT_MQTT_RESPONDING: String(brokerResponding) } });
    return JSON.parse(result.stdout.trim());
  } else {
    const inodes = new Set();
    for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
      for (const line of fs.readFileSync(file, 'utf8').trim().split('\n').slice(1)) {
        const fields = line.trim().split(/\s+/);
        if (fields[3] === '0A' && parseInt(fields[1].split(':').pop(), 16) === port) inodes.add(fields[9]);
      }
    }
    const owners = [];
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const descriptors = fs.readdirSync(`/proc/${entry}/fd`);
        const owns = descriptors.some((fd) => {
          try { return inodes.has(fs.readlinkSync(`/proc/${entry}/fd/${fd}`).match(/^socket:\[(\d+)\]$/)?.[1]); }
          catch { return false; }
        });
        if (!owns) continue;
        const executable = path.basename(fs.readlinkSync(`/proc/${entry}/exe`));
        const expected = service === 'MQTT' ? ['mosquitto'] : ['node', 'nodejs'];
        if (!expected.includes(executable)) throw new Error(`Cổng ${port} thuộc tiến trình khác: ${executable}`);
        owners.push(Number(entry));
      } catch (error) {
        if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error;
      }
    }
    const signal = (pid, name) => {
      try { process.kill(pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    for (const pid of owners) signal(pid, 'SIGTERM');
    for (let attempt = 0; attempt < 30 && await portOpen('127.0.0.1', port); attempt++) await sleep(100);
    if (await portOpen('127.0.0.1', port)) for (const pid of owners) signal(pid, 'SIGKILL');
  }
}
module.exports = { stopPort, mqttResponding };
