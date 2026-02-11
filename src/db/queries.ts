import db from './database.js';
import type { Message, User, Session } from './types.js';

// ============================================
// СООБЩЕНИЯ (Messages)
// ============================================

/**
 * Сохранить сообщение пользователя или бота
 */
export function saveMessage(params: {
  message_id?: string;
  chat_id: string;
  user_id: string;
  username?: string;
  message_text: string;
  is_bot?: boolean;
  ai_model?: string;
  ai_provider?: string;
}): number {
  const stmt = db.prepare(`
    INSERT INTO messages (message_id, chat_id, user_id, username, message_text, is_bot, ai_model, ai_provider)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    params.message_id || null,
    params.chat_id,
    params.user_id,
    params.username || null,
    params.message_text,
    params.is_bot ? 1 : 0,
    params.ai_model || null,
    params.ai_provider || null
  );

  console.log(`💾 Сообщение сохранено: ID=${result.lastInsertRowid}, chat=${params.chat_id}, user=${params.user_id}`);
  return Number(result.lastInsertRowid);
}

/**
 * Получить историю сообщений для чата
 */
export function getMessageHistory(chatId: string, limit: number = 50): Message[] {
  const stmt = db.prepare(`
    SELECT * FROM messages
    WHERE chat_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);

  const messages = stmt.all(chatId, limit) as Message[];
  
  // Конвертируем is_bot из числа в boolean
  return messages.map(msg => ({
    ...msg,
    is_bot: Boolean(msg.is_bot),
  })).reverse(); // Разворачиваем, чтобы старые сообщения были сначала
}

/**
 * Получить последние N сообщений для чата (для контекста AI)
 */
export function getRecentMessages(chatId: string, limit: number = 10): Message[] {
  const stmt = db.prepare(`
    SELECT * FROM messages
    WHERE chat_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);

  const messages = stmt.all(chatId, limit) as Message[];
  
  return messages.map(msg => ({
    ...msg,
    is_bot: Boolean(msg.is_bot),
  })).reverse();
}

/**
 * Получить общее количество сообщений в чате
 */
export function getMessageCount(chatId: string): number {
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM messages WHERE chat_id = ?
  `);

  const result = stmt.get(chatId) as { count: number };
  return result.count;
}

// ============================================
// ПОЛЬЗОВАТЕЛИ (Users)
// ============================================

/**
 * Создать или обновить пользователя
 */
export function createOrUpdateUser(params: {
  user_id: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}): void {
  const stmt = db.prepare(`
    INSERT INTO users (user_id, username, first_name, last_name, last_seen, message_count)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 1)
    ON CONFLICT(user_id) DO UPDATE SET
      username = COALESCE(excluded.username, username),
      first_name = COALESCE(excluded.first_name, first_name),
      last_name = COALESCE(excluded.last_name, last_name),
      last_seen = CURRENT_TIMESTAMP,
      message_count = message_count + 1
  `);

  stmt.run(
    params.user_id,
    params.username || null,
    params.first_name || null,
    params.last_name || null
  );
}

/**
 * Получить информацию о пользователе
 */
export function getUser(userId: string): User | null {
  const stmt = db.prepare(`
    SELECT * FROM users WHERE user_id = ?
  `);

  return stmt.get(userId) as User | null;
}

/**
 * Получить всех пользователей
 */
export function getAllUsers(): User[] {
  const stmt = db.prepare(`
    SELECT * FROM users ORDER BY last_seen DESC
  `);

  return stmt.all() as User[];
}

// ============================================
// СЕССИИ (Sessions)
// ============================================

/**
 * Создать или обновить сессию
 */
export function createOrUpdateSession(params: {
  chat_id: string;
  user_id?: string;
}): void {
  const session_id = `session_${params.chat_id}_${Date.now()}`;

  const stmt = db.prepare(`
    INSERT INTO sessions (session_id, chat_id, user_id, last_message_at, message_count)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1)
    ON CONFLICT(chat_id) DO UPDATE SET
      last_message_at = CURRENT_TIMESTAMP,
      message_count = message_count + 1
  `);

  stmt.run(
    session_id,
    params.chat_id,
    params.user_id || null
  );
}

/**
 * Получить информацию о сессии
 */
export function getSession(chatId: string): Session | null {
  const stmt = db.prepare(`
    SELECT * FROM sessions WHERE chat_id = ?
  `);

  return stmt.get(chatId) as Session | null;
}

/**
 * Получить все активные сессии (с сообщениями за последние 24 часа)
 */
export function getActiveSessions(): Session[] {
  const stmt = db.prepare(`
    SELECT * FROM sessions
    WHERE last_message_at > datetime('now', '-24 hours')
    ORDER BY last_message_at DESC
  `);

  return stmt.all() as Session[];
}

// ============================================
// СТАТИСТИКА
// ============================================

/**
 * Получить общую статистику БД
 */
export function getDatabaseStats() {
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number };
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  const totalSessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
  const activeSessions = getActiveSessions().length;

  return {
    totalMessages: totalMessages.count,
    totalUsers: totalUsers.count,
    totalSessions: totalSessions.count,
    activeSessions,
  };
}

// ============================================
// ИСТОРИЯ (Advanced history + cleanup)
// ============================================

export interface HistoryFilter {
  limit?: number;
  offset?: number;
  role?: 'user' | 'bot';
  startDate?: string;
  endDate?: string;
  search?: string;
}

/**
 * Продвинутое получение истории (фильтры + пагинация)
 */
export function getChatHistoryAdvanced(chatId: string, options: HistoryFilter = {}) {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  let query = 'SELECT * FROM messages WHERE chat_id = ?';
  const params: Array<string | number> = [chatId];

  if (options.role) {
    query += ' AND is_bot = ?';
    params.push(options.role === 'bot' ? 1 : 0);
  }

  if (options.startDate) {
    query += ' AND created_at >= ?';
    params.push(options.startDate);
  }

  if (options.endDate) {
    query += ' AND created_at <= ?';
    params.push(options.endDate);
  }

  if (options.search) {
    query += ' AND message_text LIKE ?';
    params.push(`%${options.search}%`);
  }

  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
  const totalResult = db.prepare(countQuery).get(...params) as { total: number };

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as Message[];

  return {
    messages: rows.map(msg => ({
      ...msg,
      is_bot: Boolean(msg.is_bot),
    })),
    total: totalResult.total,
    limit,
    offset,
  };
}

/**
 * Очистка истории чата
 */
export function clearChatHistory(chatId: string): number {
  const stmt = db.prepare('DELETE FROM messages WHERE chat_id = ?');
  const info = stmt.run(chatId);

  db.prepare('UPDATE sessions SET message_count = 0 WHERE chat_id = ?').run(chatId);

  return info.changes;
}

/**
 * Удаление старых сообщений
 */
export function cleanupOldMessages(days: number): number {
  const stmt = db.prepare(`
    DELETE FROM messages 
    WHERE created_at < datetime('now', '-' || ? || ' days')
  `);
  const info = stmt.run(days);
  return info.changes;
}
