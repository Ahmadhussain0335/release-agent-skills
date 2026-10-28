# release-agent-skills

Agent skills that publish libraries safely. You type one sentence, the agent runs the checks, shows you exactly what will be released, and waits for your approval before anything leaves your machine.

Version 0.1 supports **Maven Central** (JVM, Android and Kotlin Multiplatform libraries built with Gradle) through the Sonatype Central Portal. npm and pub.dev are planned.

```
> publish KMPermission 0.4.0 to Maven Central
```

## What it does

1. **Detect**: finds the publishable modules, groupId, artifactId, version, library type (JVM, Android, KMP), publishing setup, and any CI workflow that already publishes.
2. **Pre-flight, nothing uploaded**:
   - git tree clean, expected branch, tag not taken
   - version not already on Maven Central
   - credentials present (key names only, values are never read out)
   - build and tests pass
   - every artifact has a POM with the required fields, sources and javadoc jars, and a signature; signing key on a public keyserver
   - for KMP, every target is published
3. **Prepare**: version bump (or a `-PVERSION_NAME` override for projects that keep a SNAPSHOT in the file) and a changelog entry drafted from commits since the last tag.
4. **Gate 1**: a summary of coordinates, version, files and changelog. Nothing is committed or uploaded without your explicit "yes".
5. **Upload and validate** in the Central Portal. Manual release is the default: the deployment is validated but not published.
6. **Gate 2**: the release becomes permanent only when you click Publish in the Portal or answer "yes" a second time. You can also drop the deployment; the version is not used up.
7. **Verify**: polls repo1.maven.org with backoff until the version is visible (10 to 30 minutes is normal).
8. **Finish**: tag, push and GitHub release, each after your approval.

When something fails, the agent looks the error up in an error library of 23 common Maven Central and Gradle publishing errors. It explains the cause in plain English, proposes a fix, and applies it only after you approve.

## Quick start

Requires Node.js 20 or later.

```sh
cd your-library
npx release-agent-skills install
```

This copies the skills into `.claude/skills/` in the current project. Commit that folder, or install with `--user` instead, because the pre-flight requires a clean git tree. Then ask your agent:

```
> check if my library is ready to publish to Maven Central
```

That runs the checks only and changes nothing. When everything passes:

```
> publish mylib 1.0.2 to Maven Central
```

### Claude Code plugin

Instead of the npm installer, Claude Code users can install the skills as a plugin from this repository's marketplace. The plugin updates with each release.

```
/plugin install release-agent-skills --marketplace Ahmadhussain0335/release-agent-skills
```

On Claude Code versions before 2.1.275, add the marketplace first:

```
/plugin marketplace add Ahmadhussain0335/release-agent-skills
/plugin install release-agent-skills@release-agent
```

The skill then runs as `/release-agent-skills:release-maven`, and Claude also picks it up from requests such as "publish mylib 1.0.2 to Maven Central". Use either the plugin or the npm installer, not both, or Claude Code sees the skill twice.

### Maven Central

The same skill files are also published to Maven Central as `io.github.ahmadhussain0335:release-agent-skills`, for teams that mirror Central or want a signed copy of each release. The jar contains the `skills/` folder; copy it into your agent's skills directory. The npm installer and the Claude Code plugin remain the easiest ways to install.

### Other tools and locations

```sh
npx release-agent-skills install --target agents    # .agents/skills (Codex and other Agent Skills tools)
npx release-agent-skills install --target cursor    # .cursor/skills
npx release-agent-skills install --target all
npx release-agent-skills install --user             # ~/.claude/skills, for all your projects
npx release-agent-skills install --dir path/to/skills
npx release-agent-skills install --dry-run          # show what would be copied
npx release-agent-skills list
```

Cursor also reads `.claude/skills` and `.agents/skills`, so a separate Cursor install is only needed if you use Cursor alone. An existing installation is never overwritten unless you pass `--force`, and the installer never deletes files.

## Safety model

- **No upload without approval.** Gate 1 comes before the upload; Gate 2 comes before the release, which cannot be undone. The Portal publish call needs a `--confirm-permanent` flag, which the skill only passes after your explicit answer.
- **Manual release by default.** Automatic release is used only when you ask for it in so many words.
- **Secrets stay secret.** `check-credentials` reports key names and where they were found, never values. The skill forbids commands that print secrets, including `./gradlew properties`, which dumps `~/.gradle/gradle.properties`. The only script that reads a secret value is `portal.mjs`. It uses the Portal token in-process for the HTTP header and never prints it.
- **Check-only mode.** Ask for a check or a dry run and nothing is changed, committed or uploaded.
- **Deterministic checks.** Version lookups, POM validation, signature checks and artifact listing are small Node.js scripts with no dependencies that print JSON, so the agent reads results instead of guessing.
- **Works with your pipeline.** If a CI workflow already publishes, the skill recommends running its checks locally and triggering that workflow, rather than bypassing it.

## Supported setups

| | Supported |
|---|---|
| Publishing plugin | [vanniktech gradle-maven-publish-plugin](https://github.com/vanniktech/gradle-maven-publish-plugin) 0.34.0 or later (0.37.0 recommended); plain `maven-publish` + `signing` (uploaded by this skill through the Portal Publisher API) |
| Library types | Java / Kotlin JVM, Android library, Kotlin Multiplatform (including the AGP `com.android.kotlin.multiplatform.library` plugin) |
| Signing | in-memory key, key ring file, GnuPG agent (`useGpgCmd()`) |
| Repository | Sonatype Central Portal. Legacy OSSRH was shut down on June 30, 2025 and is detected and flagged |
| Agents | Claude Code, Codex, Cursor and other tools that read `SKILL.md` folders |

## What gets installed

```
.claude/skills/
├── release-maven/
│   ├── SKILL.md              the workflow the agent follows
│   ├── errors.md             error library: cause, fix, phase to rerun
│   ├── reference/            Central Portal, Gradle setups, POM, signing, KMP notes
│   └── scripts/              detect, check-version, check-credentials, bump-version,
│                             inspect-artifacts, validate-pom, verify-signatures,
│                             portal, wait-for-central
└── release-agent-shared/     registry-independent scripts: git pre-flight,
                              changelog, GitHub release, release state
```

Scripts can also be run by hand, for example:

```sh
node .claude/skills/release-maven/scripts/check-version.mjs --group io.github.example --artifact mylib --version 1.0.2
node .claude/skills/release-maven/scripts/detect-project.mjs --project .
```

## Development

```sh
npm test
```

Tests use the built-in `node:test` runner and mock all network calls. See [docs/adding-a-registry.md](docs/adding-a-registry.md) for how npm, pub.dev and other registries fit in.

## License

[MIT](LICENSE)
