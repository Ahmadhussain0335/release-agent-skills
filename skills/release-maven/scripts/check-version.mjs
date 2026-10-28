#!/usr/bin/env node
// Phase 2: the new version must be a release version, newer than the current one,
// and not already on Maven Central.
import { runCli, check, result, required } from '../../release-agent-shared/scripts/lib/cli.mjs';
import { fetchWithRetry } from '../../release-agent-shared/scripts/lib/http.mjs';
import { pomUrl, metadataUrl, parseXml, child, children, text, compareVersions, CENTRAL_REPO } from './lib/maven.mjs';

export async function checkVersion({ group, artifact, version, current, base = CENTRAL_REPO, fetchImpl = fetch }) {
  const checks = [];
  const data = { pomUrl: pomUrl(group, artifact, version, base) };

  if (/-SNAPSHOT$/i.test(version)) {
    checks.push(check('version.snapshot', 'fail', `${version} is a SNAPSHOT version; Maven Central releases cannot end in -SNAPSHOT`, { fix: 'Use a release version (errors.md E10).' }));
  }
  if (!/^\d+(\.\d+)*([-.+][0-9A-Za-z.+-]+)?$/.test(version)) {
    checks.push(check('version.format', 'warn', `${version} does not look like a semantic version`, { fix: 'Confirm the version with the user.' }));
  }
  if (current && /-SNAPSHOT$/i.test(current)) {
    // Development versions are compared against the released line they lead to, and only warn:
    // releasing 0.3.1 while the file says 0.4.0-SNAPSHOT is a normal patch release.
    const base = current.replace(/-SNAPSHOT$/i, '');
    checks.push(compareVersions(version, base) <= 0 && version !== base
      ? check('version.order', 'warn', `${version} is lower than the development version ${current}`, { fix: 'Fine for a patch of an older line; confirm with the user.' })
      : check('version.order', 'pass', `${version} matches or follows the development version ${current}`));
  } else if (current) {
    const cmp = compareVersions(version, current);
    if (cmp <= 0) checks.push(check('version.order', 'fail', `${version} is not newer than the current version ${current}`, { fix: 'Choose a version higher than the current one.' }));
    else checks.push(check('version.order', 'pass', `${version} is newer than ${current}`));
  }

  try {
    const res = await fetchWithRetry(data.pomUrl, { method: 'HEAD' }, { fetchImpl });
    if (res.status === 200) checks.push(check('version.central.pom', 'fail', `${group}:${artifact}:${version} already exists on Maven Central`, { fix: 'Published versions can never be replaced. Choose a new version (errors.md E03).' }));
    else if (res.status === 404) checks.push(check('version.central.pom', 'pass', `${group}:${artifact}:${version} is not on Maven Central`));
    else checks.push(check('version.central.pom', 'warn', `Unexpected HTTP ${res.status} from repo1.maven.org`, { fix: 'Retry later; check https://status.maven.org.' }));
  } catch (err) {
    checks.push(check('version.central.pom', 'warn', `Could not reach repo1.maven.org: ${err.message}`, { fix: 'Check the network and retry; do not skip this check before publishing.' }));
  }

  try {
    const res = await fetchWithRetry(metadataUrl(group, artifact, base), {}, { fetchImpl });
    if (res.status === 200) {
      const meta = parseXml(await res.text());
      const versioning = child(meta, 'versioning');
      const versions = children(child(versioning, 'versions'), 'version').map(text);
      data.publishedVersions = versions;
      data.latest = text(child(versioning, 'release')) || versions.at(-1) || null;
      if (versions.includes(version)) {
        checks.push(check('version.central.metadata', 'fail', `maven-metadata.xml already lists ${version}`, { fix: 'Choose a new version (errors.md E03).' }));
      } else if (data.latest && compareVersions(version, data.latest) < 0) {
        checks.push(check('version.central.metadata', 'warn', `${version} is lower than the latest published version ${data.latest}`, { fix: 'Confirm with the user that releasing an older line is intended.' }));
      } else {
        checks.push(check('version.central.metadata', 'pass', `Latest published version: ${data.latest ?? 'none'}`));
      }
    } else if (res.status === 404) {
      data.publishedVersions = [];
      checks.push(check('version.central.metadata', 'pass', 'No versions of this artifact on Maven Central yet (first release)'));
    } else {
      checks.push(check('version.central.metadata', 'warn', `Unexpected HTTP ${res.status} for maven-metadata.xml`));
    }
  } catch (err) {
    checks.push(check('version.central.metadata', 'warn', `Could not read maven-metadata.xml: ${err.message}`));
  }

  return result(checks, data);
}

await runCli(import.meta.url, {
  usage: 'Usage: check-version.mjs --group <groupId> --artifact <artifactId> --version <new> [--current <current>]',
  options: { group: { type: 'string' }, artifact: { type: 'string' }, version: { type: 'string' }, current: { type: 'string' }, 'repo-url': { type: 'string' } },
}, (v) => {
  required(v, 'group', 'artifact', 'version');
  return checkVersion({ group: v.group, artifact: v.artifact, version: v.version, current: v.current, base: v['repo-url'] ?? CENTRAL_REPO });
});
