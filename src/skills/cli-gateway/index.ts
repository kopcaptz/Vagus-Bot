/**
 * index.ts — CliGatewaySkill (Фаза 1: Скелет).
 *
 * Безопасный шлюз для выполнения CLI-команд оркестратором Vagus.
 * Vagus не имеет прямого доступа к shell — только структурированный JSON.
 *
 * Фаза 1: валидация входных данных + заглушка (всегда BLOCKED).
 * Реальный запуск процессов, Trusted Path Resolver, санитайзер — в следующих фазах.
 */

import type { Skill, ToolDefinition } from '../types.js';
import type { CliRequest, CliResponse, CliResponseError } from './types.js';
import { cliGatewayConfig } from './config.js';

// ============================================
// Константы
// ============================================

const TOOL_EXECUTE = 'system_cli_gateway';
const TOOL_CONFIRM = 'system_cli_gateway_confirm';
const TOOL_STATUS  = 'system_cli_gateway_status';

const LOG_PREFIX = '[cli-gateway]';

// ============================================
// Валидация входных данных
// ============================================

type ValidationResult = {
  ok: true;
  request: CliRequest;
} | {
  ok: false;
  error: CliResponseError;
};

/**
 * Валидирует и парсит сырые аргументы от AI в типизированный CliRequest.
 * Проверяет типы, обязательные поля, формат.
 */
function validateCliRequest(args: Record<string, unknown>): ValidationResult {
  // --- executable ---
  if (typeof args.executable !== 'string' || !args.executable.trim()) {
    return {
      ok: false,
      error: {
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Field "executable" is required and must be a non-empty string.',
      },
    };
  }
  const executable = args.executable.trim();

  // Защита: executable не должен содержать путей / слэшей
  if (/[/\\]/.test(executable)) {
    return {
      ok: false,
      error: {
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Field "executable" must be a binary name (e.g. "git"), not a path.',
      },
    };
  }

  // --- args ---
  let parsedArgs: string[] = [];
  if (args.args !== undefined && args.args !== null) {
    if (!Array.isArray(args.args)) {
      return {
        ok: false,
        error: {
          ok: false,
          error: 'VALIDATION_ERROR',
          message: 'Field "args" must be an array of strings.',
        },
      };
    }
    for (let i = 0; i < args.args.length; i++) {
      const item = args.args[i];
      if (typeof item !== 'string') {
        return {
          ok: false,
          error: {
            ok: false,
            error: 'VALIDATION_ERROR',
            message: `Field "args[${i}]" must be a string, got ${typeof item}.`,
          },
        };
      }
    }
    parsedArgs = args.args as string[];
  }

  // --- cwd ---
  const cwd = typeof args.cwd === 'string' ? args.cwd.trim() || '.' : '.';

  // --- confirm_token ---
  let confirmToken: string | null = null;
  if (args.confirm_token !== undefined && args.confirm_token !== null) {
    if (typeof args.confirm_token !== 'string') {
      return {
        ok: false,
        error: {
          ok: false,
          error: 'VALIDATION_ERROR',
          message: 'Field "confirm_token" must be a string or null.',
        },
      };
    }
    confirmToken = args.confirm_token;
  }

  return {
    ok: true,
    request: {
      executable,
      args: parsedArgs,
      cwd,
      confirm_token: confirmToken,
    },
  };
}

/**
 * Валидирует аргументы для system_cli_gateway_confirm.
 */
function validateConfirmArgs(args: Record<string, unknown>): { ok: true; token: string } | { ok: false; error: CliResponseError } {
  if (typeof args.confirm_token !== 'string' || !args.confirm_token.trim()) {
    return {
      ok: false,
      error: {
        ok: false,
        error: 'VALIDATION_ERROR',
        message: 'Field "confirm_token" is required and must be a non-empty string.',
      },
    };
  }
  return { ok: true, token: args.confirm_token.trim() };
}

// ============================================
// Stub-ответ (Фаза 1)
// ============================================

function makeBlockedResponse(reason: string): CliResponseError {
  return {
    ok: false,
    error: 'NOT_IMPLEMENTED',
    message: reason,
  };
}

function makeStatusResponse(): string {
  const cfg = cliGatewayConfig;
  const allowedBinaries = Object.keys(cfg.allowlist);
  return JSON.stringify({
    status: 'BLOCKED',
    mode: cfg.mode,
    allowlist: allowedBinaries,
    project_root: cfg.projectRoot,
    confirm_token_ttl_ms: cfg.confirmTokenTTL,
    timeout_ms: cfg.timeoutMs,
    phase: 'skeleton',
    note: 'CLI Gateway is in Phase 1 (skeleton). No commands are executed.',
  }, null, 2);
}

