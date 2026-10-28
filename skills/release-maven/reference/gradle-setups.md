# Gradle publishing setups

Checked against the vanniktech plugin documentation (0.37.0), the Gradle 9.8 signing plugin documentation, and the Android publishing documentation on 2026-10-28.

Sonatype does not provide an official Gradle plugin for the Central Portal. This skill supports two setups:

- **A. vanniktech** (`com.vanniktech.maven.publish`): uploads to the Central Portal itself. Recommended by the Kotlin documentation for KMP libraries.
- **B. Plain `maven-publish` + `signing`**: Gradle builds and signs the artifacts; this skill's `portal.mjs` uploads them.

Other Portal plugins (JReleaser, GradleUp nmcp, and others) exist. `detect-project.mjs` reports them as `none`; v0.1 does not publish with them.

## Detecting the setup

`detect-project.mjs` looks for, in order:

1. Plugin ID `com.vanniktech.maven.publish` or `com.vanniktech.maven.publish.base` in `plugins {}` blocks, or a version catalog alias whose plugin ID matches.
2. Plugin ID `maven-publish` or `` `maven-publish` `` together with `signing`.
3. Convention plugins in `buildSrc/` or included builds (`build-logic/`) that apply either of the above. These are reported with a `warn`, because static detection there is less reliable.

## A. vanniktech maven-publish

### Version requirements

| Plugin version | JDK | Gradle | AGP | Kotlin Gradle plugin |
|---|---|---|---|---|
| 0.36.0, 0.37.0 | 17 | 9.0.0 | 8.13.0 | 2.2.0 |
| 0.35.0 | 11 | 8.13 | 8.2.2 | 1.9.20 |
| 0.34.0 | 11 | 8.5 | 8.0.0 | 1.9.20 |

- Versions below 0.33.0 default to OSSRH, which no longer exists. Versions below 0.34.0 still contain OSSRH code paths. Treat anything below 0.34.0 as a pre-flight failure and recommend upgrading.
- 0.36.0 removed Dokka v1 support and changed `validateDeployment` from a boolean to the `DeploymentValidation` enum.
- 0.37.0 logs the deployment ID after upload and, by default, uploads only `.md5` and `.sha1` checksums.

### Configuration (DSL)

```kotlin
plugins {
    id("com.vanniktech.maven.publish") version "0.37.0"
}

mavenPublishing {
    publishToMavenCentral()                // manual release by default
    signAllPublications()
    coordinates("io.github.example", "mylib", "1.0.2")

    pom {
        name = "My Library"
        description = "What it does."
        inceptionYear = "2025"
        url = "https://github.com/example/mylib"
        licenses {
            license {
                name = "The Apache License, Version 2.0"
                url = "https://www.apache.org/licenses/LICENSE-2.0.txt"
                distribution = "https://www.apache.org/licenses/LICENSE-2.0.txt"
            }
        }
        developers {
            developer {
                id = "example"
                name = "Example Developer"
                url = "https://github.com/example"
            }
        }
        scm {
            url = "https://github.com/example/mylib"
            connection = "scm:git:git://github.com/example/mylib.git"
            developerConnection = "scm:git:ssh://git@github.com/example/mylib.git"
        }
    }
}
```

`publishToMavenCentral(automaticRelease = true)` releases without the manual step. This skill does not need it; it chooses manual or automatic per release through the Gradle task.

### Configuration (gradle.properties)

The same settings can come from the project's `gradle.properties`:

```properties
mavenCentralPublishing=true
signAllPublications=true

GROUP=io.github.example
POM_ARTIFACT_ID=mylib
VERSION_NAME=1.0.2

POM_NAME=My Library
POM_DESCRIPTION=What it does.
POM_INCEPTION_YEAR=2025
POM_URL=https://github.com/example/mylib
POM_LICENSE_NAME=The Apache License, Version 2.0
POM_LICENSE_URL=https://www.apache.org/licenses/LICENSE-2.0.txt
POM_LICENSE_DIST=https://www.apache.org/licenses/LICENSE-2.0.txt
POM_SCM_URL=https://github.com/example/mylib
POM_SCM_CONNECTION=scm:git:git://github.com/example/mylib.git
POM_SCM_DEV_CONNECTION=scm:git:ssh://git@github.com/example/mylib.git
POM_DEVELOPER_ID=example
POM_DEVELOPER_NAME=Example Developer
POM_DEVELOPER_URL=https://github.com/example
```

Older property names still work and have no planned removal: `SONATYPE_HOST=CENTRAL_PORTAL` (same as `mavenCentralPublishing=true`), `RELEASE_SIGNING_ENABLED=true` (same as `signAllPublications=true`), `SONATYPE_AUTOMATIC_RELEASE=true` (same as `mavenCentralAutomaticPublishing=true`). `SONATYPE_HOST=DEFAULT` or `S01` is an OSSRH setting and fails on 0.34.0 and later.

The base plugin (`com.vanniktech.maven.publish.base`) ignores these properties; the DSL methods must be called.

### Credentials

Never in the project's `gradle.properties`. Use `~/.gradle/gradle.properties` or environment variables:

| Gradle property | Environment variable |
|---|---|
| `mavenCentralUsername` | `ORG_GRADLE_PROJECT_mavenCentralUsername` |
| `mavenCentralPassword` | `ORG_GRADLE_PROJECT_mavenCentralPassword` |

Signing properties are in `signing-setup.md`.

### Tasks

| Task | Effect |
|---|---|
| `publishToMavenLocal` | Builds and signs everything into the local Maven repository (used for pre-flight) |
| `publishToMavenCentral` | Uploads one deployment; release is manual |
| `publishAndReleaseToMavenCentral` | Uploads and releases automatically |

