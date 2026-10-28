#!/usr/bin/env node
// Release progress stored in <project>/build/release-agent/state.json so a
// session that is interrupted (for example during a long Central sync) can resume.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runCli, check, result, UsageError } from './lib/cli.mjs';

const SECRET_KEY = /(password|passphrase|secret|token|privatekey|signingkey|credential)/i;

export function statePath(projectDir) {
  return join(projectDir, 'build', 'release-agent', 'state.json');
}

export function readState(projectDir) {
  const file = statePath(projectDir);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function updateState(projectDir, entries, now = new Date()) {
  for (const key of Object.keys(entries)) {
    if (SECRET_KEY.test(key)) throw new UsageError(`Refusing to store "${key}": state must never hold secrets`);
  }
  const file = statePath(projectDir);
  mkdirSync(dirname(file), { recursive: true });
  const next = { ...(readState(projectDir) ?? { startedAt: now.toISOString() }), ...entries, updatedAt: now.toISOString() };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function parsePairs(pairs) {
  const entries = {};
  for (const pair of pairs) {
    const i = pair.indexOf('=');
    if (i <= 0) throw new UsageError(`Expected key=value, got "${pair}"`);
    entries[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return entries;
}

const usage = `Usage:
  state.mjs show [--project <dir>]
  state.mjs set key=value [key=value ...] [--project <dir>]`;

await runCli(import.meta.url, { options: { project: { type: 'string', default: '.' } }, usage, allowPositionals: true }, (values, positionals) => {
  const [command, ...rest] = positionals;
  if (command === 'show') {
    const state = readState(values.project);
    return result([check('state', 'pass', state ? `Release in progress: phase ${state.phase ?? 'unknown'}` : 'No release in progress')], state);
  }
  if (command === 'set') {
    if (rest.length === 0) throw new UsageError('set needs at least one key=value');
    const state = updateState(values.project, parsePairs(rest));
    return result([check('state', 'pass', `Saved ${rest.length} value(s) to ${statePath(values.project)}`)], state);
  }
  throw new UsageError(`Unknown command "${command ?? ''}"`);
});
