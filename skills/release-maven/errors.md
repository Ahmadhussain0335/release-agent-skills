# Error library

Known errors when publishing to Maven Central from Gradle. Portal messages are quoted as they commonly appear; the exact wording can change, so match on the key phrase in **Match**.

Each entry gives the cause, the fix, and the phase to rerun from. Propose the fix, show the exact change, and apply it only after the user approves.

| ID | Short name | Where it appears |
|---|---|---|
| E01 | Unauthorized | Upload |
| E02 | Namespace not allowed | Upload, validation |
| E03 | Version already exists | Pre-flight, validation |
| E04 | Javadoc jar missing | Pre-flight, validation |
| E05 | Sources jar missing | Pre-flight, validation |
| E06 | Signature missing | Pre-flight, validation |
| E07 | Signature invalid or key not found | Validation |
| E08 | POM field missing | Pre-flight, validation |
| E09 | Checksum missing or invalid | Validation |
| E10 | SNAPSHOT version | Pre-flight, validation |
| E11 | No configured signatory | Build |
| E12 | Cannot read the signing key | Build |
| E13 | secring.gpg not found | Build |
| E14 | Legacy OSSRH configuration | Build, upload |
| E15 | Configuration cache failure | Build, upload |
| E16 | Dokka task not found | Build |
| E17 | KMP target missing or not buildable on this host | Build, pre-flight |
| E18 | Duplicate files or components | Validation |
| E19 | Android component missing | Build, pre-flight |
| E20 | Shared signing output in KMP | Build |
| E21 | Validation timeout | Upload |
| E22 | Published but not visible on repo1 | Verify |
| E23 | Plugin requires newer Gradle, JDK, AGP or Kotlin | Build |

---

## E01 Unauthorized

- **Match:** `401`, `Unauthorized`, `Invalid credentials`
- **Cause:** The upload did not use a valid Central Portal user token. Usual reasons: the account login password was used instead of a token; the token was generated on the old OSSRH site; the token was revoked; the property names are wrong, so Gradle sent nothing.
- **Fix:** The user generates a new token on the Account page of https://central.sonatype.com and stores the two parts as `mavenCentralUsername` and `mavenCentralPassword` in `~/.gradle/gradle.properties` or as `ORG_GRADLE_PROJECT_*` environment variables. Run `check-credentials.mjs` to confirm the names are found. Do not ask for the values.
- **Rerun from:** Phase 2

## E02 Namespace not allowed

- **Match:** `Namespace '...' is not allowed`, `403`, `not authorized to publish`, `namespace not verified`
- **Cause:** The groupId does not start with a namespace verified for this Portal account. Common when the groupId is `com.<name>` without owning that domain, or when the token belongs to a different account than the one that verified the namespace.
- **Fix:** Check the Namespaces page in the Portal. Either verify the namespace (DNS TXT record for a domain, or the GitHub flow for `io.github.<username>`), or change the groupId to a verified one. Changing the groupId changes the library's coordinates for all users; confirm that with the user.
- **Rerun from:** Phase 1 if the groupId changed, otherwise Phase 6

## E03 Version already exists

- **Match:** `Component with package url: '...' already exists`, `already exists`, `check-version: version exists`
- **Cause:** This version is already on Maven Central, or another deployment with the same version is being published. Central never allows overwriting.
- **Fix:** Choose a new version. If a previous deployment of this version is only `VALIDATED` in the Portal (not published), drop it there and upload again instead.
- **Rerun from:** Phase 2 with the new version

## E04 Javadoc jar missing

- **Match:** `Javadocs must be provided but not found in entries`, `inspect-artifacts: javadoc missing`
- **Cause:** At least one component has no `-javadoc.jar`. Typical for Kotlin and KMP libraries, where Gradle does not produce one by default, and for klib-based Apple targets.
- **Fix:**
  - vanniktech: `configure(KotlinMultiplatform(javadocJar = JavadocJar.Dokka("dokkaGeneratePublicationHtml")))` or `JavadocJar.Empty()`; for other types see `reference/gradle-setups.md`.
  - plain maven-publish: `java { withJavadocJar() }` (Java), `singleVariant("release") { withJavadocJar() }` (Android), or a Dokka jar added to every publication (KMP, see `reference/kmp-notes.md`).
