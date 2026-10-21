-- Run once AFTER 001, with backend stopped and an external backup made.
-- Guard against silently replacing custom units. Temporary table is session-local.
CREATE TEMPORARY TABLE bcnf_unit_guard (
  valid TINYINT NOT NULL CHECK (valid = 1)
);
INSERT INTO bcnf_unit_guard (valid)
SELECT IF(EXISTS (
  SELECT 1 FROM sensors WHERE BINARY unit <> BINARY CASE sensor_type
    WHEN 'Temperature' THEN '°C' WHEN 'Humidity' THEN '%' WHEN 'Light' THEN 'Lux' END
    -- Known legacy Windows import encoding of the degree symbol (┬░C).
    AND NOT (sensor_type = 'Temperature' AND HEX(unit) = 'E294ACE2969143')
), 0, 1);
DROP TEMPORARY TABLE bcnf_unit_guard;

-- Legacy telemetry may have no matching catalog entry. Create those before linking.
INSERT INTO sensors (device_id, sensor_type, sensor_name, unit)
SELECT DISTINCT d.device_id, d.sensor_type,
  CASE d.sensor_type WHEN 'Temperature' THEN 'Temperature'
    WHEN 'Humidity' THEN 'Humidity Sensor' WHEN 'Light' THEN 'Light Sensor' END,
  CASE d.sensor_type WHEN 'Temperature' THEN '°C'
    WHEN 'Humidity' THEN '%' WHEN 'Light' THEN 'Lux' END
FROM data_sensor d
LEFT JOIN sensors s ON s.device_id = d.device_id AND s.sensor_type = d.sensor_type
WHERE s.id IS NULL;

ALTER TABLE data_sensor ADD COLUMN sensor_id BIGINT UNSIGNED NULL AFTER id;
UPDATE data_sensor d JOIN sensors s
  ON s.device_id = d.device_id AND s.sensor_type = d.sensor_type
SET d.sensor_id = s.id;

ALTER TABLE data_sensor
  MODIFY COLUMN sensor_id BIGINT UNSIGNED NOT NULL,
  ADD CONSTRAINT fk_data_sensor_sensor FOREIGN KEY (sensor_id) REFERENCES sensors (id) ON DELETE CASCADE,
  DROP FOREIGN KEY fk_data_sensor_device,
  DROP INDEX idx_data_sensor_device_id,
  DROP INDEX idx_data_sensor_sensor_type,
  DROP INDEX idx_data_sensor_query,
  ADD INDEX idx_data_sensor_query (sensor_id, timestamp),
  DROP COLUMN device_id,
  DROP COLUMN sensor_type;
ALTER TABLE sensors DROP COLUMN unit;
