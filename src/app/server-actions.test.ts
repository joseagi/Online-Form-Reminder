import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Server Actions are public HTTP endpoints: anyone can call them, whatever the page shows. So every
// exported action must check who is calling (requireUser / requireAdmin) before doing anything,
// unless it is meant for signed-out visitors. This reads the source of every 'use server' file.

// Meant for signed-out visitors; each does its own validation.
const PUBLIC_ACTIONS = new Set([
  'app/login/actions.ts#signIn',
  'app/forgot-password/actions.ts#requestPasswordReset',
  'app/auth/confirm/actions.ts#confirmEmailLink',
  'app/actions.ts#signOut',
]);

const SRC = join(__dirname, '..');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

const actionFiles = filesUnder(SRC).filter((file) => /^\s*['"]use server['"]/.test(readFileSync(file, 'utf8')));

// Top-level functions (the code style puts them at column 0, closed by a "}" at column 0).
function functionsIn(source: string): Map<string, { exported: boolean; body: string }> {
  const found = new Map<string, { exported: boolean; body: string }>();
  for (const match of source.matchAll(/^(export )?async function (\w+)[\s\S]*?^}/gm)) {
    found.set(match[2], { exported: Boolean(match[1]), body: match[0] });
  }
  return found;
}

// Checks the caller itself, or first calls a local helper that does.
function isGuarded(name: string, functions: Map<string, { body: string }>, seen = new Set<string>()): boolean {
  const body = functions.get(name)?.body ?? '';
  if (/\brequire(User|Admin)\(\)/.test(body)) return true;
  seen.add(name);
  return [...functions.keys()].some((helper) => !seen.has(helper) && new RegExp(`\\b${helper}\\(`).test(body.slice(body.indexOf('{'))) && isGuarded(helper, functions, seen));
}

describe('Server Actions', () => {
  it('are found', () => {
    expect(actionFiles.length).toBeGreaterThanOrEqual(10);
  });

  it.each(actionFiles.map((file) => [relative(SRC, file).replaceAll('\\', '/'), file]))(
    '%s: every exported action checks who is calling',
    (label, file) => {
      const source = readFileSync(file, 'utf8');
      // Only "export async function" is understood here; other export forms would escape the check.
      expect(source, 'use "export async function" for Server Actions').not.toMatch(/^export (const|let|default|\{)/m);

      const functions = functionsIn(source);
      const unguarded = [...functions.entries()]
        .filter(([name, fn]) => fn.exported && !PUBLIC_ACTIONS.has(`${label}#${name}`) && !isGuarded(name, functions))
        .map(([name]) => name);
      expect(unguarded, 'call requireUser() or requireAdmin() first, or list the action in PUBLIC_ACTIONS').toEqual([]);
    },
  );

  it('the public list names only actions that exist', () => {
    const existing = new Set(
      actionFiles.flatMap((file) =>
        [...functionsIn(readFileSync(file, 'utf8')).entries()]
          .filter(([, fn]) => fn.exported)
          .map(([name]) => `${relative(SRC, file).replaceAll('\\', '/')}#${name}`),
      ),
    );
    for (const entry of PUBLIC_ACTIONS) expect(existing, entry).toContain(entry);
  });
});
