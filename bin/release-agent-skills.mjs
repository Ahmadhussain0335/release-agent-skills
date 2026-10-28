#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { installSkills, availableSkills, packageVersion } from '../src/installer/install.mjs';
import { resolveTarget, TARGETS } from '../src/installer/targets.mjs';

const HELP = `release-agent-skills ${packageVersion()}

Usage:
  npx release-agent-skills install [options]
  npx release-agent-skills list

Install options:
  --target <name>   ${Object.keys(TARGETS).join(' | ')} | all   (default: claude)
  --user            install into your home directory instead of the current project
  --dir <path>      install into this skills directory instead of a target
  --skill <name>    install only this skill (repeatable; default: all)
  --force           overwrite an existing installation (files are replaced, never deleted)
  --dry-run         show what would be installed without writing anything

Targets:
${Object.entries(TARGETS).map(([k, t]) => `  ${k.padEnd(8)} ${t.label}: ./${t.project} (or ~/${t.user} with --user)`).join('\n')}
  Cursor also reads .claude/skills and .agents/skills, so --target cursor is only
  needed if you use Cursor alone.`;

function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      target: { type: 'string', default: 'claude' }, user: { type: 'boolean', default: false },
      dir: { type: 'string' }, skill: { type: 'string', multiple: true }, force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
    },
  });
  const [command] = positionals;
  if (values.version) return console.log(packageVersion());
  if (values.help || !command) return console.log(HELP);

  if (command === 'list') {
    for (const s of availableSkills()) console.log(`${s.name}\n  ${s.description}\n`);
    return;
  }
  if (command !== 'install') throw new Error(`Unknown command "${command}". Run with --help.`);

  const destinations = values.dir
    ? [{ label: 'custom directory', dir: resolve(values.dir) }]
    : (values.target === 'all' ? Object.keys(TARGETS) : [values.target]).map((t) => resolveTarget(t, { user: values.user }));

  for (const dest of destinations) {
    const report = installSkills({ destDir: dest.dir, skills: values.skill, force: values.force, dryRun: values['dry-run'] });
    console.log(`${values['dry-run'] ? '[dry run] ' : ''}${dest.label}: ${dest.dir}`);
    for (const r of report) {
      console.log(r.action === 'skipped'
        ? `  skipped    ${r.folder} (${r.reason}; use --force to overwrite)`
        : `  ${r.action.padEnd(10)} ${r.folder} (${r.files} files)`);
    }
  }
  if (!values['dry-run']) {
    console.log('\nNext: open your project in your AI tool and ask, for example:');
    console.log('  "check if my library is ready to publish to Maven Central"   (check only, nothing uploaded)');
    console.log('  "publish mylib 1.0.2 to Maven Central"');
  }
}

try {
  main(process.argv.slice(2));
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}
