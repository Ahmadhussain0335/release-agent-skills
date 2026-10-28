#!/usr/bin/env node
// Drafts a Keep a Changelog entry (Added / Changed / Fixed) from commits since the last tag.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { runCli, check, result, required } from './lib/cli.mjs';
import { git, lastTag } from './lib/git.mjs';

const SECTIONS = ['Added', 'Changed', 'Fixed'];
const TYPE_SECTION = { feat: 'Added', fix: 'Fixed', perf: 'Changed', refactor: 'Changed', revert: 'Changed', deprecate: 'Changed', security: 'Fixed' };
const OMIT_TYPES = new Set(['chore', 'docs', 'test', 'tests', 'ci', 'build', 'style']);

const HEADER = `# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
`;

export function readCommits(cwd, since) {
  const range = since ? `${since}..HEAD` : 'HEAD';
  const raw = git(['log', range, '--no-merges', '--format=%H%x1f%s%x1f%b%x1e'], cwd);
  if (raw === null) return [];
  return raw.split('\x1e').map((s) => s.trim()).filter(Boolean).map((record) => {
    const [hash, subject, body = ''] = record.split('\x1f');
    return { hash, subject, body };
  });
}

export function classify(commit) {
  const m = commit.subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!m) return { section: null, text: commit.subject, reason: 'not a conventional commit' };
  const [, rawType, scope, bang, description] = m;
  const type = rawType.toLowerCase();
  const breaking = Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(commit.body);
  let text = scope ? `${scope}: ${description}` : description;
  if (breaking) text = `Breaking: ${text}`;
  if (type === 'chore' && /^release\b/i.test(scope ?? '')) return { section: null, text, omitted: true, reason: 'release commit' };
  if (breaking && !TYPE_SECTION[type]) return { section: 'Changed', text };
  if (TYPE_SECTION[type]) return { section: TYPE_SECTION[type], text };
  if (OMIT_TYPES.has(type)) return { section: null, text: commit.subject, omitted: true, reason: `${type} commits are not user-facing` };
  return { section: null, text: commit.subject, reason: `unknown type "${type}"` };
}

/** Matches a release heading such as "## [1.0.2] - date", "## 1.0.2 (date)" or "## v1.0.2". */
export const RELEASE_HEADING = /^## \[?v?\d+\.\d+/;

/** Follows the heading style already used in the file; Keep a Changelog otherwise. */
export function headingFor(existing, version, date) {
  const first = existing?.split('\n').find((l) => RELEASE_HEADING.test(l));
  if (first && !first.startsWith('## [')) {
    const prefix = /^## v/.test(first) ? 'v' : '';
    return /\(\d{4}-\d{2}-\d{2}\)/.test(first) ? `## ${prefix}${version} (${date})` : `## ${prefix}${version}`;
  }
  return `## [${version}] - ${date}`;
}

export function buildEntry(version, commits, date, heading = `## [${version}] - ${date}`) {
  const sections = Object.fromEntries(SECTIONS.map((s) => [s, []]));
  const unclassified = [];
  const omitted = [];
  for (const commit of commits) {
    const c = classify(commit);
    const short = commit.hash.slice(0, 7);
    if (c.section) sections[c.section].push(c.text.charAt(0).toUpperCase() + c.text.slice(1));
    else if (c.omitted) omitted.push({ commit: short, subject: commit.subject, reason: c.reason });
    else unclassified.push({ commit: short, subject: commit.subject, reason: c.reason });
  }
  let entry = `${heading}\n`;
  for (const name of SECTIONS) {
    if (sections[name].length === 0) continue;
    entry += `\n### ${name}\n\n${sections[name].map((t) => `- ${t}`).join('\n')}\n`;
  }
  return { entry, sections, unclassified, omitted };
}

/** Inserts the entry below [Unreleased] (or the header), above the newest release. */
export function insertEntry(existing, version, entry) {
  if (existing === null) return `${HEADER}\n${entry}`;
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^## \\[?v?${escaped}(\\]|\\s|$)`, 'm').test(existing)) {
    throw new Error(`CHANGELOG already has a section for ${version}`);
  }
  const lines = existing.split('\n');
  const idx = lines.findIndex((l) => RELEASE_HEADING.test(l));
  if (idx === -1) return `${existing.replace(/\n*$/, '\n')}\n${entry}`;
  lines.splice(idx, 0, ...entry.replace(/\n*$/, '\n').split('\n'));
  return lines.join('\n');
}

export function changelog({ cwd = '.', version, since, date = new Date().toISOString().slice(0, 10), write }) {
  const from = since ?? lastTag(cwd);
  const commits = readCommits(cwd, from);
  const existing = write && existsSync(write) ? readFileSync(write, 'utf8') : null;
  const built = buildEntry(version, commits, date, headingFor(existing, version, date));
  const checks = [];
  const total = Object.values(built.sections).reduce((n, s) => n + s.length, 0);
  checks.push(total > 0
    ? check('changelog.entries', 'pass', `${total} change(s) since ${from ?? 'the first commit'}`)
    : check('changelog.entries', 'warn', `No user-facing changes found since ${from ?? 'the first commit'}`, { fix: 'Ask the user what this release changes and write the entry by hand.' }));
  if (built.unclassified.length) {
    checks.push(check('changelog.unclassified', 'warn', `${built.unclassified.length} commit(s) could not be classified`, { fix: 'Show them to the user and ask which section each belongs in, or whether to drop it.' }));
  }
  if (write) {
    writeFileSync(write, insertEntry(existing, version, built.entry));
    checks.push(check('changelog.write', 'pass', `${existing === null ? 'Created' : 'Updated'} ${write}`));
  }
  return result(checks, { since: from, entry: built.entry, unclassified: built.unclassified, omitted: built.omitted });
}

const usage = 'Usage: changelog.mjs --version <version> [--since <tag>] [--date YYYY-MM-DD] [--write CHANGELOG.md] [--cwd <dir>]';

await runCli(import.meta.url, {
  usage,
  options: { version: { type: 'string' }, since: { type: 'string' }, date: { type: 'string' }, write: { type: 'string' }, cwd: { type: 'string', default: '.' } },
}, (v) => {
  required(v, 'version');
  return changelog({ cwd: v.cwd, version: v.version, since: v.since, date: v.date, write: v.write });
});