- **Rerun from:** Phase 4

## E05 Sources jar missing

- **Match:** `Sources must be provided but not found in entries`, `inspect-artifacts: sources missing`
- **Cause:** At least one component has no `-sources.jar`.
- **Fix:**
  - vanniktech: `sourcesJar = SourcesJar.Sources()` in `configure(...)`.
  - Java/Kotlin JVM: `java { withSourcesJar() }`. Android: `singleVariant("release") { withSourcesJar() }`. KMP: remove `withSourcesJar(publish = false)` if present.
- **Rerun from:** Phase 4

## E06 Signature missing

- **Match:** `Missing signature for file`, `verify-signatures: missing .asc`
- **Cause:** Signing did not run for some or all files. The Gradle signing plugin skips signing silently when no signatory is configured, or signing was applied to one publication only.
- **Fix:**
  - vanniktech: `signAllPublications()` in the DSL or `signAllPublications=true` in `gradle.properties`.
  - plain: `signing { isRequired = true; sign(publishing.publications) }` so the build fails instead of skipping.
  - Confirm signing credentials with `check-credentials.mjs`.
- **Rerun from:** Phase 4

## E07 Signature invalid or key not found

- **Match:** `Invalid signature for file`, `Could not find a public key by the key fingerprint`, `verify-signatures: key not on keyserver`
- **Cause, in order of likelihood:**
  1. The public key was never uploaded to a supported keyserver, or was uploaded minutes ago and has not propagated.
  2. The key has expired.
  3. A signing subkey was used, and the public key on the keyserver is outdated or does not include it.
  4. The file was modified after signing (rare; usually a custom bundle step).
- **Fix:** The user runs `gpg --keyserver keyserver.ubuntu.com --send-keys <KEYID>` (and optionally `keys.openpgp.org`). For an expired key, extend it (`reference/signing-setup.md`) and send it again. For a subkey problem, sign with the primary key or upload the current public key including the subkey. Wait a few minutes, then rerun `verify-signatures.mjs`.
- **Rerun from:** Phase 4 (re-upload needed if the deployment already failed)

## E08 POM field missing

- **Match:** `Project name is missing`, `Project description is missing`, `Project URL is not defined`, `License information is missing`, `Developers information is missing`, `SCM URL is not defined`, `validate-pom: missing`
- **Cause:** The generated POM lacks a required element, often on KMP target publications only.
- **Fix:** Add the field as shown in `reference/pom-requirements.md`. For plain maven-publish, configure it in `publications.withType<MavenPublication>().configureEach { pom { } }` so it applies to every publication.
- **Rerun from:** Phase 4

## E09 Checksum missing or invalid

- **Match:** `Missing 'md5' checksum`, `Missing 'sha1' checksum`, `Invalid 'md5' checksum`, `Invalid 'sha1' checksum`
- **Cause:** The bundle contains files without `.md5` and `.sha1` files, or a file was changed after its checksum was written. Common when a Maven local repository was zipped by hand.
- **Fix:** Upload with `portal.mjs upload`, which generates checksums from the files it bundles. Do not edit files in the staging repo after the build.
- **Rerun from:** Phase 6

## E10 SNAPSHOT version

- **Match:** `-SNAPSHOT`, `Snapshot versions are not allowed`, `check-version: snapshot`
- **Cause:** Releases cannot end in `-SNAPSHOT`.
- **Fix:** Use a release version. The Portal has a separate snapshot repository, which this skill does not handle in v0.1.
- **Rerun from:** Phase 2

## E11 No configured signatory

- **Match:** `Cannot perform signing task ... because it has no configured signatory`
- **Cause:** Signing is required, but Gradle found none of the signing properties.
- **Fix:** Configure one of the three setups in `reference/signing-setup.md`. Check the property names with `check-credentials.mjs`. If it reports `gpgInstalled: false`, use the in-memory key: it is the only setup that works without `gpg`.
- **Check-only with keys only in CI:** this error is expected on a machine without keys. Stage with `--init-script "$SKILL_DIR/scripts/skip-signing.init.gradle.kts"` and pass `--unsigned-expected` to the checks (SKILL.md, Phase 4). With environment variables, confirm they are exported in the shell that runs Gradle and that the Gradle daemon was started after they were set (`./gradlew --stop` restarts it).
- **Rerun from:** Phase 4

