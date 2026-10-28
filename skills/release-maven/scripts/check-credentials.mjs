#!/usr/bin/env node
// Phase 2: reports which credential keys exist and where. Never prints values.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { runCli, check, result, UsageError } from '../../release-agent-shared/scripts/lib/cli.mjs';
import { isTracked } from '../../release-agent-shared/scripts/lib/git.mjs';
import { credentialSources, locateKey, describeKey } from './lib/credentials.mjs';

const CENTRAL_KEYS = ['mavenCentralUsername', 'mavenCentralPassword'];
const SECRET_KEYS = [
  ...CENTRAL_KEYS, 'signingInMemoryKey', 'signingInMemoryKeyPassword', 'signingKey', 'signingPassword', 'signing.password',
];

function usesGpgCmd(projectDir) {
  const files = ['build.gradle.kts', 'build.gradle'];
  const dirs = [projectDir, ...readdirSync(projectDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'build').map((d) => join(projectDir, d.name))];
  return dirs.some((d) => files.some((f) => existsSync(join(d, f)) && /useGpgCmd\s*\(/.test(readFileSync(join(d, f), 'utf8'))));
}

function gpgInstalled() {
  try {
    execFileSync('gpg', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function gpgSecretKeyCount() {
  try {
    const out = execFileSync('gpg', ['--batch', '--list-secret-keys', '--with-colons'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').filter((l) => l.startsWith('sec:')).length;
  } catch {
    return null;
  }
}

export function checkCredentials({ setup = 'any', projectDir = '.', env = process.env, home, gpgCount = gpgSecretKeyCount, hasGpg = gpgInstalled } = {}) {
  if (!['vanniktech', 'maven-publish', 'any'].includes(setup)) throw new UsageError(`Unknown setup "${setup}"`);
  const sources = credentialSources({ projectDir, env, home });
  const checks = [];
  const report = {};
  const locate = (key) => (report[key] = locateKey(key, sources));

  for (const key of CENTRAL_KEYS) {
    const r = locate(key);
    checks.push(r.found
      ? check(`credentials.${key}`, 'pass', `${key} found in ${r.source}`)
      : check(`credentials.${key}`, 'fail', `${key} not found`, { fix: `Add ${key} (a Central Portal user token part) to ~/.gradle/gradle.properties or set ORG_GRADLE_PROJECT_${key}. See errors.md E01.` }));
  }

  // Signing: any one of the supported configurations is enough.
  const inMemory = locate('signingInMemoryKey');
  locate('signingInMemoryKeyId');
  locate('signingInMemoryKeyPassword');
  const plainInMemory = locate('signingKey');
  const keyring = ['signing.keyId', 'signing.password', 'signing.secretKeyRingFile'].map(locate);
  const gpgCmd = usesGpgCmd(projectDir);
  const signing = [];

  if (inMemory.found) {
    signing.push('in-memory (signingInMemoryKey)');
    const armored = describeKey('signingInMemoryKey', sources, (v) => /-----BEGIN PGP PRIVATE KEY BLOCK-----/.test(v.replace(/\\n/g, '\n')));
    if (!armored) checks.push(check('credentials.signingInMemoryKey.format', 'warn', 'signingInMemoryKey is not an ASCII-armored private key block', { fix: 'The user should re-export it with `gpg --armor --export-secret-keys <KEYID>` (errors.md E12).' }));
  }
  if (plainInMemory.found) signing.push('in-memory (signingKey, plain signing plugin)');
  if (keyring.every((r) => r.found)) {
    signing.push('key ring file (signing.keyId)');
    const fileOk = describeKey('signing.secretKeyRingFile', sources, (p) => isAbsolute(p) && existsSync(p));
    if (!fileOk) checks.push(check('credentials.signing.secretKeyRingFile', 'fail', 'signing.secretKeyRingFile is not an absolute path to an existing file', { fix: 'See errors.md E13.' }));
  } else if (keyring.some((r) => r.found)) {
    checks.push(check('credentials.signing.keyring', 'warn', `Key ring configuration is incomplete: missing ${keyring.filter((r) => !r.found).map((r) => r.key).join(', ')}`));
  }
  if (gpgCmd) {
    const count = gpgCount();
    if (count) signing.push(`gpg agent (useGpgCmd, ${count} secret key(s) in the local keyring)`);
    else checks.push(check('credentials.gpg', 'fail', 'The build uses useGpgCmd() but gpg has no secret keys or is not installed', { fix: 'See reference/signing-setup.md.' }));
  }
  const gpg = hasGpg();
  checks.push(signing.length
    ? check('credentials.signing', 'pass', `Signing configured: ${signing.join('; ')}`)
    : check('credentials.signing', 'fail', `No signing configuration found${gpg ? '' : ' (gpg is not installed)'}`, {
      fix: gpg
        ? 'Configure one of the setups in reference/signing-setup.md (errors.md E11).'
        : 'Use the in-memory key setup (signingInMemoryKey, signingInMemoryKeyPassword); it needs no gpg on this machine. See reference/signing-setup.md (errors.md E11).',
    }));

  // Secrets must not sit in files that are committed.
  for (const key of SECRET_KEYS) {
    const r = report[key] ?? locate(key);
    for (const [source, file] of [['project-gradle.properties', 'gradle.properties'], ['local.properties', 'local.properties']]) {
      if (!r.sources.includes(source)) continue;
      const tracked = isTracked(file, projectDir);
      checks.push(check(`credentials.${key}.location`, tracked ? 'fail' : 'warn',
        `${key} is stored in the project's ${file}${tracked ? ', which is tracked by git' : ''}`,
        { fix: tracked ? 'Move it to ~/.gradle/gradle.properties and rotate it, since it is in git history.' : 'Move it to ~/.gradle/gradle.properties so it cannot be committed by accident.' }));
    }
  }

  return result(checks, { gpgInstalled: gpg, keys: Object.values(report).map(({ key, found, source }) => ({ key, found, source })) });
}

await runCli(import.meta.url, {
  usage: 'Usage: check-credentials.mjs [--setup vanniktech|maven-publish|any] [--project <dir>]',
  options: { setup: { type: 'string', default: 'any' }, project: { type: 'string', default: '.' } },
}, (v) => checkCredentials({ setup: v.setup, projectDir: v.project }));
