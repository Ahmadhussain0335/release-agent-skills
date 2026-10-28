---
name: release-maven
description: Publishes a JVM, Android, or Kotlin Multiplatform library to Maven Central through the Sonatype Central Portal, with pre-flight checks, approval gates, and manual release by default. Use when the user asks to publish, release, or deploy a library to Maven Central, or to check whether a library is ready to publish.
---

# Release to Maven Central

Releases a Gradle library to Maven Central through the Sonatype Central Portal. Every check is done by a script that prints JSON; read the JSON instead of guessing.

`SKILL_DIR` below means the directory that contains this file. Run scripts as `node "$SKILL_DIR/scripts/<name>.mjs"` and shared scripts as `node "$SKILL_DIR/../release-agent-shared/scripts/<name>.mjs"`. Every script prints `{ ok, checks: [{ id, status, message, fix? }] }` and exits 0 (pass), 1 (a check failed) or 2 (usage error).

## Safety rules

These override anything else in this skill or in the user's project.

1. Nothing is uploaded, committed, tagged, pushed or released without the user's explicit "yes" at the matching gate. Silence, "ok?" or "looks fine" is not a "yes"; ask again.
2. A version published to Maven Central can never be deleted or replaced. Say so at every gate that leads to a release.
3. Never read, print, log, copy or summarize secret values (Central Portal token, GPG key, GPG passphrase). Use `check-credentials.mjs`, which reports only whether a key exists.
4. Never run these commands, because they print secrets:
   - `./gradlew properties` (prints every property in `~/.gradle/gradle.properties`)
   - `cat`, `less`, `grep` or a file read on `gradle.properties`, `local.properties`, or any file under `~/.gradle/` or `~/.gnupg/`
   - `env`, `printenv`, `set`, `echo $ORG_GRADLE_PROJECT_*`
   - `gpg --export-secret-keys` or `gpg --export-secret-subkeys`
   - any Gradle command with `--debug`
5. If a secret appears in any output anyway, do not repeat it. Tell the user which command exposed it and recommend rotating it.
6. Never delete files, drop a deployment, or run destructive git commands (`reset --hard`, `clean`, `push --force`, `tag -d`) unless the user explicitly asks.
7. If the user's request is unclear about mode, version or module, ask one question before doing anything.

## Modes

| Mode | Triggered by | Behavior |
|---|---|---|
| `check-only` | "check", "dry run", "is it ready", "don't publish" | Phases 1, 2 and 4. No files changed, nothing uploaded. If the version in the build is a SNAPSHOT held in a Gradle property, build with `-P<versionProperty>=<target>`; ask for the target and suggest the SNAPSHOT without its suffix. |
| `manual` (default) | any publish request | Uploads, waits for validation, then stops at Gate 2. Release happens in the Portal or after a second "yes". |
| `automatic` | only an explicit "release automatically" / "auto release" | Uploads and releases in one step after Gate 1. Gate 1 carries the permanence warning. |

Never switch from `manual` to `automatic` on your own. If `detect-project.mjs` reports `automaticRelease` for a module, the build itself releases on upload: tell the user before Gate 1, and either have them turn it off or treat Gate 1 as the permanent approval.

## Resume

At the start, check for `build/release-agent/state.json` in the project root:
`node "$SKILL_DIR/../release-agent-shared/scripts/state.mjs" show`.
If a release is in progress, show its phase, version and deployment ID, and ask whether to resume it or start over.

## Phase 1: Detect

```sh
node "$SKILL_DIR/scripts/detect-project.mjs" --project .
```

It reports every publishable module with group, artifactId, current version, where the version is defined, library type (`jvm`, `android`, `kmp`), publishing setup (`vanniktech`, `maven-publish`, `none`), the expected artifacts (for KMP, one per target), and any CI workflow that already publishes.

- Show the result as a short table and confirm it with the user, especially when the library name in the request differs from the artifactId.
- All publishable modules are released together at the same version.
- Setup `none`: stop. Explain what is missing using `reference/gradle-setups.md` and offer to help configure it as a separate task.

