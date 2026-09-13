import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

test('env runner passes file values and arguments to npm, preserves shell precedence and failure status', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cmon-env-runner-'));
  try {
    writeFileSync(
      join(cwd, '.env'),
      'CMON_ENV_TEST_FILE=file-value\nCMON_ENV_TEST_OVERRIDE=file-value\n',
    );
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ scripts: { probe: 'node probe.cjs', fail: 'node -e "process.exit(7)"' } }),
    );
    writeFileSync(
      join(cwd, 'probe.cjs'),
      `console.log(JSON.stringify({ file: process.env.CMON_ENV_TEST_FILE, override: process.env.CMON_ENV_TEST_OVERRIDE, args: process.argv.slice(2) }));`,
    );
    const env: NodeJS.ProcessEnv = { ...process.env, CMON_ENV_TEST_OVERRIDE: 'shell-value' };
    delete env.CMON_ENV_TEST_FILE;
    const run = (args: string[]) =>
      spawnSync(process.execPath, ['--env-file=.env', resolve('scripts/with-env.mjs'), ...args], {
        cwd,
        env,
        encoding: 'utf8',
      });
    const success = run(['probe', '--', 'a b', 'literal-$value']);
    expect(success.status, success.stderr).toBe(0);
    expect(success.stdout).toContain(
      JSON.stringify({
        file: 'file-value',
        override: 'shell-value',
        args: ['a b', 'literal-$value'],
      }),
    );
    expect(run(['fail']).status).toBe(7);
    expect(run(['with-env']).status).toBe(1);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
