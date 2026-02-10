/**
 * confirmation.ts — менеджер токенов подтверждения для опасных операций (CONFIRM).
 * Токен: 6 символов, живёт TTL мс (по умолчанию 3 мин). Одноразовый.
 */

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** token -> expiry timestamp (Date.now() + ttl) */
const tokens = new Map<string, number>();

/**
 * Генерирует случайный токен из 6 символов (без похожих: 0/O, 1/I).
 */
export function generateToken(): string {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return s;
}

/**
 * Сохраняет токен с временем жизни ttlMs. Возвращает сам токен.
 */
export function addToken(ttlMs: number): string {
  const token = generateToken();
  tokens.set(token, Date.now() + ttlMs);
  return token;
}

/**
 * Проверяет токен: есть в памяти и не истёк. Если ОК — удаляет (одноразовый) и возвращает true.
 * Иначе возвращает false.
 */
export function consumeToken(token: string): boolean {
  const expiry = tokens.get(token);
  if (expiry === undefined) return false;
  if (Date.now() > expiry) {
    tokens.delete(token);
    return false;
  }
  tokens.delete(token);
  return true;
}
