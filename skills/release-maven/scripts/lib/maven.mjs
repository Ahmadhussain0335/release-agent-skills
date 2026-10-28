import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const CENTRAL_REPO = 'https://repo1.maven.org/maven2';

export const groupPath = (group) => group.replace(/\./g, '/');

export function pomUrl(group, artifact, version, base = CENTRAL_REPO) {
  return `${base}/${groupPath(group)}/${artifact}/${version}/${artifact}-${version}.pom`;
}

export function metadataUrl(group, artifact, base = CENTRAL_REPO) {
  return `${base}/${groupPath(group)}/${artifact}/maven-metadata.xml`;
}

/** Files that are signatures, checksums or local metadata rather than artifacts. */
export function isAuxiliary(name) {
  return /\.(asc|md5|sha1|sha256|sha512)$/.test(name) || name.startsWith('maven-metadata');
}

/** Lists `{ artifactId, dir, files }` for every artifact of `group` with `version` in a Maven repo layout. */
export function listComponents(repo, group, version) {
  const base = join(repo, groupPath(group));
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter((a) => existsSync(join(base, a, version)) && statSync(join(base, a, version)).isDirectory())
    .sort()
    .map((artifactId) => {
      const dir = join(base, artifactId, version);
      return { artifactId, dir, files: readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).sort() };
    });
}

// Minimal XML reader for POMs and maven-metadata.xml: elements, text, no namespaces.
export function parseXml(text) {
  const src = text
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  const root = { name: '#root', children: [], text: '' };
  const stack = [root];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([\w:.-]+)[^>]*?(\/?)>|([^<]+)/g;
  for (const m of src.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[5] !== undefined) top.text += m[5];
    else if (m[2] === '/') {
      if (stack.length > 1) stack.pop();
    } else {
      const node = { name: m[3].replace(/^.*:/, ''), children: [], text: '' };
      top.children.push(node);
      if (m[4] !== '/') stack.push(node);
    }
  }
  return root.children[0] ?? null;
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export const child = (node, name) => node?.children.find((c) => c.name === name) ?? null;
export const children = (node, name) => node?.children.filter((c) => c.name === name) ?? [];
export const text = (node) => (node ? decode(node.text).trim() : '');

const QUALIFIER_ORDER = ['alpha', 'beta', 'milestone', 'rc', 'snapshot', '', 'sp'];
const QUALIFIER_ALIASES = { a: 'alpha', b: 'beta', m: 'milestone', cr: 'rc', ga: '', final: '', release: '' };
// Unknown qualifiers sort just below a plain release.
const qualifierRank = (q) => {
  const i = QUALIFIER_ORDER.indexOf(QUALIFIER_ALIASES[q] ?? q);
  return i === -1 ? QUALIFIER_ORDER.indexOf('') - 0.5 : i;
};

function tokens(v) {
  return v.toLowerCase().split(/[.\-+]|(?<=\d)(?=[a-z])|(?<=[a-z])(?=\d)/).filter(Boolean)
    .map((t) => (/^\d+$/.test(t) ? Number(t) : t));
}

/** Approximates Maven version ordering: numeric parts, then alpha < beta < rc < release. */
export function compareVersions(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    const x = ta[i];
    const y = tb[i];
    if (x === y) continue;
    if (x === undefined) return typeof y === 'number' ? (y === 0 ? 0 : -1) : qualifierRank('') - qualifierRank(y) > 0 ? 1 : -1;
    if (y === undefined) return -compareVersions(b, a);
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return 1;
    if (typeof y === 'number') return -1;
    const d = qualifierRank(x) - qualifierRank(y);
    if (d) return d;
    return x < y ? -1 : 1;
  }
  return 0;
}
