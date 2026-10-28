#!/usr/bin/env node
// Creates a GitHub release from a CHANGELOG section. Without --create it only
// prints the command, so nothing outward-facing happens by accident.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runCli, check, result, required } from './lib/cli.mjs';

export function extractSection(changelogText, version) {
  const lines = changelogText.split('\n');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = lines.findIndex((l) => new RegExp(`^## \\[?v?${escaped}(\\]|\\s|$)`).test(l));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && /^## \[?v?\d+\.\d+/.test(l));
  if (end === -1) end = lines.length;
  // Drop link reference definitions that trail the last section.
  return lines.slice(start + 1, end).filter((l) => !/^\[[^\]]+\]:\s*\S+/.test(l)).join('\n').trim();
}

function ghStatus() {
  try {
    execFileSync('gh', ['--version'], { stdio: 'ignore' });
  } catch {
    return 'missing';
  }
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
    return 'ready';
  } catch {
    return 'unauthenticated';
  }
}

const quote = (s) => (/^[\w./:@-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export function githubRelease({ cwd = '.', tag, version, changelogPath, title, draft = false, create = false }) {
  const file = join(cwd, changelogPath);
  if (!existsSync(file)) return result([check('release.changelog', 'fail', `${changelogPath} not found`)]);
  const notes = extractSection(readFileSync(file, 'utf8'), version);
  if (!notes) return result([check('release.changelog', 'fail', `No section for ${version} in ${changelogPath}`, { fix: 'Run changelog.mjs first.' })]);

  const notesDir = join(cwd, 'build', 'release-agent');
  mkdirSync(notesDir, { recursive: true });
  const notesFile = join(notesDir, `release-notes-${version}.md`);
  writeFileSync(notesFile, `${notes}\n`);

  const args = ['release', 'create', tag, '--title', title ?? version, '--notes-file', notesFile, '--verify-tag'];
  if (draft) args.push('--draft');
  const command = `gh ${args.map(quote).join(' ')}`;
  const data = { notes, notesFile, command };

  const gh = ghStatus();
  if (!create) return result([check('release.dry-run', 'pass', `Not created (no --create). Command: ${command}`)], { ...data, gh });
  if (gh !== 'ready') {
    const why = gh === 'missing' ? 'gh CLI is not installed' : 'gh CLI is not logged in';
    return result([check('release.gh', 'warn', `${why}; run the command yourself or create the release on github.com`, {
      fix: gh === 'missing' ? 'Install gh (https://cli.github.com) or create the release in the browser with the notes file.' : 'Run `gh auth login`, then retry.',
    })], { ...data, gh });
  }
  try {
    const url = execFileSync('gh', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return result([check('release.create', 'pass', `Created GitHub release ${tag}`)], { ...data, url });
  } catch (err) {
    return result([check('release.create', 'fail', `gh failed: ${(err.stderr || err.message).toString().trim()}`, {
      fix: 'If the tag is not on the remote yet, push it first (gh is called with --verify-tag).',
    })], data);
  }
}

const usage = 'Usage: github-release.mjs --tag <tag> --version <version> [--changelog CHANGELOG.md] [--title <title>] [--draft] [--create] [--cwd <dir>]';

await runCli(import.meta.url, {
  usage,
  options: {
    tag: { type: 'string' }, version: { type: 'string' }, changelog: { type: 'string', default: 'CHANGELOG.md' },
    title: { type: 'string' }, draft: { type: 'boolean', default: false }, create: { type: 'boolean', default: false },
    cwd: { type: 'string', default: '.' },
  },
}, (v) => {
  required(v, 'tag', 'version');
  return githubRelease({ cwd: v.cwd, tag: v.tag, version: v.version, changelogPath: v.changelog, title: v.title, draft: v.draft, create: v.create });
});
