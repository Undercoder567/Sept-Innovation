import { Router, Request, Response } from 'express';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import { generateToken } from '../security/authMiddleware';
import { dbClient } from './analytics.controller';

interface DevUser {
  password: string;
  userId: string;
  username: string;
  roles: string[];
  permissions: string[];
  departmentId?: string;
}

const DEV_USERS: Record<string, DevUser> = {
  admin: {
    password: 'admin123',
    userId: 'admin',
    username: 'admin',
    roles: ['ADMIN'],
    permissions: ['analytics:query:*', 'analytics:export:*', 'security:audit:read', 'system:config:read'],
    departmentId: 'DEPT-ALL',
  },
  analyst: {
    password: 'analyst123',
    userId: 'analyst',
    username: 'analyst',
    roles: ['ANALYST'],
    permissions: ['analytics:query:read', 'analytics:export:read', 'analytics:insights:read'],
    departmentId: 'DEPT-ANALYTICS',
  },
  user: {
    password: 'user123',
    userId: 'user',
    username: 'user',
    roles: ['USER'],
    permissions: ['analytics:query:limited'],
    departmentId: 'DEPT-GENERAL',
  },
};

const loginSchema = Joi.object({
  userId: Joi.string().trim().min(1).required(),
  password: Joi.string().min(1).required(),
});

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  const { error, value } = loginSchema.validate(req.body);
  if (error) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: error.details[0].message,
      requestId: (req as any).id,
    });
    return;
  }

  const username = String(value.userId).trim().toLowerCase();
  const candidate = DEV_USERS[username];
  const valid = candidate && candidate.password === value.password;

  if (!valid) {
    res.status(401).json({
      error: 'INVALID_CREDENTIALS',
      message: 'Invalid username or password',
      requestId: (req as any).id,
    });
    return;
  }

  const sessionId = uuidv4();

  try {
    await dbClient.query(
      `
      INSERT INTO user_sessions (session_id, user_id, ip_address, user_agent, is_active)
      VALUES ($1, $2, $3, $4, 1);
      `,
      [
        sessionId,
        candidate.userId,
        req.ip,
        req.headers['user-agent'] ?? '',
      ]
    );
  } catch (error) {
    console.warn('Failed to record session', error);
  }

  const token = generateToken({
    userId: candidate.userId,
    username: candidate.username,
    roles: candidate.roles,
    permissions: candidate.permissions,
    departmentId: candidate.departmentId,
    sessionId,
  });

  res.status(200).json({
    success: true,
    token,
    sessionId,
    user: {
      userId: candidate.userId,
      username: candidate.username,
      roles: candidate.roles,
      permissions: candidate.permissions,
      departmentId: candidate.departmentId,
    },
  });
});

export default router;
