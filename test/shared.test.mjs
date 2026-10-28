import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify, buildEntry, insertEntry, changelog } from '../skills/release-agent-shared/scripts/changelog.mjs';
import { gitPreflight } from '../skills/release-agent-shared/scripts/git-preflight.mjs';
import { updateState, readState } from '../skills/release-agent-shared/scripts/state.mjs';
import { extractSection, githubRelease, installSection } from '../skills/release-agent-shared/scripts/github-release.mjs';
import { tempDir, gitRepo } from './support/helpers.mjs';

test('classify maps conventional commits to Keep a Changelog sections', () => {
  assert.deepEqual(classify({ subject: 'feat(ios): add camera permission', body: '' }), { section: 'Added', text: 'ios: add camera permission' });
  assert.equal(classify({ subject: 'fix: crash on denial', body: '' }).section, 'Fixed');
  assert.equal(classify({ subject: 'refactor!: rename API', body: '' }).text, 'Breaking: rename API');
  assert.equal(classify({ subject: 'chore: bump deps', body: '' }).omitted, true);
  assert.equal(classify({ subject: 'chore(release): 1.0.1', body: '' }).omitted, true);
  assert.equal(classify({ subject: 'Update README', body: '' }).section, null);
});

test('buildEntry groups commits and lists unclassified ones', () => {
  const commits = [
    { hash: 'a'.repeat(40), subject: 'feat: one', body: '' },
    { hash: 'b'.repeat(40), subject: 'fix: two', body: '' },
    { hash: 'c'.repeat(40), subject: 'random change', body: '' },
  ];
  const r = buildEntry('1.0.2', commits, '2026-10-28');
  assert.equal(r.entry, '## [1.0.2] - 2026-10-28\n\n### Added\n\n- One\n\n### Fixed\n\n- Two\n');
  assert.equal(r.unclassified[0].commit, 'ccccccc');
});

test('insertEntry places the entry under Unreleased and above older releases', () => {
  const existing = '# Changelog\n\n## [Unreleased]\n\n## [1.0.1] - 2026-01-01\n\n### Fixed\n\n- Old\n';
  const out = insertEntry(existing, '1.0.2', '## [1.0.2] - 2026-10-28\n\n### Added\n\n- New\n');
  assert.ok(out.indexOf('[Unreleased]') < out.indexOf('[1.0.2]'));
  assert.ok(out.indexOf('[1.0.2]') < out.indexOf('[1.0.1]'));
  assert.throws(() => insertEntry(out, '1.0.2', 'x'), /already has a section/);
  assert.match(insertEntry(null, '0.1.0', '## [0.1.0] - d\n'), /^# Changelog[\s\S]*## \[Unreleased\][\s\S]*## \[0\.1\.0\]/);
});

test('changelog reads commits since the last tag from a real repo', () => {
  const dir = tempDir();
  const repo = gitRepo(dir);
  repo.commit('feat: initial');
  repo.run('tag', 'v1.0.1');
  repo.commit('feat: new thing', 'b.txt');
  repo.commit('fix: a bug', 'c.txt');
  repo.commit('docs: readme', 'd.txt');
  const r = changelog({ cwd: dir, version: '1.0.2', date: '2026-10-28', write: join(dir, 'CHANGELOG.md') });
  assert.equal(r.data.since, 'v1.0.1');
  assert.match(r.data.entry, /### Added\n\n- New thing\n\n### Fixed\n\n- A bug/);
  assert.equal(r.data.omitted.length, 1);
  assert.match(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), /## \[1\.0\.2\] - 2026-10-28/);
});

test('git-preflight checks clean tree, branch and tag', () => {
  const dir = tempDir();
  const repo = gitRepo(dir);
  repo.commit('feat: initial');
  repo.run('tag', 'v1.0.1');
  const ok = gitPreflight({ cwd: dir, branch: 'main', tag: 'v1.0.2', checkRemote: false });
  assert.equal(ok.ok, true, JSON.stringify(ok.checks));
  assert.equal(ok.data.prefix, 'v');

  writeFileSync(join(dir, 'dirty.txt'), 'x');
  const bad = gitPreflight({ cwd: dir, branch: 'develop', tag: 'v1.0.1', checkRemote: false });
  assert.deepEqual(bad.checks.filter((c) => c.status === 'fail').map((c) => c.id), ['git.clean', 'git.branch', 'git.tag.local']);
});

test('state stores progress and refuses secret-looking keys', () => {
  const dir = tempDir();
  updateState(dir, { phase: 'uploaded', deploymentId: 'd1' });
  updateState(dir, { phase: 'validated' });
  assert.equal(readState(dir).deploymentId, 'd1');
  assert.equal(readState(dir).phase, 'validated');
  assert.throws(() => updateState(dir, { mavenCentralPassword: 'x' }), /never hold secrets/);
});

test('github-release extracts notes and does nothing without --create', () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [1.0.2] - 2026-10-28\n\n### Added\n\n- New\n\n## [1.0.1] - 2026-01-01\n\n- Old\n\n[1.0.2]: https://example.com\n');
  assert.equal(extractSection(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), '1.0.2'), '### Added\n\n- New');
  const r = githubRelease({ cwd: dir, tag: 'v1.0.2', version: '1.0.2', changelogPath: 'CHANGELOG.md' });
  assert.equal(r.ok, true);
  assert.match(r.data.command, /^gh release create v1\.0\.2 --title 1\.0\.2 --notes-file .* --verify-tag$/);
  assert.equal(readFileSync(r.data.notesFile, 'utf8'), '### Added\n\n- New\n');
});

