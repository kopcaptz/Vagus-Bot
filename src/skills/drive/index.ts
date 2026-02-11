/**
 * DriveSkill — full file system control within the drive mount (path jail).
 *
 * All operations are confined to config.drive.root (default /app/drive).
 * No size limit for reading text files; binary files return metadata only.
 */

import fs from 'fs';
import path from 'path';
import { config } from '../../config/config.js';
import type { Skill, ToolDefinition } from '../types.js';

// ============================================
// Constants
// ============================================

const MAX_DIR_ENTRIES = 200;
const TREE_MAX_DEPTH = 4;
const ENCODING = 'utf-8' as const;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.yml', '.yaml', '.xml', '.html', '.css', '.js', '.ts', '.mjs', '.cjs',
  '.py', '.sh', '.bat', '.ps1', '.env', '.log', '.csv', '.sql', '.graphql',
  '.ini', '.conf', '.cfg', '.config',
]);

// ============================================
// Path jail
// ============================================

function getDriveRoot(): string {
  const root = config.drive.root.trim() || '/app/drive';
  return path.resolve(root);
}

/**
 * Resolve user path to absolute path inside drive root. Returns null if outside jail.
 * Empty string or "." are treated as the drive root (no trailing slashes or illegal chars).
 */
function resolveInJail(userPath: string): string | null {
  const root = getDriveRoot();
  const trimmed = (userPath ?? '').trim();
  if (trimmed === '' || trimmed === '.') return path.resolve(root);
  const normalized = path.normalize(trimmed).replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  if (normalized === '' || normalized === '.') return path.resolve(root);
  const resolved = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (!resolved.startsWith(rootResolved)) return null;
  return resolved;
}

/**
 * Same as resolveInJail but if path exists, resolve symlinks and ensure still inside root.
 * On Windows, realpathSync may throw; we fall back to resolved path and log the error.
 */
