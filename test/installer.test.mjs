import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installSkills, availableSkills } from '../src/installer/install.mjs';
import { resolveTarget } from '../src/installer/targets.mjs';
import { tempDir } from './support/helpers.mjs';

const BIN = fileURLToPath(new URL('../bin/release-agent-skills.mjs', import.meta.url));

test('availableSkills lists skills with SKILL.md only', () => {
  const names = availableSkills().map((s) => s.name);
  assert.ok(names.includes('release-maven'));
  assert.ok(!names.includes('release-agent-shared'));
});

test('install copies the skill and the shared folder, and installed scripts run', () => {
  const dest = tempDir();
  const report = installSkills({ destDir: dest });
  assert.deepEqual(report.map((r) => [r.folder, r.action]), [['release-maven', 'installed'], ['release-agent-shared', 'installed']]);
  assert.ok(existsSync(join(dest, 'release-maven', 'SKILL.md')));
  assert.ok(existsSync(join(dest, 'release-maven', 'reference', 'central-portal.md')));
  // Relative imports into release-agent-shared must resolve from the installed layout.
  const out = spawnSync(process.execPath, [join(dest, 'release-maven', 'scripts', 'check-version.mjs'), '--group', 'g'], { encoding: 'utf8' });
  assert.equal(out.status, 2);
  assert.match(JSON.parse(out.stdout).error, /--artifact is required/);
});

test('install skips existing folders unless --force, and never removes files', () => {
  const dest = tempDir();
  installSkills({ destDir: dest });
  const extra = join(dest, 'release-maven', 'my-notes.md');
  writeFileSync(extra, 'keep me');
  const skipped = installSkills({ destDir: dest });
  assert.ok(skipped.every((r) => r.action === 'skipped'));
  assert.match(skipped[0].reason, /version 0\.1\.0 already installed/);
  const forced = installSkills({ destDir: dest, force: true });
  assert.ok(forced.every((r) => r.action === 'overwritten'));
  assert.equal(readFileSync(extra, 'utf8'), 'keep me');
});

test('dry run writes nothing, unknown skill is rejected', () => {
  const dest = tempDir();
  installSkills({ destDir: dest, dryRun: true });
  assert.ok(!existsSync(join(dest, 'release-maven')));
  assert.throws(() => installSkills({ destDir: dest, skills: ['release-npm'] }), /Unknown skill/);
});

test('targets resolve to project and user folders', () => {
  assert.equal(resolveTarget('claude', { cwd: '/p' }).dir, join('/p', '.claude/skills'));
  assert.equal(resolveTarget('agents', { user: true, home: '/h' }).dir, join('/h', '.agents/skills'));
  assert.throws(() => resolveTarget('vim'), /Unknown target/);
});

test('CLI install --dir works end to end', () => {
  const dest = tempDir();
  const out = execFileSync(process.execPath, [BIN, 'install', '--dir', dest], { encoding: 'utf8' });
  assert.match(out, /installed\s+release-maven/);
  assert.ok(existsSync(join(dest, 'release-agent-shared', 'scripts', 'lib', 'cli.mjs')));
});
