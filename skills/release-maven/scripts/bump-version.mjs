#!/usr/bin/env node
// Phase 3: changes the version literal(s) in place. Shows the diff unless --write is given.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runCli, check, result, required } from '../../release-agent-shared/scripts/lib/cli.mjs';
import { detectProject } from './lib/gradle.mjs';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function bumpVersion({ projectDir = '.', to, write = false }) {
  const root = resolve(projectDir);
  const project = detectProject(root);
  const modules = project.modules.filter((m) => m.setup !== 'none');
  const unique = new Map();
  for (const m of modules) for (const s of m.versionSources) unique.set(`${s.file}:${s.line}`, s);
  const sources = [...unique.values()];

  if (sources.length === 0) {
    return result([check('bump.sources', 'fail', 'No version literal found to change', { fix: 'The version may be computed; ask the user how to set it.' })]);
  }
  const currents = [...new Set(sources.map((s) => s.current))];
  if (currents.length > 1) {
    return result([check('bump.sources', 'fail', `Version literals disagree: ${currents.join(', ')}`, { fix: 'Ask the user which is authoritative before changing anything.' })], { sources });
  }
  if (currents[0] === to) {
    return result([check('bump.sources', 'warn', `Version is already ${to}; nothing to change`)], { sources });
  }

  const byFile = new Map();
  for (const s of sources) byFile.set(s.file, [...(byFile.get(s.file) ?? []), s]);
  const diff = [];
  for (const [file, list] of byFile) {
    const path = join(root, file);
    const lines = readFileSync(path, 'utf8').split('\n');
    for (const s of list) {
      const before = lines[s.line - 1];
      const after = before.replace(new RegExp(`(["'=:\\s])${escape(s.current)}(["']|\\s*$)`), `$1${to}$2`);
      if (after === before) throw new Error(`Could not locate ${s.current} on ${file}:${s.line}`);
      lines[s.line - 1] = after;
      diff.push({ file, line: s.line, before: before.trim(), after: after.trim() });
    }
    if (write) writeFileSync(path, lines.join('\n'));
  }
  const message = write ? `Changed ${diff.length} line(s) from ${currents[0]} to ${to}` : `Would change ${diff.length} line(s) from ${currents[0]} to ${to} (run with --write)`;
  return result([check('bump.write', 'pass', message)], { from: currents[0], to, written: write, files: [...byFile.keys()], diff });
}

await runCli(import.meta.url, {
  usage: 'Usage: bump-version.mjs --to <version> [--project <dir>] [--write]',
  options: { project: { type: 'string', default: '.' }, to: { type: 'string' }, write: { type: 'boolean', default: false } },
}, (v) => {
  required(v, 'to');
  return bumpVersion({ projectDir: v.project, to: v.to, write: v.write });
});