function resolveInJailStrict(userPath: string): string | null {
  const resolved = resolveInJail(userPath);
  if (!resolved) return null;
  if (!fs.existsSync(resolved)) return resolved;
  try {
    const real = fs.realpathSync(resolved);
    const rootResolved = path.resolve(getDriveRoot());
    if (!real.startsWith(rootResolved)) return null;
    return real;
  } catch (err) {
    console.error('[DriveSkill] resolveInJailStrict realpathSync error:', err instanceof Error ? err.message : String(err));
    return resolved;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || /\.(env|config|cfg|ini|conf)$/.test(ext);
}

// ============================================
// Manifest
// ============================================

const MANIFEST_STRUCTURE = ['system/logs', 'system/memory', 'work/projects', 'work/assets'];

function ensureManifest(): void {
  const root = getDriveRoot();
  const manifestPath = path.join(root, 'manifest.json');
  if (fs.existsSync(manifestPath)) return;
  const manifest = {
    version: '1.0',
    root: 'Vagus-Bot',
    structure: MANIFEST_STRUCTURE,
    status: 'initialized',
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  for (const dir of MANIFEST_STRUCTURE) {
    const full = path.join(root, dir);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
  }
}

// ============================================
// Tool implementations
// ============================================

function driveList(dirPath: string): string {
  try {
    const resolved = resolveInJailStrict(dirPath ?? '');
    if (!resolved) return 'Ошибка: путь вне корня диска или недопустим.';
    if (!fs.existsSync(resolved)) return `Ошибка: директория не найдена: ${dirPath || '.'}`;
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return 'Ошибка: путь не является директорией.';

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    if (entries.length === 0) return '(директория пуста)';

    const root = getDriveRoot();
    const relDir = path.relative(root, resolved) || '.';
    const lines: string[] = [`Содержимое: ${relDir}/`];
    let count = 0;

    for (const entry of entries) {
      if (count >= MAX_DIR_ENTRIES) {
        lines.push(`... и ещё ${entries.length - MAX_DIR_ENTRIES} элементов`);
        break;
      }
      try {
        const full = path.join(resolved, entry.name);
        const s = fs.statSync(full);
        if (entry.isDirectory()) {
          lines.push(`  [DIR]  ${entry.name}/`);
        } else {
          lines.push(`  [FILE] ${entry.name} (${formatSize(s.size)})`);
        }
      } catch {
        lines.push(`  [???]  ${entry.name}`);
      }
      count++;
    }
    return lines.join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[DriveSkill] drive_list error:', msg);
    if (stack) console.error('[DriveSkill] drive_list stack:', stack);
    return `Ошибка при чтении директории: ${msg}`;
  }
}

function driveTree(dirPath: string, depthLimit: number = TREE_MAX_DEPTH): string {
  try {
    const resolved = resolveInJailStrict(dirPath ?? '');
    if (!resolved) return 'Ошибка: путь вне корня диска или недопустим.';
    if (!fs.existsSync(resolved)) return `Ошибка: директория не найдена: ${dirPath || '.'}`;
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return 'Ошибка: путь не является директорией.';

    const root = getDriveRoot();
    const relBase = path.relative(root, resolved) || '.';

    function walk(dir: string, prefix: string, depth: number): string[] {
      if (depth <= 0) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const lines: string[] = [];
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });
      for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        const isLast = i === sorted.length - 1;
        const branch = isLast ? '└── ' : '├── ';
        const nextPrefix = isLast ? '    ' : '│   ';
        const full = path.join(dir, entry.name);
        try {
          const s = fs.statSync(full);
          if (entry.isDirectory()) {
            lines.push(`${prefix}${branch}[DIR] ${entry.name}/`);
            lines.push(...walk(full, prefix + nextPrefix, depth - 1));
          } else {
            lines.push(`${prefix}${branch}[FILE] ${entry.name} (${formatSize(s.size)})`);
          }
        } catch {
          lines.push(`${prefix}${branch}[???] ${entry.name}`);
        }
      }
      return lines;
    }

    let body = walk(resolved, '', depthLimit);
    if (relBase === '.' && body.length === 0) {
      ensureManifest();
      body = walk(resolved, '', depthLimit);
    }
    const header = `${relBase}/`;
    return [header, ...body].join('\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[DriveSkill] drive_tree error:', msg);
    if (stack) console.error('[DriveSkill] drive_tree stack:', stack);
    return `Ошибка при построении дерева: ${msg}`;
  }
}

