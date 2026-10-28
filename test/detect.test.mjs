import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detect } from '../skills/release-maven/scripts/detect-project.mjs';
import { bumpVersion } from '../skills/release-maven/scripts/bump-version.mjs';
import { tempDir, writeTree } from './support/helpers.mjs';

const KMP_VANNIKTECH = {
  'settings.gradle.kts': 'rootProject.name = "KMPermission"\ninclude(":kmpermission")\n// include(":sample")\n',
  'build.gradle.kts': 'plugins {\n  alias(libs.plugins.kotlinMultiplatform) apply false\n  alias(libs.plugins.vanniktech.mavenPublish) apply false\n}\n',
  'gradle/libs.versions.toml': '[versions]\nkotlin = "2.2.20"\nvanniktech = "0.37.0"\n\n[plugins]\nkotlinMultiplatform = { id = "org.jetbrains.kotlin.multiplatform", version.ref = "kotlin" }\nvanniktech-mavenPublish = { id = "com.vanniktech.maven.publish", version.ref = "vanniktech" }\nandroidLibrary = { id = "com.android.library", version = "8.13.0" }\n',
  'gradle.properties': 'GROUP=io.github.example\nVERSION_NAME=1.0.1\nPOM_NAME=KMPermission\n',
  'kmpermission/gradle.properties': 'POM_ARTIFACT_ID=kmpermission\n',
  'kmpermission/build.gradle.kts': `plugins {
  alias(libs.plugins.kotlinMultiplatform)
  alias(libs.plugins.androidLibrary)
  alias(libs.plugins.vanniktech.mavenPublish)
}
kotlin {
  jvmToolchain(17)
  androidTarget { publishLibraryVariants("release") }
  jvm("desktop")
  listOf(iosX64(), iosArm64(), iosSimulatorArm64()).forEach { it.binaries.framework { baseName = "kmp" } }
  sourceSets { iosArm64Main.dependencies { } }
}
mavenPublishing { publishToMavenCentral(); signAllPublications() }
`,
};

test('detects a KMP vanniktech module through version catalog aliases', () => {
  const root = writeTree(tempDir(), KMP_VANNIKTECH);
  const r = detect(root, { platform: 'darwin' });
  assert.equal(r.ok, true, JSON.stringify(r.checks, null, 2));
  assert.equal(r.data.modules.length, 1);
  const m = r.data.modules[0];
  assert.equal(m.path, 'kmpermission');
  assert.equal(m.type, 'kmp');
  assert.equal(m.setup, 'vanniktech');
  assert.equal(m.vanniktechVersion, '0.37.0');
  assert.equal(m.group, 'io.github.example');
  assert.equal(m.artifactId, 'kmpermission');
  assert.equal(m.version, '1.0.1');
  assert.deepEqual(m.kmp.targets.map((t) => t.artifactSuffix), ['android', 'desktop', 'iosx64', 'iosarm64', 'iossimulatorarm64']);
  assert.equal(m.kmp.appleTargets, true);
  assert.deepEqual(m.expectedArtifacts, ['kmpermission', 'kmpermission-android', 'kmpermission-desktop', 'kmpermission-iosx64', 'kmpermission-iosarm64', 'kmpermission-iossimulatorarm64']);
});

test('Apple targets on Linux warn, and fail when cinterop is used', () => {
  const root = writeTree(tempDir(), KMP_VANNIKTECH);
  const warn = detect(root, { platform: 'linux' });
  assert.equal(warn.checks.find((c) => c.id.endsWith('.host')).status, 'warn');
  writeTree(root, { 'kmpermission/src/nativeInterop/cinterop/foo.def': 'headers = foo.h' });
  const fail = detect(root, { platform: 'linux' });
  assert.equal(fail.checks.find((c) => c.id.endsWith('.host')).status, 'fail');
});

