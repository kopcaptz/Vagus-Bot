import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startDemoSkillServer } from './demo_skill_server.ts';
import type { Server } from 'node:http';

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortKeysDeep(obj[key]);
    return out;
  }
  return value;
}

function sign(payload: Record<string, unknown>, secret: string): string {
  const canonical = JSON.stringify(sortKeysDeep(payload));
  return crypto.createHmac('sha256', secret).update(Buffer.from(canonical, 'utf8')).digest('hex');
}

async function captureLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
    originalLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
    originalWarn(...args);
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
  return lines;
}

function assertHasLog(lines: string[], expected: string): void {
  const found = lines.some(line => line.includes(expected));
  assert.equal(found, true, `expected log marker "${expected}" not found`);
}

function assertKillSwitchLogs(registryPath: string): void {
  const evalCode = `
import { createRemoteGatewaySkill } from './src/skills/remote-gateway/index.ts';
await createRemoteGatewaySkill();
`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--eval', evalCode], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SKILL_GATEWAY_ENABLED: 'true',
      SKILL_GATEWAY_KILL: '1',
      SKILL_GATEWAY_ALLOWED_PROTOCOLS: 'http,https',
      SKILL_GATEWAY_PROTOCOL_VERSION: '1.0',
      SKILL_GATEWAY_REGISTRY_PATH: registryPath,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `kill-switch subprocess failed: ${result.stderr}`);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(output.includes('GATEWAY_DISABLED'), true, 'missing GATEWAY_DISABLED log for kill-switch');
  assert.equal(output.includes('registration_skipped reason=kill_switch_active'), true, 'missing registration_skipped log for kill-switch');
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const registryPath = path.join(os.tmpdir(), `skill-gateway-registry-${Date.now()}.json`);

  process.env.SKILL_GATEWAY_ENABLED = 'true';
  process.env.SKILL_GATEWAY_KILL = '';
  process.env.SKILL_GATEWAY_ALLOWED_PROTOCOLS = 'http,https';
  process.env.SKILL_GATEWAY_REQUEST_TIMEOUT_MS = '800';
  process.env.SKILL_GATEWAY_PROTOCOL_VERSION = '1.0';
  process.env.SKILL_GATEWAY_REGISTRY_PATH = registryPath;
  process.env.DEMO_SKILL_HMAC_SECRET = 'demo-secret';

  const registry = {
    skills: [
      {
        skill_id: 'demo.echo',
        base_url: 'http://127.0.0.1:4050',
        auth: {
          type: 'hmac',
          header_name: 'X-Skill-Signature',
          secret_env_key: 'DEMO_SKILL_HMAC_SECRET',
        },
        allowlist_capabilities: ['demo.echo'],
        rate_limit_per_minute: 60,
        timeout_ms: 800,
      },
    ],
  };
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2));

  let server = await startDemoSkillServer({ protocolVersion: '1.0', secret: 'demo-secret' });
  try {
    const { createRemoteGatewaySkill } = await import('../src/skills/remote-gateway/index.ts');
    let skill = null as Awaited<ReturnType<typeof createRemoteGatewaySkill>>;
    const creationLogs = await captureLogs(async () => {
      skill = await createRemoteGatewaySkill();
    });
    assert(skill, 'remote gateway skill should be created');
    assertHasLog(creationLogs, 'registry_loaded path=');
    assertHasLog(creationLogs, 'registry_summary skills=1 capabilities=1');
    assertHasLog(creationLogs, 'manifest_discovery_start skill_id=demo.echo');
    assertHasLog(creationLogs, 'manifest_protocol_ok version=1.0');
    assertHasLog(creationLogs, 'manifest_schema_ok skill_id=demo.echo');
    assertHasLog(creationLogs, 'remote_tools_registered count=1');

    const okRaw = await skill!.execute('remote_skill.demo.echo', { message: 'hello' });
    const ok = JSON.parse(okRaw);
    assert.equal(ok.ok, true);
    assert.equal(ok.output.result, 'echo:hello');

    const badSchemaRaw = await skill!.execute('remote_skill.demo.echo', { message: 'x', mode: 'invalid_output' });
    const badSchema = JSON.parse(badSchemaRaw);
    assert.equal(badSchema.ok, false);
    assert.equal(badSchema.error_code, 'SCHEMA_VALIDATION_FAILED');

    const timeoutRaw = await skill!.execute('remote_skill.demo.echo', { message: 'x', mode: 'timeout' });
    const timeout = JSON.parse(timeoutRaw);
    assert.equal(timeout.ok, false);
    assert.equal(timeout.error_code, 'SKILL_TIMEOUT');

    // Nonce replay check (direct server contract check)
    const nonce = 'fixed-nonce-replay-check';
    const basePayload = {
      gateway_protocol_version: '1.0',
      skill_id: 'demo.echo',
      capability: 'demo.echo',
      input: { message: 'nonce-check' },
      timestamp: Date.now(),
      nonce,
    };
    const payload = { ...basePayload, signature: sign(basePayload, 'demo-secret') };
    const first = await fetch('http://127.0.0.1:4050/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(first.ok, true);
    const second = await fetch('http://127.0.0.1:4050/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    assert.equal(second.ok, false);
    const secondJson = (await second.json()) as { error_code?: string };
    assert.equal(secondJson.error_code, 'NONCE_REPLAY');

    // Protocol mismatch should prevent discovery
    await closeServer(server);
    server = await startDemoSkillServer({ protocolVersion: '2.0', secret: 'demo-secret' });
    await sleep(50);
    const { clearManifestCacheForTests } = await import('../src/skills/remote-gateway/discovery.ts');
    clearManifestCacheForTests();
    let mismatchSkill = null as Awaited<ReturnType<typeof createRemoteGatewaySkill>>;
    const mismatchLogs = await captureLogs(async () => {
      mismatchSkill = await createRemoteGatewaySkill();
    });
    assert.equal(mismatchSkill, null);
    assertHasLog(mismatchLogs, 'skill_skipped skill_id=demo.echo reason=PROTOCOL_VERSION_UNSUPPORTED');
    assertHasLog(mismatchLogs, 'registration_skipped reason=no_routes_discovered');

    assertKillSwitchLogs(registryPath);

    console.log('Skill Gateway smoke: happy path, schema error, timeout, nonce replay, protocol mismatch passed.');
  } finally {
    await closeServer(server);
    try {
      fs.unlinkSync(registryPath);
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
