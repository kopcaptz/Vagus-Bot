import type { ImageAttachment } from '../ai/models.js';

// ============================================
// Callback для статуса обработки (live typing)
// ============================================

/** Вызывается роутером/AI для уведомления канала о прогрессе */
export type StatusCallback = (status: string) => Promise<void>;

// ============================================
// Входящее сообщение (единый формат для всех каналов)
// ============================================

export interface IncomingMessage {
  /** ID канала: "telegram" | "web" | ... */
  channelId: string;
  /** ID чата / диалога */
  chatId: string;
  /** ID пользователя */
  userId: string;
  /** Username (@username) */
  username?: string;
  /** Имя пользователя */
  firstName?: string;
  /** Фамилия */
  lastName?: string;
  /** Текст сообщения */
  text: string;
  /** Изображения (Vision) */
  images?: ImageAttachment[];
  /** Оригинальный объект канала (grammY Context, Express req и т.п.) */
  raw?: unknown;
  /** Callback для live-статуса (Telegram: editMessage, Web: ignore) */
  onStatus?: StatusCallback;
}

// ============================================
// Результат обработки сообщения
// ============================================

export interface MessageResult {
  /** Текст ответа */
  text: string;
  /** Использованная модель */
  model?: string;
  /** Провайдер (openai / anthropic) */
  provider?: string;
  /** Использовано токенов */
  tokensUsed?: number;
  /** Количество сообщений контекста */
  contextUsed?: number;
  /** Контекст включён */
  contextEnabled?: boolean;
  /** Всего сообщений в контексте (включая системный промпт) */
  contextTotal?: number;
}

// ============================================
// Исходящее сообщение
// ============================================

export interface OutgoingMessage {
  chatId: string;
  text: string;
}

// ============================================
// Плагин канала
// ============================================

export interface ChannelPlugin {
  /** Уникальный ID: "telegram", "web", "discord", ... */
  readonly id: string;
  /** Человекочитаемое имя */
  readonly name: string;
  /** Запуск канала (подключение, старт polling и т.п.) */
  start(): Promise<void>;
  /** Остановка канала */
  stop(): Promise<void>;
  /** Отправить сообщение в канал (push-модель: Telegram, Discord). Для request-response каналов (web) — no-op */
  sendMessage(msg: OutgoingMessage): Promise<void>;
}

// ============================================
// Обработчик сообщений (чистая функция: вход → результат)
// ============================================

/**
 * MessageHandler — чистая функция.
 * Принимает IncomingMessage, возвращает MessageResult.
 * Не отправляет ответ сама — это делает канал.
 */
export type MessageHandler = (msg: IncomingMessage) => Promise<MessageResult | null>;
