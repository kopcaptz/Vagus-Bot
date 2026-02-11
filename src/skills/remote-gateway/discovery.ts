import { config } from '../../config/config.js';
import type { RemoteSkillRegistryEntry, SkillManifestV1 } from './types.js';

interface CacheEntry {
  manifest: SkillManifestV1;
  expiresAt: number;
}

const manifestCache = new Map<string, CacheEntry>();
const MANIFEST_CACHE_TTL_MS = 60_000;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function assertManifest(manifest: unknown, expectedSkillId: string): asserts manifest is SkillManifestV1 {
  if (!isObject(manifest)) {
    throw new Error('MANIFEST_INVALID: response is not an object');
  }
  if (manifest.gateway_protocol_version !== config.skillGateway.protocolVersion) {
    throw new Error(`PROTOCOL_VERSION_UNSUPPORTED: expected ${config.skillGateway.protocolVersion}, got ${String(manifest.gateway_protocol_version)}`);
  }
  if (typeof manifest.id !== 'string' || !manifest.id) {
    throw new Error('MANIFEST_INVALID: id is required');
  }
  if (manifest.id !== expectedSkillId) {
    throw new Error(`MANIFEST_INVALID: id mismatch (${manifest.id} != ${expectedSkillId})`);
  }
  if (!Array.isArray(manifest.capabilities)) {
    throw new Error('MANIFEST_INVALID: capabilities must be an array');
  }
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    if (!res.ok) {
      throw new Error(`MANIFEST_INVALID: GET ${url} returned ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function discoverManifest(entry: RemoteSkillRegistryEntry): Promise<SkillManifestV1> {
  const cached = manifestCache.get(entry.skill_id);
  if (cached && cached.expiresAt > Date.now()) {
    console.log(`[remote_gateway] manifest_cached skill_id=${entry.skill_id}`);
    return cached.manifest;
  }

  console.log(`[remote_gateway] manifest_discovery_start skill_id=${entry.skill_id} base_url=${entry.base_url}`);
  const raw = await fetchJsonWithTimeout(`${entry.base_url}/manifest`, entry.timeout_ms ?? config.skillGateway.requestTimeoutMs);
  assertManifest(raw, entry.skill_id);
  console.log(`[remote_gateway] manifest_protocol_ok version=${config.skillGateway.protocolVersion}`);
  console.log(`[remote_gateway] manifest_schema_ok skill_id=${entry.skill_id}`);
  const manifest = raw as SkillManifestV1;
  manifestCache.set(entry.skill_id, { manifest, expiresAt: Date.now() + MANIFEST_CACHE_TTL_MS });
  return manifest;
}

export function clearManifestCacheForTests(): void {
  manifestCache.clear();
}
