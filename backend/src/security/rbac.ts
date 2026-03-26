import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';

// __dirname is provided by CommonJS

interface PermissionsConfig {
  roles: Record<string, Role>;
  resources: Record<string, Resource>;
}

interface Role {
  name: string;
  description: string;
  permissions: string[];
  dataAccessLevel: 'FULL' | 'DEPARTMENT' | 'PERSONAL' | 'NONE';
  queryLimit: number; // queries per hour
}

interface Resource {
  name: string;
  requiredPermissions: string[];
  dataClassification: 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';
}

let permissionsConfig: PermissionsConfig;

/**
 * Load permissions configuration from file
 */
function loadPermissionsConfig(): PermissionsConfig {
  if (permissionsConfig) {
    return permissionsConfig;
  }

  try {
    const configPath = path.join(process.cwd(), 'config', 'permissions.yaml');
    // For now, return default config (in production, parse YAML)
    return getDefaultPermissionsConfig();
  } catch {
    return getDefaultPermissionsConfig();
  }
}

/**
 * Default permissions configuration
 */
function getDefaultPermissionsConfig(): PermissionsConfig {
  return {
    roles: {
      ADMIN: {
        name: 'Administrator',
        description: 'Full system access',
        permissions: [
          'analytics:query:*',
          'analytics:export:*',
          'security:audit:read',
          'security:permissions:manage',
          'system:config:read',
        ],
        dataAccessLevel: 'FULL',
        queryLimit: 1000,
      },
      ANALYST: {
        name: 'Data Analyst',
        description: 'Query and analyze data within department',
        permissions: [
          'analytics:query:read',
          'analytics:export:read',
          'analytics:insights:read',
        ],
        dataAccessLevel: 'DEPARTMENT',
        queryLimit: 100,
      },
      MANAGER: {
        name: 'Manager',
        description: 'View reports for team/department',
        permissions: [
          'analytics:query:read',
          'analytics:export:read',
        ],
        dataAccessLevel: 'DEPARTMENT',
        queryLimit: 50,
      },
      USER: {
        name: 'User',
        description: 'Basic analytics access',
        permissions: [
          'analytics:query:limited',
        ],
        dataAccessLevel: 'PERSONAL',
        queryLimit: 10,
      },
      GUEST: {
        name: 'Guest',
        description: 'Read-only access to public dashboards',
        permissions: [],
        dataAccessLevel: 'NONE',
        queryLimit: 0,
      },
    },
    resources: {
      'analytics:query': {
        name: 'Analytics Queries',
        requiredPermissions: ['analytics:query:read'],
        dataClassification: 'INTERNAL',
      },
      'analytics:export': {
        name: 'Data Export',
        requiredPermissions: ['analytics:export:read'],
        dataClassification: 'CONFIDENTIAL',
      },
      'security:audit': {
        name: 'Audit Logs',
        requiredPermissions: ['security:audit:read'],
        dataClassification: 'RESTRICTED',
      },
      'system:config': {
        name: 'System Configuration',
        requiredPermissions: ['system:config:read'],
        dataClassification: 'RESTRICTED',
      },
    },
  };
}

/**
 * RBAC Middleware
 * Enforces role-based access control and data classification
 */
export function rbacMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    // Skip RBAC for health check
    if (req.path === '/health') {
      next();
      return;
    }

    if (!req.user) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User not authenticated',
        requestId: (req as any).id,
      });
      return;
    }

    // Store RBAC context on request
    const config = loadPermissionsConfig();
    const userRoles = req.user.roles || [];
    
    // Get permissions for user's roles
    const userPermissions = new Set<string>();
    let maxQueryLimit = 0;
    let dataAccessLevel = 'NONE';

    userRoles.forEach(roleId => {
      const role = config.roles[roleId];
      if (role) {
        role.permissions.forEach(perm => userPermissions.add(perm));
        maxQueryLimit = Math.max(maxQueryLimit, role.queryLimit);
        
        // Highest data access level wins
        if (role.dataAccessLevel === 'FULL') {
          dataAccessLevel = 'FULL';
        } else if (dataAccessLevel !== 'FULL' && role.dataAccessLevel === 'DEPARTMENT') {
          dataAccessLevel = 'DEPARTMENT';
        } else if (dataAccessLevel === 'NONE' && role.dataAccessLevel === 'PERSONAL') {
          dataAccessLevel = 'PERSONAL';
        }
      }
    });

    // Attach RBAC context to request
    (req as any).rbac = {
      permissions: Array.from(userPermissions),
      roles: userRoles,
      queryLimit: maxQueryLimit,
      dataAccessLevel,
      departmentId: req.user.departmentId,
    };

    next();
  } catch (error) {
    res.status(500).json({
      error: 'RBAC_ERROR',
      message: 'Role-based access control error',
      requestId: (req as any).id,
    });
  }
}

/**
 * Check if user has required permission
 */
export function checkPermission(
  req: Request,
  requiredPermission: string
): boolean {
  const rbac = (req as any).rbac;
  if (!rbac) {
    return false;
  }

  const permissions = rbac.permissions as string[];
  
  // Check exact match or wildcard
  return (
    permissions.includes(requiredPermission) ||
    permissions.some(perm => perm.endsWith(':*') &&
      requiredPermission.startsWith(perm.replace(':*', ':')))
  );
}

/**
 * Check data access level
 */
export function checkDataAccess(
  req: Request,
  dataClassification: string
): boolean {
  const rbac = (req as any).rbac;
  if (!rbac) {
    return false;
  }

  const accessLevels: Record<string, number> = {
    NONE: 0,
    PERSONAL: 1,
    DEPARTMENT: 2,
    INTERNAL: 2,
    CONFIDENTIAL: 3,
    RESTRICTED: 4,
    FULL: 5,
  };

  const userLevel = accessLevels[rbac.dataAccessLevel] || 0;
  const requiredLevel = accessLevels[dataClassification] || 0;

  return userLevel >= requiredLevel;
}

/**
 * Require permission middleware factory
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!checkPermission(req, permission)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `User lacks required permission: ${permission}`,
        requestId: (req as any).id,
      });
      return;
    }
    next();
  };
}

/**
 * Require role middleware factory
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRoles = req.user?.roles || [];
    
    if (!roles.some(role => userRoles.includes(role))) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `User must have one of these roles: ${roles.join(', ')}`,
        requestId: (req as any).id,
      });
      return;
    }
    next();
  };
}

export { PermissionsConfig, Role, Resource };
