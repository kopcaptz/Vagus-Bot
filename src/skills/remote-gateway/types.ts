export type GatewayErrorCode =
  | 'MANIFEST_INVALID'
  | 'PROTOCOL_VERSION_UNSUPPORTED'
  | 'NONCE_REPLAY'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'SKILL_TIMEOUT'
  | 'SKILL_AUTH_FAILED'
  | 'GATEWAY_DISABLED'
  | 'ROUTING_FAILED'
  | 'SKILL_HTTP_ERROR';

export interface GatewayError {
  ok: false;
  error_code: GatewayErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface RemoteCapabilityManifest {
  capability: string;
  description: string;
  input_schema: JsonSchemaObject;
  output_schema: JsonSchemaObject;
}

export interface SkillManifestV1 {
  gateway_protocol_version: string;
  id: string;
  version: string;
  capabilities: RemoteCapabilityManifest[];
  requires?: Record<string, unknown>;
  safety?: Record<string, unknown>;
}

export interface SkillRunRequestV1 {
  gateway_protocol_version: string;
  skill_id: string;
  capability: string;
  input: Record<string, unknown>;
  timestamp: number;
  nonce: string;
  signature: string;
}

export interface SkillRunResponseOkV1 {
  ok: true;
  output: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export type SkillRunResponseV1 = SkillRunResponseOkV1 | GatewayError;

export interface RemoteSkillRegistryEntry {
  skill_id: string;
  base_url: string;
  auth: {
    type: 'api_key' | 'hmac';
    header_name?: string;
    secret_env_key?: string;
  };
  allowlist_capabilities: string[];
  rate_limit_per_minute?: number;
  timeout_ms?: number;
}

export interface RemoteSkillRegistryFile {
  skills: RemoteSkillRegistryEntry[];
}
