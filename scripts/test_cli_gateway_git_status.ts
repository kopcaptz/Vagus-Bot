/**
 * Проверка Фазы 2: system_cli_gateway с git status возвращает реальный вывод.
 * Запуск: CLI_GATEWAY_MODE=SAFE npx tsx scripts/test_cli_gateway_git_status.ts
 * На Windows Git часто в AppData — добавь в CLI_GATEWAY_TRUSTED_DIRS или задай здесь:
 */
process.env.CLI_GATEWAY_MODE = process.env.CLI_GATEWAY_MODE || 'SAFE';
if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  const gitPath = `${process.env.LOCALAPPDATA}\\Programs\\Git`;
  const existing = process.env.CLI_GATEWAY_TRUSTED_DIRS || '';
  process.env.CLI_GATEWAY_TRUSTED_DIRS = existing ? `${existing},${gitPath}` : gitPath;
}

const { CliGatewaySkill } = await import('../src/skills/cli-gateway/index.js');
const skill = new CliGatewaySkill();

const result = await skill.execute('system_cli_gateway', {
  executable: 'git',
  args: ['status'],
});

console.log('--- Raw response (first 800 chars) ---');
console.log(result.slice(0, 800));
console.log('---');

const parsed = JSON.parse(result);
if (parsed.ok && parsed.stdout !== undefined) {
  console.log('OK: real git status output:');
  console.log(parsed.stdout);
  process.exit(0);
} else {
  console.log('Unexpected response:', parsed);
  process.exit(1);
}
