import type { Skill, ToolDefinition } from '../types.js';
import { config } from '../../config/config.js';
import { loadRemoteSkillRegistry } from './registry.js';
import { discoverManifest } from './discovery.js';
import { NonceStore } from './nonce-store.js';
import { signRunPayload, assertProtocolVersion } from './signing.js';
import { validateBySchema } from './schema.js';
import { postRun } from './http-client.js';
import type {
  GatewayError,
  GatewayErrorCode,
  RemoteCapabilityManifest,
  RemoteSkillRegistryEntry,
  SkillRunRequestV1,
  SkillRunResponseV1,
} from './types.js';

interface RouteEntry {
  entry: RemoteSkillRegistryEntry;
  capability: RemoteCapabilityManifest;
}

function toolNameForCapability(capability: string): string {
  return `remote_skill.${capability}`;
}

function toGatewayError(code: GatewayErrorCode, message: string, details?: Record<string, unknown>): GatewayError {
  return { ok: false, error_code: code, message, details };
}

function parseError(err: unknown): GatewayError {
  const msg = err instanceof Error ? err.message : String(err);
  const knownCodes: GatewayErrorCode[] = [
    'MANIFEST_INVALID',
    'PROTOCOL_VERSION_UNSUPPORTED',
    'NONCE_REPLAY',
    'SCHEMA_VALIDATION_FAILED',
    'SKILL_TIMEOUT',
    'SKILL_AUTH_FAILED',
    'GATEWAY_DISABLED',
    'ROUTING_FAILED',
    'SKILL_HTTP_ERROR',
  ];
  const matched = knownCodes.find(code => msg.startsWith(code));
  if (matched) return toGatewayError(matched, msg);
  return toGatewayError('SKILL_HTTP_ERROR', msg);
}

function pickWhitelistedInput(
  args: Record<string, unknown>,
  schema: RemoteCapabilityManifest['input_schema'],
): Record<string, unknown> {
  const whitelisted = new Set(Object.keys(schema.properties || {}));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (whitelisted.has(k)) out[k] = v;
  }
  return out;
}

class RateLimiter {
  private readonly buckets = new Map<string, { windowStartMs: number; count: number }>();

  allow(key: string, limitPerMinute: number): boolean {
    const now = Date.now();
    const minute = 60_000;
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStartMs >= minute) {
      this.buckets.set(key, { windowStartMs: now, count: 1 });
      return true;
    }
    if (bucket.count >= limitPerMinute) return false;
    bucket.count += 1;
    return true;
  }
}

export class RemoteGatewaySkill implements Skill {
  readonly id = 'remote-gateway';
  readonly name = 'Remote Skill Gateway';
  readonly description = 'Secure HTTP gateway for external skills/workers.';

  private readonly nonceStore = new NonceStore();
  private readonly limiter = new RateLimiter();

  constructor(private readonly routesByToolName: Map<string, RouteEntry>) {}

  getTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const [toolName, route] of this.routesByToolName.entries()) {
      tools.push({
        name: toolName,
        description: route.capability.description,
        parameters: route.capability.input_schema,
      });
    }
    return tools;
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    if (!config.skillGateway.enabled || config.skillGateway.killSwitch) {
      return JSON.stringify(toGatewayError('GATEWAY_DISABLED', 'Skill gateway is disabled by feature flag or kill-switch.'));
    }
    const route = this.routesByToolName.get(toolName);
    if (!route) {
      return JSON.stringify(toGatewayError('ROUTING_FAILED', `Unknown remote tool: ${toolName}`));
    }
    try {
      const limit = route.entry.rate_limit_per_minute ?? 60;
      if (!this.limiter.allow(route.entry.skill_id, limit)) {
        return JSON.stringify(toGatewayError('SKILL_HTTP_ERROR', `Rate limit exceeded for ${route.entry.skill_id}`));
      }

      assertProtocolVersion(config.skillGateway.protocolVersion);
      const input = pickWhitelistedInput(args, route.capability.input_schema);
      validateBySchema(route.capability.input_schema, input, 'input');

      const timestamp = Date.now();
      this.nonceStore.assertTimestampWithinSkew(timestamp);
      const nonce = this.nonceStore.create();

      const unsignedPayload: Omit<SkillRunRequestV1, 'signature'> = {
        gateway_protocol_version: config.skillGateway.protocolVersion,
        skill_id: route.entry.skill_id,
        capability: route.capability.capability,
        input,
        timestamp,
        nonce,
      };

      let signature = 'api_key';
      if (route.entry.auth.type === 'hmac') {
        const secretEnv = route.entry.auth.secret_env_key;
        const secret = secretEnv ? process.env[secretEnv] : '';
        if (!secret) {
          throw new Error('SKILL_AUTH_FAILED: missing hmac secret');
        }
        signature = signRunPayload(unsignedPayload, secret).signature;
      }
      const payload: SkillRunRequestV1 = { ...unsignedPayload, signature };

      const response = await postRun(route.entry, payload);
      const normalized = response as SkillRunResponseV1;
      if (!normalized || typeof normalized !== 'object') {
        throw new Error('SKILL_HTTP_ERROR: empty or invalid response');
      }
      if (!('ok' in normalized)) {
        throw new Error('SKILL_HTTP_ERROR: response missing ok flag');
      }
      if (normalized.ok !== true) {
        const gatewayErr = normalized as GatewayError;
        return JSON.stringify(gatewayErr);
      }

      validateBySchema(route.capability.output_schema, normalized.output, 'output');

      // Return as plain data object; caller treats this as data, not control instruction.
      return JSON.stringify({
        ok: true,
        output: normalized.output,
        meta: normalized.meta || {},
      });
    } catch (err) {
      return JSON.stringify(parseError(err));
    }
  }
}

export async function createRemoteGatewaySkill(): Promise<RemoteGatewaySkill | null> {
  if (!config.skillGateway.enabled) {
    console.warn('[remote_gateway] GATEWAY_DISABLED');
    console.warn('[remote_gateway] registration_skipped reason=feature_flag_disabled');
    return null;
  }
  if (config.skillGateway.killSwitch) {
    console.warn('[remote_gateway] GATEWAY_DISABLED');
    console.warn('[remote_gateway] registration_skipped reason=kill_switch_active');
    return null;
  }

  const registry = loadRemoteSkillRegistry();
  if (registry.skills.length === 0) {
    console.warn('[remote_gateway] registration_skipped reason=registry_empty');
    return null;
  }

  const routesByToolName = new Map<string, RouteEntry>();
  for (const entry of registry.skills) {
    try {
      const manifest = await discoverManifest(entry);
      for (const capabilityDef of manifest.capabilities) {
        if (!entry.allowlist_capabilities.includes(capabilityDef.capability)) {
          continue;
        }
        const toolName = toolNameForCapability(capabilityDef.capability);
        routesByToolName.set(toolName, { entry, capability: capabilityDef });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const reason = msg.split(':', 1)[0] || 'UNKNOWN_ERROR';
      console.warn(`[remote_gateway] skill_skipped skill_id=${entry.skill_id} reason=${reason}`);
      console.warn(`[remote_gateway] ${msg}`);
    }
  }

  if (routesByToolName.size === 0) {
    console.warn('[remote_gateway] registration_skipped reason=no_routes_discovered');
    return null;
  }
  const tools = Array.from(routesByToolName.keys());
  console.log(`[remote_gateway] remote_tools_registered count=${tools.length} tools=[${tools.join(',')}]`);
  return new RemoteGatewaySkill(routesByToolName);
}
