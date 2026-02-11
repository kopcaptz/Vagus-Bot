/**
 * Manual smoke script for CLI Gateway.
 *
 * Usage:
 *   npx tsx scripts/test_cli_gateway_smoke.ts
 *
 * Optional:
 *   RUN_SAFE=1 npx tsx scripts/test_cli_gateway_smoke.ts
 */

async function main() {
  process.env.CLI_GATEWAY_MODE = process.env.CLI_GATEWAY_MODE || 'SAFE';
  process.env.CLI_GATEWAY_PROJECT_ROOT = process.cwd();

  const { CliGatewaySkill } = await import('../src/skills/cli-gateway/index.js');
  const skill = new CliGatewaySkill();

  const payloads = [
    {
      name: 'Status',
      args: {},
      tool: 'system_cli_gateway_status',
    },
    {
      name: 'InjectionBlocked',
      tool: 'system_cli_gateway',
      args: { executable: 'git', args: ['status', '&&', 'format', 'c:'], cwd: '.' },
    },
  ];

  if (process.env.RUN_SAFE === '1') {
    payloads.push({
      name: 'SafeGitStatus',
      tool: 'system_cli_gateway',
      args: { executable: 'git', args: ['status'], cwd: '.' },
    });
  }

  for (const test of payloads) {
    const raw = await skill.execute(test.tool, test.args as Record<string, unknown>);
    console.log(`\n=== ${test.name} ===`);
    console.log(raw);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

