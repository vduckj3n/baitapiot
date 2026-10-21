#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <esp_random.h>

// 1. PIN
#define DHT_PIN 4
#define DHT_TYPE DHT11

#define LDR_PIN 34
const int LED_PINS[] = {21, 22, 23};
const int LED_COUNT = sizeof(LED_PINS) / sizeof(LED_PINS[0]);

// 2. WIFI
// Wi-Fi cũ (giữ lại để chuyển mạng khi cần):
// const char *ssid = "Đức Kiên";
// const char *wifi_password = "123456789a";
const char *ssid = "PTIT_WIFI_KTX";
const char *wifi_password = "PTIT@33daimo";

// 3. MQTT

// IP Wi-Fi của laptop Windows
const char *mqtt_server = "10.32.222.134";
const int mqtt_port = 1883;

const char *mqtt_username = "vanduckien";
const char *mqtt_password = "B23DCAT162";

// MQTT Topics
const char *topic_sensor = "data_sensor";
const char *topic_control = "device_control";
const char *topic_status = "device_status";

// 4. OBJECT
WiFiClient espClient;
PubSubClient client(espClient);

DHT dht(DHT_PIN, DHT_TYPE);

// Gửi dữ liệu cảm biến mỗi 5 giây
unsigned long lastSensorSend = 0;
const unsigned long SENSOR_INTERVAL = 5000;

bool ledsSynchronized = false;
String syncId;
unsigned long lastSyncRequest = 0;
const unsigned long SYNC_INTERVAL = 2000;

// 5. KẾT NỐI WIFI
void connectWiFi() {
  Serial.println();
  Serial.println("===== WIFI =====");
  WiFi.mode(WIFI_STA);
  Serial.print("Connecting to: ");
  Serial.println(ssid);
  WiFi.begin(ssid, wifi_password);
  int count = 0;
  // Thử kết nối tối đa 30 giây
  while (WiFi.status() != WL_CONNECTED && count < 30) {
    delay(1000);
    Serial.print("WiFi status = ");
    Serial.println(WiFi.status());
    count++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("WiFi connected!");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("Gateway: ");
    Serial.println(WiFi.gatewayIP());
    Serial.print("RSSI: ");
    Serial.println(WiFi.RSSI());
  } else {
    Serial.println();
    Serial.println("WiFi connection FAILED!");
    Serial.print("Final status = ");
    Serial.println(WiFi.status());
  }
}

// 6. ĐIỀU KHIỂN ĐÈN
const char *ledState(int ledId) {
  return digitalRead(LED_PINS[ledId - 1]) == HIGH ? "ON" : "OFF";
}

void publishDeviceStatus() {
  String payload;
  payload.reserve(192);
  payload = "{\"type\":\"status\",\"device_id\":1,\"connection_status\":\"ONLINE\",\"sync_id\":";
  payload += syncId;
  payload += ",\"synchronized\":";
  payload += ledsSynchronized ? "true" : "false";
  // Chỉ báo trạng thái đèn sau khi đã khôi phục từ Backend.
  if (ledsSynchronized) {
    payload += ",\"led_states\":[";
    for (int id = 1; id <= LED_COUNT; id++) {
      if (id > 1) payload += ",";
      payload += "\"";
      payload += ledState(id);
      payload += "\"";
    }
    payload += "]";
  }
  payload += "}";
  client.publish(topic_status, payload.c_str(), true);
}

void requestLedSync() {
  lastSyncRequest = millis();
  String payload = "{\"type\":\"sync_request\",\"device_id\":1,\"sync_id\":";
  payload += syncId;
  payload += "}";
  client.publish(topic_status, payload.c_str(), false);
}

void sendLedResponse(int ledId, const String &actionId) {
  String payload;
  payload.reserve(128);
  payload = "{\"type\":\"response\",\"action_id\":";
  payload += actionId;
  payload += ",\"device_id\":";
  payload += ledId;
  payload += ",\"led_state\":\"";
  payload += ledState(ledId);
  payload += "\",\"status\":\"SUCCESS\"}";
  if (!client.publish(topic_status, payload.c_str(), false)) {
    Serial.println("Publish LED response FAILED!");
  }
}

// Đọc số nguyên trong JSON do Backend gửi; trả chuỗi để giữ nguyên action_id.
String jsonNumber(const String &message, const char *name) {
  String key = "\"";
  key += name;
  key += "\":";
  int start = message.indexOf(key);
  if (start < 0) return "";
  start += key.length();
  int end = start;
  while (end < message.length() && isDigit(message[end])) end++;
  if (end == start || end >= message.length() ||
      (message[end] != ',' && message[end] != '}')) return "";
  return message.substring(start, end);
}

// Kiểm tra đủ ba trạng thái trước khi đổi chân đèn; bỏ tin đồng bộ cũ/lặp.
void restoreLeds(const String &message) {
  if (ledsSynchronized || jsonNumber(message, "sync_id") != syncId ||
      jsonNumber(message, "device_id") != "1") return;

  String key = "\"led_states\":[";
  int start = message.indexOf(key);
  if (start < 0) return;
  start += key.length();
  int levels[LED_COUNT];
  for (int id = 0; id < LED_COUNT; id++) {
    if (start >= message.length() || message[start] != '"') return;
    int end = message.indexOf('"', start + 1);
    if (end < 0 || end + 1 >= message.length()) return;
    String state = message.substring(start + 1, end);
    if (state != "ON" && state != "OFF") return;
    char delimiter = id == LED_COUNT - 1 ? ']' : ',';
    if (message[end + 1] != delimiter) return;
    levels[id] = state == "ON" ? HIGH : LOW;
    start = end + 2;
  }
  for (int id = 0; id < LED_COUNT; id++) {
    digitalWrite(LED_PINS[id], levels[id]);
  }
  ledsSynchronized = true;
  Serial.println("LED states restored from Backend.");
  publishDeviceStatus();
}

