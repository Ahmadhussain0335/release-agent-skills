# Signing setup

Checked against https://central.sonatype.org/publish/requirements/gpg/ and the Gradle 9.8 signing plugin documentation on 2026-10-28.

Every file in a deployment needs a detached ASCII-armored signature (`.asc`), and the public key must be on a public keyserver so the Portal can verify it.

## Rules for the agent

- Never run `gpg --export-secret-keys` or `gpg --export-secret-subkeys`. They print the private key. When the user needs one of them, give the user the command to run themselves.
- `gpg --list-keys`, `gpg --list-secret-keys --keyid-format long` and `gpg --verify` are safe: they print key IDs and fingerprints, not secrets.
- Never ask the user to paste a passphrase or key into the conversation.

## Key requirements

- Supported keyservers: `keyserver.ubuntu.com`, `keys.openpgp.org`, `pgp.mit.edu`. The old SKS keyserver network is deprecated.
- No formal key type requirement. Sonatype's examples use RSA 3072.
- Keys expire after 2 years by default. An expired key fails validation. Extend it with `gpg --edit-key <KEYID>`, then `expire`, then `save`, and upload the public key again.
- **Primary key vs subkey:** Sonatype's guidance is that Maven tooling verifies signatures made with the primary key, and recommends that the primary key does the signing. GnuPG and some tools create a signing subkey and use it by default. If validation reports an invalid signature while the key is on a keyserver, check this first (see `errors.md`).

## Creating and distributing a key

The user runs these:

```sh
gpg --full-generate-key
gpg --list-secret-keys --keyid-format long
gpg --keyserver keyserver.ubuntu.com --send-keys <KEYID>
gpg --keyserver keys.openpgp.org --send-keys <KEYID>
```

- `keys.openpgp.org` sends a verification email before the key's user ID is searchable. The key can still be fetched by fingerprint.
- A newly uploaded key can take a few minutes to become available. If the Portal reports that it cannot find the key right after upload, wait and upload again.
- `verify-signatures.mjs` reads the issuer fingerprint from the `.asc` files and checks whether `keyserver.ubuntu.com` or `keys.openpgp.org` serves that key.

## Gradle signing configurations

Pick one. `check-credentials.mjs` reports which one it found, by property name only.

### 1. In-memory key (recommended, works for local and CI)

This is the only setup that needs no `gpg` on the machine that builds. Use it when `check-credentials.mjs` reports `gpgInstalled: false`. Exporting the key once requires `gpg` on some machine (or an existing CI secret holding the armored key).

| Gradle property | Environment variable | Notes |
|---|---|---|
| `signingInMemoryKey` | `ORG_GRADLE_PROJECT_signingInMemoryKey` | ASCII-armored private key |
| `signingInMemoryKeyId` | `ORG_GRADLE_PROJECT_signingInMemoryKeyId` | Optional; last 8 characters of the key ID, needed for subkeys |
| `signingInMemoryKeyPassword` | `ORG_GRADLE_PROJECT_signingInMemoryKeyPassword` | Optional if the key has no passphrase |

These names are read by the vanniktech plugin. With plain `signing`, wire them in yourself:

```kotlin
signing {
    val key = providers.gradleProperty("signingInMemoryKey").orNull
    val keyId = providers.gradleProperty("signingInMemoryKeyId").orNull
    val password = providers.gradleProperty("signingInMemoryKeyPassword").orNull
    if (key != null) useInMemoryPgpKeys(keyId, key, password)
    sign(publishing.publications)
}
```

The user exports the key with `gpg --armor --export-secret-keys <KEYID>` and stores the output in `~/.gradle/gradle.properties` or a CI secret. In `gradle.properties`, a multi-line value needs each line break written as `\n`; environment variables can hold the key as is.

### 2. Key ring file

| Gradle property | Notes |
|---|---|
| `signing.keyId` | Last 8 characters of the key ID (`gpg -K` shows it) |
| `signing.password` | Key passphrase |
| `signing.secretKeyRingFile` | Absolute path to a secret key ring file |

GnuPG 2.1 and later no longer create `secring.gpg`. The user exports one with `gpg --export-secret-keys -o ~/.gnupg/secring.gpg`. Keep that file outside the project and readable only by the user.

### 3. GnuPG agent (`useGpgCmd()`)

```kotlin
signing {
    useGpgCmd()
    sign(publishing.publications)
}
```

Optional properties: `signing.gnupg.keyName` (key ID; defaults to GnuPG's default key), `signing.gnupg.executable` (defaults to `gpg2`, or `gpg` with `signing.gnupg.useLegacyGpg=true`), `signing.gnupg.homeDir`, `signing.gnupg.passphrase`. The passphrase can come from gpg-agent instead. This keeps the private key out of Gradle entirely, which suits local releases from a developer machine. On macOS with Homebrew GnuPG, the executable is usually `gpg`, so `signing.gnupg.executable=gpg` is often needed.

## Where credentials may live

`check-credentials.mjs` looks in, in order:

1. `$GRADLE_USER_HOME/gradle.properties` (default `~/.gradle/gradle.properties`)
2. `ORG_GRADLE_PROJECT_*` environment variables
3. The project's `gradle.properties` and `local.properties`

Finding a secret in the project's `gradle.properties` is a `fail` if the file is tracked by git, and a `warn` otherwise. Finding one in `local.properties` is a `warn` unless the file is tracked by git, then a `fail`.

## Sources

- https://central.sonatype.org/publish/requirements/gpg/
- https://docs.gradle.org/current/userguide/signing_plugin.html
- https://vanniktech.github.io/gradle-maven-publish-plugin/central/
