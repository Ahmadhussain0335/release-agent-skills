// Static (no Gradle run) inspection of a Gradle build: modules, plugins,
// coordinates, KMP targets and where the version is defined. Heuristic by
// nature; anything it cannot resolve is reported as unresolved, never guessed.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';
import { readProperties } from '../../../release-agent-shared/scripts/lib/properties.mjs';

const BUILD_FILES = ['build.gradle.kts', 'build.gradle'];
const SETTINGS_FILES = ['settings.gradle.kts', 'settings.gradle'];

const PLUGIN = {
  vanniktech: ['com.vanniktech.maven.publish', 'com.vanniktech.maven.publish.base'],
  mavenPublish: ['maven-publish'],
  signing: ['signing'],
  kmp: ['org.jetbrains.kotlin.multiplatform'],
  androidLibrary: ['com.android.library', 'com.android.kotlin.multiplatform.library'],
  kotlinJvm: ['org.jetbrains.kotlin.jvm'],
  java: ['java-library', 'java'],
  cocoapods: ['org.jetbrains.kotlin.native.cocoapods'],
};

const KMP_TARGETS = [
  'jvm', 'androidTarget', 'androidLibrary', 'js', 'wasmJs', 'wasmWasi',
  'iosArm64', 'iosX64', 'iosSimulatorArm64', 'macosArm64', 'macosX64',
  'watchosArm32', 'watchosArm64', 'watchosDeviceArm64', 'watchosX64', 'watchosSimulatorArm64',
  'tvosArm64', 'tvosX64', 'tvosSimulatorArm64',
  'linuxX64', 'linuxArm64', 'mingwX64',
  'androidNativeArm32', 'androidNativeArm64', 'androidNativeX86', 'androidNativeX64',
];
const APPLE = /^(ios|macos|watchos|tvos)/;

const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : null);

/** Removes // and /* *\/ comments so commented-out config is ignored. Keeps line count. */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:"'])\/\/.*$/gm, '$1');
}

const normalizeAlias = (s) => s.toLowerCase().replace(/[-_.]/g, '.');

/** Parses the [versions] and [plugins] tables of a version catalog. */
export function parseCatalog(text) {
  const versions = {};
  const plugins = {};
  let table = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const t = line.match(/^\[([\w-]+)\]$/);
    if (t) { table = t[1]; continue; }
    const kv = line.match(/^([\w.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (table === 'versions') {
      const s = value.match(/^"([^"]*)"/);
      if (s) versions[key] = s[1];
    } else if (table === 'plugins') {
      const id = value.match(/id\s*=\s*"([^"]+)"/) ?? value.match(/^"([^":]+)(?::[^"]*)?"/);
      const ref = value.match(/version\.ref\s*=\s*"([^"]+)"/);
      const lit = value.match(/version\s*=\s*"([^"]+)"/) ?? value.match(/^"[^":]+:([^"]+)"/);
      if (id) plugins[normalizeAlias(key)] = { id: id[1], version: ref ? versions[ref[1]] ?? null : lit?.[1] ?? null, versionRef: ref?.[1] ?? null };
    }
  }
  // Second pass for version.ref entries declared before [versions].
  for (const p of Object.values(plugins)) if (p.versionRef && !p.version) p.version = versions[p.versionRef] ?? null;
  return { versions, plugins };
}

/**
 * Returns plugin ids (with versions when declared) for a build script. Declarations
 * marked `apply false` are skipped unless `includeNotApplied` is set (used to find
 * versions declared in the root build).
 */
