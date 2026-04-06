import express, { Express, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

import { setupAuditLogger, AuditLogger } from './logs/auditLogger';
import { authMiddleware } from './security/authMiddleware';
import { rbacMiddleware } from './security/rbac';
import analyticsRouter from './api/analytics.controller';
import authRouter from './api/auth.controller';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Initialize audit logger
const auditLogger: AuditLogger = setupAuditLogger();
(app as any).auditLogger = auditLogger;

// Trust proxy for accurate IP addresses
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: 'no-referrer' },
}));

// CORS configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
};

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => req.path === '/health',
});

app.use(limiter);

// Body parsing with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Request ID for tracing
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = req.headers['x-request-id'] as string || uuidv4();
  res.setHeader('X-Request-ID', requestId);
  (req as any).id = requestId;
  next();
});

// Request logging middleware
app.use(requestLogger(auditLogger));

// Health check endpoint (no auth required)
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    uptime: process.uptime(),
  });
});

// Authentication routes (no auth required)
app.use('/auth', authRouter);

// Authentication and RBAC middleware
app.use('/api', authMiddleware);
app.use('/api', rbacMiddleware);

// API routes
app.use('/api/analytics', analyticsRouter);

// Not found handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} does not exist`,
    requestId: (req as any).id,
  });
});

// Global error handler
app.use(errorHandler(auditLogger));

let server: ReturnType<typeof app.listen>;

async function startServer(): Promise<void> {
  console.log('[DEBUG] Starting server on port', PORT);
  const portNum = typeof PORT === 'string' ? parseInt(PORT, 10) : PORT;
  return new Promise((resolve) => {
    server = app.listen(portNum, '0.0.0.0', () => {
      console.log(`🚀 Server is running on port ${PORT} in ${NODE_ENV} mode`);
      console.log(`📊 Analytics API available at http://localhost:${PORT}/api/analytics`);
      auditLogger.log({
        timestamp: new Date(),
        action: 'SERVER_START',
        userId: 'SYSTEM',
        resource: 'SERVER',
        details: { port: PORT, environment: NODE_ENV },
        severity: 'INFO',
      });
      resolve();
    });
    
    server.on('error', (err) => {
      console.error('[DEBUG] Server error:', err);
    });
  });
}

console.log('[DEBUG] About to start server...');
startServer().catch(err => {
  console.error('Failed to start server', err);
  process.exit(1);
});
console.log('[DEBUG] StartServer called, now waiting...');

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server?.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

export { app, auditLogger };
