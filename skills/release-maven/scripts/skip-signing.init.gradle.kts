// Gradle init script for check-only staging on a machine without signing keys,
// for projects whose keys exist only in CI. It disables every Sign task, so the
// staged artifacts have no .asc files. Never use it with an upload task.
//
// ./gradlew publishToMavenLocal --init-script <path to this file> ...
allprojects {
    tasks.withType<Sign>().configureEach { enabled = false }
}
