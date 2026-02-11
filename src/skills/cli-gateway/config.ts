/**
 * config.ts — Конфигурация CLI Gateway.
 *
 * Читает настройки из ENV при старте. Режим фиксирован на весь lifecycle процесса.
 * Никакого runtime-переключения, никаких HTTP-эндпоинтов.
 */

import fs from 'fs';
import path from 'path';
import type { GatewayMode, BinaryDef, CliGatewayConfig } from './types.js';
import { VALID_MODES } from './types.js';

// ============================================
// ENV helpers
// ============================================

function env(key: string, fallback = ''): string {
  return process.env[key] || fallback;
}

// ============================================
// Режим безопасности
// ============================================

function parseMode(raw: string): GatewayMode {
  const upper = raw.trim().toUpperCase();
  if (VALID_MODES.includes(upper as GatewayMode)) {
    return upper as GatewayMode;
  }
  // Невалидное значение → OFF (безопасный дефолт)
  if (raw) {
    console.warn(`[cli-gateway] Невалидный CLI_GATEWAY_MODE="${raw}", используем OFF`);
  }
  return 'OFF';
}

// ============================================
// Доверенные директории
// ============================================

/** Системные доверенные директории (платформо-зависимые) */
function getDefaultTrustedDirs(): string[] {
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files',
      'C:\\Program Files (x86)',
      'C:\\Windows\\System32',
    ];
  }
  return [
    '/usr/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
}

/** Дополнительные директории из env CLI_GATEWAY_TRUSTED_DIRS (через запятую) */
function getExtraTrustedDirs(): string[] {
  const raw = env('CLI_GATEWAY_TRUSTED_DIRS');
  if (!raw) return [];
  return raw
    .split(',')
    .map(d => d.trim())
    .filter(Boolean)
    .map(d => path.resolve(d));
}

// ============================================
// Allowlist бинарников (по умолчанию)
// ============================================

function buildDefaultAllowlist(): Record<string, BinaryDef> {
  return {
    git: {
      name: 'git',
      pathOverride: env('CLI_GATEWAY_GIT_PATH') || undefined,
      modes: ['SAFE', 'LIMITED', 'CONFIRM'],
      commands: {
        SAFE: [['status'], ['log'], ['diff'], ['branch'], ['show'], ['tag']],
        LIMITED: [['add'], ['commit'], ['checkout'], ['stash'], ['merge'], ['rebase']],
        CONFIRM: [['push'], ['pull'], ['clone'], ['reset'], ['clean']],
      },
    },
    npm: {
      name: 'npm',
      pathOverride: env('CLI_GATEWAY_NPM_PATH') || undefined,
      modes: ['SAFE', 'CONFIRM'],
      commands: {
        SAFE: [['list'], ['outdated'], ['run', '--list'], ['view'], ['ls']],
        CONFIRM: [['install'], ['update'], ['uninstall'], ['ci'], ['audit']],
      },
    },
    node: {
      name: 'node',
      pathOverride: env('CLI_GATEWAY_NODE_PATH') || undefined,
      modes: ['SAFE'],
      commands: {
        SAFE: [['--version'], ['-v'], ['-e']],
      },
    },
  };
}

// ============================================
// Сборка конфига (один раз при импорте)
// ============================================

function buildConfig(): CliGatewayConfig {
  const mode = parseMode(env('CLI_GATEWAY_MODE', 'OFF'));
  const projectRoot = path.resolve(process.cwd(), env('CLI_GATEWAY_PROJECT_ROOT', '.'));
  const stopFlagFile = 'STOP.flag';
  const killEnvVar = 'CLI_GATEWAY_KILL';
  const trustedDirs = [...getDefaultTrustedDirs(), ...getExtraTrustedDirs()];
  const confirmTokenTTL = Math.max(
    120_000, // минимум 2 мин
    Math.min(
      300_000, // максимум 5 мин
      parseInt(env('CLI_GATEWAY_CONFIRM_TTL', '180000'), 10) || 180_000,
    ),
  );
  const timeoutMs = Math.max(
    5_000,
    parseInt(env('CLI_GATEWAY_TIMEOUT_MS', '15000'), 10) || 15_000,
  );

  return {
    mode,
    projectRoot,
    stopFlagFile,
    killEnvVar,
    allowlist: buildDefaultAllowlist(),
    trustedDirs,
    confirmTokenTTL,
    timeoutMs,
  };
}

/** Конфиг CLI Gateway — singleton, инициализируется при первом импорте. */
export const cliGatewayConfig: CliGatewayConfig = buildConfig();

/**
 * Kill-switch проверяется на каждый вызов gateway (sync).
 * Любое срабатывание мгновенно переводит gateway в OFF-поведение.
 */
export function isKillSwitchActive(): boolean {
  const stopFlagPath = path.join(cliGatewayConfig.projectRoot, cliGatewayConfig.stopFlagFile);
  const stopFlagExists = fs.existsSync(stopFlagPath);
  const envKilled = process.env[cliGatewayConfig.killEnvVar] === '1';
  return stopFlagExists || envKilled;
}

/**
 * Минимальный env для дочернего процесса.
 * Не передаем process.env целиком, чтобы не утекали секреты.
 */
export function getChildProcessEnv(): Record<string, string> {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
  return {
    PATH: process.env.PATH ?? '',
    HOME: home,
    USERPROFILE: process.env.USERPROFILE ?? home,
    LANG: process.env.LANG ?? 'en_US.UTF-8',
  };
}
