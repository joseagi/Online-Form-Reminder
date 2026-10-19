// Creates the first administrator for an environment (everyone after that is invited from the
// app). Uses the server-only secret key, so run it from a trusted machine:
//
//   npm run admin:create -- --email you@your-office.ng --name "Your Name"
//
// Prints a one-time password. Sign in with it, then choose your own under "Change password".
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
const email = values.email?.trim();
const name = values.name?.trim();
if (!email || !name) {
  console.error('Usage: npm run admin:create -- --email <email> --name "<full name>"');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set (see .env.example).');
  process.exit(1);
}

const supabase = createClient(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Random, with at least one letter and one digit to satisfy the password policy.
const password = `${randomBytes(12).toString('base64url')}a7`;

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: name },
});
if (error) {
  console.error(`Could not create the user: ${error.message}`);
  process.exit(1);
}

// The profile was created by a database trigger; promote it.
const { error: roleError } = await supabase.from('profiles').update({ role: 'admin' }).eq('id', data.user.id);
if (roleError) {
  console.error(`User created, but promoting to admin failed: ${roleError.message}`);
  process.exit(1);
}

console.log(`Administrator created: ${name} <${email}>`);
console.log(`One-time password:     ${password}`);
console.log('Sign in, then choose your own password under "Change password".');
