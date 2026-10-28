#!/usr/bin/env node
// Central Portal Publisher API client: upload | status | publish | drop.
// This is the only script that reads secret values (the Portal user token).
// They are used in-process for the Authorization header and never printed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { runCli, check, result, required, progress, UsageError } from '../../release-agent-shared/scripts/lib/cli.mjs';
import { fetchWithRetry, sleep } from '../../release-agent-shared/scripts/lib/http.mjs';
import { updateState } from '../../release-agent-shared/scripts/state.mjs';
import { listComponents, isAuxiliary } from './lib/maven.mjs';
import { createZip } from './lib/zip.mjs';
import { credentialSources, readSecret } from './lib/credentials.mjs';

export const PORTAL_URL = 'https://central.sonatype.com/api/v1/publisher';
const DEPLOYMENTS_PAGE = 'https://central.sonatype.com/publishing/deployments';
const MAX_BUNDLE_BYTES = 1024 ** 3;

export function authHeader({ projectDir = '.', env = process.env, home } = {}) {
  const sources = credentialSources({ projectDir, env, home });
  const user = readSecret('mavenCentralUsername', sources);
  const pass = readSecret('mavenCentralPassword', sources);
  if (!user || !pass) throw new Error('mavenCentralUsername / mavenCentralPassword not found. Run check-credentials.mjs (errors.md E01).');
  return `Bearer ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

/** Builds bundle entries from a staged repo: artifacts + .asc as found, fresh .md5/.sha1, no maven-metadata. */
export function bundleEntries(repo, group, version) {
  const entries = [];
  const unsigned = [];
  for (const { dir, files } of listComponents(repo, group, version)) {
    for (const name of files) {
      if (name.startsWith('maven-metadata') || /\.(md5|sha1|sha256|sha512)$/.test(name)) continue;
      const path = relative(repo, join(dir, name)).split(sep).join('/');
      const data = readFileSync(join(dir, name));
      entries.push({ name: path, data });
      if (name.endsWith('.asc')) continue;
      if (!isAuxiliary(name) && !files.includes(`${name}.asc`)) unsigned.push(path);
      entries.push({ name: `${path}.md5`, data: Buffer.from(createHash('md5').update(data).digest('hex')) });
      entries.push({ name: `${path}.sha1`, data: Buffer.from(createHash('sha1').update(data).digest('hex')) });
    }
  }
  return { entries, unsigned };
}

async function describeFailure(res) {
  const body = (await res.text().catch(() => '')).slice(0, 2000);
  const hint = res.status === 401 ? ' (errors.md E01)' : res.status === 403 ? ' (errors.md E02)' : '';
  return `HTTP ${res.status}${hint}${body ? `: ${body}` : ''}`;
}

export async function upload({ repo, group, version, name, type = 'user_managed', projectDir = '.', dryRun = false, auth, base = PORTAL_URL, fetchImpl = fetch }) {
  const publishingType = { user_managed: 'USER_MANAGED', automatic: 'AUTOMATIC' }[type];
  if (!publishingType) throw new UsageError('--type must be user_managed or automatic');
  const { entries, unsigned } = bundleEntries(repo, group, version);
  if (entries.length === 0) return result([check('portal.bundle', 'fail', `No artifacts for ${group} ${version} in ${repo}`)]);
  if (unsigned.length) return result([check('portal.bundle', 'fail', `Refusing to upload: ${unsigned.length} file(s) have no .asc`, { files: unsigned.slice(0, 30), fix: 'errors.md E06.' })]);

  const zip = createZip(entries);
  if (zip.length > MAX_BUNDLE_BYTES) return result([check('portal.bundle', 'fail', `Bundle is ${zip.length} bytes; the Portal limit is 1 GB`)]);
  const outDir = join(resolve(projectDir), 'build', 'release-agent');
  mkdirSync(outDir, { recursive: true });
  const bundlePath = join(outDir, `bundle-${version}.zip`);
  writeFileSync(bundlePath, zip);
  const checks = [check('portal.bundle', 'pass', `Bundle with ${entries.length} entries written to ${bundlePath}`)];
  if (dryRun) return result(checks, { bundlePath, entries: entries.map((e) => e.name) });

  const form = new FormData();
  form.append('bundle', new Blob([zip], { type: 'application/octet-stream' }), `bundle-${version}.zip`);
  const url = `${base}/upload?name=${encodeURIComponent(name)}&publishingType=${publishingType}`;
  // No retries: a retried upload after a lost response could create a second deployment.
  const res = await fetchImpl(url, { method: 'POST', headers: { Authorization: auth ?? authHeader({ projectDir }) }, body: form, signal: AbortSignal.timeout(10 * 60 * 1000) });
  if (res.status !== 201 && res.status !== 200) {
    checks.push(check('portal.upload', 'fail', `Upload failed: ${await describeFailure(res)}`));
    return result(checks, { bundlePath });
  }
  const deploymentId = (await res.text()).trim();
  updateState(projectDir, { phase: 'uploaded', deploymentId, version, publishingType });
  checks.push(check('portal.upload', 'pass', `Uploaded as deployment ${deploymentId} (${publishingType})`));
  return result(checks, { bundlePath, deploymentId, publishingType, deploymentsPage: DEPLOYMENTS_PAGE });
}

export async function getStatus({ id, auth, base = PORTAL_URL, fetchImpl = fetch }) {
  const res = await fetchWithRetry(`${base}/status?id=${encodeURIComponent(id)}`, { method: 'POST', headers: { Authorization: auth } }, { fetchImpl });
  if (res.status !== 200) throw new Error(`Status request failed: ${await describeFailure(res)}`);
  return res.json();
}

const TERMINAL = { VALIDATED: ['VALIDATED', 'PUBLISHING', 'PUBLISHED', 'FAILED'], PUBLISHED: ['PUBLISHED', 'FAILED'] };

export async function status({ id, wait = false, until = 'VALIDATED', timeoutMin = 9, intervalSec = 10, auth, base, fetchImpl, sleepImpl = sleep, now = Date.now }) {
  if (!TERMINAL[until]) throw new UsageError('--until must be VALIDATED or PUBLISHED');
  const started = now();
  let s = await getStatus({ id, auth, base, fetchImpl });
  while (wait && !TERMINAL[until].includes(s.deploymentState)) {
    if (now() - started > timeoutMin * 60000) {
      return result([check('portal.status', 'fail', `Timed out after ${timeoutMin} min; deployment is still ${s.deploymentState}. The upload is fine; run this again to keep waiting (errors.md E21).`)], { state: s.deploymentState, reached: false, deployment: s });
    }
    progress(`[portal] deployment ${id} is ${s.deploymentState}; checking again in ${intervalSec}s`);
    await sleepImpl(intervalSec * 1000);
    s = await getStatus({ id, auth, base, fetchImpl });
  }
  const state = s.deploymentState;
  const data = { state, reached: TERMINAL[until].includes(state), deployment: s, deploymentsPage: DEPLOYMENTS_PAGE };
  if (state === 'FAILED') return result([check('portal.status', 'fail', 'Deployment FAILED validation; see data.deployment.errors and errors.md', { errors: s.errors })], data);
  return result([check('portal.status', 'pass', `Deployment ${id} is ${state}`)], data);
}

export async function publish({ id, confirmed, auth, base = PORTAL_URL, fetchImpl = fetch, projectDir = '.' }) {
  if (!confirmed) throw new UsageError('publish makes the release permanent; pass --confirm-permanent after the user said yes at Gate 2');
  const s = await getStatus({ id, auth, base, fetchImpl });
  if (s.deploymentState !== 'VALIDATED') {
    return result([check('portal.publish', 'fail', `Deployment is ${s.deploymentState}; only VALIDATED deployments can be published`)], { state: s.deploymentState });
  }
  const res = await fetchImpl(`${base}/deployment/${encodeURIComponent(id)}`, { method: 'POST', headers: { Authorization: auth } });
  if (res.status !== 204 && res.status !== 200) return result([check('portal.publish', 'fail', `Publish failed: ${await describeFailure(res)}`)]);
  updateState(projectDir, { phase: 'publishing' });
  return result([check('portal.publish', 'pass', `Deployment ${id} is being published to Maven Central`)], { state: 'PUBLISHING' });
}

export async function drop({ id, confirmed, auth, base = PORTAL_URL, fetchImpl = fetch, projectDir = '.' }) {
  if (!confirmed) throw new UsageError('drop deletes the deployment; pass --confirm after the user agreed');
  const res = await fetchImpl(`${base}/deployment/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: auth } });
  if (res.status !== 204 && res.status !== 200) return result([check('portal.drop', 'fail', `Drop failed: ${await describeFailure(res)}`, { fix: 'Only VALIDATED or FAILED deployments can be dropped.' })]);
  updateState(projectDir, { phase: 'dropped' });
  return result([check('portal.drop', 'pass', `Deployment ${id} dropped; the version can be uploaded again`)]);
}