## E12 Cannot read the signing key

- **Match:** `Could not read PGP secret key`, `invalid header encountered`, `checksum mismatch`, `Could not find key with ID`, `Unable to retrieve secret key from key ring file`, `No secret key`
- **Cause:**
  - `checksum mismatch`: wrong passphrase.
  - `invalid header encountered`: the in-memory key is not the full ASCII-armored block, or line breaks were lost (in `gradle.properties` each line break must be written as `\n`).
  - `Could not find key with ID`: `signing.keyId` or `signingInMemoryKeyId` does not match the key, or is not the last 8 characters.
- **Fix:** The user re-exports the key themselves (`gpg --armor --export-secret-keys <KEYID>`) and stores it again, or corrects the key ID from `gpg --list-secret-keys --keyid-format short`. Never ask for the key or passphrase in the conversation.
- **Rerun from:** Phase 4

## E13 secring.gpg not found

- **Match:** `secring.gpg`, `Unable to read secret key ring file`, `No such file`
- **Cause:** `signing.secretKeyRingFile` points to a file that does not exist. GnuPG 2.1 and later no longer create `secring.gpg`.
- **Fix:** Switch to the in-memory key or `useGpgCmd()`, or the user exports a key ring: `gpg --export-secret-keys -o ~/.gnupg/secring.gpg`. The path must be absolute.
- **Rerun from:** Phase 4

## E14 Legacy OSSRH configuration

- **Match:** `oss.sonatype.org`, `s01.oss.sonatype.org`, `SonatypeHost`, `Unresolved reference: SonatypeHost`, `SONATYPE_HOST=DEFAULT`, `SONATYPE_HOST=S01`, `nexus-staging`, `io.github.gradle-nexus.publish-plugin` without the staging API URL
- **Cause:** The build still targets OSSRH, which was shut down on June 30, 2025.
- **Fix:**
  - vanniktech: upgrade to 0.37.0 (or at least 0.34.0); replace `publishToMavenCentral(SonatypeHost.S01)` with `publishToMavenCentral()` and `SONATYPE_HOST=S01` with `mavenCentralPublishing=true`.
  - gradle-nexus publish-plugin: either point `nexusUrl` at `https://ossrh-staging-api.central.sonatype.com/service/local/` (see `reference/central-portal.md`), or switch to one of the two setups this skill supports.
  - Generate a new Portal user token; OSSRH tokens do not work.
- **Rerun from:** Phase 1

## E15 Configuration cache failure

- **Match:** `Configuration cache problems found`, `cannot serialize`, `invocation of 'Task.project' at execution time is unsupported` during a publish task
- **Cause:** A plugin or build script used by the publish tasks is not compatible with the configuration cache.
- **Fix:** Run the publish tasks with `--no-configuration-cache` (the skill does this by default). If it fails during `publishToMavenLocal`, add the flag there as well. Upgrading vanniktech to 0.34.0 or later fixes its own part.
- **Rerun from:** the phase that failed

## E16 Dokka task not found

- **Match:** `Task 'dokkaHtml' not found`, `Task with name 'dokkaJavadoc' not found`, `Dokka V1 is no longer supported`
- **Cause:** Dokka 2 renamed its tasks, and vanniktech 0.36.0 removed Dokka 1 support.
- **Fix:** Use `dokkaGeneratePublicationHtml` (or `dokkaGeneratePublicationJavadoc` with the `org.jetbrains.dokka-javadoc` plugin). Remove `org.jetbrains.dokka.experimental.gradle.pluginMode=V1Enabled` or similar Dokka 1 flags from `gradle.properties` if present.
- **Rerun from:** Phase 4

## E17 KMP target missing or not buildable on this host

