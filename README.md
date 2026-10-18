# ESP32 IoT

Giám sát nhiệt độ, độ ẩm, ánh sáng và điều khiển 3 LED bằng ESP32, Node.js, MySQL và MQTT.

## 1. Cài công cụ

### Windows — PowerShell

```powershell
winget install --exact --id OpenJS.NodeJS.LTS
winget install --exact --id Git.Git
winget install --exact --id EclipseFoundation.Mosquitto
```

Cài thêm [MySQL Server 8.0](https://dev.mysql.com/downloads/mysql/8.0.html) và [Arduino IDE](https://www.arduino.cc/en/software/).

```powershell
node --version
npm --version
git --version
Get-Service *mysql*, *mosquitto*
```

### Ubuntu 24.04 / Ubuntu WSL

```bash
sudo apt update
sudo apt install -y git curl build-essential python3 mysql-server mysql-client mosquitto mosquitto-clients
sudo systemctl start mysql
```

Cài [Node.js LTS](https://nodejs.org/en/download) phiên bản >= 20. Debian/Kali dùng [MySQL APT Repository](https://dev.mysql.com/doc/mysql-apt-repo-quick-guide/en/) thay cho lệnh cài MySQL của Ubuntu.

## 2. Cài project

```bash
git clone <URL_REPOSITORY>
cd <THU_MUC_PROJECT>
npm install
```

Windows PowerShell:

```powershell
Copy-Item Backend/.env.example Backend/.env
```

Linux/WSL:

```bash
cp Backend/.env.example Backend/.env
```

Sửa `Backend/.env`:

```dotenv
PORT=3000
FRONTEND_PORT=5500
FRONTEND_ORIGIN=http://localhost:5500

DB_HOST=127.0.0.1
DB_PORT=3307
DB_USER=iot_user
DB_PASSWORD=your_database_password
DB_NAME=iot_system
DB_TIMEZONE=+07:00

JWT_SECRET=replace_with_generated_secret
JWT_EXPIRES_IN=1d

MQTT_HOST=mqtt://127.0.0.1
MQTT_PORT=1883
MQTT_USERNAME=iot_mqtt
MQTT_PASSWORD=your_mqtt_password
MQTT_CLIENT_ID=iot_backend

MYSQL_AUTO_START=false
DEVICE_RESPONSE_TIMEOUT=30000
DEVICE_OFFLINE_TIMEOUT=15000

PROFILE_GITHUB_URL=https://github.com/vduckj3n/baitapiot
PROFILE_FIGMA_URL=https://www.figma.com/design/your-design
PROFILE_API_DOCS_URL=https://documenter.getpostman.com/view/50291878/2sBYHSxLWC
```

Đặt `DB_PORT` đúng cổng MySQL đã cài (`3306` hoặc `3307`).

Tạo JWT secret rồi dán vào `JWT_SECRET`:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## 3. Bật MySQL và tạo database

Windows PowerShell Administrator (thay `MySQL80` nếu tên dịch vụ khác):

```powershell
Start-Service MySQL80
& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -h 127.0.0.1 -P 3307 -u root -p
```

Linux/WSL:

```bash
sudo systemctl start mysql
sudo mysql
```

Chạy trong MySQL shell, tại thư mục project:

```sql
SOURCE Backend/database/schema.sql;
SOURCE Backend/database/seed.sql;

CREATE USER IF NOT EXISTS 'iot_user'@'localhost'
IDENTIFIED BY 'your_database_password';
GRANT SELECT, INSERT, UPDATE, DELETE ON iot_system.* TO 'iot_user'@'localhost';
EXIT;
```

## 4. Tạo tài khoản MQTT

```bash
node -e "require('node:fs').mkdirSync('Backend/mosquitto', { recursive: true })"
```

Windows PowerShell:

```powershell
& "C:\Program Files\mosquitto\mosquitto_passwd.exe" -c Backend/mosquitto/passwd iot_mqtt
```

Thêm vào `.env` nếu Mosquitto chưa có trong PATH:

```dotenv
MOSQUITTO_BIN="C:/Program Files/mosquitto/mosquitto.exe"
```

Linux/WSL:

```bash
mosquitto_passwd -c Backend/mosquitto/passwd iot_mqtt
```

Nhập mật khẩu trùng `MQTT_PASSWORD`. Bỏ `-c` khi cập nhật file đã có.

Nếu Mosquitto đã chạy riêng trên cổng 1883, dừng dịch vụ trước:

```powershell
# Windows PowerShell Administrator
Stop-Service mosquitto
```

```bash
# Linux/WSL
sudo systemctl stop mosquitto
```

## 5. Nạp ESP32

Trong Arduino IDE:

1. Thêm Board Manager URL: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`.
2. Cài board **esp32 by Espressif Systems**.
3. Cài thư viện **PubSubClient**, **DHT sensor library**, **Adafruit Unified Sensor**.
4. Mở `ESP32/esp32_iot/esp32_iot.ino`, sửa Wi-Fi, IP và tài khoản MQTT; chọn board/cổng USB rồi Upload.

| Thành phần | GPIO |
| --- | --- |
| DHT11 | 4 |
| LDR | 34 |
| LED 1 / 2 / 3 | 21 / 22 / 23 |

Lấy IP máy chạy broker:

```powershell
ipconfig
```

```bash
ip -4 addr
```

ESP32 và broker cần cùng mạng; `mqtt_server` dùng IP LAN của broker. Nếu Windows Firewall chặn, chạy PowerShell Administrator:

```powershell
New-NetFirewallRule -DisplayName "ESP32 MQTT 1883" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 1883 -Profile Private -RemoteAddress LocalSubnet
```

## 6. Chạy và kiểm tra

Chạy tại thư mục gốc:

```bash
npm run dev
npm run status
```

Mở **http://localhost:5500**, đăng ký tài khoản rồi đăng nhập.

```bash
npm run check
npm test
npm run restart
npm stop
```

Log: `Backend/runtime/logs/`.
