#!/usr/bin/env node
// Phase 4: checks every generated POM for the fields Maven Central requires.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { runCli, check, result, UsageError } from '../../release-agent-shared/scripts/lib/cli.mjs';
import { parseXml, child, children, text } from './lib/maven.mjs';

const isUrl = (s) => /^https?:\/\/\S+$/.test(s);

export function validatePomText(xml) {
  const project = parseXml(xml);
  if (!project || project.name !== 'project') return { missing: ['<project> root element'], warnings: [], coordinates: null };
  const missing = [];
  const warnings = [];
  const get = (name) => text(child(project, name));

  const parent = child(project, 'parent');
  const groupId = get('groupId') || text(child(parent, 'groupId'));
  const artifactId = get('artifactId');
  const version = get('version') || text(child(parent, 'version'));
  if (!groupId) missing.push('groupId');
  if (!artifactId) missing.push('artifactId');
  if (!version) missing.push('version');
  else if (/-SNAPSHOT$/i.test(version)) missing.push('release version (found SNAPSHOT)');

  if (!get('name')) missing.push('name');
  if (!get('description')) missing.push('description');
  if (!get('url')) missing.push('url');
  else if (!isUrl(get('url'))) warnings.push(`url "${get('url')}" is not an absolute http(s) URL`);

  const licenses = children(child(project, 'licenses'), 'license');
  if (licenses.length === 0) missing.push('licenses');
  else if (!licenses.some((l) => text(child(l, 'name')) && text(child(l, 'url')))) missing.push('license name and url');

  const developers = children(child(project, 'developers'), 'developer');
  if (developers.length === 0) missing.push('developers');
  else if (!developers.some((d) => text(child(d, 'name')) || text(child(d, 'id')))) missing.push('developer name or id');

  const scm = child(project, 'scm');
  if (!scm) missing.push('scm');
  else {
    if (!text(child(scm, 'url'))) missing.push('scm/url');
    for (const field of ['connection', 'developerConnection']) {
      const value = text(child(scm, field));
      if (!value) missing.push(`scm/${field}`);
      else if (!value.startsWith('scm:')) warnings.push(`scm/${field} should start with "scm:"`);
    }
    const scmUrl = text(child(scm, 'url')).replace(/\.git$/, '').replace(/\/$/, '');
    const url = get('url').replace(/\/$/, '');
    if (scmUrl && url && /github\.com|gitlab\.com/.test(scmUrl + url) && scmUrl !== url) warnings.push(`url (${url}) and scm/url (${scmUrl}) differ`);
  }

  if (child(project, 'repositories') || child(project, 'pluginRepositories')) warnings.push('POM declares <repositories>; Sonatype discourages this');
  const deps = children(child(project, 'dependencies'), 'dependency');
  const unversioned = deps.filter((d) => !text(child(d, 'version'))).map((d) => `${text(child(d, 'groupId'))}:${text(child(d, 'artifactId'))}`);
  if (unversioned.length && !child(project, 'dependencyManagement')) warnings.push(`dependencies without a version: ${unversioned.join(', ')}`);

  return { missing, warnings, coordinates: { groupId, artifactId, version } };
}

function findPoms(dir, version) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...findPoms(p, version));
    else if (entry.endsWith('.pom') && (!version || entry.endsWith(`-${version}.pom`))) out.push(p);
  }
  return out;
}

export function validatePoms(files) {
  const checks = [];
  const poms = [];
  for (const file of files) {
    const r = validatePomText(readFileSync(file, 'utf8'));
    const name = basename(file);
    poms.push({ file: name, ...r });
    if (r.missing.length) checks.push(check(`pom.${name}`, 'fail', `${name}: missing ${r.missing.join(', ')}`, { fix: 'See reference/pom-requirements.md (errors.md E08).' }));
    else checks.push(check(`pom.${name}`, 'pass', `${name}: all required fields present`));
    for (const w of r.warnings) checks.push(check(`pom.${name}.warning`, 'warn', `${name}: ${w}`));
  }
  if (files.length === 0) checks.push(check('pom.found', 'fail', 'No POM files found'));
  return result(checks, { poms });
}

await runCli(import.meta.url, {
  usage: 'Usage: validate-pom.mjs (--repo <dir> [--version <version>] | --pom <file>)',
  options: { repo: { type: 'string' }, version: { type: 'string' }, pom: { type: 'string', multiple: true } },
}, (v) => {
  if (!v.repo && !v.pom) throw new UsageError('Pass --repo or --pom');
  return validatePoms(v.pom ?? findPoms(v.repo, v.version));
});
