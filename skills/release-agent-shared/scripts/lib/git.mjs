import { execFileSync } from 'node:child_process';

/** Runs git and returns trimmed stdout, or null when git exits non-zero. */
export function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export function lastTag(cwd) {
  return git(['describe', '--tags', '--abbrev=0'], cwd);
}

export function isTracked(file, cwd) {
  return git(['ls-files', '--error-unmatch', file], cwd) !== null;
}
