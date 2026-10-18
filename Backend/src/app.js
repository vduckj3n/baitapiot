import cors from 'cors';
import express from 'express';
import { env } from './config/env.js';
import { authenticate } from './middleware/authMiddleware.js';
import { errorHandler } from './middleware/errorMiddleware.js';
import { notFound } from './middleware/notFoundMiddleware.js';
import { actionRoutes } from './routes/actionRoutes.js';
import { authRoutes } from './routes/authRoutes.js';
import { dashboardRoutes } from './routes/dashboardRoutes.js';
import { deviceRoutes } from './routes/deviceRoutes.js';
import { sensorRoutes } from './routes/sensorRoutes.js';
import { userRoutes } from './routes/userRoutes.js';

export const app = express();

app.disable('x-powered-by');
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.frontendOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(
        Object.assign(new Error('Origin không được CORS cho phép'), {
          status: 403,
        }),
      );
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(express.json({ limit: '32kb' }));

app.get('/api/health', (req, res) =>
  res.json({ success: true, data: { status: 'UP' } }),
);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', authenticate, dashboardRoutes);
app.use('/api/sensors', authenticate, sensorRoutes);
app.use('/api/devices', authenticate, deviceRoutes);
app.use('/api/actions', authenticate, actionRoutes);
app.use('/api/users', authenticate, userRoutes);

app.use(notFound);
app.use(errorHandler);
