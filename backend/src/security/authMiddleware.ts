import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

interface TokenPayload {
  userId: string;
  username: string;
  roles: string[];
  permissions: string[];
  departmentId?: string;
  sessionId?: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
      tokenId?: string;
    }
  }
}

/**
 * Authentication Middleware
 * Validates JWT tokens and extracts user context
 * Supports both Authorization header and cookie-based tokens
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // Skip auth for certain paths
    if (req.path === '/health' || req.path === '/api-docs') {
      next();
      return;
    }

    const token =
      extractTokenFromHeader(req) ||
      extractTokenFromCookie(req);

    if (!token) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'No authentication token provided',
        requestId: (req as any).id,
      });
      return;
    }

    const secret = process.env.JWT_SECRET || 'your-secret-key';
    const decoded = jwt.verify(token, secret) as TokenPayload;

    // Attach user to request
    req.user = decoded;
    req.tokenId = uuidv4();

    // Check token expiration
    if (decoded.exp && decoded.exp * 1000 < Date.now()) {
      res.status(401).json({
        error: 'TOKEN_EXPIRED',
        message: 'Authentication token has expired',
        requestId: (req as any).id,
      });
      return;
    }

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        error: 'INVALID_TOKEN',
        message: 'Invalid or malformed token',
        requestId: (req as any).id,
      });
      return;
    }

    res.status(500).json({
      error: 'AUTHENTICATION_ERROR',
      message: 'Internal authentication error',
      requestId: (req as any).id,
    });
  }
}

/**
 * Extract token from Authorization header (Bearer scheme)
 */
function extractTokenFromHeader(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Extract token from secure cookie
 */
function extractTokenFromCookie(req: Request): string | null {
  const cookies = req.headers.cookie;
  if (!cookies) {
    return null;
  }

  const match = cookies.match(/auth_token=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Generate a JWT token (for testing/development)
 */
export function generateToken(payload: TokenPayload): string {
  const secret = process.env.JWT_SECRET || 'your-secret-key';
  const expiresIn = process.env.JWT_EXPIRY || '24h';

  return jwt.sign(payload as any, secret as any, {
    expiresIn: expiresIn as any,
    algorithm: 'HS256',
  });
}

/**
 * Validate token without middleware context
 */
export function validateToken(token: string): TokenPayload | null {
  try {
    const secret = process.env.JWT_SECRET || 'your-secret-key';
    return jwt.verify(token, secret) as TokenPayload;
  } catch {
    return null;
  }
}
