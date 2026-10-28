#!/usr/bin/env node
// Builds the Maven Central artifacts for io.github.ahmadhussain0335:release-agent-skills
// into a Maven repository layout: POM, jar (the skills), sources jar and javadoc jar.
// Signing and upload happen in .github/workflows/maven-central.yml.
import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, check, result } from '../../skills/release-agent-shared/scripts/lib/cli.mjs';
import { createZip } from '../../skills/release-maven/scripts/lib/zip.mjs';

export const GROUP = 'io.github.ahmadhussain0335';
export const ARTIFACT = 'release-agent-skills';
const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function walk(dir) {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function pom(version) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>${GROUP}</groupId>
  <artifactId>${ARTIFACT}</artifactId>
  <version>${version}</version>
  <packaging>jar</packaging>
  <name>release-agent-skills</name>
  <description>Agent skills that publish libraries safely: Maven Central through the Sonatype Central Portal for JVM, Android and Kotlin Multiplatform, with pre-flight checks, approval gates and manual release by default. Install with npx release-agent-skills install.</description>
  <url>https://github.com/Ahmadhussain0335/release-agent-skills</url>
  <inceptionYear>2026</inceptionYear>
  <licenses>
    <license>
      <name>MIT License</name>
      <url>https://opensource.org/licenses/MIT</url>
      <distribution>repo</distribution>
    </license>
  </licenses>
  <developers>
    <developer>
      <id>Ahmadhussain0335</id>
      <name>Ahmad Hussain</name>
      <email>ahmadhussain0335@gmail.com</email>
      <url>https://github.com/Ahmadhussain0335</url>
    </developer>
  </developers>
  <scm>
    <url>https://github.com/Ahmadhussain0335/release-agent-skills</url>
    <connection>scm:git:git://github.com/Ahmadhussain0335/release-agent-skills.git</connection>
    <developerConnection>scm:git:ssh://git@github.com/Ahmadhussain0335/release-agent-skills.git</developerConnection>
  </scm>
</project>
`;
}

function manifest(version) {
  return `Manifest-Version: 1.0\r\nImplementation-Title: ${ARTIFACT}\r\nImplementation-Version: ${version}\r\nImplementation-Vendor: Ahmad Hussain\r\n\r\n`;
}

const entry = (name, data) => ({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data) });

export function buildMavenRepo({ out, version, root = ROOT }) {
  const skills = walk(join(root, 'skills')).map((f) => entry(relative(root, f).split(sep).join('/'), readFileSync(f)));
  const common = [
    entry('META-INF/MANIFEST.MF', manifest(version)),
    entry('META-INF/LICENSE', readFileSync(join(root, 'LICENSE'))),
    entry('README.md', readFileSync(join(root, 'README.md'))),
  ];
  const dir = join(out, ...GROUP.split('.'), ARTIFACT, version);
  mkdirSync(dir, { recursive: true });
  const prefix = join(dir, `${ARTIFACT}-${version}`);
  writeFileSync(`${prefix}.pom`, pom(version));
  writeFileSync(`${prefix}.jar`, createZip([...common, ...skills]));
  writeFileSync(`${prefix}-sources.jar`, createZip([...common, ...skills]));
  // The skills are Markdown and scripts, not Java, so the javadoc jar carries the README.
  writeFileSync(`${prefix}-javadoc.jar`, createZip(common));
  return { dir, files: readdirSync(dir).sort(), skillFiles: skills.length };
}

await runCli(import.meta.url, {
  usage: 'Usage: build.mjs --out <dir> [--version <version>]   (version defaults to package.json)',
  options: { out: { type: 'string', default: 'build/maven-repo' }, version: { type: 'string' } },
}, (v) => {
  const version = v.version ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
  const built = buildMavenRepo({ out: resolve(v.out), version });
  return result([check('maven.build', 'pass', `Built ${GROUP}:${ARTIFACT}:${version} (${built.skillFiles} skill files) in ${built.dir}`)], built);
});
