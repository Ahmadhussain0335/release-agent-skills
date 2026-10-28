# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `skip-signing.init.gradle.kts` and an `--unsigned-expected` flag for `inspect-artifacts.mjs` and `verify-signatures.mjs`, so check-only runs work on machines without signing keys when the keys live in CI. Missing signatures are then reported as warnings while POMs, sources, javadoc and KMP targets are still checked.

### Changed

- `check-credentials.mjs` reports whether gpg is installed and, without gpg, recommends the in-memory key setup.

### Fixed

- Check-only mode no longer writes `build/release-agent/state.json`, so a later run does not mistake a check for a release in progress.

## [0.1.0] - 2026-10-28

### Added

- `release-maven` skill: publishes JVM, Android and Kotlin Multiplatform libraries to Maven Central through the Sonatype Central Portal, with check-only, manual (default) and automatic modes, two approval gates and resumable state.
- Check scripts: project detection, version lookup on repo1.maven.org, credential presence, version bump, artifact inspection, POM validation, signature and keyserver verification, Portal Publisher API client, and sync polling.
- Shared scripts: git pre-flight, changelog drafting from conventional commits, GitHub release creation.
- Error library with 23 Maven Central and Gradle publishing errors.
- Reference docs for the Central Portal, Gradle publishing setups, POM requirements, signing and Kotlin Multiplatform.
- Installer for Claude Code, Cursor and Agent Skills folders (`npx release-agent-skills install`).
