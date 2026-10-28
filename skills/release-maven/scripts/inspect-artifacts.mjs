#!/usr/bin/env node
// Phase 4: checks the staged Maven repo has, for every component, a POM, the main
// artifact, sources and javadoc jars and a .asc per file, and for KMP that every
// target referenced by the root .module file (and declared in the build) is present.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runCli, check, result, required } from '../../release-agent-shared/scripts/lib/cli.mjs';
import { listComponents, isAuxiliary, parseXml, child, text } from './lib/maven.mjs';
import { detectProject } from './lib/gradle.mjs';

function moduleTargets(dir, artifactId, version) {
  const file = join(dir, `${artifactId}-${version}.module`);
  if (!existsSync(file)) return [];
  const meta = JSON.parse(readFileSync(file, 'utf8'));
  return [...new Set((meta.variants ?? []).map((v) => v['available-at']?.module).filter(Boolean))];
}

export function inspectArtifacts({ repo, group, version, expected = [] }) {
  const checks = [];
  const components = listComponents(repo, group, version);
  if (components.length === 0) {
    return result([check('artifacts.found', 'fail', `No artifacts for ${group} version ${version} in ${repo}`, {
      fix: 'Run publishToMavenLocal with -Dmaven.repo.local pointing at this directory, and check the group and version.',
    })]);
  }
  checks.push(check('artifacts.found', 'pass', `${components.length} component(s): ${components.map((c) => c.artifactId).join(', ')}`));

  const present = new Set(components.map((c) => c.artifactId));
  const summary = [];
  for (const { artifactId, dir, files } of components) {
    const prefix = `${artifactId}-${version}`;
    const has = (name) => files.includes(name);
    const pomFile = `${prefix}.pom`;
    const missing = [];
    let packaging = 'jar';
    if (!has(pomFile)) missing.push(pomFile);
    else packaging = text(child(parseXml(readFileSync(join(dir, pomFile), 'utf8')), 'packaging')) || 'jar';

    const mains = files.filter((f) => f.startsWith(`${prefix}.`) && !isAuxiliary(f) && !/\.(pom|module)$/.test(f));
    if (packaging !== 'pom') {
      if (mains.length === 0) missing.push(`${prefix}.<${packaging}>`);
      if (!has(`${prefix}-sources.jar`)) missing.push(`${prefix}-sources.jar`);
      if (!has(`${prefix}-javadoc.jar`)) missing.push(`${prefix}-javadoc.jar`);
    }
    const unsigned = files.filter((f) => !isAuxiliary(f) && !has(`${f}.asc`));

    if (missing.length) {
      const fixes = [];
      if (missing.some((m) => m.endsWith('-javadoc.jar'))) fixes.push('javadoc: errors.md E04');
      if (missing.some((m) => m.endsWith('-sources.jar'))) fixes.push('sources: errors.md E05');
      checks.push(check(`artifacts.${artifactId}.files`, 'fail', `${artifactId}: missing ${missing.join(', ')}`, { fix: fixes.join('; ') || 'Check the publication configuration.' }));
    } else {
      checks.push(check(`artifacts.${artifactId}.files`, 'pass', `${artifactId}: POM, main artifact, sources and javadoc present`));
    }
    checks.push(unsigned.length
      ? check(`artifacts.${artifactId}.signatures`, 'fail', `${artifactId}: ${unsigned.length} file(s) without .asc: ${unsigned.join(', ')}`, { fix: 'Signing did not run for these files (errors.md E06).' })
      : check(`artifacts.${artifactId}.signatures`, 'pass', `${artifactId}: every file has a .asc signature`));

    const targets = moduleTargets(dir, artifactId, version);
    const missingTargets = targets.filter((t) => !present.has(t));
    if (missingTargets.length) {
      checks.push(check(`artifacts.${artifactId}.targets`, 'fail', `${artifactId}: .module references target artifact(s) not in the staging repo: ${missingTargets.join(', ')}`, { fix: 'A target was not published. Never upload a partial set (errors.md E17).' }));
    }
    summary.push({ artifactId, packaging, files: files.filter((f) => !isAuxiliary(f)), targets });
  }

  const notStaged = expected.filter((a) => !present.has(a));
  if (notStaged.length) {
    checks.push(check('artifacts.expected', 'fail', `Declared in the build but not staged: ${notStaged.join(', ')}`, {
      fix: 'Check that every module and target publishes (errors.md E17, E19 for Android).',
    }));
  } else if (expected.length) {
    checks.push(check('artifacts.expected', 'pass', `All ${expected.length} expected artifact(s) staged`));
  }

  const fileCount = components.reduce((n, c) => n + c.files.filter((f) => !/\.(md5|sha1|sha256|sha512)$/.test(f) && !f.startsWith('maven-metadata')).length, 0);
  return result(checks, { fileCount, components: summary });
}

function expectedFromProject(projectDir, group) {
  const project = detectProject(resolve(projectDir));
  return project.modules.filter((m) => m.setup !== 'none' && m.group === group).flatMap((m) => m.expectedArtifacts);
}

await runCli(import.meta.url, {
  usage: 'Usage: inspect-artifacts.mjs --repo <dir> --group <groupId> --version <version> [--project <dir>] [--expect a,b,c]',
  options: { repo: { type: 'string' }, group: { type: 'string' }, version: { type: 'string' }, project: { type: 'string' }, expect: { type: 'string' } },
}, (v) => {
  required(v, 'repo', 'group', 'version');
  const expected = v.expect ? v.expect.split(',').map((s) => s.trim()).filter(Boolean) : v.project ? expectedFromProject(v.project, v.group) : [];
  return inspectArtifacts({ repo: v.repo, group: v.group, version: v.version, expected });
});
