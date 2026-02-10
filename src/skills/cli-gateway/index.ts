/**
 * index.ts — CliGatewaySkill (Фаза 2: Safe Executor).
 *
 * Безопасный шлюз для выполнения CLI-команд: where/which + trusted path,
 * spawn с shell: false, санитайзер вывода, режим SAFE (только read-only команды).
 */

import path from 'path';
import { spawn } from 'child_process';
import type { Skill, ToolDefinition } from '../types.js';
import type { CliRequest, CliResponseOk, CliResponseError } from './types.js';
import { cliGatewayConfig } from './config.js';
import { resolveExecutable, TRUSTED_PATH_VIOLATION } from './path-resolver.js';
import { scrubSecrets } from './sanitizer.js';
import { addToken, consumeToken } from './confirmation.js';

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
// Ошибки и ответы
// ============================================

function makeErrorResponse(error: CliResponseError['error'], message: string, extra?: Partial<CliResponseError>): CliResponseError {
  return { ok: false, error, message, ...extra };
}

/** Команда входит в список SAFE (read-only). */
function isCommandInSafeList(executable: string, args: string[]): boolean {
  const def = cliGatewayConfig.allowlist[executable];
  const list = def?.commands?.SAFE;
  if (!list?.length) return false;
  return list.some((cmdList) => args.length >= cmdList.length && cmdList.every((c, i) => args[i] === c));
}

/** Команда входит в список LIMITED (safe write, e.g. git add, git commit). */
function isCommandInLimitedList(executable: string, args: string[]): boolean {
  const def = cliGatewayConfig.allowlist[executable];
  const list = def?.commands?.LIMITED;
  if (!list?.length) return false;
  return list.some((cmdList) => args.length >= cmdList.length && cmdList.every((c, i) => args[i] === c));
}

/** Команда входит в список CONFIRM (dangerous: network/install, e.g. git push, npm install). */
function isCommandInConfirmList(executable: string, args: string[]): boolean {
  const def = cliGatewayConfig.allowlist[executable];
  const list = def?.commands?.CONFIRM;
  if (!list?.length) return false;
  return list.some((cmdList) => args.length >= cmdList.length && cmdList.every((c, i) => args[i] === c));
}

/** Разрешена ли команда в текущем режиме без токена (SAFE или LIMITED список). */
function isAllowedWithoutToken(mode: string, executable: string, args: string[]): boolean {
  if (mode === 'SAFE') return isCommandInSafeList(executable, args);
  if (mode === 'LIMITED' || mode === 'CONFIRM') return isCommandInSafeList(executable, args) || isCommandInLimitedList(executable, args);
  return false;
}

/** Требуется ли токен подтверждения (dangerous команда в режиме LIMITED или CONFIRM). */
function needsConfirmation(mode: string, executable: string, args: string[]): boolean {
  return (mode === 'LIMITED' || mode === 'CONFIRM') && isCommandInConfirmList(executable, args);
}

/** Разрешить cwd относительно projectRoot; убедиться, что не выходим за пределы песочницы. */
function resolveCwd(cwd: string): { ok: true; path: string } | { ok: false; error: CliResponseError } {
  const projectRoot = cliGatewayConfig.projectRoot;
  const resolved = path.resolve(projectRoot, cwd);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return {
      ok: false,
      error: makeErrorResponse('CWD_OUTSIDE_SANDBOX', `Working directory must be inside project root: ${projectRoot}`),
    };
  }
  return { ok: true, path: resolved };
}

/**
 * Запуск бинарника: spawn с shell: false, аргументы массивом, таймаут, сбор stdout/stderr.
 * Возвращает санитизированный вывод.
 */
function runCommand(
  binaryPath: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const child = spawn(binaryPath, args, {
      cwd,
      shell: false,
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (err) => reject(err));
    child.on('close', (code, signal) => {
      const durationMs = Date.now() - start;
      resolve({
        exitCode: code ?? (signal ? -1 : 0),
        stdout,
        stderr,
        durationMs,
      });
    });
  });
}

function makeBlockedResponse(message: string): CliResponseError {
  return {
    ok: false,
    error: 'NOT_IMPLEMENTED',
    message,
  };
}

