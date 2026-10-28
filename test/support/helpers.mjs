// Test helpers. Temporary directories are created under the OS temp dir and are
// not removed by the tests; the OS cleans them up.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export function tempDir(prefix = 'ras-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Writes { 'path/file': 'content' } under root. */
export function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

export function gitRepo(dir) {
  const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  run('config', 'commit.gpgsign', 'false');
  run('config', 'tag.gpgsign', 'false');
  return {
    run,
    commit(message, file = 'file.txt', content = message) {
      writeFileSync(join(dir, file), content);
      run('add', '-A');
      run('commit', '-q', '-m', message);
    },
  };
}

/** Fake fetch: routes is a function (url, init) -> { status, body }. Records calls. */
export function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const { status = 200, body = '' } = routes(String(url), init) ?? {};
    return new Response(status === 204 ? null : body, { status });
  };
  impl.calls = calls;
  return impl;
}

/** Builds an ASCII-armored v4 signature packet carrying an issuer fingerprint (not cryptographically valid). */
export function fakeSignature(fingerprintHex) {
  const fpr = Buffer.from(fingerprintHex, 'hex');
  const created = Buffer.alloc(4);
  created.writeUInt32BE(1700000000);
  const hashed = Buffer.concat([
    Buffer.from([5, 2]), created, // creation time
    Buffer.from([22, 33, 4]), fpr, // issuer fingerprint, v4 key
  ]);
  const unhashed = Buffer.concat([Buffer.from([9, 16]), fpr.subarray(12)]); // issuer key id
  const body = Buffer.concat([
    Buffer.from([4, 0x00, 1, 8]), // v4, binary doc, RSA, SHA256
    Buffer.from([0, hashed.length]), hashed,
    Buffer.from([0, unhashed.length]), unhashed,
    Buffer.from([0xab, 0xcd]), // left 16 bits of hash
    Buffer.from([0x00, 0x08, 0xff]), // dummy MPI
  ]);
  const packet = Buffer.concat([Buffer.from([0xc2, body.length]), body]);
  const b64 = packet.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN PGP SIGNATURE-----\nVersion: BCPG v1.80\n\n${b64}\n=AAAA\n-----END PGP SIGNATURE-----\n`;
}

export const FPR = '0123456789ABCDEF0123456789ABCDEF01234567';

const POM = (group, artifact, version, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>${group}</groupId>
  <artifactId>${artifact}</artifactId>
  <version>${version}</version>
  <name>${artifact}</name>
  <description>Test library</description>
  <url>https://github.com/example/lib</url>
  <licenses><license><name>MIT</name><url>https://opensource.org/licenses/MIT</url></license></licenses>
  <developers><developer><id>example</id><name>Example</name></developer></developers>
  <scm>
    <url>https://github.com/example/lib</url>
    <connection>scm:git:git://github.com/example/lib.git</connection>
    <developerConnection>scm:git:ssh://git@github.com/example/lib.git</developerConnection>
  </scm>${extra}
</project>
`;
export { POM };

/** Creates a staged Maven repo for a KMP library: root + targets, each fully signed. */
export function stagedKmpRepo({ group = 'io.github.example', artifact = 'lib', version = '1.0.2', targets = ['jvm', 'iosarm64'], omit = [] } = {}) {
  const repo = tempDir('ras-repo-');
  const gp = group.replace(/\./g, '/');
  const files = {};
  const add = (a, name, content) => {
    if (omit.includes(name)) return;
    files[`${gp}/${a}/${version}/${name}`] = content;
    if (!omit.includes(`${name}.asc`)) files[`${gp}/${a}/${version}/${name}.asc`] = fakeSignature(FPR);
  };
  const module = { formatVersion: '1.1', variants: targets.map((t) => ({ name: `${t}ApiElements`, 'available-at': { url: `../../${artifact}-${t}/${version}/${artifact}-${t}-${version}.module`, group, module: `${artifact}-${t}`, version } })) };
  for (const a of [artifact, ...targets.map((t) => `${artifact}-${t}`)]) {
    const ext = a.endsWith('iosarm64') ? 'klib' : 'jar';
    add(a, `${a}-${version}.pom`, POM(group, a, version, ext === 'klib' ? '\n  <packaging>klib</packaging>' : ''));
    add(a, `${a}-${version}.module`, JSON.stringify(a === artifact ? module : { formatVersion: '1.1', variants: [] }));
    add(a, `${a}-${version}.${ext}`, `main ${a}`);
    add(a, `${a}-${version}-sources.jar`, `sources ${a}`);
    add(a, `${a}-${version}-javadoc.jar`, `javadoc ${a}`);
  }
  files[`${gp}/${artifact}/maven-metadata-local.xml`] = '<metadata/>';
  writeTree(repo, files);
  return repo;
}
