// Copies skills into a tool's skills folder. Never deletes anything; an existing
// skill folder is left untouched unless --force, which overwrites files in place.
import { readdirSync, existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SKILLS_ROOT = join(PACKAGE_ROOT, 'skills');
export const SHARED = 'release-agent-shared';
const MARKER = '.release-agent-skills.json';

export function packageVersion() {
  return JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version;
}

/** Skills are folders with a SKILL.md; the shared support folder is not a skill. */
export function availableSkills(root = SKILLS_ROOT) {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'SKILL.md')))
    .map((d) => {
      const md = readFileSync(join(root, d.name, 'SKILL.md'), 'utf8');
      const description = md.match(/^description:\s*(.+)$/m)?.[1] ?? '';
      return { name: d.name, description };
    });
}

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? listFiles(p, base) : [p.slice(base.length + 1)];
  });
}

export function installSkills({ destDir, skills, force = false, dryRun = false, root = SKILLS_ROOT, version = packageVersion() }) {
  const known = availableSkills(root).map((s) => s.name);
  const chosen = skills?.length ? skills : known;
  const unknown = chosen.filter((s) => !known.includes(s));
  if (unknown.length) throw new Error(`Unknown skill(s): ${unknown.join(', ')}. Available: ${known.join(', ')}`);

  const report = [];
  for (const folder of [...chosen, SHARED]) {
    const src = join(root, folder);
    const dest = join(destDir, folder);
    const files = listFiles(src);
    const existed = existsSync(dest);
    if (existed && !force) {
      let installed = null;
      try { installed = JSON.parse(readFileSync(join(dest, MARKER), 'utf8')).version; } catch { /* not installed by us */ }
      report.push({ folder, dest, action: 'skipped', reason: installed ? `version ${installed} already installed` : 'folder already exists', files: 0 });
      continue;
    }
    if (!dryRun) {
      for (const rel of files) {
        mkdirSync(dirname(join(dest, rel)), { recursive: true });
        copyFileSync(join(src, rel), join(dest, rel));
      }
      writeFileSync(join(dest, MARKER), `${JSON.stringify({ package: 'release-agent-skills', version }, null, 2)}\n`);
    }
    report.push({ folder, dest, action: existed ? 'overwritten' : 'installed', files: files.length });
  }
  return report;
}
