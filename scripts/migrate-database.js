const fs = require('node:fs');
const path = require('node:path');
const mysql = require('../Backend/node_modules/mysql2/promise');
require('../Backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../Backend/.env'), quiet: true });

async function main() {
  const database = process.env.DB_NAME || 'iot_system';
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: Number(process.env.DB_PORT || 3307),
    user: process.env.DB_USER || 'iot_user', password: process.env.DB_PASSWORD || '',
    database, multipleStatements: true, supportBigNumbers: true, bigNumberStrings: true,
    dateStrings: true,
  });
  try {
    const tables = ['users', 'devices', 'sensors', 'data_sensor', 'action_history'];
    const [columns] = await connection.execute(
      'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ?', [database],
    );
    const has = (table, column) => columns.some((row) => row.TABLE_NAME === table && row.COLUMN_NAME === column);
    const isBcnf = has('data_sensor', 'sensor_id') && !has('sensors', 'unit');
    const hasEnums = columns.some((row) => row.DATA_TYPE === 'enum');
    if (isBcnf && !hasEnums) {
      console.log('Database đã dùng schema BCNF và VARCHAR; không cần migration.');
      return;
    }
    if (!isBcnf && has('data_sensor', 'sensor_id')) throw new Error('Schema chuyển đổi dở dang; cần kiểm tra trước khi tiếp tục.');
    const backup = { database, createdAt: new Date().toISOString(), tables: {} };
    for (const table of tables) {
      const [ddl] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
      const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
      backup.tables[table] = { createTable: ddl[0]['Create Table'], rows };
    }
    const backupDirectory = path.resolve(__dirname, '../Backend/runtime/backups');
    fs.mkdirSync(backupDirectory, { recursive: true });
    const backupPath = path.join(backupDirectory, `before-bcnf-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(`Đã sao lưu cấu trúc và dữ liệu: ${backupPath}`);
    // Check before any ALTER, including cleanup of the original schema.
    if (has('sensors', 'unit')) {
      const [unexpectedUnits] = await connection.query(`SELECT id FROM sensors
        WHERE BINARY unit <> BINARY CASE sensor_type
          WHEN 'Temperature' THEN '°C' WHEN 'Humidity' THEN '%' WHEN 'Light' THEN 'Lux' END
          AND NOT (sensor_type = 'Temperature' AND HEX(unit) = 'E294ACE2969143') LIMIT 1`);
      if (unexpectedUnits.length) throw new Error('Có đơn vị tùy chỉnh chưa hỗ trợ; schema chưa bị thay đổi.');
    }
    const migrations = [];
    if (has('devices', 'device_code')) migrations.push('001_remove_unused_columns.sql');
    if (!isBcnf) migrations.push('002_bcnf_five_tables.sql');
    migrations.push('003_enum_to_varchar.sql');
    for (const migration of migrations) {
      let sql = fs.readFileSync(path.resolve(__dirname, '../Backend/database/migrations', migration), 'utf8');
      if (migration === '002_bcnf_five_tables.sql') {
        // Installed databases can use older constraint/index names than schema.sql.
        const [foreignKeys] = await connection.execute(`SELECT DISTINCT CONSTRAINT_NAME
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA=? AND TABLE_NAME='data_sensor' AND COLUMN_NAME='device_id'
            AND REFERENCED_TABLE_NAME IS NOT NULL`, [database]);
        const [indexes] = await connection.execute(`SELECT DISTINCT INDEX_NAME
          FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA=? AND TABLE_NAME='data_sensor'
            AND COLUMN_NAME IN ('device_id','sensor_type') AND INDEX_NAME <> 'PRIMARY'`, [database]);
        const quote = (name) => '`' + name.replaceAll('`', '``') + '`';
        sql = sql.replace('  DROP FOREIGN KEY fk_data_sensor_device,',
          foreignKeys.map((row) => `  DROP FOREIGN KEY ${quote(row.CONSTRAINT_NAME)},`).join('\n'));
        sql = sql.replace(/  DROP INDEX idx_data_sensor_device_id,\n  DROP INDEX idx_data_sensor_sensor_type,\n  DROP INDEX idx_data_sensor_query,/,
          indexes.map((row) => `  DROP INDEX ${quote(row.INDEX_NAME)},`).join('\n'));
      }
      await connection.query(sql);
      console.log(`Đã áp dụng ${migration}`);
    }
    for (const table of tables) {
      const [rows] = await connection.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
      const before = backup.tables[table].rows.length;
      if (table === 'sensors' ? Number(rows[0].total) < before : Number(rows[0].total) !== before) {
        throw new Error(`Số bản ghi ${table} không khớp bản sao lưu; kiểm tra trước khi bật backend.`);
      }
    }
    if (isBcnf) {
      const assert = require('node:assert/strict');
      for (const table of tables) {
        const [rows] = await connection.query(`SELECT * FROM \`${table}\` ORDER BY id`);
        const expected = [...backup.tables[table].rows].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
        assert.deepEqual(rows, expected, `Dữ liệu ${table} thay đổi sau khi đổi kiểu dữ liệu`);
      }
      console.log('Đã đối chiếu toàn bộ giá trị từng dòng của cả năm bảng; dữ liệu giữ nguyên.');
    }
    console.log('Migration hoàn tất; số bản ghi đã được đối chiếu với bản sao lưu.');
  } finally { await connection.end(); }
}
main().catch((error) => { console.error(`Migration thất bại: ${error.code || ''} ${error.message}`); process.exitCode = 1; });
