import { Request, Response, NextFunction } from 'express';
import { AuditLogger } from '../logs/auditLogger';

/**
 * Request logging middleware
 * Tracks all incoming requests for audit and debugging
 */
export function requestLogger(auditLogger: AuditLogger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const requestId = (req as any).id;
    const userId = req.user?.userId || 'ANONYMOUS';

    // Log request start
    console.log(`[${requestId}] ${req.method} ${req.path}`);

    // Capture original send function
    const originalSend = res.send;

    // Override send to log response
    res.send = function(data: any) {
      const duration = Date.now() - startTime;

      // Log to audit if sensitive operations
      if (req.path.includes('/api/analytics')) {
        auditLogger.log({
          timestamp: new Date(),
          action: 'HTTP_REQUEST',
          userId,
          resource: `${req.method} ${req.path}`,
          details: {
            statusCode: res.statusCode,
            duration,
            contentLength: (data && data.length) || 0,
          },
          severity: res.statusCode >= 400 ? 'WARNING' : 'INFO',
        });
      }

      console.log(`[${requestId}] ${res.statusCode} in ${duration}ms`);

      // Call original send
      return originalSend.call(this, data);
    };

    next();
  };
}
