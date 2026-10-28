# Sonatype Central Portal

Checked against the official Sonatype documentation on 2026-10-28.

## Background

- Sonatype shut down OSSRH (`oss.sonatype.org`, `s01.oss.sonatype.org`) on June 30, 2025. All publishing to Maven Central now goes through the Central Portal at https://central.sonatype.com.
- Instructions that mention Nexus staging repositories, "close and release", `nexus-staging-maven-plugin`, or `SonatypeHost.S01` are from the OSSRH era and no longer apply.
- Publishing needs at least one verified namespace (groupId prefix) in the Portal. `io.github.<username>` namespaces are verified through GitHub; domain namespaces through a DNS TXT record.

## Credentials

- Publishing uses a **Portal user token**, generated on the Account page of https://central.sonatype.com. It has a username part and a password part.
- The account login password does not work. Old OSSRH tokens return HTTP 401.
- Convention used by this skill and by the vanniktech plugin: Gradle properties `mavenCentralUsername` and `mavenCentralPassword`, either in `~/.gradle/gradle.properties` or as `ORG_GRADLE_PROJECT_mavenCentralUsername` / `ORG_GRADLE_PROJECT_mavenCentralPassword` environment variables.

## Publisher API

Base URL: `https://central.sonatype.com/api/v1/publisher`

Authentication header: `Authorization: Bearer <base64("<token username>:<token password>")>`. A `UserToken` header with the same value is also accepted but may be removed in future; use `Bearer`.

| Action | Request | Result |
|---|---|---|
| Upload a bundle | `POST /upload?name=<name>&publishingType=USER_MANAGED\|AUTOMATIC`, multipart field `bundle` (`application/octet-stream`) | `201`, body is the deployment ID as plain text |
| Status | `POST /status?id=<deploymentId>` | JSON with `deploymentId`, `deploymentName`, `deploymentState`, `purls`, and `errors` when failed |
| Publish | `POST /deployment/<deploymentId>` | `204`; only for `USER_MANAGED` deployments in `VALIDATED` |
| Drop | `DELETE /deployment/<deploymentId>` | `204`; only in `VALIDATED` or `FAILED` |

`publishingType` defaults to `USER_MANAGED`. This skill always passes it explicitly.

The full OpenAPI reference is at https://central.sonatype.com/api-doc.

## Deployment states

| State | Meaning | What to do |
|---|---|---|
| `PENDING` | Uploaded, waiting for validation | Wait |
| `VALIDATING` | Being validated | Wait |
| `VALIDATED` | Passed validation, waiting for a manual Publish | Gate 2: Publish or Drop |
| `PUBLISHING` | Being copied to Maven Central | Wait; this cannot be stopped |
| `PUBLISHED` | Released to Maven Central | Permanent. Poll repo1.maven.org |
| `FAILED` | Validation failed; see `errors` | Look up in `errors.md`, fix, upload again |

Key consequences:

- Until a deployment reaches `PUBLISHING`, nothing is public. A dropped deployment does not use up the version number; the same version can be uploaded again.
- Once `PUBLISHING` starts, the version is permanent. It cannot be deleted, replaced or re-uploaded. A broken release can only be followed by a new version.
- A deployment cannot be modified. Any fix means a new upload.
- Sonatype advises keeping `FAILED` deployments if you may need support, because their files help diagnose the problem.

## Bundle layout

Used only by the plain maven-publish path (`portal.mjs upload`). The vanniktech plugin builds its own bundle.

- A zip (or tar.gz) of a Maven repository layout: `<group path>/<artifactId>/<version>/<files>`. For `io.github.example:lib:1.0.2` that is `io/github/example/lib/1.0.2/`.
- One archive per upload; it can hold several components, for example all KMP target artifacts.
- Maximum size 1 GB.
- Every file needs a `.asc` signature and `.md5` and `.sha1` checksum files. `.sha256` and `.sha512` are optional. Signatures do not need checksums, and checksums do not need signatures.

Differences between a `publishToMavenLocal` output and a valid bundle, which `portal.mjs upload` handles:

- Maven local repositories contain no checksum files. The script generates `.md5` and `.sha1` for every file except `.asc` files.
- Maven local repositories contain `maven-metadata-local.xml` files. The script leaves them out.
- Only the files for the requested version are included.

## Checking whether a version exists

- Direct POM URL (most reliable): `https://repo1.maven.org/maven2/<group path>/<artifactId>/<version>/<artifactId>-<version>.pom`. HTTP 200 means the version is published; 404 means it is not on Central yet.
- Metadata: `https://repo1.maven.org/maven2/<group path>/<artifactId>/maven-metadata.xml` lists published versions. It can lag behind the POM, and is 404 for an artifact that was never published.
- `check-version.mjs` checks both, and treats the POM URL as authoritative.
- A deployment that is `VALIDATED` but not yet published does not appear on repo1. If the user may have an open deployment for the same version, ask them to check the Portal's Deployments page.

## Timing after publishing

- `PUBLISHED` to visible on repo1.maven.org: usually 10 to 30 minutes, sometimes longer.
- Search indexes (central.sonatype.com search, search.maven.org) can take several hours longer. Do not use them to decide whether a release worked.
- During the wait, do not upload again. A second upload of the same version will fail with "already exists" once the first one lands.

## OSSRH Staging API (compatibility service)

Sonatype runs a compatibility service for tools that were written for OSSRH. This skill does not use it, but users who already publish with plain maven-publish this way may ask about it.

- Base URL: `https://ossrh-staging-api.central.sonatype.com`. Repository URL for Gradle: `https://ossrh-staging-api.central.sonatype.com/service/local/staging/deploy/maven2/`.
- Uses Portal user tokens; OSSRH tokens return 401.
- After the Gradle upload, a second call is required or the deployment never appears in the Portal: `POST /manual/upload/defaultRepository/<namespace>` with optional `publishing_type=user_managed|automatic|portal_api`. It must come from the same IP address as the upload.
- Dropping a deployment in the Portal does not drop the staging repository, and the reverse.

This skill prefers the Publisher API bundle upload because it needs no extra call and is not tied to the IP address.

## Sources

- https://central.sonatype.org/publish/publish-portal-api/
- https://central.sonatype.org/publish/publish-portal-upload/
- https://central.sonatype.org/publish/requirements/
- https://central.sonatype.org/publish/publish-portal-gradle/
- https://central.sonatype.org/publish/publish-portal-ossrh-staging-api/
