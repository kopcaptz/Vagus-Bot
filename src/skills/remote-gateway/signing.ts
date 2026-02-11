import crypto from 'crypto';
import { config } from '../../config/config.js';
import type { SkillRunRequestV1 } from './types.js';

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep(obj[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalizeForSignature(payload: Record<string, unknown>): string {
  const stable = sortKeysDeep(payload);
  return JSON.stringify(stable);
}

export function hmacSha256Hex(secret: string, canonicalPayload: string): string {
  return crypto.createHmac('sha256', secret).update(Buffer.from(canonicalPayload, 'utf8')).digest('hex');
}

export function signRunPayload(payloadWithoutSignature: Omit<SkillRunRequestV1, 'signature'>, secret: string): SkillRunRequestV1 {
  const canonical = canonicalizeForSignature(payloadWithoutSignature as unknown as Record<string, unknown>);
  const signature = hmacSha256Hex(secret, canonical);
  return {
    ...payloadWithoutSignature,
    signature,
  };
}

export function assertProtocolVersion(version: string): void {
  if (version !== config.skillGateway.protocolVersion) {
    throw new Error(`PROTOCOL_VERSION_UNSUPPORTED: expected ${config.skillGateway.protocolVersion}, got ${version}`);
  }
}