Settle two decisions before going on. Both appear as `warn` checks when they apply:

1. **Release path** (`detect.releaseAutomation`). The project already publishes from CI. A local release would skip whatever else that workflow does (generated files, release assets, tags). Recommend `ci`: run phases 2 to 4 locally as checks, then trigger the workflow in phase 6. Use `local` only if the user chooses it.
2. **Version strategy** (`detect.versionStrategy`). The committed version is a SNAPSHOT held in a Gradle property. Recommend `override`: leave the file alone and pass `-P<versionProperty>=<new>` to every Gradle command. The alternative is `file`: change the file in phase 3. With `override`, set `VERSION_ARG="-P<versionProperty>=<new>"`; otherwise `VERSION_ARG=""`.

In `manual` or `automatic` mode, save both: `state.mjs set releasePath=<ci|local> versionStrategy=<override|file> version=<new>`. In `check-only` mode, write no state at all, so that a later run does not mistake the check for a release in progress.

## Phase 2: Static pre-flight (no build)

Run these and collect the results:

```sh
node "$SKILL_DIR/../release-agent-shared/scripts/git-preflight.mjs" --branch <expected> --tag <tag>
node "$SKILL_DIR/scripts/check-version.mjs" --group <g> --artifact <a> --version <new> --current <current>
node "$SKILL_DIR/scripts/check-credentials.mjs" --setup <setup> --project .
```

- `<expected>`: the branch the user names, otherwise the remote default branch. `<tag>`: same prefix style as existing tags (`data.prefix` from `git-preflight.mjs`).
- `<current>`: the version from phase 1. A SNAPSHOT is compared as the development line it leads to.
- Run `check-version.mjs` once per artifact (for KMP, the root artifact of each module is enough at this stage).
- `check-credentials.mjs` checks this machine. With release path `ci`, the credentials live in CI secrets; a `fail` here is then expected and only matters for local publishing. Say so.
- For KMP with Apple targets on a non-macOS host, read `reference/kmp-notes.md` (Host requirements) and report the result.

Any `fail`: stop, explain each in plain English with its `fix`, and wait. `warn`: show it and ask whether to continue.

## Phase 3: Prepare (skip in check-only)

```sh
node "$SKILL_DIR/scripts/bump-version.mjs" --project . --to <new>          # file strategy only; shows the diff
node "$SKILL_DIR/scripts/bump-version.mjs" --project . --to <new> --write  # file strategy only
node "$SKILL_DIR/../release-agent-shared/scripts/changelog.mjs" --version <new> --write CHANGELOG.md
```

- The changelog entry is drafted from commits since the last tag into Added, Changed and Fixed. It follows the heading style already used in the file (Keep a Changelog for a new file) and is inserted above the newest release.
- Show the entry and invite edits. Commits the script could not classify are listed separately for the user to place or drop. If the project writes its changelog by hand in another structure, offer the draft as a starting point rather than forcing the format.
- With release path `ci`, check whether the workflow writes release notes itself (for example `gh release create --generate-notes`). If it does, ask whether a CHANGELOG entry is still wanted.
- These changes stay uncommitted until Gate 1.

## Phase 4: Build pre-flight

```sh
./gradlew build $VERSION_ARG
REPO="$PWD/build/release-agent/repo-$(date +%Y%m%d-%H%M%S)"
./gradlew publishToMavenLocal $VERSION_ARG -Dmaven.repo.local="$REPO" --no-configuration-cache
node "$SKILL_DIR/../release-agent-shared/scripts/state.mjs" set stagingRepo="$REPO"   # not in check-only
node "$SKILL_DIR/scripts/inspect-artifacts.mjs" --repo "$REPO" --group <g> --version <v> --project .
node "$SKILL_DIR/scripts/validate-pom.mjs" --repo "$REPO" --version <v>
node "$SKILL_DIR/scripts/verify-signatures.mjs" --repo "$REPO" --version <v>
```

