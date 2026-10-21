CREATE DATABASE IF NOT EXISTS iot_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE iot_system;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NULL,
  role ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT uq_users_email UNIQUE (email)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS devices (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_name VARCHAR(100) NOT NULL,
  led_state ENUM('ON', 'OFF') NOT NULL DEFAULT 'OFF',
  connection_status ENUM('ONLINE', 'OFFLINE') NOT NULL DEFAULT 'OFFLINE',
  last_seen DATETIME(3) NULL,
  INDEX idx_devices_last_seen (last_seen)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS sensors (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_id BIGINT UNSIGNED NOT NULL,
  sensor_type ENUM('Temperature', 'Humidity', 'Light') NOT NULL,
  sensor_name VARCHAR(100) NOT NULL,
  CONSTRAINT fk_sensors_device FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE,
  CONSTRAINT uq_sensor_device_type UNIQUE (device_id, sensor_type),
  INDEX idx_sensors_device_id (device_id)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS data_sensor (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sensor_id BIGINT UNSIGNED NOT NULL,
  value DECIMAL(12, 3) NOT NULL,
  timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_data_sensor_sensor FOREIGN KEY (sensor_id) REFERENCES sensors (id) ON DELETE CASCADE,
  INDEX idx_data_sensor_timestamp (timestamp),
  INDEX idx_data_sensor_query (sensor_id, timestamp)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS action_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  device_id BIGINT UNSIGNED NOT NULL,
  action ENUM('ON', 'OFF') NOT NULL,
  status ENUM('PENDING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING',
  message VARCHAR(255) NULL,
  timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  completed_at DATETIME(3) NULL,
  CONSTRAINT fk_actions_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_actions_device FOREIGN KEY (device_id) REFERENCES devices (id),
  INDEX idx_action_history_timestamp (timestamp),
  INDEX idx_action_history_device_id (device_id),
  INDEX idx_action_history_status (status),
  INDEX idx_action_pending_match (device_id, status, action, timestamp)
) ENGINE = InnoDB;
