const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Telemetry accepts 0–1000 lux and rejects invalid or unconverted light values', async () => {
  const { validateSensorPayload } = await import('../../Backend/src/services/sensorService.js');
  const payload = {device_id:1,temperature:25,humidity:60,light:0};
  for (const light of [0, 0.001, 500, 999.999, 1000]) {
    assert.doesNotThrow(() => validateSensorPayload({...payload,light}));
  }
  for (const light of [-0.001,1000.001,4095,NaN,Infinity,-Infinity,'500',null,undefined]) {
    assert.throws(() => validateSensorPayload({...payload,light}),/light/);
  }
});

test('Firmware reports higher light values for lower ADC readings across all 4096 inputs', (t) => {
  const compiler = spawnSync('g++',['--version'],{encoding:'utf8'});
  if (compiler.error?.code === 'ENOENT') {t.skip('g++ is required for the host C++ conversion test');return;}
  assert.equal(compiler.status,0,compiler.stderr);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'iot-light-'));
  try {
    const binary = path.join(directory, process.platform==='win32'?'light-test.exe':'light-test');
    const compiled = spawnSync('g++',['-std=c++11','-Wall','-Wextra','-Werror',path.join(__dirname,'fixtures/light-sensor.cpp'),'-o',binary],{encoding:'utf8'});
    assert.equal(compiled.status,0,compiled.stderr);
    const result = spawnSync(binary,[],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
