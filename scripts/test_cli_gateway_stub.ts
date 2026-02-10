/**
 * Quick check: CLI Gateway Phase 1 stub works (execute returns NOT_IMPLEMENTED, status returns BLOCKED).
 * Run from repo root: npx tsx scripts/test_cli_gateway_stub.ts
 */
import { CliGatewaySkill } from '../src/skills/cli-gateway/index.js';

const skill = new CliGatewaySkill();

// 1) system_cli_gateway: must not execute, return stub (NOT_IMPLEMENTED / Phase 1)
const execResult = await skill.execute('system_cli_gateway', {
  executable: 'git',
  args: ['status'],
  cwd: process.cwd(),
});
const stubOk = execResult.includes('NOT_IMPLEMENTED') && execResult.includes('Phase 1');
console.log(stubOk ? 'OK: system_cli_gateway returns stub (NOT_IMPLEMENTED)' : 'FAIL: execute response:', execResult.slice(0, 180));

// 2) system_cli_gateway_status: must return BLOCKED
const statusResult = await skill.execute('system_cli_gateway_status', {});
const hasBlocked = String(statusResult).includes('BLOCKED');
console.log(hasBlocked ? 'OK: system_cli_gateway_status returns BLOCKED' : 'FAIL: status response:', statusResult.slice(0, 180));

const ok = stubOk && hasBlocked;
process.exit(ok ? 0 : 1);
