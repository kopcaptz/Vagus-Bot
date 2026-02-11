# Skill Gateway v1 Specification

## Goal

Skill Gateway v1 lets Vagus call external workers over HTTP(S) safely.
Vagus does not execute remote logic directly and does not trust remote responses as control instructions.

## Scope

- MVP-1:
  - local registry of remote skills
  - manifest discovery (`GET /manifest`)
  - one or more runtime calls (`POST /run`)
  - strict input/output schema validation
  - authentication and signing
  - replay protection fields and nonce handling
  - timeout / rate-limit / kill-switch
- MVP-2 (out of scope):
  - marketplace and auto-discovery
  - dynamic policy editor and advanced observability
  - retry orchestration and tenant-level policy layers

## Security model

- Remote skill URLs come only from local registry.
- LLM must never provide or override remote URL.
- Remote response is treated as data only.
- No system-prompt mutation from remote payloads.
- No secret leakage to remote payloads.

## Endpoints

### GET /manifest

Required response fields:

- `gateway_protocol_version` (string, current: `1.0`)
- `id` (string)
- `version` (string)
- `capabilities` (string[])
- `input_schema` (JSON Schema object)
- `output_schema` (JSON Schema object)
- `requires` (object, optional, e.g. auth requirements)
- `safety` (object, optional policy metadata)

Example:

```json
{
  "gateway_protocol_version": "1.0",
  "id": "demo.echo",
  "version": "1.0.0",
  "capabilities": ["demo.echo"],
  "input_schema": {
    "type": "object",
    "properties": {
      "message": { "type": "string" }
    },
    "required": ["message"],
    "additionalProperties": false
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "result": { "type": "string" }
    },
    "required": ["result"],
    "additionalProperties": false
  },
  "requires": {
    "auth": "hmac-sha256"
  },
  "safety": {
    "data_handling": "no_secrets"
  }
}
```

### POST /run

Request (signed):

- `gateway_protocol_version`
- `skill_id`
- `capability`
- `input`
- `timestamp` (unix ms)
- `nonce` (unique for ttl window)
- `signature` (HMAC-SHA256 over canonical payload)

Example:

```json
{
  "gateway_protocol_version": "1.0",
  "skill_id": "demo.echo",
  "capability": "demo.echo",
  "input": { "message": "hello" },
  "timestamp": 1735689600000,
  "nonce": "ec95ea7f3a5f4d7d9e3d133114a2fce7",
  "signature": "a4f7e9..."
}
```

Response:

```json
{
  "ok": true,
  "output": { "result": "hello" },
  "meta": { "duration_ms": 12 }
}
```

## Version compatibility

- Current supported protocol: `1.0`.
- Incompatible version must return `PROTOCOL_VERSION_UNSUPPORTED`.

## Authentication and signing

- Supported auth in MVP-1:
  - API key header
  - HMAC-SHA256 signature
- Signature uses canonical JSON serialization:
  - fixed field set:
    - `gateway_protocol_version`
    - `skill_id`
    - `capability`
    - `input`
    - `timestamp`
    - `nonce`
  - recursive key sorting
  - UTF-8 bytes
  - hash algorithm: SHA-256

## Replay protection

- Timestamp validation window: `±120s` default.
- Nonce TTL window: `5 minutes` default.
- Reused nonce inside TTL must fail with `NONCE_REPLAY`.

## Schema enforcement

- Validate input against manifest `input_schema` before sending.
- Validate output against manifest `output_schema` after receiving.
- Enforce `additionalProperties: false` for strict contracts.

## Data minimization

- Forward only whitelisted `input` fields.
- Never forward:
  - API keys/tokens/secrets
  - system prompts
  - internal reasoning or hidden orchestration metadata

## Error contract

Gateway-level error codes:

- `MANIFEST_INVALID`
- `PROTOCOL_VERSION_UNSUPPORTED`
- `NONCE_REPLAY`
- `SCHEMA_VALIDATION_FAILED`
- `SKILL_TIMEOUT`
- `SKILL_AUTH_FAILED`
- `GATEWAY_DISABLED`
- `ROUTING_FAILED`
- `SKILL_HTTP_ERROR`

Error response format:

```json
{
  "ok": false,
  "error_code": "SCHEMA_VALIDATION_FAILED",
  "message": "Output schema validation failed",
  "details": { "path": "/output/result", "expected": "string" }
}
```

## Routing policy

- Route by local map:
  - `capability -> skill_id -> base_url`
- Ignore any URL-like data from model input.

## Logging policy

- Log only sanitized payload fragments.
- Never log full secrets or auth headers.
- Never log hidden system prompts.

## Minimal Log-Contract (MVP-1 acceptance)

When gateway is enabled, runtime logs must include deterministic markers:

- Boot:
  - `remote_gateway enabled=true|false`
  - `remote_gateway kill_switch=true|false`
- Registry:
  - `registry_loaded path=...`
  - `registry_summary skills=M capabilities=N`
- Discovery:
  - `manifest_discovery_start skill_id=... base_url=...`
  - `manifest_protocol_ok version=...`
  - `manifest_schema_ok skill_id=...`
  - `manifest_cached skill_id=...` (on cache hit)
- Registration:
  - `remote_tools_registered count=N tools=[...]`
- Fail-closed:
  - `GATEWAY_DISABLED + registration_skipped reason=...`
  - `PROTOCOL_VERSION_UNSUPPORTED + skill_skipped skill_id=... reason=...`
  - No silent skip is allowed: every skipped skill must log a reason.
