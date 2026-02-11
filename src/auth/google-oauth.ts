/**
 * google-oauth.ts — Управление OAuth-токенами Google (Gemini API).
 *
 * Безопасное хранение:
 *  - Токены шифруются AES-256-GCM перед записью на диск.
 *  - Ключ шифрования = SHA-256(ADMIN_TOKEN || fallback-secret).
 *  - Файл хранится в .google-oauth-tokens.json (добавлен в .gitignore).
 *
 * Lifecycle:
 *  - connect:    сохранить tokens после OAuth callback
 *  - refresh:    обновить access_token по refresh_token
 *  - disconnect: удалить токены, revoke у Google
 *  - getStatus:  подключено / истекло / нужно перелогиниться
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { config } from '../config/config.js';

// ─── Types ───────────────────────────────────────────────────────

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;       // Unix ms
  token_type: string;
  scope: string;
}

export type OAuthStatus = 'connected' | 'expired' | 'needs_reauth' | 'disconnected';

export interface OAuthStatusInfo {
  status: OAuthStatus;
  expiresAt?: number;
  /** Сколько осталось до истечения (мс) */
  expiresIn?: number;
  message: string;
}

// ─── Constants ───────────────────────────────────────────────────

const TOKEN_FILE = join(process.cwd(), '.google-oauth-tokens.json');
const ALGORITHM = 'aes-256-gcm';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
/** Обновляем за 5 минут до истечения */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// ─── Encryption helpers ──────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const secret = config.security.adminToken || 'vagus-default-secret-change-me';
  return createHash('sha256').update(secret).digest();
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return JSON.stringify({ iv: iv.toString('hex'), tag, data: encrypted });
}

function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const { iv, tag, data } = JSON.parse(ciphertext);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ─── Token storage ───────────────────────────────────────────────

function saveTokens(tokens: GoogleTokens): void {
  const encrypted = encrypt(JSON.stringify(tokens));
  writeFileSync(TOKEN_FILE, encrypted, 'utf-8');
}

function loadTokens(): GoogleTokens | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    const raw = readFileSync(TOKEN_FILE, 'utf-8');
    const decrypted = decrypt(raw);
    return JSON.parse(decrypted) as GoogleTokens;
  } catch (err) {
    console.error('⚠️ Не удалось расшифровать Google OAuth токены:', (err as Error).message);
    return null;
  }
}

function deleteTokens(): void {
  if (existsSync(TOKEN_FILE)) {
    unlinkSync(TOKEN_FILE);
  }
}

// ─── Public API ──────────────────────────────────────────────────

/**
 * Получить Google OAuth config из env.
 * Возвращает null если не настроен.
 */
export function getGoogleOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) return null;

  const port = config.server.port;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI
    || `http://localhost:${port}/auth/google/callback`;

  return { clientId, clientSecret, redirectUri };
}

/**
 * Сгенерировать URL для начала OAuth-авторизации Google.
 */
export function getGoogleAuthUrl(): string | null {
  const oauthConfig = getGoogleOAuthConfig();
  if (!oauthConfig) return null;

  const params = new URLSearchParams({
    client_id: oauthConfig.clientId,
    redirect_uri: oauthConfig.redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/generative-language',
    access_type: 'offline',
    prompt: 'consent',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Обменять authorization code на токены.
 */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const oauthConfig = getGoogleOAuthConfig();
  if (!oauthConfig) throw new Error('Google OAuth не настроен (нет GOOGLE_OAUTH_CLIENT_ID/SECRET)');

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: oauthConfig.clientId,
      client_secret: oauthConfig.clientSecret,
      redirect_uri: oauthConfig.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as any;
    throw new Error(`Google token exchange failed: ${error?.error_description || error?.error || response.statusText}`);
  }

  const data = await response.json() as any;

  const tokens: GoogleTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
    token_type: data.token_type || 'Bearer',
    scope: data.scope || '',
  };

  saveTokens(tokens);
  console.log('✅ Google OAuth токены сохранены (зашифрованы)');
  return tokens;
}

