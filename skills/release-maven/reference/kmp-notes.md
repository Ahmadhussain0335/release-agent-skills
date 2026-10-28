# Kotlin Multiplatform notes

Checked against the Kotlin Multiplatform publishing documentation and the Dokka 2.2.0 documentation on 2026-10-28.

## Publication structure

For a module `lib` with `group = "io.github.example"` and targets `jvm()` and `iosArm64()`, the Kotlin plugin creates:

| Publication | Coordinates | Contents |
|---|---|---|
| `kotlinMultiplatform` (root) | `io.github.example:lib` | `.module` (Gradle module metadata), POM, a JAR without classifier holding metadata, sources |
| `jvm` | `io.github.example:lib-jvm` | `.jar`, POM, `.module`, sources |
| `iosArm64` | `io.github.example:lib-iosarm64` | `.klib`, POM, `.module`, sources |

- Target artifact IDs are the module name plus the lowercased target name: `-jvm`, `-android`, `-iosarm64`, `-iossimulatorarm64`, `-iosx64`, `-macosarm64`, `-js`, `-wasmjs`, `-linuxx64`.
- Gradle consumers depend on the root artifact. The root `.module` file points them to the right target artifact.
- Every target artifact is a separate component for Central and needs its own POM fields, sources jar, javadoc jar and signatures.
- `publishToMavenLocal` publishes all publications. `inspect-artifacts.mjs` compares the targets declared in the build with the artifact directories in the staging repo and fails if one is missing.

## Host requirements

- Kotlin/Native can cross-compile, so `.klib` files for Apple targets can be produced on Linux or Windows.
- A Mac is still required when the library or a module it depends on uses cinterop, uses the CocoaPods integration, or builds or tests final Apple binaries.
- `detect-project.mjs` reports `appleTargets`, `cinterop` (a `cinterops {}` block or `src/nativeInterop/cinterop/*.def` files) and `cocoapods` (the `org.jetbrains.kotlin.native.cocoapods` plugin).
  - Apple targets on a non-macOS host with cinterop or CocoaPods: `fail`.
  - Apple targets on a non-macOS host without them: `warn`. Recommend publishing from macOS anyway, because Apple tests cannot run elsewhere.
- Publish all targets from **one host in one deployment**. Maven Central rejects duplicate publications, so a split such as "Apple targets from a Mac, the rest from Linux CI" fails unless the build disables publishing per target on each host.

## Android target

By default no Android artifact is published from a KMP module. Which configuration applies depends on the Android plugin:

| Android plugin in the KMP module | How Android is published |
|---|---|
| `com.android.library` with `androidTarget { }` | `androidTarget { publishLibraryVariants("release") }`. The vanniktech plugin does this through `androidVariantsToPublish` (default `release` with the main plugin) |
| `com.android.kotlin.multiplatform.library` with `kotlin { androidLibrary { } }` | Published through the `androidLibrary {}` block. Needs vanniktech 0.35.0 or later; do not set `androidVariantsToPublish` |

Check that an `-android` artifact exists in the staging repo whenever the build declares an Android target.

## Javadoc jar for KMP

Central requires a `-javadoc.jar` for every component, including klib-based Apple and native artifacts. The content is not validated, so an empty jar is accepted.

| Setup | Option |
|---|---|
| vanniktech | `JavadocJar.Dokka("dokkaGeneratePublicationHtml")` for real documentation, or `JavadocJar.Empty()`. Applied to every publication |
| plain maven-publish | Register one jar task and add it to every publication with `artifact(...)` inside `publications.withType<MavenPublication>().configureEach { }` |

Dokka 2 (current version 2.2.0) task names:

| Task | Output |
|---|---|
| `dokkaGenerate` | All formats from the applied Dokka plugins |
| `dokkaGeneratePublicationHtml` | HTML, from `org.jetbrains.dokka` |
| `dokkaGeneratePublicationJavadoc` | Javadoc format, from `org.jetbrains.dokka-javadoc` (Alpha) |

- Dokka 1 tasks (`dokkaHtml`, `dokkaJavadoc`) no longer exist in Dokka 2, and vanniktech 0.36.0 removed Dokka 1 support.
- For KMP, package the HTML output. The Javadoc format is Alpha and is aimed at JVM code.

Plain maven-publish example:

```kotlin
val javadocJar by tasks.registering(Jar::class) {
    archiveClassifier.set("javadoc")
    from(tasks.named("dokkaGeneratePublicationHtml"))
}

publishing {
    publications.withType<MavenPublication>().configureEach {
        artifact(javadocJar)
    }
}
```

Each publication stores the shared jar under its own `<artifactId>-<version>-javadoc.jar` name. With Gradle signing, though, every `sign<Target>Publication` task signs the same jar file and writes the same `.asc` path, and Gradle 8 and later fails with "uses this output of task ... without declaring an explicit or implicit dependency". Two fixes:

- Register one javadoc jar task per publication (preferred: no shared outputs).
- Or order the tasks: `tasks.withType<AbstractPublishToMaven>().configureEach { dependsOn(tasks.withType<Sign>()) }`.

## Sources jars

The Kotlin plugin publishes sources for all targets by default. `kotlin { withSourcesJar(publish = false) }` disables them, which then fails Central validation. If `inspect-artifacts.mjs` reports missing sources for a KMP target, look for that call.

## Sources

- https://kotlinlang.org/docs/multiplatform/multiplatform-publish-lib-setup.html
- https://kotlinlang.org/docs/multiplatform/multiplatform-publish-libraries-to-maven.html
- https://kotlinlang.org/docs/dokka-gradle.html
- https://vanniktech.github.io/gradle-maven-publish-plugin/what/
- https://central.sonatype.org/publish/requirements/