// Backend gửi: {"action_id":42,"device_id":2,"command":"OFF"}.
// Lệnh ON/OFF trực tiếp chỉ điều khiển LED 1 và không tạo lịch sử lệnh.
void mqttCallback(char *topic, byte *payload, unsigned int length) {
  if (String(topic) != topic_control) return;

  String message;
  message.reserve(length);
  for (unsigned int i = 0; i < length; i++) message += char(payload[i]);
  message.replace(" ", "");
  message.replace("\n", "");
  message.replace("\r", "");
  message.replace("\t", "");

  if (message.indexOf("\"type\":\"sync\"") >= 0) {
    restoreLeds(message);
    return;
  }
  if (!ledsSynchronized) return;

  int ledId = 1;
  String actionId;
  if (message != "ON" && message != "OFF") {
    String id = jsonNumber(message, "device_id");
    if (id != "1" && id != "2" && id != "3") {
      Serial.println("Invalid LED ID!");
      return;
    }
    ledId = id.toInt();
    actionId = jsonNumber(message, "action_id");
  }

  bool on = message == "ON" || message.indexOf("\"command\":\"ON\"") >= 0;
  bool off = message == "OFF" || message.indexOf("\"command\":\"OFF\"") >= 0;
  if (on == off) {
    Serial.println("Invalid LED command!");
    return;
  }

  digitalWrite(LED_PINS[ledId - 1], on ? HIGH : LOW);
  Serial.print("LED ");
  Serial.print(ledId);
  Serial.println(on ? " -> ON" : " -> OFF");
  if (actionId.length() > 0) sendLedResponse(ledId, actionId);
  publishDeviceStatus();
}

// 7. KẾT NỐI MQTT
void connectMQTT() {
  // Nếu chưa có Wi-Fi thì không kết nối MQTT
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }
  while (!client.connected()) {
    Serial.print("Connecting MQTT...");
    if (client.connect("ESP32_Client", mqtt_username, mqtt_password,
                       topic_status, 1, true,
                       "{\"type\":\"status\",\"device_id\":1,\"connection_status\":\"OFFLINE\"}")) {
      Serial.println("SUCCESS!");
      // Subscribe trước khi yêu cầu Backend khôi phục đèn.
      ledsSynchronized = false;
      syncId = String((unsigned long)esp_random());
      client.subscribe(topic_control);
      publishDeviceStatus();
      requestLedSync();
      Serial.print("Subscribed: ");
      Serial.println(topic_control);
    } else {
      Serial.print("FAILED, rc=");
      Serial.println(client.state());
      delay(2000);
    }
  }
}

// 9. ĐỌC + GỬI DỮ LIỆU CẢM BIẾN
void sendSensorData() {
  // ĐỌC CẢM BIẾN
  // Nhiệt độ
  float temperature = dht.readTemperature();
  // Độ ẩm
  float humidity = dht.readHumidity();
  // Ánh sáng
  int light = analogRead(LDR_PIN);
  // KIỂM TRA DHT11
  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("Failed to read DHT11!");
    return;
  }
  // TẠO JSON
  String payload;
  payload.reserve(128);
  payload = "{";
  payload += "\"device_id\":1,";
  payload += "\"temperature\":";
  payload += String(temperature, 1);
  payload += ",";
  payload += "\"humidity\":";
  payload += String(humidity, 1);
  payload += ",";
  payload += "\"light\":";
  payload += String(light);
  payload += "}";
  // PUBLISH DATA_SENSOR
  bool result = client.publish(topic_sensor, payload.c_str());
  if (result) {
    Serial.print("Publish data_sensor: ");
    Serial.println(payload);
  } else {
    Serial.println("Publish data_sensor FAILED!");
  }
}

// 10. SETUP
void setup() {
  Serial.begin(115200);
  delay(1000);
  // Tắt cả ba đèn khi khởi động
  for (int pin : LED_PINS) {
    pinMode(pin, OUTPUT);
    digitalWrite(pin, LOW);
  }
  // LDR
  pinMode(LDR_PIN, INPUT);
  // DHT11
  dht.begin();
  // WIFI
  connectWiFi();
  // MQTT
  // Địa chỉ MQTT Broker
  client.setServer(mqtt_server, mqtt_port);
  // Broker phát hiện kết nối chết nhanh hơn (mặc định thường là 15 giây).
  client.setKeepAlive(5);
  // Hàm xử lý khi nhận message MQTT
  client.setCallback(mqttCallback);
}

// 11. LOOP
void loop() {
  // KIỂM TRA WIFI
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi disconnected!");
    connectWiFi();
    return;
  }
  // KIỂM TRA MQTT
  if (!client.connected()) {
    connectMQTT();
  }
  // Xử lý message MQTT
  client.loop();
  if (!ledsSynchronized && millis() - lastSyncRequest >= SYNC_INTERVAL) {
    requestLedSync();
  }
  // GỬI SENSOR MỖI 5 GIÂY
  if (millis() - lastSensorSend >= SENSOR_INTERVAL) {
    lastSensorSend = millis();
    sendSensorData();
    publishDeviceStatus();
  }
}
