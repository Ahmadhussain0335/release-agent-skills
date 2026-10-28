import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readState } from '../skills/release-agent-shared/scripts/state.mjs';
import { bundleEntries, upload, status, publish, drop, authHeader } from '../skills/release-maven/scripts/portal.mjs';
import { waitForCentral } from '../skills/release-maven/scripts/wait-for-central.mjs';
import { tempDir, writeTree, fakeFetch, stagedKmpRepo } from './support/helpers.mjs';

const AUTH = 'Bearer dGVzdDp0ZXN0';

test('bundleEntries adds md5/sha1, keeps .asc and drops maven-metadata', () => {
  const repo = stagedKmpRepo({ targets: ['jvm'] });
  const { entries, unsigned } = bundleEntries(repo, 'io.github.example', '1.0.2');
  const names = entries.map((e) => e.name);
  assert.deepEqual(unsigned, []);
  assert.ok(!names.some((n) => n.includes('maven-metadata')));
  assert.ok(names.includes('io/github/example/lib/1.0.2/lib-1.0.2.jar.asc'));
  assert.ok(!names.includes('io/github/example/lib/1.0.2/lib-1.0.2.jar.asc.md5'));
  const jar = entries.find((e) => e.name === 'io/github/example/lib/1.0.2/lib-1.0.2.jar').data;
  const sha1 = entries.find((e) => e.name === 'io/github/example/lib/1.0.2/lib-1.0.2.jar.sha1').data.toString();
  assert.equal(sha1, createHash('sha1').update(jar).digest('hex'));
});

test('upload refuses unsigned bundles and never calls the network', async () => {
  const repo = stagedKmpRepo({ omit: ['lib-1.0.2.jar.asc'] });
  const fetchImpl = fakeFetch(() => ({ status: 201, body: 'x' }));
  const r = await upload({ repo, group: 'io.github.example', version: '1.0.2', name: 'n', projectDir: tempDir(), auth: AUTH, fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(fetchImpl.calls.length, 0);
});

test('upload posts a USER_MANAGED bundle and stores the deployment id', async () => {
  const repo = stagedKmpRepo();
  const project = tempDir();
  const fetchImpl = fakeFetch(() => ({ status: 201, body: 'dep-123\n' }));
  const r = await upload({ repo, group: 'io.github.example', version: '1.0.2', name: 'io.github.example:lib:1.0.2', projectDir: project, auth: AUTH, fetchImpl, base: 'https://portal.test/api' });
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.equal(r.data.deploymentId, 'dep-123');
  const call = fetchImpl.calls[0];
  assert.equal(call.url, 'https://portal.test/api/upload?name=io.github.example%3Alib%3A1.0.2&publishingType=USER_MANAGED');
  assert.equal(call.init.headers.Authorization, AUTH);
  assert.ok(call.init.body instanceof FormData);
  assert.equal(readState(project).deploymentId, 'dep-123');
});

test('upload reports 401 with the error library reference', async () => {
  const fetchImpl = fakeFetch(() => ({ status: 401, body: 'Unauthorized' }));
  const r = await upload({ repo: stagedKmpRepo(), group: 'io.github.example', version: '1.0.2', name: 'n', projectDir: tempDir(), auth: AUTH, fetchImpl });
  assert.match(r.checks.at(-1).message, /401 \(errors\.md E01\)/);
});

test('status waits until VALIDATED and surfaces FAILED errors', async () => {
  const states = ['PENDING', 'VALIDATING', 'VALIDATED'];
  const fetchImpl = fakeFetch(() => ({ body: JSON.stringify({ deploymentId: 'd', deploymentState: states.shift() }) }));
  const r = await status({ id: 'd', wait: true, auth: AUTH, fetchImpl, sleepImpl: async () => {} });
  assert.equal(r.data.state, 'VALIDATED');
  assert.equal(fetchImpl.calls.length, 3);

  const failed = fakeFetch(() => ({ body: JSON.stringify({ deploymentState: 'FAILED', errors: { 'pkg:maven/x': ['Javadocs must be provided but not found in entries'] } }) }));
  const f = await status({ id: 'd', wait: true, auth: AUTH, fetchImpl: failed });
  assert.equal(f.ok, false);
  assert.ok(f.checks[0].errors);
});

test('status times out with a clear message', async () => {
  let t = 0;
  const fetchImpl = fakeFetch(() => ({ body: JSON.stringify({ deploymentState: 'VALIDATING' }) }));
  const r = await status({ id: 'd', wait: true, timeoutMin: 1, auth: AUTH, fetchImpl, sleepImpl: async () => {}, now: () => (t += 20000) });
  assert.equal(r.ok, false);
  assert.match(r.checks[0].message, /Timed out.*E21/);
});

test('publish requires explicit confirmation and a VALIDATED deployment', async () => {
  const project = tempDir();
  await assert.rejects(publish({ id: 'd', confirmed: false, auth: AUTH }), /confirm-permanent/);
  const pending = fakeFetch(() => ({ body: JSON.stringify({ deploymentState: 'PENDING' }) }));
  const r1 = await publish({ id: 'd', confirmed: true, auth: AUTH, fetchImpl: pending, projectDir: project });
  assert.equal(r1.ok, false);
  assert.equal(pending.calls.length, 1);
  const validated = fakeFetch((url, init) => (init.method === 'POST' && url.includes('/deployment/') ? { status: 204 } : { body: JSON.stringify({ deploymentState: 'VALIDATED' }) }));
  const r2 = await publish({ id: 'd', confirmed: true, auth: AUTH, fetchImpl: validated, projectDir: project });
  assert.equal(r2.ok, true);
});

test('drop requires confirmation and uses DELETE', async () => {
  await assert.rejects(drop({ id: 'd', confirmed: false, auth: AUTH }), /--confirm/);
  const fetchImpl = fakeFetch(() => ({ status: 204 }));
  const r = await drop({ id: 'd', confirmed: true, auth: AUTH, fetchImpl, projectDir: tempDir() });
  assert.equal(r.ok, true);
  assert.equal(fetchImpl.calls[0].init.method, 'DELETE');
});

test('authHeader builds a Bearer token and errors without credentials', () => {
  const home = writeTree(tempDir(), { 'gradle.properties': 'mavenCentralUsername=u\nmavenCentralPassword=p\n' });
  assert.equal(authHeader({ projectDir: tempDir(), env: {}, home }), `Bearer ${Buffer.from('u:p').toString('base64')}`);
  assert.throws(() => authHeader({ projectDir: tempDir(), env: {}, home: tempDir() }), /E01/);
});

test('wait-for-central backs off until the POM appears', async () => {
  const statuses = [404, 404, 200];
  const delays = [];
  const fetchImpl = fakeFetch(() => ({ status: statuses.shift() }));
  const r = await waitForCentral({ group: 'g', artifact: 'a', version: '1', initialSec: 30, fetchImpl, sleepImpl: async (ms) => delays.push(ms), now: () => 0 });
  assert.equal(r.ok, true);
  assert.deepEqual(delays, [30000, 60000]);
});

test('wait-for-central stops at its timeout and says the delay is normal', async () => {
  let t = 0;
  const fetchImpl = fakeFetch(() => ({ status: 404 }));
  const r = await waitForCentral({ group: 'g', artifact: 'a', version: '1', timeoutMin: 2, fetchImpl, sleepImpl: async (ms) => { t += ms; }, now: () => t });
  assert.equal(r.ok, false);
  assert.match(r.checks[0].message, /normal/);
});
