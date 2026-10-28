#!/usr/bin/env node
// Git checks before a release: clean tree, expected branch, tag not taken, in sync with upstream.
import { runCli, check, result, required } from './lib/cli.mjs';
import { git } from './lib/git.mjs';

export function defaultBranch(cwd, remote) {
  const head = git(['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`], cwd);
  if (head) return head.slice(remote.length + 1);
  for (const name of ['main', 'master']) {
    if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], cwd) !== null) return name;
  }
  return null;
}

export function tagStyle(cwd) {
  const tags = (git(['tag', '--list'], cwd) ?? '').split('\n').filter(Boolean);
  const prefixed = tags.filter((t) => /^v\d/.test(t)).length;
  const bare = tags.filter((t) => /^\d/.test(t)).length;
  return { prefix: bare > prefixed ? '' : 'v', tagCount: tags.length };
}

export function gitPreflight({ cwd = '.', branch, tag, remote = 'origin', checkRemote = true }) {
  const checks = [];
  if (git(['rev-parse', '--is-inside-work-tree'], cwd) !== 'true') {
    return result([check('git.repo', 'fail', 'Not inside a git repository', { fix: 'Run the release from the library repository root.' })]);
  }

  const status = git(['status', '--porcelain'], cwd) ?? '';
  const dirty = status.split('\n').filter(Boolean);
  checks.push(dirty.length === 0
    ? check('git.clean', 'pass', 'Working tree is clean')
    : check('git.clean', 'fail', `Working tree has ${dirty.length} uncommitted change(s)`, {
      files: dirty.slice(0, 20).map((l) => l.slice(3)),
      fix: 'Commit or stash these changes first, so the release commit contains only the version bump and changelog.',
    }));

  const current = git(['symbolic-ref', '--short', 'HEAD'], cwd);
  const expected = branch ?? defaultBranch(cwd, remote);
  if (!current) {
    checks.push(check('git.branch', 'fail', 'HEAD is detached', { fix: `Check out the release branch${expected ? ` (${expected})` : ''}.` }));
  } else if (!expected) {
    checks.push(check('git.branch', 'warn', `On branch ${current}; could not determine the default branch`, { fix: 'Pass --branch with the branch releases are made from.' }));
  } else {
    checks.push(current === expected
      ? check('git.branch', 'pass', `On expected branch ${current}`)
      : check('git.branch', 'fail', `On branch ${current}, expected ${expected}`, { fix: `Check out ${expected}, or confirm with the user that releasing from ${current} is intended and pass --branch ${current}.` }));
  }

  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd);
  if (upstream) {
    const behind = Number(git(['rev-list', '--count', 'HEAD..@{u}'], cwd) ?? 0);
    const ahead = Number(git(['rev-list', '--count', '@{u}..HEAD'], cwd) ?? 0);
    if (behind > 0) checks.push(check('git.upstream', 'fail', `Branch is ${behind} commit(s) behind ${upstream} (as of the last fetch)`, { fix: 'Pull the latest changes before releasing.' }));
    else if (ahead > 0) checks.push(check('git.upstream', 'warn', `Branch has ${ahead} unpushed commit(s) on top of ${upstream}`, { fix: 'Make sure these commits are meant to be part of the release.' }));
    else checks.push(check('git.upstream', 'pass', `In sync with ${upstream} (as of the last fetch)`));
  } else {
    checks.push(check('git.upstream', 'warn', 'Branch has no upstream; cannot compare with the remote'));
  }

  if (tag) {
    const local = git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], cwd);
    checks.push(local === null
      ? check('git.tag.local', 'pass', `Tag ${tag} does not exist locally`)
      : check('git.tag.local', 'fail', `Tag ${tag} already exists locally`, { fix: 'This version was probably released or attempted before. Choose a new version, or ask the user how this tag was created.' }));
    if (checkRemote) {
      const remoteTags = git(['ls-remote', '--tags', remote, `refs/tags/${tag}`], cwd);
      if (remoteTags === null) checks.push(check('git.tag.remote', 'warn', `Could not query remote "${remote}" for tag ${tag}`));
      else checks.push(remoteTags === ''
        ? check('git.tag.remote', 'pass', `Tag ${tag} does not exist on ${remote}`)
        : check('git.tag.remote', 'fail', `Tag ${tag} already exists on ${remote}`, { fix: 'Choose a new version.' }));
    }
  }

  return result(checks, { branch: current, expectedBranch: expected, ...tagStyle(cwd) });
}

const usage = `Usage: git-preflight.mjs [--branch <name>] [--tag <tag>] [--remote origin] [--cwd <dir>] [--offline]`;

await runCli(import.meta.url, {
  usage,
  options: {
    branch: { type: 'string' }, tag: { type: 'string' }, remote: { type: 'string', default: 'origin' },
    cwd: { type: 'string', default: '.' }, offline: { type: 'boolean', default: false },
  },
}, (v) => {
  if (v.tag !== undefined) required(v, 'tag');
  return gitPreflight({ cwd: v.cwd, branch: v.branch, tag: v.tag, remote: v.remote, checkRemote: !v.offline });
});