test('changelog follows an existing "## X.Y.Z (date)" style and inserts above the newest release', () => {
  const dir = tempDir();
  const repo = gitRepo(dir);
  repo.commit('feat: initial');
  repo.run('tag', 'v0.3.0');
  repo.commit('fix: handle denial', 'b.txt');
  writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\nIntro text.\n\n## 0.3.0 (2026-10-23)\n\n### Breaking changes\n\n- Old\n\n## 0.2.1\n\n- Older\n');
  changelog({ cwd: dir, version: '0.4.0', date: '2026-10-28', write: join(dir, 'CHANGELOG.md') });
  const text = readFileSync(join(dir, 'CHANGELOG.md'), 'utf8');
  assert.match(text, /Intro text\.\n\n## 0\.4\.0 \(2026-10-28\)\n\n### Fixed\n\n- Handle denial\n\n## 0\.3\.0 \(2026-10-23\)/);
  assert.equal(extractSection(text, '0.4.0'), '### Fixed\n\n- Handle denial');
  assert.equal(extractSection(text, '0.3.0'), '### Breaking changes\n\n- Old');
});

test('github-release puts an Install block above the notes when asked', () => {
  assert.equal(installSection(), '');
  assert.equal(installSection({ link: 'https://x', linkLabel: 'npm' }), '### Install\n\nnpm: https://x\n\n');
  const dir = tempDir();
  writeFileSync(join(dir, 'CHANGELOG.md'), '## [1.0.2] - 2026-10-28\n\n### Fixed\n\n- A bug\n');
  const r = githubRelease({
    cwd: dir, tag: 'v1.0.2', version: '1.0.2', changelogPath: 'CHANGELOG.md',
    install: ['implementation("io.github.example:lib:1.0.2")'], installLang: 'kotlin',
    link: 'https://central.sonatype.com/artifact/io.github.example/lib/1.0.2', linkLabel: 'Maven Central',
  });
  assert.equal(r.data.notes, '### Install\n\n```kotlin\nimplementation("io.github.example:lib:1.0.2")\n```\n\nMaven Central: https://central.sonatype.com/artifact/io.github.example/lib/1.0.2\n\n### Fixed\n\n- A bug');
  assert.equal(readFileSync(r.data.notesFile, 'utf8'), `${r.data.notes}\n`);
});
