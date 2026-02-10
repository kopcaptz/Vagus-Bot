/**
 * auth.ts — Express middleware для авторизации по токену.
 *
 * Если ADMIN_TOKEN не задан — доступ открыт.
 * Если задан — проверяет заголовок X-Admin-Token или query-параметр ?token=...
 */

import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { config } from '../config/config.js';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = config.security.adminToken;

  // Токен не настроен — авторизация отключена
  if (!token) {
    next();
    return;
  }

  const provided =
    (req.headers['x-admin-token'] as string) ||
    (req.query.token as string) ||
    '';

  // Используем timingSafeEqual для защиты от timing attacks.
  // Сравниваем хэши, чтобы избежать утечки длины токена.
  const tokenHash = crypto.createHash('sha256').update(token).digest();
  const providedHash = crypto.createHash('sha256').update(provided).digest();

  if (crypto.timingSafeEqual(tokenHash, providedHash)) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized. Требуется ADMIN_TOKEN.' });
}