- **Match:** `inspect-artifacts: target missing`, `The following Kotlin/Native targets cannot be built on this machine and are disabled`, `cinterop`, `CocoaPods`
- **Cause:** A declared target did not produce an artifact. Usually Apple targets built on Linux or Windows while the library uses cinterop or CocoaPods, or a target disabled by a property such as `kotlin.native.ignoreDisabledTargets=true`.
- **Fix:** Publish from macOS with Xcode installed. Never upload a partial set of targets: the root `.module` file would point to artifacts that do not exist. See `reference/kmp-notes.md`.
- **Rerun from:** Phase 4

## E18 Duplicate files or components

- **Match:** `duplicate`, `already exists` for some target artifacts only, `Deployment contains duplicate`
- **Cause:** The same component was uploaded twice, usually by publishing KMP targets from two hosts or two CI jobs, or by uploading the same version again while a previous deployment is still open.
- **Fix:** Publish every target from one host in one deployment. Drop the duplicate open deployment in the Portal.
- **Rerun from:** Phase 6

## E19 Android component missing

- **Match:** `SoftwareComponent with name 'release' not found`, `Could not get unknown property 'release'`, `inspect-artifacts: android artifact missing`
- **Cause:** AGP did not create a publishable component, or the publication read it before AGP configured the project. In KMP, no Android artifact is published unless configured.
- **Fix:**
  - Android library: add `android { publishing { singleVariant("release") { withSourcesJar(); withJavadocJar() } } }` and read the component inside `afterEvaluate` (`reference/gradle-setups.md`).
  - KMP with `androidTarget`: `publishLibraryVariants("release")`, or vanniktech's `androidVariantsToPublish`.
  - KMP with `com.android.kotlin.multiplatform.library`: vanniktech 0.35.0 or later.
- **Rerun from:** Phase 4

## E20 Shared signing output in KMP

- **Match:** `uses this output of task ':sign...Publication' without declaring an explicit or implicit dependency`
- **Cause:** One javadoc (or other) jar task is attached to several publications, so several signing tasks write the same `.asc` file.
- **Fix:** Register one jar task per publication, or add the task ordering shown in `reference/kmp-notes.md`. The vanniktech plugin handles this itself.
- **Rerun from:** Phase 4

## E21 Validation timeout

- **Match:** `Timed out waiting for deployment`, `SONATYPE_CLOSE_TIMEOUT_SECONDS`, `portal: still VALIDATING`
- **Cause:** The Portal is slow to validate. The upload itself succeeded.
- **Fix:** Do not upload again. Poll with `portal.mjs status --id <id> --wait`, or check the Deployments page. Large KMP bundles can take longer; raise `SONATYPE_CLOSE_TIMEOUT_SECONDS` for future releases if this repeats. Check https://status.maven.org for incidents.
- **Rerun from:** Phase 6, status polling only

## E22 Published but not visible on repo1

- **Match:** `wait-for-central: timeout`, `404` on the POM URL after `PUBLISHED`
- **Cause:** Normal sync delay. Usually 10 to 30 minutes, occasionally hours during incidents. Search indexes lag further.
- **Fix:** Nothing to fix. Do not upload again. Resume polling later with `wait-for-central.mjs`, and check https://status.maven.org. Only if the deployment is not `PUBLISHED` in the Portal after several hours, contact Central Support with the deployment ID.
- **Rerun from:** Phase 8

## E23 Plugin requires newer Gradle, JDK, AGP or Kotlin

- **Match:** `requires Gradle`, `requires Java 17`, `Unsupported class file major version`, `minimum supported`, `was compiled with an incompatible version of Kotlin`
- **Cause:** The publishing plugin version needs a newer toolchain. vanniktech 0.36.0 and later need JDK 17, Gradle 9.0, AGP 8.13 and Kotlin Gradle plugin 2.2.
- **Fix:** Either upgrade the toolchain, or use vanniktech 0.35.0 (JDK 11, Gradle 8.13, AGP 8.2.2, Kotlin 1.9.20), which still publishes through the Central Portal. Toolchain upgrades are a separate task; do not mix them into a release.
- **Rerun from:** Phase 1
