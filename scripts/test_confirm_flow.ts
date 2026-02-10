/**
 * Тест сценария подтверждения (Фаза 3): git push без токена -> NEEDS_CONFIRMATION,
 * затем повтор с токеном -> выполнение (или попытка запуска).
 *
 * Запуск: npx tsx scripts/test_confirm_flow.ts
 * На Windows для Git добавь доверенный путь (скрипт добавляет AppData/Programs/Git при необходимости).
 */
process.env.CLI_GATEWAY_MODE = 'CONFIRM';
if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  const gitPath = `${process.env.LOCALAPPDATA}\\Programs\\Git`;
  const existing = process.env.CLI_GATEWAY_TRUSTED_DIRS || '';
  process.env.CLI_GATEWAY_TRUSTED_DIRS = existing ? `${existing},${gitPath}` : gitPath;
}

const { CliGatewaySkill } = await import('../src/skills/cli-gateway/index.js');
const skill = new CliGatewaySkill();

console.log('1) Запрос git push без токена — ожидаем CONFIRMATION_REQUIRED и токен в ответе...\n');

const res1 = await skill.execute('system_cli_gateway', {
  executable: 'git',
  args: ['push'],
});
const out1 = JSON.parse(res1);

if (out1.ok === false && out1.error === 'CONFIRMATION_REQUIRED' && out1.confirm_token) {
  console.log('   OK: получен ответ CONFIRMATION_REQUIRED, токен:', out1.confirm_token);
  console.log('   Сообщение:', out1.message);
} else {
  console.log('   FAIL: ожидали CONFIRMATION_REQUIRED с confirm_token. Ответ:', res1.slice(0, 400));
  process.exit(1);
}

const token = out1.confirm_token as string;
console.log('\n2) Повтор запроса с токеном — ожидаем выполнение команды (или попытку)...\n');

const res2 = await skill.execute('system_cli_gateway', {
  executable: 'git',
  args: ['push'],
  confirm_token: token,
});
const out2 = JSON.parse(res2);

if (out2.ok === true) {
  console.log('   OK: команда выполнена. exit_code:', out2.exit_code, 'duration_ms:', out2.duration_ms);
  if (out2.stdout) console.log('   stdout:', out2.stdout.slice(0, 300));
  if (out2.stderr) console.log('   stderr:', out2.stderr.slice(0, 300));
} else if (out2.error === 'INVALID_CONFIRM_TOKEN') {
  console.log('   FAIL: токен признан недействительным (возможно уже использован или истёк).');
  process.exit(1);
} else {
  console.log('   Результат (может быть ошибка выполнения git push, но не INVALID_CONFIRM_TOKEN):', out2.error, out2.message);
  if (out2.ok === false && out2.error !== 'INVALID_CONFIRM_TOKEN') {
    console.log('   Команда была принята к выполнению; ошибка может быть от самого git (сеть/авторизация).');
  }
}

console.log('\n3) Повторное использование того же токена — ожидаем INVALID_CONFIRM_TOKEN...\n');

const res3 = await skill.execute('system_cli_gateway', {
  executable: 'git',
  args: ['push'],
  confirm_token: token,
});
const out3 = JSON.parse(res3);

if (out3.ok === false && out3.error === 'INVALID_CONFIRM_TOKEN') {
  console.log('   OK: одноразовый токен корректно отклонён при повторном использовании.');
} else {
  console.log('   FAIL: ожидали INVALID_CONFIRM_TOKEN. Ответ:', res3.slice(0, 300));
  process.exit(1);
}

console.log('\nВсе проверки сценария подтверждения пройдены.');
process.exit(0);