test('old vanniktech versions fail because they target OSSRH', () => {
  const root = writeTree(tempDir(), {
    ...KMP_VANNIKTECH,
    'gradle/libs.versions.toml': KMP_VANNIKTECH['gradle/libs.versions.toml'].replace('0.37.0', '0.29.0'),
  });
  const r = detect(root, { platform: 'darwin' });
  assert.equal(r.ok, false);
  assert.match(r.checks.find((c) => c.id.endsWith('.vanniktech')).message, /OSSRH/);
});

test('detects a plain maven-publish Android library and requires the signing plugin', () => {
  const root = writeTree(tempDir(), {
    'settings.gradle': "rootProject.name = 'lib'\ninclude ':library'\n",
    'library/build.gradle': "plugins {\n  id 'com.android.library'\n  id 'maven-publish'\n}\ngroup = 'com.example'\nversion = '2.3.0'\n",
  });
  const r = detect(root);
  const m = r.data.modules[0];
  assert.equal(m.type, 'android');
  assert.equal(m.setup, 'maven-publish');
  assert.equal(m.group, 'com.example');
  assert.equal(m.version, '2.3.0');
  assert.equal(r.checks.find((c) => c.id.endsWith('.signing')).status, 'fail');
  assert.equal(r.checks.find((c) => c.id.endsWith('.artifact')).status, 'warn');
});

test('reports a project without publishing setup', () => {
  const root = writeTree(tempDir(), { 'settings.gradle.kts': 'include(":app")', 'app/build.gradle.kts': 'plugins { kotlin("jvm") }' });
  const r = detect(root);
  assert.equal(r.ok, false);
  assert.equal(r.checks[0].id, 'detect.modules');
});

test('bump-version shows a diff, then writes gradle.properties', () => {
  const root = writeTree(tempDir(), KMP_VANNIKTECH);
  const dry = bumpVersion({ projectDir: root, to: '1.0.2' });
  assert.equal(dry.ok, true);
  assert.deepEqual(dry.data.diff, [{ file: 'gradle.properties', line: 2, before: 'VERSION_NAME=1.0.1', after: 'VERSION_NAME=1.0.2' }]);
  assert.match(readFileSync(join(root, 'gradle.properties'), 'utf8'), /VERSION_NAME=1\.0\.1/);
  bumpVersion({ projectDir: root, to: '1.0.2', write: true });
  assert.match(readFileSync(join(root, 'gradle.properties'), 'utf8'), /VERSION_NAME=1\.0\.2\nPOM_NAME/);
});

test('bump-version edits a version catalog entry referenced by the build', () => {
  const root = writeTree(tempDir(), {
    'settings.gradle.kts': 'rootProject.name = "lib"',
    'gradle/libs.versions.toml': '[versions]\nlibVersion = "0.4.0"\n',
    'build.gradle.kts': 'plugins { `java-library`\n `maven-publish`\n signing }\ngroup = "com.example"\nversion = libs.versions.libVersion.get()\n',
  });
  const r = bumpVersion({ projectDir: root, to: '0.5.0', write: true });
  assert.equal(r.ok, true, JSON.stringify(r, null, 2));
  assert.match(readFileSync(join(root, 'gradle/libs.versions.toml'), 'utf8'), /libVersion = "0\.5\.0"/);
});

test('bump-version refuses when version literals disagree', () => {
  const root = writeTree(tempDir(), {
    'settings.gradle.kts': 'rootProject.name = "lib"',
    'gradle.properties': 'version=1.0.0\n',
    'build.gradle.kts': 'plugins { `java-library`\n `maven-publish`\n}\nversion = "1.1.0"\n',
  });
  const r = bumpVersion({ projectDir: root, to: '1.2.0', write: true });
  assert.equal(r.ok, false);
  assert.match(readFileSync(join(root, 'gradle.properties'), 'utf8'), /1\.0\.0/);
});

