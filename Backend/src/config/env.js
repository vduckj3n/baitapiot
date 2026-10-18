import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const numberFromEnv = (name, fallback, maximum = Number.MAX_SAFE_INTEGER) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return value;
};

export const env = Object.freeze({
  port: numberFromEnv('PORT', 3000, 65535),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: numberFromEnv('DB_PORT', 3307, 65535),
    user: process.env.DB_USER || 'iot_user',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'iot_system',
    timezone: process.env.DB_TIMEZONE || '+07:00',
  },
  profileLinks: Object.freeze({
    github: process.env.PROFILE_GITHUB_URL || 'https://github.com/vduckj3n/baitapiot',
    figma: process.env.PROFILE_FIGMA_URL || 'https://www.figma.com/design/W5sp1mzed8slf3ruhOlkID/Untitled?node-id=0-1&t=UMCgnFt3erE6G9PY-1',
    api_docs: process.env.PROFILE_API_DOCS_URL || 'https://documenter.getpostman.com/view/50291878/2sBYHSxLWC',
  }),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  mqtt: {
    host: process.env.MQTT_HOST || 'mqtt://localhost',
    port: numberFromEnv('MQTT_PORT', 1883, 65535),
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    clientId: process.env.MQTT_CLIENT_ID || 'iot_backend',
  },
  deviceResponseTimeout: numberFromEnv('DEVICE_RESPONSE_TIMEOUT', 30000),
  deviceOfflineTimeout: numberFromEnv('DEVICE_OFFLINE_TIMEOUT', 15000),
  frontendOrigins: (process.env.FRONTEND_ORIGIN || 'http://localhost:5500')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
});

export function validateEnvironment() {
  if (!env.jwtSecret || env.jwtSecret.length < 16) {
    throw new Error('JWT_SECRET must contain at least 16 characters');
  }
}
