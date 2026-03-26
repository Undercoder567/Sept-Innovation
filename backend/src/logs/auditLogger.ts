import fs from 'fs';
import path from 'path';
import { createWriteStream, WriteStream } from 'fs';
import winston, { Logger, format } from 'winston';

// __dirname is provided by CommonJS

const logsBasePath = path.join(process.cwd(), 'logs');

interface AuditEntry {
  timestamp: Date;
  action: string;
  userId: string;
  resource: string;
  details?: Record<string, any>;
  severity: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  ipAddress?: string;
  status?: 'SUCCESS' | 'FAILURE';
}

/**
 * Audit Logger
 * Maintains immutable security audit trail for all system actions
 * Particularly sensitive to:
 * - Data access patterns
 * - Authorization decisions
 * - Query executions
 * - PII interactions
 */
class AuditLogger {
  private logger: Logger;
  private auditFile: WriteStream;

  constructor() {
    // Create logs directory if it doesn't exist
    const logsDir = logsBasePath;
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    // Initialize Winston logger
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.errors({ stack: true }),
        format.splat(),
        format.json()
      ),
      defaultMeta: { service: 'sept-innovation-backend' },
      transports: [
        // Console output
        new winston.transports.Console({
          format: format.combine(
            format.colorize(),
            format.printf(({ level, message, timestamp, ...meta }) => {
              return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
            })
          ),
        }),
        // File transport for audit logs
        new winston.transports.File({
          filename: path.join(logsDir, 'audit.log'),
          format: format.json(),
          maxsize: 10485760, // 10MB
          maxFiles: 5, // Keep 5 files
        }),
        // Separate error log
        new winston.transports.File({
          filename: path.join(logsDir, 'error.log'),
          level: 'error',
          format: format.json(),
          maxsize: 10485760,
          maxFiles: 5,
        }),
      ],
    });

    // Open separate audit trail file (append-only)
    const auditFilePath = path.join(logsDir, 'audit-trail.jsonl');
    this.auditFile = createWriteStream(auditFilePath, { flags: 'a' });
  }

  /**
   * Log audit entry
   * All entries are immutable (append-only)
   */
  log(entry: AuditEntry): void {
    const auditEntry = {
      ...entry,
      timestamp: entry.timestamp.toISOString(),
      id: this.generateAuditId(),
    };

    // Write to immutable audit trail
    this.auditFile.write(JSON.stringify(auditEntry) + '\n');

    // Also log to Winston
    const logLevel = entry.severity.toLowerCase();
    this.logger.log({
      level: logLevel,
      message: `[${entry.action}] ${entry.resource}`,
      ...auditEntry,
    });
  }

  /**
   * Log security event (high priority)
   */
  logSecurityEvent(
    action: string,
    resource: string,
    details: Record<string, any>,
    userId: string = 'SYSTEM'
  ): void {
    this.log({
      timestamp: new Date(),
      action,
      userId,
      resource,
      details,
      severity: 'WARNING',
    });
  }

  /**
   * Log data access
   */
  logDataAccess(
    userId: string,
    resource: string,
    action: 'READ' | 'WRITE' | 'DELETE' | 'EXPORT',
    recordCount?: number,
    masked?: boolean
  ): void {
    this.log({
      timestamp: new Date(),
      action: `DATA_ACCESS_${action}`,
      userId,
      resource,
      details: { recordCount, masked },
      severity: 'INFO',
    });
  }

  /**
   * Log authentication event
   */
  logAuthEvent(
    userId: string,
    action: 'LOGIN' | 'LOGOUT' | 'AUTH_FAILED' | 'TOKEN_REFRESH',
    ipAddress?: string,
    details?: Record<string, any>
  ): void {
    this.log({
      timestamp: new Date(),
      action,
      userId,
      resource: 'AUTHENTICATION',
      details,
      severity: action === 'AUTH_FAILED' ? 'WARNING' : 'INFO',
      ipAddress,
    });
  }

  /**
   * Log permission check
   */
  logPermissionCheck(
    userId: string,
    resource: string,
    permission: string,
    granted: boolean,
    details?: Record<string, any>
  ): void {
    this.log({
      timestamp: new Date(),
      action: granted ? 'PERMISSION_GRANTED' : 'PERMISSION_DENIED',
      userId,
      resource,
      details: { permission, ...details },
      severity: granted ? 'DEBUG' : 'WARNING',
    });
  }

  /**
   * Log query execution
   */
  logQueryExecution(
    userId: string,
    query: string,
    executionTime: number,
    recordCount: number,
    success: boolean,
    error?: string
  ): void {
    this.log({
      timestamp: new Date(),
      action: 'QUERY_EXECUTION',
      userId,
      resource: 'DATABASE',
      details: {
        query: query.substring(0, 200),
        executionTime,
        recordCount,
        error,
      },
      severity: success ? 'INFO' : 'ERROR',
      status: success ? 'SUCCESS' : 'FAILURE',
    });
  }

  /**
   * Generate unique audit entry ID (timestamp + random)
   */
  private generateAuditId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `AUD_${timestamp}${random}`.toUpperCase();
  }

  /**
   * Retrieve audit entries (for audit review)
   */
  getAuditEntries(
    filters?: {
      userId?: string;
      action?: string;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    }
  ): AuditEntry[] {
    // In production, this would query from database
    // For now, return empty array - audit trail is write-only
    return [];
  }

  /**
   * Close logger and audit file
   */
  close(): void {
    this.auditFile.end();
    this.logger.close();
  }
}

/**
 * Initialize audit logger singleton
 */
let auditLoggerInstance: AuditLogger | null = null;

export function setupAuditLogger(): AuditLogger {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new AuditLogger();
  }
  return auditLoggerInstance;
}

export { AuditLogger, AuditEntry };