function makeStatusResponse(): string {
  const cfg = cliGatewayConfig;
  const allowedBinaries = Object.keys(cfg.allowlist);
  const phase = cfg.mode === 'OFF' ? 'skeleton' : 'safe_executor';
  const note =
    cfg.mode === 'OFF'
      ? 'CLI Gateway is OFF. Set CLI_GATEWAY_MODE=SAFE to allow read-only commands.'
      : 'CLI Gateway Phase 3: SAFE/LIMITED/CONFIRM. Dangerous commands (e.g. git push) require confirm_token from operator console.';
  return JSON.stringify({
    status: cfg.mode === 'OFF' ? 'BLOCKED' : 'ACTIVE',
    mode: cfg.mode,
    allowlist: allowedBinaries,
    project_root: cfg.projectRoot,
    confirm_token_ttl_ms: cfg.confirmTokenTTL,
    timeout_ms: cfg.timeoutMs,
    phase,
    note,
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
          'args array, and cwd. No shell (shell: false). In SAFE mode only read-only commands are allowed.',
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
          'Submit a confirmation token to approve a dangerous CLI operation. ' +
          'Pass the token in system_cli_gateway as confirm_token when retrying the same command.',
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
    console.log('⚡ [CLI Gateway] EXECUTE called with action:', toolName);
    switch (toolName) {

      // ────────────────────────────────────
      // system_cli_gateway — основной инструмент
      // ────────────────────────────────────
      case 'system_cli_gateway': {
        const validation = validateCliRequest(args);

        if (!validation.ok) {
          console.log(`${LOG_PREFIX} Validation failed:`, validation.error.message);
          return JSON.stringify(validation.error, null, 2);
        }

        const req = validation.request;
        const cfg = cliGatewayConfig;

        if (cfg.mode === 'OFF') {
          const err = makeErrorResponse('MODE_OFF', 'CLI Gateway is OFF. No commands are executed.');
          return JSON.stringify(err, null, 2);
        }

        if (!cfg.allowlist[req.executable]) {
          const err = makeErrorResponse('EXECUTABLE_NOT_ALLOWED', `Executable "${req.executable}" is not in allowlist.`, {
            allowed: Object.keys(cfg.allowlist),
          });
          return JSON.stringify(err, null, 2);
        }

        if (cfg.mode === 'SAFE' && !isCommandInSafeList(req.executable, req.args)) {
          const err = makeErrorResponse(
            'COMMAND_NOT_ALLOWED',
            `Mode is SAFE. Command "${req.executable} ${req.args.join(' ')}" is not in the read-only (SAFE) list.`,
          );
          return JSON.stringify(err, null, 2);
        }

        if ((cfg.mode === 'LIMITED' || cfg.mode === 'CONFIRM') && !isAllowedWithoutToken(cfg.mode, req.executable, req.args) && !needsConfirmation(cfg.mode, req.executable, req.args)) {
          const err = makeErrorResponse(
            'COMMAND_NOT_ALLOWED',
            `Command "${req.executable} ${req.args.join(' ')}" is not allowed in mode ${cfg.mode}.`,
          );
          return JSON.stringify(err, null, 2);
        }

        if (needsConfirmation(cfg.mode, req.executable, req.args)) {
          if (!req.confirm_token || !req.confirm_token.trim()) {
            const token = addToken(cfg.confirmTokenTTL);
            console.error(`[SECURITY ALERT] Action requires confirmation. Token: ${token}.`);
            const err = makeErrorResponse('CONFIRMATION_REQUIRED', 'Requires token. Check operator console.', {
              confirm_token: token,
              expires_in_ms: cfg.confirmTokenTTL,
            });
            return JSON.stringify(err, null, 2);
          }
          if (!consumeToken(req.confirm_token.trim())) {
            const err = makeErrorResponse('INVALID_CONFIRM_TOKEN', 'Token is invalid or expired. Request a new one.');
            return JSON.stringify(err, null, 2);
          }
        }

        const cwdResult = resolveCwd(req.cwd);
        if (!cwdResult.ok) return JSON.stringify(cwdResult.error, null, 2);

        let binaryPath: string;
        try {
          binaryPath = await resolveExecutable(req.executable);
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (code === TRUSTED_PATH_VIOLATION) {
            const msg = err instanceof Error ? err.message : String(err);
            return JSON.stringify(makeErrorResponse('UNTRUSTED_BINARY_PATH', msg), null, 2);
          }
          return JSON.stringify(
            makeErrorResponse('EXECUTION_ERROR', err instanceof Error ? err.message : String(err)),
            null,
            2,
          );
        }

        const logLine = `${req.executable} [${req.args.join(', ')}] cwd=${req.cwd}`;
        console.log(`${LOG_PREFIX} Request: ${logLine}`);

        try {
          const { exitCode, stdout, stderr, durationMs } = await runCommand(
            binaryPath,
            req.args,
            cwdResult.path,
            cfg.timeoutMs,
          );

          const scrubbedStdout = scrubSecrets(stdout);
          const scrubbedStderr = scrubSecrets(stderr);
          console.log(`${LOG_PREFIX} Exit ${exitCode} in ${durationMs}ms. stdout (scrubbed):`, scrubbedStdout.slice(0, 200));

          const okResponse: CliResponseOk = {
            ok: true,
            exit_code: exitCode,
            stdout: scrubbedStdout,
            stderr: scrubbedStderr,
            duration_ms: durationMs,
          };
          return JSON.stringify(okResponse, null, 2);
        } catch (err: unknown) {
          const isTimeout = (err as { code?: string })?.code === 'ETIMEDOUT' || (err as { killed?: boolean })?.killed;
          if (isTimeout) {
            return JSON.stringify(makeErrorResponse('TIMEOUT', `Command timed out after ${cfg.timeoutMs}ms.`), null, 2);
          }
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify(makeErrorResponse('EXECUTION_ERROR', msg), null, 2);
        }
      }

      // ────────────────────────────────────
      // system_cli_gateway_confirm — подтверждение
      // ────────────────────────────────────
      case 'system_cli_gateway_confirm': {
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
      case 'system_cli_gateway_status': {
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
