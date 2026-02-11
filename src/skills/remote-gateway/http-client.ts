import { config } from '../../config/config.js';
import type { RemoteSkillRegistryEntry, SkillRunRequestV1, SkillRunResponseV1 } from './types.js';
import { scrubObjectForLog } from './sanitizer.js';

function getAuthHeaders(entry: RemoteSkillRegistryEntry, signature: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const secretEnvKey = entry.auth.secret_env_key;
  const secretValue = secretEnvKey ? (process.env[secretEnvKey] || '') : '';

  if (entry.auth.type === 'api_key') {
    if (!secretEnvKey || !secretValue) {
      throw new Error('SKILL_AUTH_FAILED: missing api key env');
    }
    headers[entry.auth.header_name || 'X-API-Key'] = secretValue;
  }

  if (entry.auth.type === 'hmac') {
    if (!secretEnvKey || !secretValue) {
      throw new Error('SKILL_AUTH_FAILED: missing hmac secret env');
    }
    if (entry.auth.header_name) {
      headers[entry.auth.header_name] = signature;
    }
  }

  return headers;
}

export async function postRun(
  entry: RemoteSkillRegistryEntry,
  payload: SkillRunRequestV1,
): Promise<SkillRunResponseV1> {
  const timeoutMs = entry.timeout_ms ?? config.skillGateway.requestTimeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(entry, payload.signature),
  };

  try {
    console.log(`[remote-gateway] ${entry.skill_id} /run payload=${scrubObjectForLog(payload)}`);
    const res = await fetch(`${entry.base_url}/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    const safeLogFragment = scrubObjectForLog(text);
    console.log(`[remote-gateway] ${entry.skill_id} /run status=${res.status} response=${safeLogFragment}`);

    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('SKILL_HTTP_ERROR: response is not valid JSON');
    }
    if (!res.ok) {
      throw new Error(`SKILL_HTTP_ERROR: status ${res.status}`);
    }
    return parsed as SkillRunResponseV1;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`SKILL_TIMEOUT: remote run exceeded ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
