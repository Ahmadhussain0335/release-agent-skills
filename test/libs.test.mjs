import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { parseProperties } from '../skills/release-agent-shared/scripts/lib/properties.mjs';
import { compareVersions, parseXml, child, children, text, pomUrl } from '../skills/release-maven/scripts/lib/maven.mjs';
import { signatureInfo } from '../skills/release-maven/scripts/lib/pgp.mjs';
import { createZip, crc32 } from '../skills/release-maven/scripts/lib/zip.mjs';
import { fakeSignature, FPR } from './support/helpers.mjs';

test('parseProperties handles separators, comments, continuations and escapes', () => {
  const p = parseProperties('# comment\n! also\na=1\nb : 2\nc 3\nd=line1\\\n   line2\ne=x\\ny\nf=\n');
  assert.equal(p.get('a'), '1');
  assert.equal(p.get('b'), '2');
  assert.equal(p.get('c'), '3');
  assert.equal(p.get('d'), 'line1line2');
  assert.equal(p.get('e'), 'x\ny');
  assert.equal(p.get('f'), '');
  assert.equal(p.size, 6);
});

test('compareVersions orders numeric parts and qualifiers like Maven', () => {
  assert.ok(compareVersions('1.0.2', '1.0.1') > 0);
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.0-rc1') > 0);
  assert.ok(compareVersions('1.0.0-rc1', '1.0.0-beta2') > 0);
  assert.ok(compareVersions('1.0.0-alpha1', '1.0.0-alpha2') < 0);
  assert.ok(compareVersions('1.0', '1.0.1') < 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('parseXml reads POM structure and ignores namespaces and comments', () => {
  const doc = parseXml('<?xml version="1.0"?><!-- c --><project xmlns="x"><name>A &amp; B</name><licenses><license><name>MIT</name></license><license><name>Apache</name></license></licenses><empty/></project>');
  assert.equal(doc.name, 'project');
  assert.equal(text(child(doc, 'name')), 'A & B');
  assert.deepEqual(children(child(doc, 'licenses'), 'license').map((l) => text(child(l, 'name'))), ['MIT', 'Apache']);
  assert.ok(child(doc, 'empty'));
});

test('pomUrl builds the repo1 path', () => {
  assert.equal(pomUrl('io.github.a', 'lib', '1.0'), 'https://repo1.maven.org/maven2/io/github/a/lib/1.0/lib-1.0.pom');
});

test('signatureInfo extracts issuer fingerprint and key id', () => {
  const info = signatureInfo(fakeSignature(FPR));
  assert.equal(info.version, 4);
  assert.equal(info.fingerprint, FPR);
  assert.equal(info.keyId, FPR.slice(-16));
  assert.equal(info.created, new Date(1700000000 * 1000).toISOString());
  assert.throws(() => signatureInfo('not a signature'), /ASCII-armored/);
});

test('createZip produces entries that inflate back to the input', () => {
  const zip = createZip([{ name: 'a/b.txt', data: Buffer.from('hello world') }, { name: 'c.txt', data: Buffer.from('') }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 2);
  const nameLen = zip.readUInt16LE(26);
  const size = zip.readUInt32LE(18);
  const data = inflateRawSync(zip.subarray(30 + nameLen, 30 + nameLen + size));
  assert.equal(data.toString(), 'hello world');
  assert.equal(zip.readUInt32LE(14), crc32(Buffer.from('hello world')));
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});