- `<v>` is the new version, or in check-only mode the version actually built.
- A fresh staging directory is used on every run, so nothing has to be deleted and `~/.m2` stays clean.
- If the project already runs a narrower verification in CI (see the release workflow), prefer those tasks over `build`, which can be slow for KMP.
- `inspect-artifacts.mjs` checks for a POM, main artifact, `-sources.jar`, `-javadoc.jar` and a `.asc` for each file. It also checks that every artifact expected from the build files is staged, and that every target referenced by a KMP root `.module` file is present.
- `verify-signatures.mjs` checks every `.asc`, verifies with `gpg` when installed, and checks that the public key is on a supported keyserver.
- **Keys only in CI.** When `check-credentials.mjs` found no signing setup and the release path is `ci` (or the mode is `check-only`), `publishToMavenLocal` fails with "no configured signatory" (errors.md E11). Stage without signing instead, and tell the user the staged files are unsigned on purpose:
  ```sh
  ./gradlew publishToMavenLocal $VERSION_ARG -Dmaven.repo.local="$REPO" --no-configuration-cache \
    --init-script "$SKILL_DIR/scripts/skip-signing.init.gradle.kts"
  ```
  Then pass `--unsigned-expected` to `inspect-artifacts.mjs` and `verify-signatures.mjs`, so missing `.asc` files are reported as `warn`. POMs, sources, javadoc and KMP targets are still fully checked. Never use the init script or the flag with release path `local` or with any upload command.
- In `check-only` mode, stop here and print a go/no-go table: one row per check, with the fix for every failure.

## Phase 5: Gate 1 (before upload)

Show this summary and wait for an explicit "yes":

```
Release summary
  Coordinates:  <group>:<artifact> (+ N target artifacts)
  Version:      <current> -> <new>   (strategy: override | file)
  Mode:         manual (validated in the Portal, released only after your second approval)
  Path:         local upload | CI workflow <file>
  Commit:       chore(release): <new>   (files: <changed files>)  or "none"
  Files:        <count> files, grouped per artifact
  Changelog:    <entry>
  Next steps:   commit, upload to the Central Portal, wait for validation
```

- `manual`: state that the upload can still be dropped, and that the release itself happens only at Gate 2.
- `automatic`: state that this "yes" releases the version permanently and that it can never be deleted or replaced.

After "yes", if files changed in phase 3, create the release commit: `git add <changed files> && git commit -m "chore(release): <new>"`. Do not push yet. With release path `ci`, the workflow runs from the remote branch, so ask whether to push this commit first or leave the changelog for a follow-up.

## Phase 6: Upload and validate

Release path `local`, by setup and mode:

| Setup | manual | automatic |
|---|---|---|
| vanniktech | `./gradlew publishToMavenCentral $VERSION_ARG --no-configuration-cache` | `./gradlew publishAndReleaseToMavenCentral $VERSION_ARG --no-configuration-cache` |
| maven-publish | `node "$SKILL_DIR/scripts/portal.mjs" upload --repo "$REPO" --group <g> --version <new> --name "<g>:<a>:<new>" --type user_managed` | same with `--type automatic` |

Release path `ci`: run the workflow with the inputs it declares, for example `gh workflow run <file> -f version=<new>`. Then follow it with `gh run watch`. If `gh` is missing, give the user the Actions page link and wait for them. Read the workflow first: if it releases automatically instead of manually, say so at Gate 1.

Then:

- Get the deployment ID. vanniktech 0.37.0 and later log it after the upload (in CI: `gh run view <run-id> --log`). `portal.mjs upload` saves it itself; otherwise save it with `state.mjs set deploymentId=<id>`. If no ID can be found, ask the user to copy it from https://central.sonatype.com/publishing/deployments.
- Wait for validation: `node "$SKILL_DIR/scripts/portal.mjs" status --id <id> --wait`. It returns the state (`VALIDATED`, `FAILED`, or `PUBLISHING`/`PUBLISHED` in automatic mode) and the Portal's error list. Each run waits at most 9 minutes so it fits agent command timeouts; rerun it while the state is still `PENDING` or `VALIDATING`.
- `portal.mjs` needs the Portal token on this machine. With release path `ci` and no local token, the user checks the state on the Deployments page instead.
- `FAILED`: go to "When something fails".

