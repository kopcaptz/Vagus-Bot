import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

async function main() {
  process.env.CLI_GATEWAY_MODE = 'CONFIRM';
  process.env.CLI_GATEWAY_PROJECT_ROOT = process.cwd();
  delete process.env.CLI_GATEWAY_KILL;

  const [{ scrubSecrets }, cfgMod, skillMod] = await Promise.all([
    import('../src/skills/cli-gateway/sanitizer.js'),
    import('../src/skills/cli-gateway/config.js'),
    import('../src/skills/cli-gateway/index.js'),
  ]);

  const { isKillSwitchActive, cliGatewayConfig } = cfgMod;
  const { CliGatewaySkill } = skillMod;

  // sanitizer
  const redacted = scrubSecrets('Bearer abc.def.ghi and API_KEY=sk-12345678901234567890');
  assert(!redacted.includes('abc.def.ghi'));
  assert(!redacted.includes('sk-12345678901234567890'));
  assert(redacted.includes('[REDACTED]'));

  // kill-switch via env
  process.env.CLI_GATEWAY_KILL = '1';
  assert.equal(isKillSwitchActive(), true);
  delete process.env.CLI_GATEWAY_KILL;

  // kill-switch via file
  const stopPath = path.join(cliGatewayConfig.projectRoot, cliGatewayConfig.stopFlagFile);
  fs.writeFileSync(stopPath, '');
  assert.equal(isKillSwitchActive(), true);
  fs.unlinkSync(stopPath);
  assert.equal(isKillSwitchActive(), false);

  // shell-injection guard
  const skill = new CliGatewaySkill();
  const injectionRaw = await skill.execute('system_cli_gateway', {
    executable: 'git',
    args: ['status', '&&', 'format', 'c:'],
    cwd: '.',
  });
  const injection = JSON.parse(injectionRaw);
  assert.equal(injection.ok, false);
  assert.equal(injection.error, 'SHELL_INJECTION_DETECTED');

  // confirmation required flow (without token)
  const confirmRaw = await skill.execute('system_cli_gateway', {
    executable: 'npm',
    args: ['install'],
    cwd: '.',
  });
  const confirm = JSON.parse(confirmRaw);
  assert.equal(confirm.ok, false);
  assert.equal(confirm.error, 'CONFIRMATION_REQUIRED');
  assert.equal(typeof confirm.confirm_token, 'string');

  console.log('CLI gateway unit checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

