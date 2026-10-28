// Common CLI plumbing: every script prints one JSON object { ok, checks, data? }
// and exits 0 (all checks passed or warned), 1 (a check failed) or 2 (usage error).
import { parseArgs } from 'node:util';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function check(id, status, message, extra = {}) {
  return { id, status, message, ...extra };
}

export function result(checks, data) {
  const ok = checks.every((c) => c.status !== 'fail');
  return data === undefined ? { ok, checks } : { ok, checks, data };
}

export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

function emit(obj, exitCode) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
  process.exitCode = exitCode;
}

export function progress(message) {
  process.stderr.write(`${message}\n`);
}

/**
 * Runs `handler(values, positionals)` when the module is executed directly.
 * The handler returns a result object; thrown errors become { ok: false, error }.
 */
export async function runCli(metaUrl, { options = {}, usage, allowPositionals = false }, handler) {
  if (!isMain(metaUrl)) return;
  let parsed;
  try {
    parsed = parseArgs({ options: { help: { type: 'boolean' }, ...options }, allowPositionals, strict: true });
  } catch (err) {
    emit({ ok: false, error: err.message, usage }, 2);
    return;
  }
  if (parsed.values.help) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  try {
    const out = await handler(parsed.values, parsed.positionals);
    emit(out, out.ok ? 0 : 1);
  } catch (err) {
    if (err instanceof UsageError) emit({ ok: false, error: err.message, usage }, 2);
    else emit({ ok: false, error: err.message }, 1);
  }
}

export class UsageError extends Error {}

export function required(values, ...names) {
  for (const name of names) {
    if (values[name] === undefined || values[name] === '') throw new UsageError(`--${name} is required`);
  }
}
