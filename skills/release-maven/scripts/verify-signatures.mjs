#!/usr/bin/env node
// Phase 4: every artifact has a readable .asc, signatures verify with gpg when it is
// installed, all files are signed by the same key, and that key is on a public keyserver.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runCli, check, result, required } from '../../release-agent-shared/scripts/lib/cli.mjs';
import { fetchWithRetry } from '../../release-agent-shared/scripts/lib/http.mjs';
import { isAuxiliary } from './lib/maven.mjs';
import { signatureInfo } from './lib/pgp.mjs';

function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function gpgAvailable() {
  try {
    execFileSync('gpg', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Returns a GnuPG status keyword (GOODSIG, BADSIG, EXPKEYSIG, NO_PUBKEY, ...). User IDs are not returned. */
function gpgVerify(file) {
  let out = '';
  try {
    out = execFileSync('gpg', ['--batch', '--status-fd', '1', '--verify', `${file}.asc`, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (err) {
    out = err.stdout?.toString() ?? '';
  }
  for (const keyword of ['BADSIG', 'REVKEYSIG', 'EXPKEYSIG', 'EXPSIG', 'NO_PUBKEY', 'GOODSIG']) {
    if (new RegExp(`\\[GNUPG:\\] ${keyword}\\b`).test(out)) return keyword;
  }
  return 'ERROR';
}

export async function keyOnKeyserver(issuer, fetchImpl = fetch) {
  const servers = [];
  const id = issuer.fingerprint ?? issuer.keyId;
  const openpgp = issuer.fingerprint
    ? `https://keys.openpgp.org/vks/v1/by-fingerprint/${issuer.fingerprint}`
    : `https://keys.openpgp.org/vks/v1/by-keyid/${issuer.keyId}`;
  const ubuntu = `https://keyserver.ubuntu.com/pks/lookup?op=get&options=mr&search=0x${id}`;
  for (const [name, url] of [['keys.openpgp.org', openpgp], ['keyserver.ubuntu.com', ubuntu]]) {
    try {
      const res = await fetchWithRetry(url, {}, { fetchImpl, retries: 1, timeoutMs: 15000 });
      servers.push({ name, found: res.status === 200 });
    } catch {
      servers.push({ name, found: null });
    }
  }
  return servers;
}

export async function verifySignatures({ repo, version, useGpg = gpgAvailable(), checkKeyserver = true, unsignedExpected = false, fetchImpl = fetch, verify = gpgVerify }) {
  const checks = [];
  const files = walk(repo).filter((f) => !isAuxiliary(basename(f)) && (!version || f.split(sep).includes(version)));
  if (files.length === 0) return result([check('signatures.files', 'fail', `No artifacts found in ${repo}`)]);

  const unsigned = [];
  const unreadable = [];
  const issuers = new Map();
  for (const f of files) {
    if (!existsSync(`${f}.asc`)) { unsigned.push(relative(repo, f)); continue; }
    try {
      const info = signatureInfo(readFileSync(`${f}.asc`, 'utf8'));
      const key = info.fingerprint ?? info.keyId;
      if (!issuers.has(key)) issuers.set(key, { fingerprint: info.fingerprint ?? null, keyId: info.keyId, files: 0 });
      issuers.get(key).files++;
    } catch (err) {
      unreadable.push(`${relative(repo, f)}.asc (${err.message})`);
    }
  }
  if (!unsigned.length) checks.push(check('signatures.present', 'pass', `All ${files.length} file(s) have a .asc signature`));
  else if (unsignedExpected) checks.push(check('signatures.present', 'warn', `${unsigned.length} of ${files.length} file(s) unsigned, as expected: signing runs in CI. Signatures are checked by the Portal on upload.`));
  else checks.push(check('signatures.present', 'fail', `${unsigned.length} of ${files.length} file(s) have no .asc`, { files: unsigned.slice(0, 30), fix: 'errors.md E06.' }));
  if (issuers.size === 0 && unreadable.length === 0) return result(checks, { fileCount: files.length, keys: [] });
  if (unreadable.length) checks.push(check('signatures.format', 'fail', `${unreadable.length} signature file(s) could not be parsed`, { files: unreadable.slice(0, 30) }));
  if (issuers.size > 1) checks.push(check('signatures.issuer', 'warn', `Files are signed by ${issuers.size} different keys`, { fix: 'Usually a mix of primary key and subkey, or two configured keys. See reference/signing-setup.md.' }));

  if (useGpg) {
    const results = {};
    for (const f of files.filter((x) => existsSync(`${x}.asc`))) {
      const r = verify(f);
      (results[r] ??= []).push(relative(repo, f));
    }
    const bad = Object.entries(results).filter(([k]) => ['BADSIG', 'REVKEYSIG', 'ERROR'].includes(k));
    const expired = results.EXPKEYSIG ?? results.EXPSIG;
    if (bad.length) checks.push(check('signatures.gpg', 'fail', `gpg rejected ${bad.reduce((n, [, v]) => n + v.length, 0)} signature(s): ${bad.map(([k]) => k).join(', ')}`, { files: bad.flatMap(([, v]) => v).slice(0, 30), fix: 'errors.md E07.' }));
    else if (expired) checks.push(check('signatures.gpg', 'fail', 'Signed with an expired key', { fix: 'Extend the key expiry and re-publish the public key (reference/signing-setup.md).' }));
    else if (results.NO_PUBKEY) checks.push(check('signatures.gpg', 'warn', 'gpg could not verify: the public key is not in the local keyring'));
    else checks.push(check('signatures.gpg', 'pass', `gpg verified ${results.GOODSIG?.length ?? 0} signature(s)`));
  } else {
    checks.push(check('signatures.gpg', 'warn', 'gpg is not installed; signatures were parsed but not cryptographically verified'));
  }

  const keys = [];
  if (checkKeyserver) {
    for (const issuer of issuers.values()) {
      const servers = await keyOnKeyserver(issuer, fetchImpl);
      keys.push({ ...issuer, servers });
      const id = issuer.fingerprint ?? issuer.keyId;
      if (servers.some((s) => s.found)) checks.push(check(`signatures.keyserver.${id}`, 'pass', `Key ${id} found on ${servers.filter((s) => s.found).map((s) => s.name).join(', ')}`));
      else if (servers.every((s) => s.found === null)) checks.push(check(`signatures.keyserver.${id}`, 'warn', `Could not reach keyservers to look up key ${id}`));
      else checks.push(check(`signatures.keyserver.${id}`, 'fail', `Key ${id} is not on keys.openpgp.org or keyserver.ubuntu.com`, { fix: `The user runs: gpg --keyserver keyserver.ubuntu.com --send-keys ${id} (errors.md E07).` }));
    }
  } else {
    keys.push(...issuers.values());
  }
  return result(checks, { fileCount: files.length, keys });
}

await runCli(import.meta.url, {
  usage: 'Usage: verify-signatures.mjs --repo <dir> [--version <version>] [--no-gpg] [--no-keyserver] [--unsigned-expected]',
  options: { repo: { type: 'string' }, version: { type: 'string' }, 'no-gpg': { type: 'boolean', default: false }, 'no-keyserver': { type: 'boolean', default: false }, 'unsigned-expected': { type: 'boolean', default: false } },
}, (v) => {
  required(v, 'repo');
  return verifySignatures({ repo: v.repo, version: v.version, useGpg: v['no-gpg'] ? false : gpgAvailable(), checkKeyserver: !v['no-keyserver'], unsignedExpected: v['unsigned-expected'] });
});
