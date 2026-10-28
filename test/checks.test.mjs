import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkVersion } from '../skills/release-maven/scripts/check-version.mjs';
import { checkCredentials } from '../skills/release-maven/scripts/check-credentials.mjs';
import { inspectArtifacts } from '../skills/release-maven/scripts/inspect-artifacts.mjs';
import { validatePomText } from '../skills/release-maven/scripts/validate-pom.mjs';
import { verifySignatures } from '../skills/release-maven/scripts/verify-signatures.mjs';
import { tempDir, writeTree, fakeFetch, stagedKmpRepo, POM, FPR } from './support/helpers.mjs';

const METADATA = '<metadata><versioning><release>1.0.1</release><versions><version>1.0.0</version><version>1.0.1</version></versions></versioning></metadata>';

test('check-version passes for a new version and reports the latest', async () => {
  const fetchImpl = fakeFetch((url) => (url.endsWith('maven-metadata.xml') ? { body: METADATA } : { status: 404 }));
  const r = await checkVersion({ group: 'io.github.example', artifact: 'lib', version: '1.0.2', current: '1.0.1', fetchImpl });
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.equal(r.data.latest, '1.0.1');
});

test('check-version fails for an existing version, SNAPSHOT, and a non-increasing version', async () => {
  const exists = fakeFetch((url) => (url.endsWith('maven-metadata.xml') ? { body: METADATA } : { status: 200 }));
  const r1 = await checkVersion({ group: 'g', artifact: 'a', version: '1.0.1', fetchImpl: exists });
  assert.deepEqual(r1.checks.filter((c) => c.status === 'fail').map((c) => c.id), ['version.central.pom', 'version.central.metadata']);

  const none = fakeFetch(() => ({ status: 404 }));
  const r2 = await checkVersion({ group: 'g', artifact: 'a', version: '1.1.0-SNAPSHOT', current: '1.1.0', fetchImpl: none });
  assert.ok(r2.checks.some((c) => c.id === 'version.snapshot' && c.status === 'fail'));
  assert.ok(r2.checks.some((c) => c.id === 'version.order' && c.status === 'fail'));
});

test('check-version warns instead of passing when Central is unreachable', async () => {
  const down = async () => { throw new Error('ECONNREFUSED'); };
  const r = await checkVersion({ group: 'g', artifact: 'a', version: '1.0.0', fetchImpl: down });
  assert.equal(r.checks.find((c) => c.id === 'version.central.pom').status, 'warn');
});

test('check-credentials reports keys and sources but never values', () => {
  const home = writeTree(tempDir(), {
    'gradle.properties': 'mavenCentralUsername=USER-SECRET-123\nmavenCentralPassword=PASS-SECRET-456\nsigningInMemoryKeyPassword=KEYPASS-789\n',
  });
  const project = writeTree(tempDir(), { 'build.gradle.kts': '' });
  const env = { ORG_GRADLE_PROJECT_signingInMemoryKey: '-----BEGIN PGP PRIVATE KEY BLOCK-----\nKEY-SECRET-000\n-----END PGP PRIVATE KEY BLOCK-----' };
  const r = checkCredentials({ projectDir: project, env, home, gpgCount: () => 0 });
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  const out = JSON.stringify(r);
  for (const secret of ['USER-SECRET-123', 'PASS-SECRET-456', 'KEYPASS-789', 'KEY-SECRET-000']) assert.ok(!out.includes(secret), `leaked ${secret}`);
  assert.deepEqual(r.data.keys.find((k) => k.key === 'signingInMemoryKey'), { key: 'signingInMemoryKey', found: true, source: 'env' });
});

test('check-credentials fails without token or signing, and flags secrets in the project', () => {
  const home = tempDir();
  const project = writeTree(tempDir(), { 'build.gradle.kts': '', 'gradle.properties': 'mavenCentralPassword=oops\n' });
  const r = checkCredentials({ projectDir: project, env: {}, home, gpgCount: () => 0 });
  assert.equal(r.ok, false);
  assert.equal(r.checks.find((c) => c.id === 'credentials.mavenCentralUsername').status, 'fail');
  assert.equal(r.checks.find((c) => c.id === 'credentials.signing').status, 'fail');
  assert.equal(r.checks.find((c) => c.id === 'credentials.mavenCentralPassword.location').status, 'warn');
  assert.ok(!JSON.stringify(r).includes('oops'));
});

