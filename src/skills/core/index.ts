/**
 * CoreSkill — базовые инструменты: файловая система и терминал.
 *
 * Вся логика безопасности (WORKSPACE_ROOT, blocklist) перенесена из старого tools.ts.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { config } from '../../config/config.js';
import type { Skill, ToolDefinition } from '../types.js';

// ============================================
// Константы
// ============================================

const MAX_FILE_SIZE = 500 * 1024; // 500 KB
const MAX_READ_ENCODING = 'utf-8' as const;
const MAX_DIR_ENTRIES = 200;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.yml', '.yaml', '.xml', '.html', '.css', '.js', '.ts', '.mjs', '.cjs',
  '.py', '.sh', '.bat', '.ps1', '.env', '.log', '.csv', '.sql', '.graphql',
]);

const COMMAND_BLOCKLIST: RegExp[] = [
  /\brm\s+-rf\s+[/]/,
  /\brm\s+-rf\s+[/][/]/,
  /\bsudo\b/,
  /\bmkfs\./,
  /\bdd\s+if=/,
  />\s*\/dev\/(sd|nvme|hd)/,
  /\|\s*\/dev\/(sd|nvme|hd)/,
  new RegExp('\\bchmod\\s+[0-7]{3,4}\\s+/'),
  new RegExp('\\bchown\\s+[^\\s]+\\s+/'),
  /\:\(\)\s*\{\s*:\s*\}\s*;\s*:/,
  /\bwget\s+.*\s+\|\s*sh\b/,
  /\bcurl\s+.*\s+\|\s*sh\b/,
];

// ============================================
// Утилиты безопасности
// ============================================

function getWorkspaceRoot(): string | null {
  const root = config.tools.workspaceRoot.trim();
  if (!root) return null;
  const resolved = path.resolve(process.cwd(), root);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return null;
  return resolved;
}

function resolvePath(relativePath: string): string | null {
  const root = getWorkspaceRoot();
  if (!root) return null;
  const normalized = path.normalize(relativePath).replace(/^(\.\/)+/, '');
  const resolved = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (!resolved.startsWith(rootResolved)) return null;
  if (!fs.existsSync(resolved)) return resolved;
  try {
    const real = fs.realpathSync(resolved);
    if (!real.startsWith(rootResolved)) return null;
    return real;
  } catch {
    return null;
  }
}

function isCommandBlocked(command: string): boolean {
  return COMMAND_BLOCKLIST.some(re => re.test(command.trim()));
}

// ============================================
// Безопасные операции
// ============================================

function readFileSafe(filePath: string): string {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return 'Ошибка: путь не является файлом.';
  if (stat.size > MAX_FILE_SIZE) return `Ошибка: файл слишком большой (лимит ${MAX_FILE_SIZE / 1024} KB).`;
  const ext = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && !/\.(env|config|cfg|ini|conf)$/.test(ext)) {
    return 'Ошибка: разрешено чтение только текстовых файлов (например .txt, .md, .js, .json, .py).';
  }
  return fs.readFileSync(filePath, { encoding: MAX_READ_ENCODING });
}

function writeFileSafe(filePath: string, content: string): string {
  const resolved = resolvePath(filePath);
  if (!resolved) return 'Ошибка: путь вне рабочей директории или недопустим.';
  const root = getWorkspaceRoot();
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, content, 'utf-8');
  return `Файл записан: ${root ? path.relative(root, resolved) : resolved}`;
}

function listDirSafe(dirPath: string): string {
  const resolved = resolvePath(dirPath || '.');
  if (!resolved) return 'Ошибка: путь вне рабочей директории или WORKSPACE_ROOT не задан.';
  if (!fs.existsSync(resolved)) return `Ошибка: директория не найдена: ${dirPath || '.'}`;

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) return 'Ошибка: путь не является директорией.';

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  if (entries.length === 0) return '(директория пуста)';

  const root = getWorkspaceRoot();
  const relDir = root ? path.relative(root, resolved) : resolved;

  const lines: string[] = [`Содержимое: ${relDir || '.'}/`];
  let count = 0;

  for (const entry of entries) {
    if (count >= MAX_DIR_ENTRIES) {
      lines.push(`... и ещё ${entries.length - MAX_DIR_ENTRIES} элементов`);
      break;
    }
    if (entry.isDirectory()) {
      lines.push(`  [DIR]  ${entry.name}/`);
    } else {
      try {
        const size = fs.statSync(path.join(resolved, entry.name)).size;
        const sizeStr = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
        lines.push(`  [FILE] ${entry.name} (${sizeStr})`);
      } catch {
        lines.push(`  [FILE] ${entry.name}`);
      }
    }
    count++;
  }

  return lines.join('\n');
}

function runCommandSafe(command: string): string {
  if (isCommandBlocked(command)) {
    return 'Ошибка: команда запрещена из соображений безопасности.';
  }
  const timeout = config.tools.commandTimeoutMs;
  try {
    const result = execSync(command, {
      encoding: 'utf-8',
      timeout,
      maxBuffer: 1024 * 1024,
      cwd: getWorkspaceRoot() || process.cwd(),
    });
    return (result ?? '').trim() || '(команда выполнена, вывод пуст)';
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Ошибка выполнения: ${msg}`;
  }
}

// ============================================
// CoreSkill
// ============================================

export class CoreSkill implements Skill {
  readonly id = 'core';
  readonly name = 'Core Tools';
  readonly description = 'File system and terminal tools';

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'read_file',
        description: 'Прочитать содержимое текстового файла в рабочей директории. Путь задаётся относительно WORKSPACE_ROOT.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Относительный путь к файлу' },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Записать текст в файл в рабочей директории. Путь задаётся относительно WORKSPACE_ROOT.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Относительный путь к файлу' },
            content: { type: 'string', description: 'Содержимое файла' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'list_dir',
        description: 'Показать файлы и директории по указанному пути внутри рабочей директории.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Относительный путь к директории (по умолчанию: корень)' },
          },
        },
      },
      {
        name: 'run_command',
        description: 'Выполнить одну команду в терминале (в рабочей директории). Опасные команды (rm -rf /, sudo и т.п.) запрещены.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Команда для выполнения (одна строка)' },
          },
          required: ['command'],
        },
      },
    ];
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    switch (toolName) {
      case 'read_file': {
        const p = typeof args.path === 'string' ? args.path : String(args.path ?? '');
        const resolved = resolvePath(p);
        if (!resolved) return 'Ошибка: путь вне рабочей директории или WORKSPACE_ROOT не задан.';
        return readFileSafe(resolved);
      }

      case 'write_file': {
        const p = typeof args.path === 'string' ? args.path : String(args.path ?? '');
        const content = typeof args.content === 'string' ? args.content : String(args.content ?? '');
        return writeFileSafe(p, content);
      }

      case 'list_dir': {
        const p = typeof args.path === 'string' ? args.path : String(args.path ?? '.');
        return listDirSafe(p);
      }

      case 'run_command': {
        const cmd = typeof args.command === 'string' ? args.command : String(args.command ?? '');
        return runCommandSafe(cmd);
      }

      default:
        return `Неизвестный инструмент в CoreSkill: ${toolName}`;
    }
  }
}
