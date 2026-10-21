-- Run once against the original schema, with backend stopped and an external backup made.
ALTER TABLE users DROP COLUMN created_at, DROP COLUMN updated_at;
ALTER TABLE devices DROP INDEX uq_devices_code, DROP COLUMN device_code,
  DROP COLUMN created_at, DROP COLUMN updated_at;
ALTER TABLE sensors DROP COLUMN created_at;
ALTER TABLE data_sensor DROP COLUMN unit, DROP COLUMN status;
