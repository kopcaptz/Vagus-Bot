/**
 * path-resolver.ts — поиск бинарника через where/which с проверкой доверенных путей.
 * Если путь не в доверенных папках (системные или project/tools) — TRUSTED_PATH_VIOLATION.
 */

import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs';
import { cliGatewayConfig } from './config.js';

export const TRUSTED_PATH_VIOLATION = 'TRUSTED_PATH_VIOLATION';

function normalizeDir(dir: string): string {
  const resolved = path.resolve(dir);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Проверяет, что filePath находится в одной из доверенных директорий.
 * Доверенные: config.trustedDirs + projectRoot/tools.
 */
function isPathTrusted(filePath: string): boolean {
  const normalizedPath = path.resolve(filePath);
  const normalizedPathWin = process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;

  const projectTools = path.join(cliGatewayConfig.projectRoot, 'tools');
  const trustedDirs = [
    ...cliGatewayConfig.trustedDirs,
    projectTools,
  ].map(normalizeDir);

  for (const trusted of trustedDirs) {
    if (normalizedPathWin === trusted || normalizedPathWin.startsWith(trusted + path.sep)) {
      return true;
    }
  }
  return false;
}

/**
 * Запускает where (Windows) или which (Linux/macOS) и возвращает первый найденный путь.
 */
function findExecutablePath(name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'where' : 'which';
    const args = [name];

    const child = spawn(cmd, args, { shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      const firstLine = stdout.split(/[\r\n]+/)[0]?.trim();
      if (firstLine && code === 0) {
        resolve(firstLine);
      } else {
        reject(new Error(stderr || `Executable not found: ${name}`));
      }
    });
  });
}

/**
 * Возвращает абсолютный путь к бинарнику по имени.
 * Использует pathOverride из allowlist, если задан; иначе where/which.
 * Выбрасывает ошибку с code TRUSTED_PATH_VIOLATION, если путь не в доверенных папках.
 */
export async function resolveExecutable(name: string): Promise<string> {
  const def = cliGatewayConfig.allowlist[name];
  let resolvedPath: string;

  if (def?.pathOverride?.trim()) {
    resolvedPath = path.resolve(def.pathOverride.trim());
  } else {
    resolvedPath = await findExecutablePath(name);
  }

  const normalizedPath = path.resolve(resolvedPath);
  let realPath = normalizedPath;
  try {
    realPath = fs.realpathSync(normalizedPath);
  } catch {
    // keep normalizedPath for error reporting when file does not exist
  }

  if (!isPathTrusted(realPath)) {
    const err = new Error(`Binary path is not in a trusted directory: ${realPath}`) as Error & { code: string };
    err.code = TRUSTED_PATH_VIOLATION;
    throw err;
  }

  return realPath;
}
