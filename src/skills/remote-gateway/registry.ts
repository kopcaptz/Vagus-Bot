import fs from 'fs';
import path from 'path';
import { config } from '../../config/config.js';
import type { RemoteSkillRegistryEntry, RemoteSkillRegistryFile } from './types.js';

export interface RegistryLoadResult {
  path: string;
  skills: RemoteSkillRegistryEntry[];
  byCapability: Map<string, RemoteSkillRegistryEntry>;
}

function assertAllowedProtocol(baseUrl: string): void {
  const url = new URL(baseUrl);
  const protocol = url.protocol.replace(':', '').toLowerCase();
  if (!config.skillGateway.allowedProtocols.includes(protocol)) {
    throw new Error(`Protocol "${protocol}" is not allowed for base_url "${baseUrl}"`);
  }
}

function normalizeEntry(entry: RemoteSkillRegistryEntry): RemoteSkillRegistryEntry {
  const normalized: RemoteSkillRegistryEntry = {
    ...entry,
    skill_id: entry.skill_id.trim(),
    base_url: entry.base_url.trim().replace(/\/+$/, ''),
    allowlist_capabilities: (entry.allowlist_capabilities || []).map(s => s.trim()).filter(Boolean),
    timeout_ms: entry.timeout_ms ?? config.skillGateway.requestTimeoutMs,
    rate_limit_per_minute: entry.rate_limit_per_minute ?? 60,
  };

  if (!normalized.skill_id) {
    throw new Error('registry entry has empty skill_id');
  }
  if (!normalized.base_url) {
    throw new Error(`registry entry "${normalized.skill_id}" has empty base_url`);
  }
  assertAllowedProtocol(normalized.base_url);
  return normalized;
}

export function loadRemoteSkillRegistry(): RegistryLoadResult {
  const registryPath = path.resolve(process.cwd(), config.skillGateway.registryPath);
  console.log(`[remote_gateway] registry_loaded path=${registryPath}`);
  if (!fs.existsSync(registryPath)) {
    console.log('[remote_gateway] registry_summary skills=0 capabilities=0');
    return { path: registryPath, skills: [], byCapability: new Map() };
  }

  const raw = fs.readFileSync(registryPath, 'utf-8');
  const parsed = JSON.parse(raw) as RemoteSkillRegistryFile;
  if (!parsed || !Array.isArray(parsed.skills)) {
    throw new Error(`Invalid remote skill registry format: ${registryPath}`);
  }

  const skills = parsed.skills.map(normalizeEntry);
  const byCapability = new Map<string, RemoteSkillRegistryEntry>();
  for (const entry of skills) {
    for (const capability of entry.allowlist_capabilities) {
      if (!byCapability.has(capability)) {
        byCapability.set(capability, entry);
      }
    }
  }

  console.log(`[remote_gateway] registry_summary skills=${skills.length} capabilities=${byCapability.size}`);
  return { path: registryPath, skills, byCapability };
}