/**
 * Обновить access_token по refresh_token.
 */
export async function refreshAccessToken(): Promise<GoogleTokens | null> {
  const tokens = loadTokens();
  if (!tokens?.refresh_token) return null;

  const oauthConfig = getGoogleOAuthConfig();
  if (!oauthConfig) return null;

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: oauthConfig.clientId,
        client_secret: oauthConfig.clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as any;
      console.error('❌ Google token refresh failed:', error?.error_description || error?.error);
      // Если refresh_token невалиден — нужно перелогиниться
      if (error?.error === 'invalid_grant') {
        return null; // status = needs_reauth
      }
      return null;
    }

    const data = await response.json() as any;

    const updated: GoogleTokens = {
      access_token: data.access_token,
      // Google не всегда возвращает новый refresh_token — сохраняем старый
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
      token_type: data.token_type || 'Bearer',
      scope: data.scope || tokens.scope,
    };

    saveTokens(updated);
    console.log('🔄 Google OAuth access_token обновлён');
    return updated;
  } catch (err) {
    console.error('❌ Ошибка обновления Google OAuth токена:', (err as Error).message);
    return null;
  }
}

/**
 * Получить валидный access_token (с автоматическим refresh при необходимости).
 * Возвращает null если нет токенов или не удалось обновить.
 */
export async function getValidAccessToken(): Promise<string | null> {
  let tokens = loadTokens();
  if (!tokens) return null;

  // Если access_token ещё валиден (с запасом)
  if (tokens.expires_at > Date.now() + REFRESH_MARGIN_MS) {
    return tokens.access_token;
  }

  // Пробуем обновить
  tokens = await refreshAccessToken();
  return tokens?.access_token ?? null;
}

/**
 * Проверить статус Google OAuth.
 */
export function getOAuthStatus(): OAuthStatusInfo {
  const tokens = loadTokens();

  if (!tokens) {
    return { status: 'disconnected', message: 'Не подключено' };
  }

  const now = Date.now();
  const expiresIn = tokens.expires_at - now;

  if (expiresIn <= 0) {
    // Истёк, но есть refresh_token — можно обновить
    if (tokens.refresh_token) {
      return {
        status: 'expired',
        expiresAt: tokens.expires_at,
        expiresIn: 0,
        message: 'Токен истёк — будет обновлён автоматически',
      };
    }
    return {
      status: 'needs_reauth',
      expiresAt: tokens.expires_at,
      expiresIn: 0,
      message: 'Токен истёк — нужно перелогиниться',
    };
  }

  return {
    status: 'connected',
    expiresAt: tokens.expires_at,
    expiresIn,
    message: `Подключено (истекает через ${Math.round(expiresIn / 60000)} мин.)`,
  };
}

/**
 * Отключить Google OAuth — удалить токены и отозвать у Google.
 */
export async function disconnectGoogle(): Promise<void> {
  const tokens = loadTokens();

  if (tokens?.access_token) {
    try {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${tokens.access_token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      console.log('🔓 Google OAuth token revoked');
    } catch {
      // Не критично — удаляем локально в любом случае
    }
  }

  deleteTokens();
  console.log('🔓 Google OAuth токены удалены');
}

/**
 * Подключить Google OAuth вручную (для случая, когда токены получены внешне).
 */
export function connectWithTokens(accessToken: string, refreshToken: string, expiresIn: number): void {
  const tokens: GoogleTokens = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Date.now() + expiresIn * 1000,
    token_type: 'Bearer',
    scope: 'https://www.googleapis.com/auth/generative-language',
  };
  saveTokens(tokens);
  console.log('✅ Google OAuth токены сохранены вручную');
}

/**
 * Проверить, настроен ли Google OAuth (есть client_id + client_secret).
 */
export function isGoogleOAuthConfigured(): boolean {
  return getGoogleOAuthConfig() !== null;
}
