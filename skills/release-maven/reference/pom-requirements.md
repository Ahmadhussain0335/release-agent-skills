# POM requirements

Checked against https://central.sonatype.org/publish/requirements/ on 2026-10-28.

Every published component needs a POM with the fields below. For Kotlin Multiplatform this means every target POM as well as the root POM, because each target is its own component.

## Required fields

| Element | Rule | `validate-pom.mjs` check |
|---|---|---|
| `groupId`, `artifactId`, `version` | groupId starts with a verified namespace; version must not end in `-SNAPSHOT` | present, not SNAPSHOT |
| `name` | Human-readable name. `${project.groupId}:${project.artifactId}` is acceptable | present, not empty |
| `description` | Short description | present, not empty |
| `url` | Project home page | present, absolute http(s) URL |
| `licenses/license` | At least one, each with `name` and `url` | at least one license with both |
| `developers/developer` | At least one. Include `name`; `email`, `organization`, `organizationUrl` or a profile `url` are recommended | at least one developer with `name` or `id` |
| `scm/url` | Web URL of the repository | present |
| `scm/connection` | Read-only connection, e.g. `scm:git:git://github.com/<owner>/<repo>.git` | present, starts with `scm:` |
| `scm/developerConnection` | Read-write connection, e.g. `scm:git:ssh://git@github.com/<owner>/<repo>.git` | present, starts with `scm:` |
| `packaging` | Required unless it is `jar` | `warn` only; Gradle sets it |

The SCM URL does not have to be public. For a private repository, a placeholder that says so is acceptable.

## Also checked (warnings)

- `<repositories>` or `<pluginRepositories>` in the POM: Sonatype discourages them, because dependencies should come from Central.
- Dependencies without a version: consumers cannot resolve them. Usually caused by a BOM or platform dependency not exported correctly.
- `url` and `scm/url` pointing to different repositories: usually a copy-paste mistake.
- A license name with no recognizable SPDX match: not an error for Central, but worth a look.

## How each setup supplies the fields

| Field | vanniktech `gradle.properties` | vanniktech / maven-publish DSL (`pom { }`) |
|---|---|---|
| name | `POM_NAME` | `name` |
| description | `POM_DESCRIPTION` | `description` |
| url | `POM_URL` | `url` |
| license | `POM_LICENSE_NAME`, `POM_LICENSE_URL`, `POM_LICENSE_DIST` | `licenses { license { name; url; distribution } }` |
| developer | `POM_DEVELOPER_ID`, `POM_DEVELOPER_NAME`, `POM_DEVELOPER_URL` | `developers { developer { id; name; url } }` |
| scm | `POM_SCM_URL`, `POM_SCM_CONNECTION`, `POM_SCM_DEV_CONNECTION` | `scm { url; connection; developerConnection }` |
| inception year (optional) | `POM_INCEPTION_YEAR` | `inceptionYear` |

In the Kotlin DSL with older Gradle versions, these are `Property` values and need `.set(...)`, for example `name.set("My Library")`. With Gradle 8.2 and later, plain assignment works.

## Common mistakes

- **POM configured on one publication only.** With plain maven-publish for KMP or multi-module builds, `pom { }` inside one `create<MavenPublication>(...)` leaves the other publications without metadata. Use `publications.withType<MavenPublication>().configureEach { pom { ... } }`.
- **Fields set in a subproject that is not published, or the reverse.** Check the generated POM in the staging repo, not the build script. `validate-pom.mjs` reads the generated files.
- **`developerConnection` missing.** It is required even if it matches `connection`.
- **License without URL.** Both `name` and `url` are needed.

## Sources

- https://central.sonatype.org/publish/requirements/
- https://vanniktech.github.io/gradle-maven-publish-plugin/central/
