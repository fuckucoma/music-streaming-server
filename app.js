require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('node:path');
const multer = require('multer');

function createApp({ logRequests = true } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS);
  if (Number.isInteger(proxyHops) && proxyHops > 0) app.set('trust proxy', proxyHops);

  const allowedOrigins = new Set([
    'https://underlab-phi.vercel.app',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5180',
    'http://127.0.0.1:5180',
    ...(process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ]);

  app.use(cors({
    origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Range', 'Authorization'],
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
  }));
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  if (logRequests) app.use(morgan(':method :status :response-time ms'));

  app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
  app.use('/avatars', express.static(path.join(__dirname, 'public', 'avatars')));
  app.use('/auth', require('./routes/authRoutes'));
  app.use('/users', require('./routes/userRoutes'));
  app.use('/tracks', require('./routes/trackRoutes'));
  app.use('/favorites', require('./routes/favoriteRoutes'));
  app.use('/complaints', require('./routes/complaintRoutes'));
  app.use('/reviews', require('./routes/reviewRoutes'));
  app.use('/api/admin', require('./routes/adminRoutes'));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE' || error.code === 'LIMIT_FILE_COUNT';
      return res.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? 'Upload exceeds the configured limit' : 'Invalid multipart upload',
      });
    }
    const status = error.status ?? error.statusCode;
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      const message = status === 413 ? 'Request body is too large' : 'Invalid request';
      return res.status(status).json({ error: message });
    }
    console.error('Unhandled request error:', error.name);
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

if (require.main === module) {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  const port = process.env.PORT || 4000;
  createApp().listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
    require('./bot/bot').launch();
  });
}

module.exports = { createApp };