Validation options: by default the task waits until the deployment is `VALIDATED` or `FAILED`, and fails the build on `FAILED` with the Portal's errors. `mavenCentralDeploymentValidation=NONE` returns right after upload. The wait times out after 60 minutes (`SONATYPE_CLOSE_TIMEOUT_SECONDS`).

The Kotlin documentation runs the publish tasks with `--no-configuration-cache`. This skill does the same, since a configuration cache problem during upload costs a full retry.

### What gets published

`mavenPublishing { configure(...) }` overrides automatic detection:

| Project type | Call |
|---|---|
| Kotlin Multiplatform | `KotlinMultiplatform(javadocJar = JavadocJar.Dokka("dokkaGeneratePublicationHtml"), sourcesJar = SourcesJar.Sources(), androidVariantsToPublish = listOf("release"))` |
| Android library | `AndroidSingleVariantLibrary(javadocJar = ..., sourcesJar = ..., variant = "release")` |
| Kotlin JVM | `KotlinJvm(javadocJar = JavadocJar.Dokka("dokkaGeneratePublicationHtml"), sourcesJar = SourcesJar.Sources())` |
| Java library | `JavaLibrary(javadocJar = JavadocJar.Javadoc(), sourcesJar = SourcesJar.Sources())` |

`JavadocJar` options: `None()` (fails Central validation), `Empty()` (accepted by Central), `Javadoc()` (Java only), `Dokka("<task>")`. Since 0.36.0, calling `configure(...)` without `javadocJar` publishes an empty javadoc jar. Dokka task names for Dokka 2 are in `kmp-notes.md`.

## B. Plain maven-publish + signing

Gradle has no built-in upload to the Central Portal. With this setup, the skill publishes to a local staging directory and uploads it with `portal.mjs`. No `repositories {}` entry for Central is needed in the build.

### JVM (Java or Kotlin)

```kotlin
plugins {
    `java-library`              // or kotlin("jvm")
    `maven-publish`
    signing
}

java {
    withSourcesJar()
    withJavadocJar()            // for Kotlin, replace with a Dokka-based javadoc jar, see kmp-notes.md
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            from(components["java"])
            artifactId = "mylib"
            pom { /* see pom-requirements.md */ }
        }
    }
}

signing {
    sign(publishing.publications)
}
```

### Android library

```kotlin
android {
    publishing {
        singleVariant("release") {
            withSourcesJar()
            withJavadocJar()
        }
    }
}

publishing {
    publications {
        register<MavenPublication>("release") {
            afterEvaluate { from(components["release"]) }
            artifactId = "mylib"
            pom { /* see pom-requirements.md */ }
        }
    }
}

signing {
    sign(publishing.publications)
}
```

The `publishing { singleVariant(...) }` DSL needs AGP 7.1 or later. The `release` component exists only after AGP has configured the project, which is why `from(...)` is inside `afterEvaluate`.

### Kotlin Multiplatform

The Kotlin plugin creates one publication per target plus the root `kotlinMultiplatform` publication. Configure every publication, not one:

```kotlin
publishing {
    publications.withType<MavenPublication>().configureEach {
        artifact(javadocJar)    // a javadoc jar is needed for every publication, see kmp-notes.md
        pom { /* see pom-requirements.md */ }
    }
}

signing {
    sign(publishing.publications)
}
```

### Signing must not be skipped silently

By default the Gradle signing plugin skips signing when no signatory is configured, and the build still succeeds. The unsigned artifacts are then rejected by the Portal. `verify-signatures.mjs` catches this in pre-flight. To make the build fail instead, add:

```kotlin
signing {
    isRequired = true
    sign(publishing.publications)
}
```

### Credentials for upload

`portal.mjs upload` reads `mavenCentralUsername` and `mavenCentralPassword` from the same places as the vanniktech plugin (`~/.gradle/gradle.properties`, then `ORG_GRADLE_PROJECT_*` environment variables). It never prints them.

## Where the version is defined

`bump-version.mjs` supports these locations and refuses to guess if it finds more than one with different values:

| Location | Example |
|---|---|
| Project `gradle.properties` | `VERSION_NAME=1.0.1` or `version=1.0.1` |
| Version catalog `gradle/libs.versions.toml` | an entry in `[versions]` referenced by the build file |
| Build file literal | `version = "1.0.1"` in `build.gradle.kts` or `build.gradle` |
| vanniktech coordinates literal | `coordinates("io.github.example", "mylib", "1.0.1")` |

**Passing the version at build time.** Projects that keep a `-SNAPSHOT` version in `gradle.properties` often set the release version on the command line instead of editing the file: `-PVERSION_NAME=1.0.2`, or `ORG_GRADLE_PROJECT_VERSION_NAME=1.0.2` in CI. A `-P` value overrides `gradle.properties`. `detect-project.mjs` reports the property as `versionProperty`, and the skill's `override` strategy passes it to every Gradle command. This works only when the version comes from a Gradle property, not from a literal in a build file.

Versions computed from git tags, environment variables or plugins (for example `axion-release`, `reckon`) are reported as `computed`. The skill then asks the user how to set the version instead of editing files.

## Sources

- https://vanniktech.github.io/gradle-maven-publish-plugin/central/
- https://vanniktech.github.io/gradle-maven-publish-plugin/what/
- https://github.com/vanniktech/gradle-maven-publish-plugin/blob/main/CHANGELOG.md
- https://kotlinlang.org/docs/multiplatform/multiplatform-publish-libraries-to-maven.html
- https://docs.gradle.org/current/userguide/signing_plugin.html
- https://developer.android.com/build/publish-library/configure-pub-variants