// ============================================
// CliGatewaySkill
// ============================================

export class CliGatewaySkill implements Skill {
  readonly id = 'cli-gateway';
  readonly name = 'CLI Gateway';
  readonly description = 'Безопасный шлюз для выполнения CLI-команд (shell-free, allowlist-based)';

  getTools(): ToolDefinition[] {
    return [
      {
        name: TOOL_EXECUTE,
        description:
          'Execute a CLI command through the secure gateway. ' +
          'Accepts a structured JSON request with executable name (from allowlist), ' +
          'args array, and cwd. No shell interpretation — shell operators (&&, |, >) are forbidden. ' +
          'Currently in Phase 1: always returns BLOCKED.',
        parameters: {
          type: 'object',
          properties: {
            executable: {
              type: 'string',
              description: 'Name of the binary from the allowlist (e.g. "git", "npm"). NOT a path.',
            },
            args: {
              type: 'array',
              description: 'Array of string arguments (e.g. ["status", "--short"]). Each element is a separate argument.',
              items: { type: 'string' },
            },
            cwd: {
              type: 'string',
              description: 'Working directory relative to project root (default: ".").',
            },
            confirm_token: {
              type: 'string',
              description: 'One-time confirmation token for dangerous operations (CONFIRM mode). Null if not needed.',
            },
          },
          required: ['executable', 'args'],
        },
      },
      {
        name: TOOL_CONFIRM,
        description:
          'Submit a confirmation token to approve a dangerous CLI operation ' +
          'that was previously blocked with CONFIRMATION_REQUIRED. ' +
          'Currently in Phase 1: always returns BLOCKED.',
        parameters: {
          type: 'object',
          properties: {
            confirm_token: {
              type: 'string',
              description: 'The one-time UUID token received from a previous CONFIRMATION_REQUIRED response.',
            },
          },
          required: ['confirm_token'],
        },
      },
      {
        name: TOOL_STATUS,
        description:
          'Get the current CLI Gateway status: security mode, available binaries, configuration.',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    switch (toolName) {

      // ────────────────────────────────────
      // system_cli_gateway — основной инструмент
      // ────────────────────────────────────
      case TOOL_EXECUTE: {
        const validation = validateCliRequest(args);

        if (!validation.ok) {
          console.log(`${LOG_PREFIX} Validation failed:`, validation.error.message);
          return JSON.stringify(validation.error, null, 2);
        }

        const req = validation.request;
        // Логируем запрос (stub — без санитайзера, Фаза 1)
        console.log(
          `${LOG_PREFIX} Request: ${req.executable} [${req.args.join(', ')}] cwd=${req.cwd}` +
          (req.confirm_token ? ' (with confirm_token)' : ''),
        );

        // Фаза 1: всегда BLOCKED
        const response = makeBlockedResponse(
          `Phase 1 stub. Mode: ${cliGatewayConfig.mode}. ` +
          `Command "${req.executable} ${req.args.join(' ')}" was validated but not executed.`,
        );
        return JSON.stringify(response, null, 2);
      }

      // ────────────────────────────────────
      // system_cli_gateway_confirm — подтверждение
      // ────────────────────────────────────
      case TOOL_CONFIRM: {
        const validation = validateConfirmArgs(args);

        if (!validation.ok) {
          console.log(`${LOG_PREFIX} Confirm validation failed:`, validation.error.message);
          return JSON.stringify(validation.error, null, 2);
        }

        console.log(`${LOG_PREFIX} Confirm token received: ${validation.token.substring(0, 8)}...`);

        // Фаза 1: всегда BLOCKED
        const response = makeBlockedResponse(
          'Phase 1 stub. Confirmation token validation is not implemented yet.',
        );
        return JSON.stringify(response, null, 2);
      }

      // ────────────────────────────────────
      // system_cli_gateway_status — статус
      // ────────────────────────────────────
      case TOOL_STATUS: {
        console.log(`${LOG_PREFIX} Status requested`);
        return makeStatusResponse();
      }

      default:
        return JSON.stringify({
          ok: false,
          error: 'VALIDATION_ERROR',
          message: `Unknown tool in CliGatewaySkill: ${toolName}`,
        }, null, 2);
    }
  }
}
