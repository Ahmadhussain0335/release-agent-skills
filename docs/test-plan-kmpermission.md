# Test plan: KMPermission

Validates release-agent-skills 0.1.0 on a real Kotlin Multiplatform library, github.com/Ahmadhussain0335/KMPermission, without anything going live by accident.

## What the skill will find

From a static run of `detect-project.mjs` against `main` on 2026-10-28:

| | |
|---|---|
| Modules | `kmppermission-core`, `kmppermission-compose` |
| Coordinates | `io.github.ahmadhussain0335:kmppermission-core`, `io.github.ahmadhussain0335:kmppermission-compose` |
| Artifacts per module | root, `-android`, `-iosarm64`, `-iossimulatorarm64` (8 components in total) |
| Setup | vanniktech 0.37.0, AGP 9.1.0 `com.android.kotlin.multiplatform.library`, Kotlin 2.4.0 |
| Version | `VERSION_NAME=0.4.0-SNAPSHOT` in `gradle.properties`; releases pass `-PVERSION_NAME` (override strategy) |
| Latest on Central | 0.3.0 |
| Release workflow | `.github/workflows/publish.yml` (manual trigger). It builds the XCFramework, writes `Package.swift`, uploads in manual mode, pushes the release commit and tag, and creates the GitHub release with the zip attached |
| Automatic release in the build | none |

Two consequences shape the plan:

- **Real releases must go through `publish.yml`.** A local release would not regenerate `Package.swift` or attach the XCFramework zip, which breaks Swift Package Manager users. The skill flags this (`detect.releaseAutomation`) and recommends the `ci` release path.
- **The local upload test always ends with Drop.** It exercises the full upload and validation path against the real Portal, then drops the deployment, so the version is never used up.

## Safety rules for the whole plan

1. Use the pre-release version `0.4.0-alpha01` for every upload test. It is not on Central, and it sorts below 0.4.0. If it were ever published by mistake, it would be a valid pre-release of `main`, not a broken or misleading version.
2. Work on a throwaway branch, `release-agent/trial`. Never push it.
3. At Gate 2, always choose **Drop**. Never click Publish in the Portal during these tests.
4. Before any upload test, confirm the Gate 1 summary says `Mode: manual`. If it says anything else, answer "no".
5. Do not run `publish.yml` during tests. It pushes a commit and tag to `main` and creates a GitHub release before the Maven release, so it is only for the real release (test 7).

## Preconditions

- macOS with Xcode (the iOS targets are compiled during the build), JDK 21 (the project uses Corretto 21), Node.js 20 or later, `gh` logged in.
- Local credentials for the upload test (test 5), set by you in `~/.gradle/gradle.properties`, never in the project:
  - `mavenCentralUsername`, `mavenCentralPassword`: a Central Portal user token
  - `signingInMemoryKey` (+ `signingInMemoryKeyPassword`), or a key ring / `useGpgCmd()` setup
- Your public key on `keyserver.ubuntu.com` or `keys.openpgp.org`.
- Install the skill for your user, not into the project. A project install leaves untracked files, and the clean-tree check would fail:

  ```sh
  cd ~/AndroidStudioProjects/release-agent-skills
  npm pack                                   # creates release-agent-skills-0.1.0.tgz
  npx ./release-agent-skills-0.1.0.tgz install --user
  ```

  Your `~/.claude/skills` already contains other skills; the installer only adds `release-maven` and `release-agent-shared` and skips existing folders.

## Tests

### 1. Installation

```sh
npx ./release-agent-skills-0.1.0.tgz list
ls ~/.claude/skills/release-maven ~/.claude/skills/release-agent-shared
npx ./release-agent-skills-0.1.0.tgz install --user          # run twice
```

Pass: `release-maven` is listed; both folders exist; the second install reports `skipped ... version 0.1.0 already installed`.

### 2. Skill triggering

In Claude Code, in the KMPermission folder on a clean `main`:

```
> is KMPermission ready to publish to Maven Central?
```

Pass: the `release-maven` skill loads, the agent picks `check-only` mode and says so, and it asks for or suggests the target version (expected: 0.4.0).

### 3. Check-only run

Continue test 2 with target `0.4.0-alpha01`.

Expected:

