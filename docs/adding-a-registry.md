# Adding a registry

Each registry is one self-contained skill folder under `skills/`. The installer finds skills by looking for folders that contain a `SKILL.md`, so adding one needs no installer changes.

```
skills/
├── release-agent-shared/        shared, registry-independent scripts (not a skill)
├── release-maven/               Maven Central (v0.1)
└── release-npm/                 example of a new registry
    ├── SKILL.md
    ├── errors.md
    ├── reference/
    └── scripts/
```

## What a registry skill must provide

1. **`SKILL.md`** with YAML frontmatter (`name`, `description`) and the same phase structure as `release-maven`: detect, static pre-flight, prepare, build pre-flight, Gate 1, upload, Gate 2 (when the registry has a staging step), verify, finish. Keep the safety rules section; adapt the banned-command list to the registry (for npm: never print `.npmrc` tokens).
2. **`errors.md`** with the same entry format: ID, Match, Cause, Fix, Rerun from.
3. **`scripts/`** that print the standard JSON result `{ ok, checks: [{ id, status, message, fix? }], data? }` and exit 0, 1 or 2. Use `../../release-agent-shared/scripts/lib/cli.mjs` (`runCli`, `check`, `result`) so the output stays uniform.
4. **`reference/`** files checked against the registry's current official documentation, each with a "Checked against ... on <date>" line and a Sources section.

## What to reuse from `release-agent-shared`

| Script | Use |
|---|---|
| `git-preflight.mjs` | clean tree, branch, tag absent |
| `changelog.mjs` | changelog entry from commits since the last tag |
| `github-release.mjs` | GitHub release from the changelog section, with an optional Install block (`--install`, `--install-lang`, `--link`, `--link-label`), for example `--install 'npx mypkg@1.2.0'` for npm |
| `state.mjs` | resumable progress in `build/release-agent/state.json` |
| `lib/http.mjs` | fetch with timeout, retries and backoff |
| `lib/properties.mjs` | `.properties` parsing |

## Rules

- No runtime dependencies. Node.js built-ins only, Node 20 or later.
- Scripts never print secret values. Credential checks report key names and sources only. A script that must read a secret to call an API keeps it in-process and is named in the skill's safety section.
- Anything permanent (a release, a publish) requires an explicit flag such as `--confirm-permanent`, which the skill passes only after the user's explicit answer.
- Network calls go through an injectable `fetchImpl` so tests never touch the network.
- Every script gets tests under `test/`.
