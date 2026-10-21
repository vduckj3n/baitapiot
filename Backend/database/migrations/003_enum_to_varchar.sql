-- Backend must be stopped; scripts/migrate-database.js backs up all five tables first.
ALTER TABLE users
  MODIFY COLUMN role VARCHAR(20) NOT NULL DEFAULT 'USER',
  ADD CONSTRAINT chk_users_role CHECK (role IN ('USER', 'ADMIN'));

ALTER TABLE devices
  MODIFY COLUMN led_state VARCHAR(10) NOT NULL DEFAULT 'OFF',
  MODIFY COLUMN connection_status VARCHAR(20) NOT NULL DEFAULT 'OFFLINE',
  ADD CONSTRAINT chk_devices_led_state CHECK (led_state IN ('ON', 'OFF')),
  ADD CONSTRAINT chk_devices_connection_status CHECK (connection_status IN ('ONLINE', 'OFFLINE'));

ALTER TABLE sensors MODIFY COLUMN sensor_type VARCHAR(50) NOT NULL;

ALTER TABLE action_history
  MODIFY COLUMN action VARCHAR(10) NOT NULL,
  MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  ADD CONSTRAINT chk_actions_action CHECK (action IN ('ON', 'OFF')),
  ADD CONSTRAINT chk_actions_status CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED'));
