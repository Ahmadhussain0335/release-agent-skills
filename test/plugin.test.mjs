import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));

test('plugin manifest matches package.json and the marketplace entry', () => {
  const pkg = read('package.json');
  const plugin = read('.claude-plugin/plugin.json');
  const marketplace = read('.claude-plugin/marketplace.json');
  // The plugin version pins what marketplace users get, so it must move with each npm release.
  assert.equal(plugin.version, pkg.version);
  assert.equal(plugin.name, pkg.name);
  assert.equal(marketplace.plugins[0].name, plugin.name);
  assert.equal(marketplace.plugins[0].source, './');
});

test('plugin root has no bin/ directory, which Claude Code would put on PATH', () => {
  assert.equal(existsSync(new URL('../bin', import.meta.url)), false);
  assert.ok(existsSync(new URL('../skills/release-maven/SKILL.md', import.meta.url)));
});