test('inspect-artifacts passes for a complete KMP staging repo', () => {
  const repo = stagedKmpRepo();
  const r = inspectArtifacts({ repo, group: 'io.github.example', version: '1.0.2', expected: ['lib', 'lib-jvm', 'lib-iosarm64'] });
  assert.equal(r.ok, true, JSON.stringify(r.checks, null, 2));
  assert.deepEqual(r.data.components.find((c) => c.artifactId === 'lib').targets, ['lib-jvm', 'lib-iosarm64']);
});

test('inspect-artifacts catches missing javadoc, signature and target', () => {
  const repo = stagedKmpRepo({ omit: ['lib-jvm-1.0.2-javadoc.jar', 'lib-1.0.2.pom.asc'] });
  const r = inspectArtifacts({ repo, group: 'io.github.example', version: '1.0.2', expected: ['lib', 'lib-jvm', 'lib-iosarm64', 'lib-android'] });
  const failed = r.checks.filter((c) => c.status === 'fail').map((c) => c.id);
  assert.deepEqual(failed.sort(), ['artifacts.expected', 'artifacts.lib-jvm.files', 'artifacts.lib.signatures'].sort());
  assert.match(r.checks.find((c) => c.id === 'artifacts.lib-jvm.files').fix, /E04/);
});

test('inspect-artifacts fails when the root .module references an unstaged target', () => {
  const repo = stagedKmpRepo();
  writeTree(repo, { 'io/github/example/lib/1.0.2/lib-1.0.2.module': JSON.stringify({ variants: [{ 'available-at': { module: 'lib-linuxx64' } }] }) });
  const r = inspectArtifacts({ repo, group: 'io.github.example', version: '1.0.2' });
  assert.ok(r.checks.some((c) => c.id === 'artifacts.lib.targets' && c.status === 'fail'));
});

test('validate-pom accepts a complete POM and lists every missing field', () => {
  assert.deepEqual(validatePomText(POM('g', 'a', '1.0')).missing, []);
  const bare = validatePomText('<project><groupId>g</groupId><artifactId>a</artifactId><version>1.0-SNAPSHOT</version><scm><url>u</url></scm></project>');
  assert.deepEqual(bare.missing, ['release version (found SNAPSHOT)', 'name', 'description', 'url', 'licenses', 'developers', 'scm/connection', 'scm/developerConnection']);
  const warned = validatePomText(POM('g', 'a', '1.0', '<repositories><repository/></repositories>'));
  assert.ok(warned.warnings.some((w) => /repositories/.test(w)));
});

test('verify-signatures checks presence, issuer and keyserver', async () => {
  const repo = stagedKmpRepo();
  const found = fakeFetch((url) => (url.includes('keys.openpgp.org') ? { status: 200 } : { status: 404 }));
  const r = await verifySignatures({ repo, useGpg: false, fetchImpl: found });
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.equal(r.data.keys[0].fingerprint, FPR);
  assert.ok(found.calls.some((c) => c.url.endsWith(`/by-fingerprint/${FPR}`)));

  const missing = fakeFetch(() => ({ status: 404 }));
  const r2 = await verifySignatures({ repo, useGpg: false, fetchImpl: missing });
  assert.equal(r2.checks.find((c) => c.id.startsWith('signatures.keyserver')).status, 'fail');
});

test('verify-signatures maps gpg results', async () => {
  const repo = stagedKmpRepo();
  const r = await verifySignatures({ repo, useGpg: true, checkKeyserver: false, verify: (f) => (f.endsWith('.klib') ? 'BADSIG' : 'GOODSIG') });
  assert.equal(r.checks.find((c) => c.id === 'signatures.gpg').status, 'fail');
  const ok = await verifySignatures({ repo, useGpg: true, checkKeyserver: false, verify: () => 'GOODSIG' });
  assert.equal(ok.ok, true);
});

test('check-version treats a SNAPSHOT current version as the development line', async () => {
  const none = fakeFetch(() => ({ status: 404 }));
  const next = await checkVersion({ group: 'g', artifact: 'a', version: '0.4.0', current: '0.4.0-SNAPSHOT', fetchImpl: none });
  assert.equal(next.checks.find((c) => c.id === 'version.order').status, 'pass');
  const patch = await checkVersion({ group: 'g', artifact: 'a', version: '0.3.1', current: '0.4.0-SNAPSHOT', fetchImpl: none });
  assert.equal(patch.checks.find((c) => c.id === 'version.order').status, 'warn');
});
