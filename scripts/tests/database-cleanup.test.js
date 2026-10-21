const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('MySQL: VARCHAR schema, legacy upgrades, HTTP and device processing', {
  skip: !process.env.IOT_TEST_MYSQL_PORT,
}, async (t) => {
  process.env.JWT_SECRET = 'iot-integration-test-secret-only';
  const mysql = require('../../Backend/node_modules/mysql2/promise');
  const options = {
    host: process.env.IOT_TEST_MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.IOT_TEST_MYSQL_PORT), user: 'root',
    password: process.env.IOT_TEST_MYSQL_PASSWORD || '', multipleStatements: true,
    decimalNumbers: true,
  };
  const connection = await mysql.createConnection(options);
  t.after(() => connection.end());
  for (const version of ['fresh', 'original', 'cleaned', 'bcnf']) {
    await t.test(version, async () => {
      const database = `iot_cleanup_test_${process.pid}_${version}`;
      const schema = version === 'bcnf' ? 'scripts/tests/fixtures/schema-before-varchar.sql' : version === 'fresh' ? 'Backend/database/schema.sql'
        : `scripts/tests/fixtures/schema-before-${version === 'original' ? 'cleanup' : 'bcnf'}.sql`;
      const seed = ['fresh', 'bcnf'].includes(version) ? 'Backend/database/seed.sql'
        : `scripts/tests/fixtures/seed-before-${version === 'original' ? 'cleanup' : 'bcnf'}.sql`;
      try {
        await connection.query(read(schema).replaceAll('iot_system', database));
        await connection.changeUser({ database });
        await connection.query(read(seed).replaceAll('iot_system', database));
        await connection.execute("INSERT INTO users (username,password_hash,full_name) VALUES ('legacy','legacy-hash','Legacy User')");
        await connection.execute("INSERT INTO action_history (user_id,device_id,action,status,completed_at) VALUES (1,2,'ON','SUCCESS',NOW(3))");
        if (version !== 'fresh') {
          if (version !== 'bcnf') {
            // Exercise the known legacy Windows encoding of the temperature unit.
            if (version === 'cleaned') {
              await connection.query(`ALTER TABLE data_sensor DROP FOREIGN KEY fk_data_sensor_device,
                ADD CONSTRAINT fk_sensor_data_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
                RENAME INDEX idx_data_sensor_device_id TO idx_sensor_data_device_id,
                RENAME INDEX idx_data_sensor_sensor_type TO idx_sensor_data_sensor_type,
                RENAME INDEX idx_data_sensor_query TO idx_sensor_data_query`);
            }
            if (version === 'cleaned') await connection.execute("UPDATE sensors SET unit=CONVERT(UNHEX('E294ACE2969143') USING utf8mb4) WHERE sensor_type='Temperature'");
            // Old telemetry accepted missing sensor metadata: migration must recover it.
            await connection.execute("DELETE FROM sensors WHERE sensor_type='Light'");
            if (version === 'original') {
              await connection.query("INSERT INTO data_sensor (device_id,sensor_type,value,unit,timestamp) VALUES (1,'Temperature',25.123,'°C','2026-10-20 12:00:00'),(1,'Light',123,'Lux','2026-10-20 12:00:00')");
            } else {
              await connection.query("INSERT INTO data_sensor (device_id,sensor_type,value,timestamp) VALUES (1,'Temperature',25.123,'2026-10-20 12:00:00'),(1,'Light',123,'2026-10-20 12:00:00')");
            }
          } else {
            await connection.query("INSERT INTO data_sensor (sensor_id,value,timestamp) SELECT id,IF(sensor_type='Temperature',25.123,123),'2026-10-20 12:00:00' FROM sensors WHERE sensor_type IN ('Temperature','Light') ORDER BY id");
          }
          const migrated = spawnSync(process.execPath, ['scripts/migrate-database.js'], {
            cwd: root, encoding: 'utf8', env: {...process.env,
              DB_HOST: options.host, DB_PORT: String(options.port), DB_USER: options.user,
              DB_PASSWORD: options.password, DB_NAME: database},
          });
          assert.equal(migrated.status, 0, migrated.stdout + migrated.stderr);
          const backupPath = migrated.stdout.match(/[^\r\n]*before-bcnf-\d+\.json/)[0].replace(/^.*: /, '');
          const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
          assert.equal(backup.tables.data_sensor.rows.length, 2);
          assert.equal(backup.tables.sensors.rows.length, version === 'bcnf' ? 3 : 2);
          fs.unlinkSync(backupPath);
          const second = spawnSync(process.execPath, ['scripts/migrate-database.js'], {
            cwd: root, encoding: 'utf8', env: {...process.env,
              DB_HOST: options.host, DB_PORT: String(options.port), DB_USER: options.user,
              DB_PASSWORD: options.password, DB_NAME: database},
          });
          assert.equal(second.status,0,second.stdout + second.stderr);
          assert.match(second.stdout,/không cần migration/);
          // DDL invalidates old prepared statements on this connection.
          await connection.changeUser({ database });
          const [old] = await connection.query('SELECT d.id,d.value,s.sensor_type FROM data_sensor d JOIN sensors s ON s.id=d.sensor_id ORDER BY d.id');
          assert.deepEqual(old, [{id:1,value:25.123,sensor_type:'Temperature'},{id:2,value:123,sensor_type:'Light'}]);
        }
        const [tables] = await connection.query('SHOW TABLES');
        assert.deepEqual(tables.map((row) => Object.values(row)[0]).sort(), ['action_history','data_sensor','devices','sensors','users']);
        const [enumColumns] = await connection.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND DATA_TYPE='enum'", [database]);
        assert.equal(enumColumns.length,0);
        const [types] = await connection.query("SELECT TABLE_NAME,COLUMN_NAME,CHARACTER_MAXIMUM_LENGTH AS size,COLUMN_DEFAULT AS default_value,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND ((TABLE_NAME='users' AND COLUMN_NAME='role') OR (TABLE_NAME='devices' AND COLUMN_NAME IN ('led_state','connection_status')) OR (TABLE_NAME='sensors' AND COLUMN_NAME='sensor_type') OR (TABLE_NAME='action_history' AND COLUMN_NAME IN ('action','status')))", [database]);
        const expectedTypes = {'users.role':[20,'USER'],'devices.led_state':[10,'OFF'],'devices.connection_status':[20,'OFFLINE'],'sensors.sensor_type':[50,null],'action_history.action':[10,null],'action_history.status':[20,'PENDING']};
        for (const col of types) {
          assert.deepEqual([col.size,col.default_value],expectedTypes[`${col.TABLE_NAME}.${col.COLUMN_NAME}`]);
          assert.equal(col.IS_NULLABLE,'NO');
        }
        assert.equal(types.length,6);
        for (const sql of ["UPDATE users SET role='INVALID'", "UPDATE devices SET led_state='INVALID'", "UPDATE devices SET connection_status='INVALID'", "UPDATE action_history SET action='INVALID'", "UPDATE action_history SET status='INVALID'"]) {
          await assert.rejects(connection.query(sql),{code:'ER_CHECK_CONSTRAINT_VIOLATED'});
        }
        await connection.execute("INSERT INTO sensors (device_id,sensor_type,sensor_name) VALUES (1,'WindSpeed','Wind sensor')");
        await connection.execute("INSERT INTO data_sensor (sensor_id,value) SELECT id,3.125 FROM sensors WHERE sensor_type='WindSpeed'");
        const [wind] = await connection.query("SELECT d.value FROM data_sensor d JOIN sensors s ON s.id=d.sensor_id WHERE s.sensor_type='WindSpeed'");
        assert.equal(wind[0].value,3.125);
        await connection.execute("DELETE FROM sensors WHERE sensor_type='WindSpeed'");
        const [fields] = await connection.query('SHOW COLUMNS FROM data_sensor');
        assert.deepEqual(fields.map((row) => row.Field), ['id','sensor_id','value','timestamp']);
        await assert.rejects(connection.execute('INSERT INTO data_sensor (sensor_id,value) VALUES (999999,1)'), {code:'ER_NO_REFERENCED_ROW_2'});
        await assert.rejects(connection.execute("INSERT INTO sensors (device_id,sensor_type,sensor_name) VALUES (1,'Temperature','duplicate')"), {code:'ER_DUP_ENTRY'});
        await connection.query(read('Backend/database/seed.sql').replaceAll('iot_system', database));
        const { pool } = await import('../../Backend/src/config/database.js');
        const { sensorRepository } = await import('../../Backend/src/repositories/sensorRepository.js');
        const { sensorService } = await import('../../Backend/src/services/sensorService.js');
        const { deviceRepository } = await import('../../Backend/src/repositories/deviceRepository.js');
        const { deviceService } = await import('../../Backend/src/services/deviceService.js');
        const { app } = await import('../../Backend/src/app.js');
        const originalExecute = pool.execute, originalConnection = pool.getConnection;
        pool.execute = connection.execute.bind(connection);
        connection.release = () => {};
        pool.getConnection = async () => connection;
        const server = app.listen(0, '127.0.0.1');
        await new Promise((resolve) => server.once('listening', resolve));
        const base = `http://127.0.0.1:${server.address().port}/api`;
        let token;
        const http = async (url, body, expected = 200) => {
          const response = await fetch(base + url, {
            method: body ? 'POST' : 'GET', headers: {
              'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}),
            }, ...(body ? {body:JSON.stringify(body)} : {}),
          });
          const result = await response.json();
          assert.equal(response.status, expected, JSON.stringify(result));
          return result;
        };
        try {
          await deviceRepository.ensureLedDevices();
          assert.deepEqual(await deviceRepository.getRestoreStates(), ['OFF','ON','OFF']);
          await http('/sensors/data', null, 401);
          const credentials = {username:'integration',password:'test-password',full_name:'Integration User',email:'iot@example.com'};
          await http('/auth/register', credentials, 201);
          await http('/auth/register', credentials, 409);
          await http('/auth/login', {username:credentials.username,password:'wrong'}, 401);
          const login = await http('/auth/login', credentials);
          token = login.token;
          assert.equal((await http(`/users/${login.user.id}`)).data.username,'integration');
          const payload = {device_id:1,temperature:26.5,humidity:60,light:100};
          await sensorService.processTelemetry(payload);
          await assert.rejects(sensorService.processTelemetry({...payload,humidity:101}),/humidity/);
          await assert.rejects(sensorService.processTelemetry({...payload,device_id:2}),/Thiếu cấu hình/);
          const dashboard = (await http('/dashboard/summary')).data;
          assert.equal(dashboard.latest.temperature,26.5);
          assert.equal(dashboard.latest.humidity,60);
          assert.equal(dashboard.device.status,'ONLINE');
          for (const [type,unit] of [['Temperature','°C'],['Humidity','%'],['Light','Lux']]) {
            const result = await http(`/sensors/data?type=${type}&sort=oldest`);
            assert(result.data.length > 0);
            assert(result.data.every((row) => row.unit === unit && row.status === 'Normal'));
          }
          for (const [searchBy,search] of [['name','Humidity Sensor'],['type','Humidity'],['value','26.5'],['timestamp','2026-10-20']]) {
            const result = await http(`/sensors/data?searchBy=${searchBy}&search=${encodeURIComponent(search)}`);
            if (searchBy !== 'timestamp' || version !== 'fresh') assert(result.data.length > 0);
          }
          const page = await http('/sensors/data?limit=1&page=2');
          assert.equal(page.data.length,1);
          await http('/sensors/data?type=Unknown',null,400);
          // Multiple devices of the same type can have independent sensor names.
          await connection.execute("INSERT INTO devices (id,device_name) VALUES (4,'Other node')");
          await connection.execute("INSERT INTO sensors (device_id,sensor_type,sensor_name) VALUES (4,'Temperature','Other temperature')");
          await connection.execute("INSERT INTO data_sensor (sensor_id,value) SELECT id,99 FROM sensors WHERE device_id=4");
          assert.equal((await sensorRepository.getLatest(4)).temperature,99);
          assert.equal((await sensorRepository.getLatest(1)).temperature,26.5);
          for (let i=0;i<23;i++) {
            await sensorRepository.insertTelemetry(connection,1,payload,new Date(Date.UTC(2027,0,1,0,0,i)));
          }
          const chart = await sensorRepository.getChartHistory();
          assert.equal(chart.length,20);
          assert(chart.every((row,index) => !index || row.timestamp >= chart[index-1].timestamp));
          const published = [], events = [];
          deviceService.configure({io:{emit:(name,data) => events.push({name,data})},publishControl:async (data) => published.push(data)});
          const requested = await http('/devices/2/actions',{command:'OFF'},201);
          assert.equal(requested.action.status,'PENDING');
          await http('/devices/2/actions',{command:'ON'},409);
          assert.equal(published[0].action_id,requested.action.id);
          await deviceService.processDeviceResponse({action_id:requested.action.id,device_id:2,led_state:'OFF',status:'SUCCESS'});
          assert.equal((await http('/devices/2/status')).data.led_state,'OFF');
          assert.deepEqual(await deviceRepository.getRestoreStates(),['OFF','OFF','OFF']);
          assert.equal(await deviceService.processDeviceResponse({action_id:requested.action.id,device_id:2,led_state:'OFF',status:'SUCCESS'}),null);
          const timeout = await http('/devices/3/actions',{command:'ON'},201);
          await connection.execute('UPDATE action_history SET timestamp=DATE_SUB(NOW(3),INTERVAL 1 HOUR) WHERE id=?',[timeout.action.id]);
          await deviceService.restoreTimeoutState();
          assert(events.some((event) => event.data.action_id===timeout.action.id && event.data.status==='FAILED'));
          const actions = await http('/actions?deviceId=2&status=SUCCESS');
          assert(actions.data.some((row) => row.id===requested.action.id));
          // Cascades reach readings through sensors, without touching other devices.
          await connection.execute('DELETE FROM devices WHERE id=4');
          const [orphans] = await connection.query('SELECT COUNT(*) AS total FROM data_sensor d LEFT JOIN sensors s ON s.id=d.sensor_id WHERE s.id IS NULL');
          assert.equal(orphans[0].total,0);
          assert.equal((await sensorRepository.getLatest(1)).temperature,26.5);
        } finally {
          await new Promise((resolve) => server.close(resolve));
          pool.execute = originalExecute;
          pool.getConnection = originalConnection;
        }
      } finally { await connection.query(`DROP DATABASE IF EXISTS \`${database}\``); }
    });
  }
  await t.test('unsupported units stop before changing the original schema', async () => {
    const database = `iot_cleanup_test_${process.pid}_guard`;
    try {
      await connection.query(read('scripts/tests/fixtures/schema-before-cleanup.sql').replaceAll('iot_system', database));
      await connection.changeUser({database});
      await connection.query(read('scripts/tests/fixtures/seed-before-cleanup.sql').replaceAll('iot_system', database));
      await connection.execute("UPDATE sensors SET unit='Fahrenheit' WHERE sensor_type='Temperature'");
      const migrated = spawnSync(process.execPath, ['scripts/migrate-database.js'], {
        cwd:root,encoding:'utf8',env:{...process.env,DB_HOST:options.host,
          DB_PORT:String(options.port),DB_USER:options.user,DB_PASSWORD:options.password,DB_NAME:database},
      });
      assert.equal(migrated.status,1);
      assert.match(migrated.stderr,/schema chưa bị thay đổi/);
      const backupPath = migrated.stdout.match(/[^\r\n]*before-bcnf-\d+\.json/)[0].replace(/^.*: /, '');
      fs.unlinkSync(backupPath);
      const [fields] = await connection.query('SHOW COLUMNS FROM devices');
      assert(fields.some((row) => row.Field==='device_code'));
      const [units] = await connection.query("SELECT unit FROM sensors WHERE sensor_type='Temperature'");
      assert.equal(units[0].unit,'Fahrenheit');
    } finally {await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);}
  });

});