| Phase | Expected result |
|---|---|
| Detect | 2 modules, 8 expected artifacts. Warnings for the release workflow and the SNAPSHOT version strategy. The agent asks you to choose the release path (`ci` recommended) and the version strategy (`override` recommended) |
| Git | clean, on `main`, tag `v0.4.0-alpha01` free locally and on origin |
| Version | not on Central; latest 0.3.0; `warn` that 0.4.0-alpha01 sorts below 0.4.0-SNAPSHOT (expected for a pre-release) |
| Credentials | `pass` for the keys you have locally. With the `ci` path, missing local keys are reported as expected rather than blocking |
| Build | `./gradlew build -PVERSION_NAME=0.4.0-alpha01` succeeds |
| Staging | `publishToMavenLocal -PVERSION_NAME=0.4.0-alpha01 -Dmaven.repo.local=build/release-agent/repo-<time>`. Without local signing keys, the skill adds `--init-script skip-signing.init.gradle.kts` and reports the unsigned files as expected |
| Artifacts | 8 components, each with POM, main artifact, sources, javadoc and `.asc` files |
| POM | all required fields present (name and description come from each module's `pom {}` block, the rest from `gradle.properties`) |
| Signatures | present; `gpg` verifies them; your key found on a keyserver |

Pass:
- No files changed: `git status` is clean apart from ignored `build/` output.
- Nothing uploaded: the Portal Deployments page is unchanged.
- The agent ends with a go/no-go table.

Things to watch:
- Whether `-PVERSION_NAME` reaches every module. All 8 POMs should say `0.4.0-alpha01`.
- Whether the iOS simulator tests inside `build` make this slow. If so, note it; the skill allows using the workflow's narrower verify tasks instead.

### 4. Error library drills (no upload)

Run these in the KMPermission folder after test 3. They only read files or use copies under `build/`.

```sh
S=~/.claude/skills/release-maven/scripts
# E03: version already exists
node $S/check-version.mjs --group io.github.ahmadhussain0335 --artifact kmppermission-core --version 0.3.0
# E08: POM field missing (edits a copy, not the staged file)
REPO=$(ls -d build/release-agent/repo-* | tail -1)
POM=$(find "$REPO" -name 'kmppermission-core-0.4.0-alpha01.pom')
sed '/<developers>/,/<\/developers>/d' "$POM" > build/release-agent/broken.pom
node $S/validate-pom.mjs --pom build/release-agent/broken.pom
```

Then ask the agent: "what does this error mean?" with the output of each command.

Pass: the scripts fail with `version.central.pom` and `missing developers`. The agent maps them to E03 and E08, explains them in plain English, and proposes a fix without applying it.

### 5. Local manual upload, ending with Drop

This is the main end-to-end test against the real Central Portal.

```sh
git switch -c release-agent/trial
```

```
> publish KMPermission 0.4.0-alpha01 to Maven Central
```

When asked, choose release path `local` (this is a test; the real release uses `ci`) and version strategy `override`.

Steps and expected results:

1. Phases 1 to 4 as in test 3, with `--branch release-agent/trial` accepted for git pre-flight.
2. Phase 3 drafts a changelog entry. Accept it so the release commit is exercised; it stays on the trial branch.
3. **Gate 1:** the summary shows both modules and their 8 components, `0.4.0-SNAPSHOT -> 0.4.0-alpha01 (override)`, `Mode: manual`, `Path: local upload`, the commit and the file count. Check every line, then answer `yes`.
4. Release commit `chore(release): 0.4.0-alpha01` on the trial branch, not pushed.
5. Upload: `./gradlew publishToMavenCentral -PVERSION_NAME=0.4.0-alpha01 --no-configuration-cache`. The agent captures the deployment ID from the log and saves it in `build/release-agent/state.json`.
6. Validation: `portal.mjs status --id <id> --wait` ends in `VALIDATED`. The deployment is visible on the Portal's Deployments page with all 8 components.
7. **Gate 2:** the agent states that publishing is permanent and offers Publish in Portal, "yes, publish" and Drop. Choose Drop, and confirm when asked.
8. `portal.mjs drop --id <id> --confirm` succeeds; the deployment disappears from the Portal.

Pass:
- The deployment reached `VALIDATED`, was dropped, and `0.4.0-alpha01` is still absent from repo1.maven.org (rerun `check-version.mjs`).
- No tag was created and nothing was pushed: `git log origin/main..` shows only the trial commit; `git tag -l 'v0.4.0*'` is empty.
- At no point did the agent print a token, key or passphrase.

If validation fails instead: that is a useful result. Check that the agent quotes the Portal error, finds the matching `errors.md` entry, and proposes a fix without applying it. Then drop the failed deployment.

Afterwards, clean up yourself: `git switch main`, then delete the trial branch.

### 6. Resume after an interrupted session

During test 5, after the upload and before Gate 2, end the Claude Code session. Start a new one and ask:

```
> continue the Maven Central release
```

Pass: the agent runs `state.mjs show`, reports the phase, version and deployment ID, and resumes polling or goes to Gate 2 without uploading again.

### 7. Real release through CI (when you are ready to ship 0.4.0)

This publishes permanently. Do it only for a real release.

```
> publish KMPermission 0.4.0 to Maven Central
```

Choose release path `ci` and version strategy `override`.

Expected:
- Phases 1 to 4 run locally as checks.
- Gate 1 names the workflow and its effects (release commit, tag, GitHub release with the XCFramework zip) and says the Maven deployment will wait for a manual Publish.
- After `yes`, the agent runs `gh workflow run publish.yml -f version=0.4.0` and follows it with `gh run watch`.
- The agent finds the deployment ID in the workflow log, or asks you to copy it from the Portal.
- At Gate 2 you review the deployment in the Portal and click Publish yourself.
- Phase 8 polls repo1.maven.org and tells you the 10 to 30 minute delay is normal. Both root artifacts and one target artifact become visible.
- Phase 9 reports the tag and GitHub release created by the workflow instead of creating them again.

Pass: `0.4.0` is on Maven Central for both modules, there is exactly one `v0.4.0` tag and one GitHub release, and `Package.swift` on `main` points at the 0.4.0 zip.

## Results to collect

For each test, note pass or fail, the agent's exact wording at both gates, anything the agent guessed instead of reading from a script, and any secret that appeared in output (there should be none). Problems found here become issues and tests before the next release.

## Results: 2026-10-28

First run, on KMPermission `main` at `9a317c9`, macOS with Xcode 16.3, JDK 17 as the default JDK, Node.js 20.20.2. The skill was installed from npm with `--user`. Tests 1 to 4 ran on 0.1.0; test 3 was repeated on 0.1.1 after the fixes below.

| Test | Result | Notes |
|---|---|---|
| 1. Installation | Pass | Both folders installed into `~/.claude/skills`; the second run skipped them as `version 0.1.0 already installed`. Claude Code listed `release-maven` immediately. Upgrading with `install --user --force` to 0.1.1 overwrote both folders |
| 2. Skill triggering | Pass | The skill loaded, picked `check-only` from "is it ready", and used the target version from the request |
| 3. Check-only run | Pass on 0.1.1 (failed on 0.1.0, see findings) | Details below |
| 4. Error library drills | Pass | `check-version` on 0.3.0 failed both Central checks and pointed to E03. `validate-pom` on a copy without `<developers>` reported `missing developers` and pointed to E08. No fix was applied |
| 5. Local upload, ending with Drop | Skipped | This Mac has no Portal token and no signing key; both exist only as GitHub secrets. Skipped by choice rather than adding local credentials |
| 6. Resume | Skipped | Depends on test 5 |
| 7. Real release through CI | Not run | To be done with the 0.4.0 release |

Test 3 in detail:

| Phase | Result |
|---|---|
| Detect | 2 modules, 8 expected artifacts, vanniktech 0.37.0, no automatic release. `warn` for `publish.yml` and for the SNAPSHOT version strategy, as expected. Decisions taken from this plan: release path `ci`, strategy `override` |
| Git | All `pass`: clean, on `main`, in sync with origin, tag `v0.4.0-alpha01` free locally and on origin |
| Version | Not on Central for either module; latest 0.3.0. `warn` that 0.4.0-alpha01 sorts below 0.4.0-SNAPSHOT (expected for a pre-release) |
| Credentials | `fail` for the Portal token and signing, with `gpg is not installed` (0.1.1). Expected for the `ci` path |
| Build | The release workflow's verify tasks with `-PVERSION_NAME=0.4.0-alpha01`: `BUILD SUCCESSFUL` in 1 min 38 s |
| Staging | 0.1.0: failed at `signAndroidPublication` with "no configured signatory" (E11). 0.1.1: succeeded with `--init-script skip-signing.init.gradle.kts` |
| Artifacts | 8 of 8 components staged, each with POM, main artifact (`.aar`, `.klib`, `.jar`), sources and javadoc; 48 files. KMP extras (`kotlin_resources.zip`, `kotlin-tooling-metadata.json`, `metadata.jar`) handled correctly |
| POMs | 8 of 8 complete, all at `0.4.0-alpha01`, so `-PVERSION_NAME` reached every module |
| Signatures | 48 of 48 unsigned on purpose. 0.1.0 reported this as `fail`; 0.1.1 with `--unsigned-expected` reports `warn` |
| Side effects | `git status` clean; no `state.json` written (0.1.1); nothing uploaded |

No secret appeared in any output.

### Findings, fixed in 0.1.1

1. Check-only mode wrote `state.json`, so a later run could take a check for a release in progress.
2. Check-only staging stopped at the first signing task when the signing keys exist only in CI. Fixed with `skip-signing.init.gradle.kts`.
3. Expected missing signatures were reported as `fail`. Fixed with `--unsigned-expected` on `inspect-artifacts.mjs` and `verify-signatures.mjs`.
4. No guidance for machines without `gpg`. `check-credentials.mjs` now reports `gpgInstalled` and recommends the in-memory key.

Earlier, a static run of `detect-project.mjs` on a clone (before 0.1.0 was published) had already led to fixes for:
- the AGP 9 `kotlin { android {} }` target
- `coordinates(artifactId = ...)` with a named argument
- the SNAPSHOT version strategy
- CI workflow detection
- the changelog heading style
- builds that enable automatic release

### Not yet verified against the real Portal

The live upload, the capture of the deployment ID from the Gradle log, validation polling (`portal.mjs status --wait`), Gate 2, and drop or publish. These are covered by mocked tests only. Test 7 will be the first real run.
