import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SECRET, SUPABASE_URL } from './support';

// Runs the dispatcher Edge Function's code directly with Deno (the npm "deno" dev dependency),
// against the local database, so a test can give it its own secrets (e.g. a fake Resend) and
// stop it mid-send. Deno.serve listens on port 8000.
export const DENO_DISPATCHER_URL = 'http://127.0.0.1:8000';

const DENO = join('node_modules', 'deno', process.platform === 'win32' ? 'deno.exe' : 'deno');
const FUNCTION = 'supabase/functions/dispatch-notifications';

export async function startDenoDispatcher(secrets: Record<string, string>) {
  if (!existsSync(DENO)) throw new Error(`${DENO} not found: run npm install`);

  // Never inherit live-sending or provider settings from the developer's shell.
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ['NOTIFICATIONS_LIVE', 'RESEND_API_KEY', 'RESEND_API_URL', 'EMAIL_FROM_ADDRESS']) delete env[name];
  Object.assign(env, {
    SUPABASE_URL,
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: process.env.SUPABASE_SECRET_KEY }),
    DISPATCH_SECRET: SECRET,
    APP_URL: 'http://localhost:3000',
    ...secrets,
  });

  const child: ChildProcess = spawn(DENO, ['run', '--allow-net', '--allow-env', '--config', `${FUNCTION}/deno.json`, `${FUNCTION}/index.ts`], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (chunk) => (output += chunk));
  child.stderr!.on('data', (chunk) => (output += chunk));

  // Ready once it answers (without the secret: 401).
  for (let attempt = 0; attempt < 240; attempt++) {
    if (child.exitCode !== null) throw new Error(`The Deno dispatcher exited:\n${output}`);
    try {
      if ((await fetch(DENO_DISPATCHER_URL, { method: 'POST' })).status === 401) break;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (attempt === 239) throw new Error(`The Deno dispatcher did not start:\n${output}`);
  }

  return {
    // Kills the process outright, as a crash would.
    async kill() {
      if (child.exitCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    },
    output: () => output,
  };
}
