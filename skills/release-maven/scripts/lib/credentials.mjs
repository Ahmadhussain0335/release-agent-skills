// Locates Gradle credentials by key name. Only `readSecret` returns a value,
// and only portal.mjs may call it. Nothing in this module logs values.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readProperties } from '../../../release-agent-shared/scripts/lib/properties.mjs';

export function gradleUserHome(env = process.env) {
  return env.GRADLE_USER_HOME || join(homedir(), '.gradle');
}

/** Places credentials are looked up, first match wins. -P command-line values are not visible here. */
export function credentialSources({ projectDir = '.', env = process.env, home = gradleUserHome(env) } = {}) {
  return [
    { name: 'gradle-user-home', file: join(home, 'gradle.properties'), props: readProperties(join(home, 'gradle.properties')) },
    { name: 'env', props: new Map(Object.entries(env).filter(([k]) => k.startsWith('ORG_GRADLE_PROJECT_')).map(([k, v]) => [k.slice('ORG_GRADLE_PROJECT_'.length), v])) },
    { name: 'project-gradle.properties', file: join(projectDir, 'gradle.properties'), props: readProperties(join(projectDir, 'gradle.properties')) },
    { name: 'local.properties', file: join(projectDir, 'local.properties'), props: readProperties(join(projectDir, 'local.properties')) },
  ];
}

/** Returns { key, found, source, sources } without the value. Empty values count as missing. */
export function locateKey(key, sources) {
  const hits = sources.filter((s) => s.props && (s.props.get(key) ?? '').trim() !== '').map((s) => s.name);
  return { key, found: hits.length > 0, source: hits[0] ?? null, sources: hits };
}

/** Inspects a value without returning it. */
export function describeKey(key, sources, inspect) {
  for (const s of sources) {
    const v = s.props?.get(key);
    if (v && v.trim() !== '') return inspect(v);
  }
  return null;
}

export function readSecret(key, sources) {
  for (const s of sources) {
    const v = s.props?.get(key);
    if (v && v.trim() !== '') return v;
  }
  return null;
}
