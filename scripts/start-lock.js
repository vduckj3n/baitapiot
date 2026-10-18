const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

const staleAfter = 30000;

function acquireStartLock(directory) {
  const ownerFile = path.join(directory, 'owner.json');
  const owner = {
    id: randomUUID(),
    pid: process.pid,
    platform: process.platform,
    hostname: os.hostname(),
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.mkdirSync(directory);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous;
      let modified;
      try {
        previous = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
        modified = fs.statSync(ownerFile).mtimeMs;
      } catch (readError) {
        if (!['ENOENT'].includes(readError.code) && !(readError instanceof SyntaxError)) {
          throw readError;
        }
        try {
          modified = fs.statSync(directory).mtimeMs;
        } catch (statError) {
          if (statError.code === 'ENOENT') continue;
          throw statError;
        }
      }
      let stale = Date.now() - modified > staleAfter;
      if (previous?.platform === process.platform && previous.hostname === os.hostname()
          && Number.isInteger(previous.pid) && previous.pid > 0) {
        try {
          process.kill(previous.pid, 0);
          stale = false;
        } catch (pidError) {
          stale = pidError.code === 'ESRCH';
        }
      }
      if (!stale) {
        throw new Error('Một lệnh khởi động khác đang chạy. Hãy chờ lệnh đó hoàn tất; nếu vừa bị ngắt, thử lại sau 30 giây.');
      }
      // Move the abandoned lock aside before competing to create a new one.
      const abandoned = `${directory}.stale-${owner.id}`;
      try {
        fs.renameSync(directory, abandoned);
      } catch (renameError) {
        if (renameError.code === 'ENOENT') continue;
        throw renameError;
      }
      fs.rmSync(abandoned, { recursive: true, force: true });
      continue;
    }
    try {
      fs.writeFileSync(ownerFile, JSON.stringify(owner), { flag: 'wx' });
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      throw error;
    }
    const stillOwned = () => {
      try {
        return JSON.parse(fs.readFileSync(ownerFile, 'utf8')).id === owner.id;
      } catch {
        return false;
      }
    };
    // Heartbeat works even when Windows and WSL have different PID namespaces.
    const timer = setInterval(() => {
      if (stillOwned()) {
        try {
          const now = new Date();
          fs.utimesSync(ownerFile, now, now);
        } catch {}
      }
    }, 1000);
    timer.unref();
    const release = () => {
      clearInterval(timer);
      process.removeListener('exit', release);
      if (stillOwned()) fs.rmSync(directory, { recursive: true, force: true });
    };
    process.once('exit', release);
    return release;
  }
  throw new Error('Không lấy được khóa khởi động. Hãy chạy lại lệnh.');
}

module.exports = { acquireStartLock };
