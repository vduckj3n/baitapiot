const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function check(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
  }
  if (result.error || result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function javascriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? javascriptFiles(file)
      : /\.(?:js|cjs)$/.test(entry.name)
        ? [file]
        : [];
  });
}

for (const directory of ['Frontend/js', 'Backend/src', 'scripts']) {
  for (const file of javascriptFiles(path.join(root, directory))) {
    check(process.execPath, ['--check', file]);
  }
}
console.log('Kiểm tra cú pháp thành công.');
