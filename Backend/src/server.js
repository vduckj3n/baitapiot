import http from 'http';
import { Server } from 'socket.io';
import { app } from './app.js';
import { env, validateEnvironment } from './config/env.js';
import { pool, verifyDatabaseConnection } from './config/database.js';
import { deviceRepository } from './repositories/deviceRepository.js';
import { mqttService } from './services/mqttService.js';
import { sensorService } from './services/sensorService.js';
import { deviceService } from './services/deviceService.js';
import { configureSocket } from './socket/socketHandler.js';
import { logger } from './utils/logger.js';

let httpServer;
let io;
let shuttingDown = false;
let offlineMonitor;
let pendingMonitor;

async function start() {
  validateEnvironment();
  await verifyDatabaseConnection();
  await deviceRepository.ensureLedDevices();
  logger.info('Connected to MySQL');

  httpServer = http.createServer(app);
  io = new Server(httpServer, {
    cors: { origin: env.frontendOrigins, methods: ['GET', 'POST'] },
  });
  configureSocket(io);
  deviceService.configure({
    io,
    publishControl: (payload) => mqttService.publishControl(payload),
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(env.port, '0.0.0.0', () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });
  logger.info('HTTP and Socket.IO server started', { port: env.port });

  mqttService.connect({
    onSensorData: async (payload) => {
      const data = await sensorService.processTelemetry(payload);
      const { becameOnline, ...event } = data;
      io.emit('sensor_data', event);
      if (becameOnline) {
        io.emit('device_status', {
          device_id: event.device_id,
          connection_status: 'ONLINE',
        });
      }
    },
    onDeviceResponse: async (payload) => {
      const data = await deviceService.processDeviceResponse(payload);
      if (!data) return;
      const { becameOnline, ...event } = data;
      io.emit('device_response', event);
      if (becameOnline) {
        io.emit('device_status', {
          device_id: event.device_id,
          connection_status: 'ONLINE',
        });
      }
    },
    onDeviceStatus: (payload) => deviceService.processDeviceStatus(payload),
    onSyncRequest: (payload) => deviceService.synchronizeLeds(payload),
  });

  offlineMonitor = setInterval(
    async () => {
      try {
        const offlineIds = await deviceRepository.markStaleDevicesOffline(
          env.deviceOfflineTimeout,
        );
        offlineIds.forEach((deviceId) =>
          io.emit('device_status', {
            device_id: deviceId,
            connection_status: 'OFFLINE',
          }),
        );
      } catch (error) {
        logger.error('Device offline monitor failed', {
          message: error.message,
        });
      }
    },
    Math.min(env.deviceOfflineTimeout, 1000),
  );

  pendingMonitor = setInterval(() => {
    deviceService.restoreTimeoutState().catch((error) =>
      logger.error('Pending action monitor failed', {
        message: error.message,
      }),
    );
  }, 1000);
  offlineMonitor.unref?.();
  pendingMonitor.unref?.();
  await deviceService.restoreTimeoutState();
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down', { signal });
  clearInterval(offlineMonitor);
  clearInterval(pendingMonitor);
  await mqttService.close().catch(() => {});
  if (io) {
    await io.close();
  } else if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
  }
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) =>
  logger.error('Unhandled rejection', { message: error?.message }),
);

start().catch((error) => {
  logger.error('Backend startup failed', { message: error.message });
  process.exit(1);
});
