import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function configureSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }
    try {
      socket.user = jwt.verify(token, env.jwtSecret);
      return next();
    } catch {
      return next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    logger.info('Socket client connected', {
      socketId: socket.id,
      userId: socket.user.id,
    });
    socket.on('disconnect', (reason) => {
      logger.info('Socket client disconnected', {
        socketId: socket.id,
        reason,
      });
    });
  });
}