export function appliedPlugins(src, catalog, { includeNotApplied = false } = {}) {
  const found = new Map();
  const add = (m, id, version = null) => {
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (!includeNotApplied && /^\s*(?:version\s*\(?\s*["'][^"']*["']\s*\)?\s*)?apply\s*\(?\s*false/.test(after)) return;
    if (!found.has(id) || version) found.set(id, version);
  };
  for (const m of src.matchAll(/\bid\s*\(?\s*["']([\w.-]+)["']\s*\)?(?:\s*version\s*\(?\s*["']([^"']+)["']\s*\)?)?/g)) add(m, m[1], m[2] ?? null);
  for (const m of src.matchAll(/apply\s+plugin\s*:\s*["']([\w.-]+)["']/g)) add(m, m[1]);
  for (const m of src.matchAll(/\bkotlin\s*\(\s*"([\w.]+)"\s*\)/g)) add(m, `org.jetbrains.kotlin.${m[1]}`);
  for (const m of src.matchAll(/`([\w-]+)`/g)) if (['maven-publish', 'java-library'].includes(m[1])) add(m, m[1]);
  for (const m of src.matchAll(/^\s*(signing|java)\s*$/gm)) add(m, m[1]);
  for (const m of src.matchAll(/alias\s*\(\s*libs\.plugins\.([\w.]+)\s*\)/g)) {
    const p = catalog?.plugins[normalizeAlias(m[1])];
    if (p) add(m, p.id, p.version);
  }
  return found;
}

/** Module directories from settings: include(":a", ":b:c") and include ':a'. */
export function includedModules(settingsSrc) {
  const modules = new Set();
  for (const m of settingsSrc.matchAll(/\binclude\s*\(?([^)\n]*)\)?/g)) {
    for (const s of m[1].matchAll(/["']:?([\w.:-]+)["']/g)) modules.add(s[1].replace(/:/g, '/'));
  }
  return [...modules];
}

function kmpTargets(src) {
  const targets = [];
  const seen = new Set();
  const re = new RegExp(`\\b(${KMP_TARGETS.join('|')})\\s*(\\(\\s*(?:"([\\w-]+)")?[^)]*\\)|\\{)`, 'g');
  for (const m of src.matchAll(re)) {
    const kind = m[1];
    const name = m[3] ?? (kind === 'androidTarget' || kind === 'androidLibrary' ? 'android' : kind);
    if (seen.has(name)) continue;
    seen.add(name);
    targets.push({ name, kind, artifactSuffix: name.toLowerCase(), apple: APPLE.test(kind) });
  }
  return targets;
}

function hasCinterop(dir, src) {
  if (/\bcinterops\s*[{.]/.test(src)) return true;
  const defDir = join(dir, 'src', 'nativeInterop', 'cinterop');
  return existsSync(defDir) && readdirSync(defDir).some((f) => f.endsWith('.def'));
}

const literal = (m) => (m ? m[1] : null);

/** Finds every place a version literal is defined for this module. */
export function versionSources(root, moduleDir, src, catalog) {
  const sources = [];
  const addProps = (dir) => {
    const file = join(dir, 'gradle.properties');
    const text = read(file);
    if (!text) return;
    text.split('\n').forEach((line, i) => {
      const m = line.match(/^\s*(VERSION_NAME|version)\s*[=:]\s*(\S+)\s*$/);
      if (m) sources.push({ file: relative(root, file) || 'gradle.properties', line: i + 1, kind: 'properties', key: m[1], current: m[2] });
    });
  };
  addProps(moduleDir);
  if (moduleDir !== root) addProps(root);

  const buildFile = BUILD_FILES.map((f) => join(moduleDir, f)).find(existsSync);
  if (buildFile && src) {
    const rel = relative(root, buildFile);
    src.split('\n').forEach((line, i) => {
      const lit = line.match(/^\s*(?:project\.)?version\s*=?\s*["']([^"'$]+)["']\s*$/);
      if (lit) sources.push({ file: rel, line: i + 1, kind: 'build-literal', key: 'version', current: lit[1] });
      const coordVersion = /coordinates\s*\(/.test(line) ? coordinatesArgs(line)?.version : null;
      if (coordVersion) sources.push({ file: rel, line: i + 1, kind: 'coordinates', key: 'coordinates', current: coordVersion });
      const cat = line.match(/(?:^\s*(?:project\.)?version\s*=|coordinates\s*\([^)]*,)\s*libs\.versions\.([\w.]+)\.get\(\)/);
      if (cat && catalog) {
        const entry = Object.entries(catalog.versions).find(([k]) => normalizeAlias(k) === normalizeAlias(cat[1]));
        if (entry) {
          const catFile = join(root, 'gradle', 'libs.versions.toml');
          const catLine = read(catFile).split('\n').findIndex((l) => new RegExp(`^\\s*${entry[0].replace(/[.-]/g, '\\$&')}\\s*=`).test(l));
          sources.push({ file: relative(root, catFile), line: catLine + 1, kind: 'catalog', key: entry[0], current: entry[1] });
        }
      }
    });
  }
  return sources;
}

/** Literal arguments of vanniktech's coordinates(...), positional or named. */
export function coordinatesArgs(src) {
  const call = src.match(/coordinates\s*\(([^)]*)\)/);
  if (!call) return null;
  const args = {};
  const names = ['groupId', 'artifactId', 'version'];
  call[1].split(',').forEach((raw, i) => {
    const named = raw.match(/^\s*(groupId|artifactId|version)\s*=\s*"([^"$]+)"\s*$/);
    const positional = raw.match(/^\s*"([^"$]+)"\s*$/);
    if (named) args[named[1]] = named[2];
    else if (positional && names[i]) args[names[i]] = positional[1];
  });
  return args;
}

function resolveCoordinates(root, moduleDir, src, rootSrc, settingsName) {
  const modProps = readProperties(join(moduleDir, 'gradle.properties')) ?? new Map();
  const rootProps = readProperties(join(root, 'gradle.properties')) ?? new Map();
  const prop = (k) => modProps.get(k) ?? rootProps.get(k) ?? null;
  const coord = coordinatesArgs(src);

  const group = coord?.groupId
    ?? literal(src.match(/^\s*(?:project\.)?group\s*=?\s*["']([^"'$]+)["']/m))
    ?? prop('GROUP')
    ?? literal(rootSrc?.match(/^\s*(?:project\.)?group\s*=?\s*["']([^"'$]+)["']/m))
    ?? prop('group');
  const artifactId = coord?.artifactId
    ?? modProps.get('POM_ARTIFACT_ID')
    ?? literal(src.match(/artifactId\s*=\s*["']([^"'$]+)["']/))
    ?? (moduleDir === root ? settingsName : basename(moduleDir));
  return { group, artifactId, artifactIdFromDefault: !coord?.artifactId && !modProps.get('POM_ARTIFACT_ID') };
}

function compareSemverLike(a, b) {
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

export function detectProject(root, { platform = process.platform } = {}) {
  const settingsFile = SETTINGS_FILES.map((f) => join(root, f)).find(existsSync);
  const settingsSrc = settingsFile ? stripComments(read(settingsFile)) : '';
  const settingsName = literal(settingsSrc.match(/rootProject\.name\s*=\s*["']([^"']+)["']/)) ?? basename(root);
  const catalogText = read(join(root, 'gradle', 'libs.versions.toml'));
  const catalog = catalogText ? parseCatalog(catalogText) : null;
  const rootBuild = BUILD_FILES.map((f) => join(root, f)).find(existsSync);
  const rootSrc = rootBuild ? stripComments(read(rootBuild)) : null;

  const dirs = [root, ...includedModules(settingsSrc).map((m) => join(root, m))];
  const modules = [];
  for (const dir of dirs) {
    const buildFile = BUILD_FILES.map((f) => join(dir, f)).find(existsSync);
    if (!buildFile) continue;
    const src = stripComments(read(buildFile));
    const plugins = appliedPlugins(src, catalog);
    const has = (group) => PLUGIN[group].some((id) => plugins.has(id));
    const vanniktechId = PLUGIN.vanniktech.find((id) => plugins.has(id));
    let vanniktechVersion = vanniktechId ? plugins.get(vanniktechId) : null;
    if (vanniktechId && !vanniktechVersion && rootSrc) {
      vanniktechVersion = appliedPlugins(rootSrc, catalog, { includeNotApplied: true }).get(vanniktechId) ?? null;
    }
    const setup = vanniktechId ? 'vanniktech' : has('mavenPublish') ? 'maven-publish' : 'none';
    if (setup === 'none' && dir === root && dirs.length > 1) continue;

    const type = has('kmp') ? 'kmp' : has('androidLibrary') ? 'android' : (has('kotlinJvm') || has('java')) ? 'jvm' : 'unknown';
    if (setup === 'none' && type === 'unknown') continue;

    const coords = resolveCoordinates(root, dir, src, rootSrc, settingsName);
    const sources = versionSources(root, dir, src, catalog);
    const values = [...new Set(sources.map((s) => s.current))];
    const module = {
      path: relative(root, dir) || '.',
      buildFile: relative(root, buildFile),
      type,
      setup,
      vanniktechVersion: vanniktechVersion ?? null,
      signingPlugin: has('signing') || Boolean(vanniktechId),
      group: coords.group,
      artifactId: coords.artifactId,
      artifactIdFromDefault: coords.artifactIdFromDefault,
      version: values.length === 1 ? values[0] : null,
      versionSources: sources,
      // A Gradle property can be overridden with -P<key>=<version> instead of editing the file.
      automaticRelease: /publishToMavenCentral\s*\(\s*(?:automaticRelease\s*=\s*)?true\b/.test(src)
        || ['mavenCentralAutomaticPublishing', 'SONATYPE_AUTOMATIC_RELEASE'].some((k) => [readProperties(join(dir, 'gradle.properties')), readProperties(join(root, 'gradle.properties'))].some((p) => p?.get(k) === 'true')),
      versionProperty: sources.length > 0 && sources.every((s) => s.kind === 'properties' && s.key === sources[0].key) ? sources[0].key : null,
    };
    if (type === 'kmp') {
      const targets = kmpTargets(src);
      if (plugins.has('com.android.kotlin.multiplatform.library') && !targets.some((t) => t.name === 'android')) {
        targets.unshift({ name: 'android', kind: 'androidLibrary', artifactSuffix: 'android', apple: false });
      }
      module.kmp = {
        targets,
        appleTargets: targets.some((t) => t.apple),
        cinterop: hasCinterop(dir, src),
        cocoapods: has('cocoapods') || /\bcocoapods\s*\{/.test(src),
      };
      module.expectedArtifacts = [coords.artifactId, ...targets.map((t) => `${coords.artifactId}-${t.artifactSuffix}`)];
    } else {
      module.expectedArtifacts = [coords.artifactId];
    }
    modules.push(module);
  }

  const conventionDirs = ['buildSrc', 'build-logic'].filter((d) => existsSync(join(root, d)) && statSync(join(root, d)).isDirectory());
  return { root, rootProjectName: settingsName, host: platform, catalogFound: Boolean(catalog), conventionDirs, releaseAutomation: releaseAutomation(root), modules };
}

const PUBLISH_TASK = /\b(publishToMavenCentral|publishAndReleaseToMavenCentral|publishAllPublicationsTo\w*Repository|jreleaserDeploy|jreleaser\s+deploy|publishToSonatype|closeAndReleaseSonatypeStagingRepository)\b/;

/** CI workflows that already publish to Maven Central. */
export function releaseAutomation(root) {
  const dir = join(root, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).flatMap((f) => {
    const text = read(join(dir, f));
    const m = text.match(PUBLISH_TASK);
    if (!m) return [];
    const name = text.match(/^name:\s*(.+)$/m)?.[1].trim() ?? f;
    return [{ file: `.github/workflows/${f}`, name, task: m[1], manualTrigger: /workflow_dispatch/.test(text) }];
  });
}

export function detectionChecks(project, check) {
  const checks = [];
  const publishable = project.modules.filter((m) => m.setup !== 'none');
  if (publishable.length === 0) {
    checks.push(check('detect.modules', 'fail', 'No module applies a supported publishing plugin (vanniktech or maven-publish)', {
      fix: project.conventionDirs.length
        ? `Publishing may be configured in ${project.conventionDirs.join(', ')} (convention plugins). Confirm the publishable modules with the user; see reference/gradle-setups.md.`
        : 'Set up publishing first; see reference/gradle-setups.md.',
    }));
    return checks;
  }
  checks.push(check('detect.modules', 'pass', `${publishable.length} publishable module(s): ${publishable.map((m) => m.path).join(', ')}`));

  for (const m of publishable) {
    const id = `detect.${m.path}`;
    if (!m.group) checks.push(check(`${id}.group`, 'fail', `${m.path}: could not resolve groupId`, { fix: 'Ask the user for the groupId; it may be computed in a convention plugin.' }));
    if (m.artifactIdFromDefault) checks.push(check(`${id}.artifact`, 'warn', `${m.path}: artifactId "${m.artifactId}" assumed from the project name`, { fix: 'Confirm the artifactId with the user, or confirm it later from the staging repo.' }));
    if (m.versionSources.length === 0) checks.push(check(`${id}.version`, 'fail', `${m.path}: no version literal found; the version may be computed`, { fix: 'Ask the user how the version is set (see "Where the version is defined" in reference/gradle-setups.md).' }));
    else if (!m.version) checks.push(check(`${id}.version`, 'fail', `${m.path}: version defined in several places with different values`, { sources: m.versionSources, fix: 'Ask the user which one is authoritative.' }));
    if (m.setup === 'vanniktech') {
      if (m.vanniktechVersion && compareSemverLike(m.vanniktechVersion, '0.34.0') < 0) {
        checks.push(check(`${id}.vanniktech`, 'fail', `${m.path}: vanniktech ${m.vanniktechVersion} still targets OSSRH, which was shut down`, { fix: 'Upgrade to 0.37.0 (or 0.35.0 for older toolchains). See errors.md E14 and E23.' }));
      } else if (!m.vanniktechVersion) {
        checks.push(check(`${id}.vanniktech`, 'warn', `${m.path}: vanniktech plugin version not found (likely declared in a settings or convention plugin)`, { fix: 'Confirm it is 0.34.0 or later.' }));
      }
    }
    if (m.automaticRelease) {
      checks.push(check(`${id}.automaticRelease`, 'warn', `${m.path}: the build enables automatic release, so publishToMavenCentral publishes permanently right after validation and Gate 2 never happens`, {
        fix: 'For a manual release, remove automaticRelease = true / mavenCentralAutomaticPublishing=true, or treat Gate 1 as the final, permanent approval and say so.',
      }));
    }
    if (m.setup === 'maven-publish' && !m.signingPlugin) {
      checks.push(check(`${id}.signing`, 'fail', `${m.path}: maven-publish without the signing plugin`, { fix: 'Add the signing plugin; see reference/signing-setup.md.' }));
    }
    if (m.kmp) {
      if (m.kmp.targets.length === 0) checks.push(check(`${id}.targets`, 'warn', `${m.path}: no KMP targets recognised in the build file`, { fix: 'Targets may be declared in a convention plugin; they are checked again from the staging repo in phase 4.' }));
      if (m.kmp.appleTargets && project.host !== 'darwin') {
        const needsMac = m.kmp.cinterop || m.kmp.cocoapods;
        checks.push(check(`${id}.host`, needsMac ? 'fail' : 'warn', needsMac
          ? `${m.path}: Apple targets with ${m.kmp.cinterop ? 'cinterop' : 'CocoaPods'} need a macOS host`
          : `${m.path}: Apple targets on a non-macOS host; klibs can be cross-compiled, but Apple tests cannot run here`, { fix: 'Publish from macOS. See reference/kmp-notes.md.' }));
      }
    }
  }
  for (const wf of project.releaseAutomation) {
    checks.push(check('detect.releaseAutomation', 'warn', `${wf.file} ("${wf.name}") already publishes to Maven Central (${wf.task})${wf.manualTrigger ? ', and can be run manually' : ''}`, {
      fix: 'A local release would skip anything else that workflow does (assets, generated files, tags). Ask the user whether to trigger the workflow instead; see SKILL.md, Phase 1.',
    }));
  }
  const snapshots = publishable.filter((m) => m.version && /-SNAPSHOT$/i.test(m.version));
  if (snapshots.length && snapshots.every((m) => m.versionProperty)) {
    checks.push(check('detect.versionStrategy', 'warn', `The committed version is ${snapshots[0].version}; the release version is probably passed at build time (-P${snapshots[0].versionProperty}=<version>)`, {
      fix: 'Ask the user whether to keep the SNAPSHOT in the file and pass the version on the command line, or to change the file.',
    }));
  }
  const versions = [...new Set(publishable.map((m) => m.version).filter(Boolean))];
  if (versions.length > 1) checks.push(check('detect.versions', 'warn', `Modules have different versions: ${versions.join(', ')}`, { fix: 'Ask the user whether all modules are released together.' }));
  return checks;
}