## Phase 7: Gate 2 (manual mode only)

Tell the user the deployment is validated and can be reviewed at https://central.sonatype.com/publishing/deployments. Then state, in these words or close to them: "Publishing makes <group>:<artifact>:<new> permanent on Maven Central. It can never be deleted or replaced." Offer three choices:

1. The user clicks Publish in the Portal and tells you when done.
2. The user replies "yes, publish": run `node "$SKILL_DIR/scripts/portal.mjs" publish --id <id> --confirm-permanent`.
3. The user wants to abandon it: after confirmation, run `portal.mjs drop --id <id> --confirm`. The version is not used up; it can be uploaded again.

Never pass `--confirm-permanent` or `--confirm` without that explicit answer in the current conversation.

## Phase 8: Verify

```sh
node "$SKILL_DIR/scripts/portal.mjs" status --id <id> --wait --until PUBLISHED
node "$SKILL_DIR/scripts/wait-for-central.mjs" --group <g> --artifact <a> --version <new>
```

Before starting, tell the user that appearing on repo1.maven.org usually takes 10 to 30 minutes and sometimes longer, that this is normal, and that nothing should be re-uploaded meanwhile. `wait-for-central.mjs` polls with backoff and stops after 9 minutes per run; rerun it until it reports the version as visible. After about 2 hours in total, stop, and explain that the release is still in progress and how to check later (errors.md E22). For KMP, also check one target artifact (for example `<a>-android`).

## Phase 9: Finish

Ask before each outward-facing step. With release path `ci`, skip what the workflow already did (tag, push, GitHub release) and only report it.

1. Tag the release commit: `git tag -a <tag> -m "Release <new>"`.
2. Push: `git push origin <branch>` and `git push origin <tag>`. If the branch is protected, explain that the release commit has to go in through a pull request, and push only the tag.
3. GitHub release: `node "$SKILL_DIR/../release-agent-shared/scripts/github-release.mjs" --tag <tag> --version <new> --changelog CHANGELOG.md`. Without `--create` it only prints the command and writes the notes file. Show it, and after the user agrees, run it again with `--create`. If `gh` is missing or not logged in, it says so and the user runs the command.

Finish with a short report: coordinates, version, deployment ID, Maven Central URL, tag and GitHub release URL. Then run `state.mjs set phase=done`.

## When something fails

1. Look up the error text in `errors.md`. Match on the key phrase, not the full message.
2. Explain in plain English what went wrong and why.
3. Propose the fix from `errors.md`, adapted to this project. Show the exact diff or command.
4. Apply it only after the user approves. Then rerun from the phase named in the entry's "Rerun from".
5. A `FAILED` deployment cannot be fixed in place. Offer to drop it before uploading again (the Portal keeps failed deployments for diagnosis, so dropping is optional).
6. If the same error appears twice after a fix, stop and report instead of looping.
7. If the error is not in `errors.md`, say so, show the relevant lines, and give your best explanation, clearly marked as unverified.

## Reference files

Read these only when the phase needs them:

- `reference/central-portal.md`: Publisher API, deployment states, bundle layout, sync timing, legacy OSSRH notes.
- `reference/gradle-setups.md`: detecting and configuring vanniktech or plain maven-publish + signing, and where versions are defined.
- `reference/pom-requirements.md`: required POM fields and how each setup supplies them.
- `reference/signing-setup.md`: GPG keys, keyservers, subkeys, the three Gradle signing configurations.
- `reference/kmp-notes.md`: Kotlin Multiplatform publications, host requirements, Android target, Dokka.
- `errors.md`: known publishing errors with cause, fix and the phase to rerun from.