async function driveRead(filePath: string): Promise<string> {
  const resolved = resolveInJailStrict(filePath);
  if (!resolved) return 'Ошибка: путь вне корня диска или недопустим.';
  if (!fs.existsSync(resolved)) return `Ошибка: файл не найден: ${filePath}`;
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) return 'Ошибка: путь не является файлом.';

  if (!isTextFile(resolved)) {
    return `Binary file [${formatSize(stat.size)}]`;
  }
  try {
    return await fs.promises.readFile(resolved, { encoding: ENCODING });
  } catch (err) {
    return `Ошибка чтения: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function driveWrite(filePath: string, content: string): string {
  const resolved = resolveInJail(filePath);
  if (!resolved) return 'Ошибка: путь вне корня диска или недопустим.';
  const root = getDriveRoot();
  if (!resolved.startsWith(path.resolve(root))) return 'Ошибка: путь вне корня диска.';
  const dir = path.dirname(resolved);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, content, 'utf-8');
  const rel = path.relative(root, resolved);
  return `Файл записан: ${rel}`;
}

function driveMkdir(dirPath: string): string {
  const resolved = resolveInJail(dirPath);
  if (!resolved) return 'Ошибка: путь вне корня диска или недопустим.';
  const root = getDriveRoot();
  if (!resolved.startsWith(path.resolve(root))) return 'Ошибка: путь вне корня диска.';
  if (fs.existsSync(resolved)) {
    return fs.statSync(resolved).isDirectory() ? `Директория уже существует: ${dirPath}` : 'Ошибка: по этому пути уже существует файл.';
  }
  fs.mkdirSync(resolved, { recursive: true });
  const rel = path.relative(root, resolved);
  return `Директория создана: ${rel}`;
}

function driveMove(source: string, destination: string): string {
  const srcResolved = resolveInJailStrict(source);
  const dstResolved = resolveInJail(destination);
  if (!srcResolved) return 'Ошибка: исходный путь вне корня диска или недопустим.';
  if (!dstResolved) return 'Ошибка: путь назначения вне корня диска или недопустим.';
  const root = getDriveRoot();
  if (!dstResolved.startsWith(path.resolve(root))) return 'Ошибка: путь назначения вне корня диска.';
  if (!fs.existsSync(srcResolved)) return `Ошибка: источник не найден: ${source}`;
  if (fs.existsSync(dstResolved)) return 'Ошибка: по пути назначения уже существует файл или директория.';

  try {
    fs.renameSync(srcResolved, dstResolved);
    return `Перемещено: ${path.relative(root, srcResolved)} -> ${path.relative(root, dstResolved)}`;
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'EXDEV') {
      fs.cpSync(srcResolved, dstResolved, { recursive: true });
      fs.rmSync(srcResolved, { recursive: true });
      return `Перемещено (копирование): ${path.relative(root, srcResolved)} -> ${path.relative(root, dstResolved)}`;
    }
    return `Ошибка перемещения: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function driveDelete(targetPath: string): string {
  const resolved = resolveInJailStrict(targetPath);
  if (!resolved) return 'Ошибка: путь вне корня диска или недопустим.';
  if (!fs.existsSync(resolved)) return `Ошибка: не найдено: ${targetPath}`;
  const root = getDriveRoot();
  if (resolved === path.resolve(root)) return 'Ошибка: нельзя удалить корень диска.';
  try {
    fs.rmSync(resolved, { recursive: true });
    return `Удалено: ${path.relative(root, resolved)}`;
  } catch (err) {
    return `Ошибка удаления: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function driveOrganize(dirPath: string, strategy: string): string {
  const resolved = resolveInJailStrict(dirPath || '.');
  if (!resolved) return 'Ошибка: путь вне корня диска или недопустим.';
  if (!fs.existsSync(resolved)) return `Ошибка: директория не найдена: ${dirPath || '.'}`;
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) return 'Ошибка: путь не является директорией.';

  const useDate = strategy === 'date';
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const files = entries.filter(e => e.isFile());
  if (files.length === 0) return '(в директории нет файлов для организации)';

  const root = getDriveRoot();
  const moved: string[] = [];

  if (useDate) {
    const byDate = new Map<string, string[]>();
    for (const entry of files) {
      const full = path.join(resolved, entry.name);
      const mtime = fs.statSync(full).mtime;
      const key = `${mtime.getFullYear()}-${String(mtime.getMonth() + 1).padStart(2, '0')}`;
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(entry.name);
    }
    for (const [folderName, names] of byDate) {
      const subDir = path.join(resolved, folderName);
      fs.mkdirSync(subDir, { recursive: true });
      for (const name of names) {
        const src = path.join(resolved, name);
        const dst = path.join(subDir, name);
        fs.renameSync(src, dst);
        moved.push(`${name} -> ${folderName}/`);
      }
    }
  } else {
    const byExt = new Map<string, string[]>();
    for (const entry of files) {
      const ext = path.extname(entry.name).toLowerCase() || '.noext';
      const label = ext === '.noext' ? 'NoExtension' : ext.slice(1).toUpperCase() + 's';
      if (!byExt.has(label)) byExt.set(label, []);
      byExt.get(label)!.push(entry.name);
    }
    for (const [folderName, names] of byExt) {
      const subDir = path.join(resolved, folderName);
      fs.mkdirSync(subDir, { recursive: true });
      for (const name of names) {
        const src = path.join(resolved, name);
        const dst = path.join(subDir, name);
        fs.renameSync(src, dst);
        moved.push(`${name} -> ${folderName}/`);
      }
    }
  }

  const rel = path.relative(root, resolved);
  return `Организовано в ${rel} (${strategy}): ${moved.length} файлов перемещено.\n${moved.slice(0, 30).join('\n')}${moved.length > 30 ? `\n... и ещё ${moved.length - 30}` : ''}`;
}

// ============================================
// DriveSkill
// ============================================

export class DriveSkill implements Skill {
  readonly id = 'drive';
  readonly name = 'Drive';
  readonly description = 'Full file system control within the drive mount (/app/drive)';

  getTools(): ToolDefinition[] {
    return [
      {
        name: 'drive_list',
        description: 'List files and folders in a directory on the drive. Path is relative to drive root.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to directory (default: root)' },
          },
        },
      },
      {
        name: 'drive_tree',
        description: 'Show recursive directory structure with depth limit. Use to inspect drive layout before organizing.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to directory (default: root)' },
          },
        },
      },
      {
        name: 'drive_read',
        description: 'Read file content. Text files: full content. Binary files: returns "Binary file [size]".',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to file' },
          },
          required: ['path'],
        },
      },
      {
        name: 'drive_write',
        description: 'Write content to a file on the drive. Parent directories are created if needed.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to file' },
            content: { type: 'string', description: 'File content' },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'drive_mkdir',
        description: 'Create a directory on the drive (recursive).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to new directory' },
          },
          required: ['path'],
        },
      },
      {
        name: 'drive_move',
        description: 'Move or rename a file or folder on the drive.',
        parameters: {
          type: 'object',
          properties: {
            source: { type: 'string', description: 'Relative path to source' },
            destination: { type: 'string', description: 'Relative path to destination' },
          },
          required: ['source', 'destination'],
        },
      },
      {
        name: 'drive_delete',
        description: 'Delete a file or folder on the drive (recursive for folders).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to file or folder' },
          },
          required: ['path'],
        },
      },
      {
        name: 'drive_organize',
        description: 'Organize files in a directory into subfolders by extension or by date (mtime).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path to directory to organize' },
            strategy: { type: 'string', description: '"extension" (default) or "date"' },
          },
        },
      },
    ];
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    switch (toolName) {
      case 'drive_list': {
        const p = typeof args.path === 'string' ? args.path : '';
        return driveList(p);
      }
      case 'drive_tree': {
        const p = typeof args.path === 'string' ? args.path : '';
        return driveTree(p);
      }
      case 'drive_read': {
        const p = typeof args.path === 'string' ? args.path : '';
        return driveRead(p);
      }
      case 'drive_write': {
        const p = typeof args.path === 'string' ? args.path : '';
        const content = typeof args.content === 'string' ? args.content : String(args.content ?? '');
        return driveWrite(p, content);
      }
      case 'drive_mkdir': {
        const p = typeof args.path === 'string' ? args.path : '';
        return driveMkdir(p);
      }
      case 'drive_move': {
        const src = typeof args.source === 'string' ? args.source : '';
        const dst = typeof args.destination === 'string' ? args.destination : '';
        return driveMove(src, dst);
      }
      case 'drive_delete': {
        const p = typeof args.path === 'string' ? args.path : '';
        return driveDelete(p);
      }
      case 'drive_organize': {
        const p = typeof args.path === 'string' ? args.path : '';
        const strategy = typeof args.strategy === 'string' && (args.strategy === 'date' || args.strategy === 'extension')
          ? args.strategy
          : 'extension';
        return driveOrganize(p, strategy);
      }
      default:
        return `Неизвестный инструмент в DriveSkill: ${toolName}`;
    }
  }
}
