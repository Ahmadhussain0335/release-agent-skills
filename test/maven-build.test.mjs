import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMavenRepo, GROUP, ARTIFACT } from '../tools/maven/build.mjs';
import { inspectArtifacts } from '../skills/release-maven/scripts/inspect-artifacts.mjs';
import { validatePoms } from '../skills/release-maven/scripts/validate-pom.mjs';
import { tempDir } from './support/helpers.mjs';

test('Maven build produces a Central-ready layout that passes the skill checks', () => {
  const out = tempDir();
  const built = buildMavenRepo({ out, version: '9.9.9' });
  assert.deepEqual(built.files, [`${ARTIFACT}-9.9.9-javadoc.jar`, `${ARTIFACT}-9.9.9-sources.jar`, `${ARTIFACT}-9.9.9.jar`, `${ARTIFACT}-9.9.9.pom`]);
  assert.ok(built.skillFiles > 20);
  const inspected = inspectArtifacts({ repo: out, group: GROUP, version: '9.9.9', expected: [ARTIFACT], unsignedExpected: true });
  assert.equal(inspected.ok, true, JSON.stringify(inspected.checks));
  const poms = validatePoms([`${built.dir}/${ARTIFACT}-9.9.9.pom`]);
  assert.equal(poms.ok, true, JSON.stringify(poms.checks));
  assert.deepEqual(poms.data.poms[0].warnings, []);
});
