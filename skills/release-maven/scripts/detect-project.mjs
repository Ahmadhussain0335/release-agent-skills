#!/usr/bin/env node
// Phase 1: finds publishable modules, coordinates, version, library type and publishing setup.
import { resolve } from 'node:path';
import { runCli, check, result } from '../../release-agent-shared/scripts/lib/cli.mjs';
import { detectProject, detectionChecks } from './lib/gradle.mjs';

export function detect(projectDir, opts) {
  const project = detectProject(resolve(projectDir), opts);
  return result(detectionChecks(project, check), project);
}

await runCli(import.meta.url, {
  usage: 'Usage: detect-project.mjs [--project <dir>]',
  options: { project: { type: 'string', default: '.' } },
}, (v) => detect(v.project));
