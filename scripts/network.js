const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

function selectAddresses(interfaces) {
  const candidates = interfaces.filter(({ address, internal, name }) => {
    return (
      !internal &&
      !address.startsWith('169.254.') &&
      !/^(lo|docker|veth|virbr|br-|tun|tap|tailscale|wg|vEthernet)/i.test(name)
    );
  });
  const wireless = candidates.filter(({ wireless }) => wireless);
  return wireless.length ? wireless : candidates;
}

async function machineAddresses() {
  const windows = process.platform === 'win32';
  const wsl =
    Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) ||
    /microsoft/i.test(os.release());
  if (windows || wsl) {
    // In WSL, use the host's physical adapters rather than the virtual Linux IP.
    const script = `
      [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
      $addresses = @(
        [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
          Where-Object {
            $_.OperationalStatus -eq 'Up' -and
            $_.NetworkInterfaceType -in @('Wireless80211', 'Ethernet') -and
            $_.Description -notmatch 'Virtual|Hyper-V|WSL|VPN|TAP|TUN|Docker'
          } | ForEach-Object {
            $adapter = $_
            $adapter.GetIPProperties().UnicastAddresses |
              Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' } |
              ForEach-Object {
                [PSCustomObject]@{
                  name = $adapter.Name
                  address = $_.Address.ToString()
                  wireless = ($adapter.NetworkInterfaceType -eq 'Wireless80211')
                  internal = $false
                }
              }
          }
      )
      ConvertTo-Json -InputObject $addresses -Compress
    `;
    const { stdout } = await execute(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000 },
    );
    const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim() || '[]');
    return selectAddresses(Array.isArray(result) ? result : [result]);
  }

  const interfaces = Object.entries(os.networkInterfaces()).flatMap(
    ([name, entries]) => {
      return entries
        .filter(({ family }) => family === 'IPv4' || family === 4)
        .map(({ address, internal }) => ({
          name,
          address,
          internal,
          wireless: /^(wl|wifi)/i.test(name),
        }));
    },
  );
  return selectAddresses(interfaces);
}

async function printMqttIpStatus(firmwareHost) {
  try {
    const addresses = await machineAddresses();
    if (!addresses.length) {
      console.log(
        'IP máy hiện tại: Không tìm thấy địa chỉ IPv4 của mạng LAN/Wi-Fi.',
      );
      console.log('[CHƯA XÁC ĐỊNH] Chưa thể so sánh IP MQTT ESP32.');
      return;
    }
    const label = addresses.some(({ wireless }) => wireless)
      ? 'IP Wi-Fi máy'
      : 'IP LAN máy';
    console.log(
      `${label} : ${addresses.map(({ name, address }) => `${address} (${name})`).join(', ')}`,
    );
    if (!firmwareHost) {
      console.log(
        '[CHƯA XÁC ĐỊNH] Không đọc được IP MQTT trong firmware ESP32.',
      );
    } else if (addresses.some(({ address }) => address === firmwareHost)) {
      console.log('[KHỚP] IP MQTT ESP32 trùng IP máy trên mạng hiện tại.');
    } else {
      console.log(
        `[KHÔNG KHỚP] IP MQTT ESP32 ${firmwareHost} khác IP máy trên mạng hiện tại.`,
      );
    }
  } catch {
    console.log('IP máy hiện tại: Không đọc được địa chỉ mạng.');
    console.log('[CHƯA XÁC ĐỊNH] Chưa thể so sánh IP MQTT ESP32.');
  }
}

module.exports = { machineAddresses, selectAddresses, printMqttIpStatus };