const usage = `Usage:
  portal.mjs upload  --repo <dir> --group <g> --version <v> --name <name> [--type user_managed|automatic] [--dry-run]
  portal.mjs status  --id <deploymentId> [--wait] [--until VALIDATED|PUBLISHED] [--timeout-min 9]
  portal.mjs publish --id <deploymentId> --confirm-permanent
  portal.mjs drop    --id <deploymentId> --confirm
Common: [--project <dir>] (for credentials lookup and state)`;

await runCli(import.meta.url, {
  usage,
  allowPositionals: true,
  options: {
    repo: { type: 'string' }, group: { type: 'string' }, version: { type: 'string' }, name: { type: 'string' },
    type: { type: 'string', default: 'user_managed' }, 'dry-run': { type: 'boolean', default: false },
    id: { type: 'string' }, wait: { type: 'boolean', default: false }, until: { type: 'string', default: 'VALIDATED' },
    'timeout-min': { type: 'string', default: '9' }, 'confirm-permanent': { type: 'boolean', default: false },
    confirm: { type: 'boolean', default: false }, project: { type: 'string', default: '.' },
    'base-url': { type: 'string' },
  },
}, async (v, [command]) => {
  const base = v['base-url'] ?? PORTAL_URL;
  const projectDir = v.project;
  switch (command) {
    case 'upload':
      required(v, 'repo', 'group', 'version', 'name');
      return upload({ repo: v.repo, group: v.group, version: v.version, name: v.name, type: v.type, projectDir, dryRun: v['dry-run'], base });
    case 'status':
      required(v, 'id');
      return status({ id: v.id, wait: v.wait, until: v.until.toUpperCase(), timeoutMin: Number(v['timeout-min']), auth: authHeader({ projectDir }), base });
    case 'publish':
      required(v, 'id');
      return publish({ id: v.id, confirmed: v['confirm-permanent'], auth: authHeader({ projectDir }), base, projectDir });
    case 'drop':
      required(v, 'id');
      return drop({ id: v.id, confirmed: v.confirm, auth: authHeader({ projectDir }), base, projectDir });
    default:
      throw new UsageError(`Unknown command "${command ?? ''}"`);
  }
});
