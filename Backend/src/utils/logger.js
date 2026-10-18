import { appendFileSync, mkdirSync } from 'fs';
import path from 'path';

const logDirectory = path.resolve('runtime', 'logs');
const logFile = path.join(logDirectory, 'backend.log');
const managedLog = process.env.IOT_MANAGED_LOG === 'true' ||
  process.argv.includes('--managed-log');

const write = (level, message, metadata) => {
  const entry = { timestamp: new Date().toISOString(), level, message };
  if (metadata !== undefined) {
    entry.metadata = metadata;
  }
  const output = JSON.stringify(entry);
  try {
    if (!managedLog) {
      mkdirSync(logDirectory, { recursive: true });
      appendFileSync(logFile, `${output}\n`, 'utf8');
    }
  } catch {
    // Logging ra console vẫn tiếp tục nếu file tạm thời không ghi được.
  }
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.info(output);
  }
};

export const logger = {
  info: (message, metadata) => write('info', message, metadata),
  warn: (message, metadata) => write('warn', message, metadata),
  error: (message, metadata) => write('error', message, metadata),
};
