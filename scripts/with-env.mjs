import { spawnSync } from 'node:child_process';

const [script, ...args] = process.argv.slice(2);
const npm = process.env.npm_execpath;
if (!npm || !script || script === 'with-env' || script.startsWith('-')) {
  console.error('Usage: npm run with-env -- <script> [-- arguments]');
  process.exitCode = 1;
} else {
  // --env-file must load before spawning npm; Node's --run does not forward it.
  const result = spawnSync(process.execPath, [npm, 'run', script, ...args], {
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) console.error('Could not start the requested npm script.');
  process.exitCode = result.status ?? 1;
  if (result.signal) process.kill(process.pid, result.signal);
}
