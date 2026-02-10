/**
 * types.ts — Типы и контракты для CLI Gateway.
 *
 * Определяет режимы безопасности, формат запросов/ответов,
 * структуру allowlist бинарников.
 */

// ============================================
// Режимы безопасности (State Machine)
// ============================================

/** Режим безопасности gateway. Задаётся через ENV при старте, неизменяем в runtime. */
export type GatewayMode = 'OFF' | 'SAFE' | 'LIMITED' | 'CONFIRM';

/** Все допустимые значения режима (для валидации env) */
export const VALID_MODES: readonly GatewayMode[] = ['OFF', 'SAFE', 'LIMITED', 'CONFIRM'] as const;

// ============================================
// Allowlist бинарников
// ============================================

/**
 * Определение разрешённого бинарника.
 * Путь определяется через Trusted Resolver (where/which + проверка доверенной директории).
 * Vagus шлёт только имя — путь НИКОГДА не принимается извне.
 */
export interface BinaryDef {
  /** Имя бинарника (e.g. "git"). */
  name: string;
  /**
   * (Опционально) Явный путь-override из .env.
   * Trusted Resolver всё равно проверяет, что путь в доверенной директории.
   */
  pathOverride?: string;
  /** В каких режимах доступен */
  modes: Exclude<GatewayMode, 'OFF'>[];
  /** Подкоманды, разрешённые в каждом режиме */
  commands: {
    SAFE?: string[][];
    LIMITED?: string[][];
    CONFIRM?: string[][];
  };
}

// ============================================
// Запрос от Vagus (JSON-контракт)
// ============================================

/** Структурированный запрос на выполнение CLI-команды */
export interface CliRequest {
  /** Имя бинарника из allowlist (e.g. "git", "npm"). Не путь! */
  executable: string;
  /** Массив аргументов (e.g. ["status", "--short"]). Никаких строковых команд. */
  args: string[];
  /** Рабочая директория относительно projectRoot (e.g. ".", "src/") */
  cwd: string;
  /** Токен подтверждения для операций в режиме CONFIRM (null если не требуется) */
  confirm_token: string | null;
}

// ============================================
// Ответы gateway
// ============================================

/** Успешный результат выполнения */
export interface CliResponseOk {
  ok: true;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
}

/** Ошибка / блокировка */
export interface CliResponseError {
  ok: false;
  error: CliErrorCode;
  message: string;
  /** Только для EXECUTABLE_NOT_ALLOWED — список доступных бинарников */
  allowed?: string[];
  /** Только для CONFIRMATION_REQUIRED — токен для подтверждения */
  confirm_token?: string;
  /** Только для CONFIRMATION_REQUIRED — TTL токена в мс */
  expires_in_ms?: number;
}

export type CliResponse = CliResponseOk | CliResponseError;

/** Типизированные коды ошибок */
export type CliErrorCode =
  | 'KILL_SWITCH_ACTIVE'
  | 'MODE_OFF'
  | 'EXECUTABLE_NOT_ALLOWED'
  | 'COMMAND_NOT_ALLOWED'
  | 'CWD_OUTSIDE_SANDBOX'
  | 'SHELL_INJECTION_DETECTED'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_CONFIRM_TOKEN'
  | 'UNTRUSTED_BINARY_PATH'
  | 'VALIDATION_ERROR'
  | 'EXECUTION_ERROR'
  | 'TIMEOUT'
  | 'NOT_IMPLEMENTED';

// ============================================
// Конфигурация
// ============================================

/** Конфигурация CLI Gateway (из env) */
export interface CliGatewayConfig {
  /** Режим безопасности */
  mode: GatewayMode;
  /** Корневая директория проекта (sandbox для cwd) */
  projectRoot: string;
  /** Имя файла kill-switch */
  stopFlagFile: string;
  /** Env-переменная kill-switch */
  killEnvVar: string;
  /** Allowlist бинарников */
  allowlist: Record<string, BinaryDef>;
  /** Доверенные директории для бинарников (системные + дополнительные из env) */
  trustedDirs: string[];
  /** TTL токена подтверждения (мс) */
  confirmTokenTTL: number;
  /** Таймаут выполнения команды (мс) */
  timeoutMs: number;
}
