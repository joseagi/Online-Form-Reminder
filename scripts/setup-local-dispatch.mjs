// LOCAL DEVELOPMENT ONLY: gives the notification dispatcher a shared secret and tells the
// database (Vault) where to call it, so Supabase Cron can run it. Also gives the resend-webhook
// function a placeholder signing secret, so its tests can sign requests; to receive real reports
// from Resend, replace it with the webhook's own secret (see README).
//
//   npm run dispatch:setup
//
// Creates supabase/functions/.env (git-ignored) if needed, reusing existing secrets.
// Production is configured separately (Phase 7), with `supabase secrets set` and Vault.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const ENV_FILE = 'supabase/functions/.env';
// The address as seen from inside the database container (Docker network name of the API gateway,
// derived from project_id in supabase/config.toml).
const DISPATCH_URL = 'http://supabase_kong_office-reminders:8000/functions/v1/dispatch-notifications';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl)) {
  console.error(`Refusing to run: NEXT_PUBLIC_SUPABASE_URL (${supabaseUrl || 'unset'}) is not the local stack.`);
  process.exit(1);
}

let lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8').split(/\r?\n/).filter(Boolean) : [];
let secret = lines.find((line) => line.startsWith('DISPATCH_SECRET='))?.slice('DISPATCH_SECRET='.length).trim();
let created = false;
if (!secret) {
  secret = randomBytes(32).toString('base64url');
  lines = lines.filter((line) => !line.startsWith('DISPATCH_SECRET='));
  lines.push(`DISPATCH_SECRET=${secret}`);
  if (!lines.some((line) => line.startsWith('APP_URL='))) lines.push('APP_URL=http://localhost:3000');
  created = true;
}
if (!lines.some((line) => line.startsWith('RESEND_WEBHOOK_SECRET='))) {
  lines.push(`RESEND_WEBHOOK_SECRET=whsec_${randomBytes(32).toString('base64')}`);
  created = true;
}
if (created) writeFileSync(ENV_FILE, `${lines.join('\n')}\n`);

const supabase = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY ?? '', {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { error } = await supabase.rpc('configure_dispatch', { p_url: DISPATCH_URL, p_secret: secret });
if (error) {
  console.error(`Could not store the dispatcher settings in Vault: ${error.message}`);
  process.exit(1);
}

console.log(`Dispatcher configured: Supabase Cron will call ${DISPATCH_URL} every 5 minutes.`);
if (created) {
  console.log(`Updated ${ENV_FILE}. Restart the local stack so the functions see it: npm run db:stop && npm run db:start`);
}
