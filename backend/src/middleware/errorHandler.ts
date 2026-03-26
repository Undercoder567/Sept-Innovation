import { Request, Response, NextFunction } from 'express';
import { AuditLogger } from '../logs/auditLogger';

/**
 * Global error handler middleware
 */
export function errorHandler(auditLogger: AuditLogger) {
  return (err: any, req: Request, res: Response, next: NextFunction) => {
    const requestId = (req as any).id;
    const userId = req.user?.userId || 'UNKNOWN';

    // Log error to audit trail
    auditLogger.log({
      timestamp: new Date(),
      action: 'ERROR_OCCURRED',
      userId,
      resource: `${req.method} ${req.path}`,
      details: {
        error: err.message,
        stack: err.stack?.substring(0, 500),
        code: err.code,
      },
      severity: 'ERROR',
    });

    // Determine error response
    const statusCode = err.statusCode || err.status || 500;
    const message = statusCode === 500 
      ? 'Internal server error' 
      : err.message || 'An error occurred';

    // Send error response
    res.status(statusCode).json({
      error: err.name || 'ERROR',
      message,
      requestId,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  };
}
