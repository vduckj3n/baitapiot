USE iot_system;

INSERT INTO
  devices (
    id,
    device_name,
    led_state,
    connection_status
  )
VALUES
  (
    1,
    'LED 1',
    'OFF',
    'OFFLINE'
  ),
  (2, 'LED 2', 'OFF', 'OFFLINE'),
  (3, 'LED 3', 'OFF', 'OFFLINE')
ON DUPLICATE KEY UPDATE
  device_name = VALUES(device_name);

INSERT INTO
  sensors (device_id, sensor_type, sensor_name)
VALUES
  (1, 'Temperature', 'Temperature'),
  (1, 'Humidity', 'Humidity Sensor'),
  (1, 'Light', 'Light Sensor')
ON DUPLICATE KEY UPDATE
  sensor_name = VALUES(sensor_name);

-- Users are created through POST /api/auth/register; no development password is seeded.
