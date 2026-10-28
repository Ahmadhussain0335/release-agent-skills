import { homedir } from 'node:os';
import { join } from 'node:path';

// Skill folders read by each tool. Cursor also reads .claude/skills and .agents/skills,
// so one install for Claude Code or Codex already covers Cursor.
export const TARGETS = {
  claude: { label: 'Claude Code', project: '.claude/skills', user: '.claude/skills' },
  cursor: { label: 'Cursor', project: '.cursor/skills', user: '.cursor/skills' },
  agents: { label: 'Codex and other Agent Skills tools', project: '.agents/skills', user: '.agents/skills' },
};

export function resolveTarget(name, { user = false, cwd = process.cwd(), home = homedir() } = {}) {
  const target = TARGETS[name];
  if (!target) throw new Error(`Unknown target "${name}". Use one of: ${Object.keys(TARGETS).join(', ')}, all`);
  return { name, label: target.label, dir: join(user ? home : cwd, user ? target.user : target.project) };
}
