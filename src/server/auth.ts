/**
 * auth.ts — Express middleware для авторизации по токену.
 *
 * Secure-by-default: если ADMIN_TOKEN не задан — API заблокирован (401).
 * Если задан — проверяет заголовок X-Admin-Token или query-параметр ?token=...
 */

import type { Request, Response, NextFunction } from 'express';
import { config } from '../config/config.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = config.security.adminToken;

  // Secure-by-default: без токена API закрыт (особенно опасно при HOST=0.0.0.0)
  if (!token) {
    res.status(401).json({
      error: 'ADMIN_TOKEN not configured. Set ADMIN_TOKEN in .env to enable API access.',
    });
    return;
  }

  const provided =
    (req.headers['x-admin-token'] as string) ||
    (req.query.token as string) ||
    '';

  if (provided === token) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized. Требуется ADMIN_TOKEN.' });
}