// Mirrors KMPermission: AGP 9 KMP Android plugin, named coordinates, SNAPSHOT version
// overridden at release time, and a CI workflow that publishes.
test('detects AGP KMP Android target, named coordinates, version strategy and release workflow', () => {
  const root = writeTree(tempDir(), {
    'settings.gradle.kts': 'rootProject.name = "KMPermission"\ninclude(":kmppermission-core")\ninclude(":sample-android")\n',
    'build.gradle.kts': 'plugins {\n  alias(libs.plugins.mavenPublish) apply false\n}\n',
    'gradle/libs.versions.toml': '[versions]\nagp = "9.1.0"\nmavenPublish = "0.37.0"\n[plugins]\nkotlinMultiplatform = { id = "org.jetbrains.kotlin.multiplatform", version = "2.4.0" }\nandroidMultiplatformLibrary = { id = "com.android.kotlin.multiplatform.library", version.ref = "agp" }\nandroidApplication = { id = "com.android.application", version.ref = "agp" }\nmavenPublish = { id = "com.vanniktech.maven.publish", version.ref = "mavenPublish" }\n',
    'gradle.properties': 'GROUP=io.github.example\nVERSION_NAME=0.4.0-SNAPSHOT\n',
    'kmppermission-core/build.gradle.kts': 'plugins {\n  alias(libs.plugins.kotlinMultiplatform)\n  alias(libs.plugins.androidMultiplatformLibrary)\n  alias(libs.plugins.mavenPublish)\n}\nkotlin {\n  listOf(iosArm64(), iosSimulatorArm64()).forEach { }\n  android { namespace = "x" }\n}\nmavenPublishing {\n  coordinates(artifactId = "kmppermission-core")\n}\n',
    'sample-android/build.gradle.kts': 'plugins { alias(libs.plugins.androidApplication) }\n',
    '.github/workflows/publish.yml': 'name: Release\non:\n  workflow_dispatch:\njobs:\n  release:\n    steps:\n      - run: ./gradlew publishToMavenCentral --no-configuration-cache\n',
    '.github/workflows/ci.yml': 'name: CI\njobs: {}\n',
  });
  const r = detect(root, { platform: 'darwin' });
  assert.equal(r.data.modules.length, 1);
  const m = r.data.modules[0];
  assert.equal(m.artifactId, 'kmppermission-core');
  assert.equal(m.artifactIdFromDefault, false);
  assert.deepEqual(m.expectedArtifacts, ['kmppermission-core', 'kmppermission-core-android', 'kmppermission-core-iosarm64', 'kmppermission-core-iossimulatorarm64']);
  assert.equal(m.versionProperty, 'VERSION_NAME');
  assert.deepEqual(r.data.releaseAutomation, [{ file: '.github/workflows/publish.yml', name: 'Release', task: 'publishToMavenCentral', manualTrigger: true }]);
  assert.equal(r.checks.find((c) => c.id === 'detect.releaseAutomation').status, 'warn');
  assert.equal(r.checks.find((c) => c.id === 'detect.versionStrategy').status, 'warn');
});

test('flags builds that enable automatic release', () => {
  const props = writeTree(tempDir(), { ...KMP_VANNIKTECH, 'gradle.properties': KMP_VANNIKTECH['gradle.properties'] + 'mavenCentralAutomaticPublishing=true\n' });
  assert.equal(detect(props, { platform: 'darwin' }).checks.find((c) => c.id.endsWith('.automaticRelease')).status, 'warn');
  const dsl = writeTree(tempDir(), { ...KMP_VANNIKTECH, 'kmpermission/build.gradle.kts': KMP_VANNIKTECH['kmpermission/build.gradle.kts'].replace('publishToMavenCentral()', 'publishToMavenCentral(automaticRelease = true)') });
  assert.equal(detect(dsl, { platform: 'darwin' }).data.modules[0].automaticRelease, true);
  assert.equal(detect(writeTree(tempDir(), KMP_VANNIKTECH), { platform: 'darwin' }).data.modules[0].automaticRelease, false);
});
