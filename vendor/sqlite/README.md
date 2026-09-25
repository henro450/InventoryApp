# Bundled SQLite source

This is the unmodified SQLite 3.45.3 amalgamation used by expo-sqlite 14.0.6.

Source: https://www.sqlite.org/2024/sqlite-amalgamation-3450300.zip

SHA-256: `ea170e73e447703e8359308ca2e4366a3ae0c4304a8665896f068c736781c651`

SQLite source is in the public domain; see the notices in the archive.

The `withBundledSQLite` Expo config plugin disables Gradle's `downloadSQLite`
network task and adds a copy task that stages this archive at its original
download destination. The existing `prepareSQLite` task depends on that copy
and extracts the source normally. Keeping the destination unchanged matters
because the extraction task can capture that path before plugin configuration.
This avoids repeated
EAS failures reaching sqlite.org.

When upgrading expo-sqlite, check its Android build.gradle for changes to the
download task and SQLite version. If the required archive changes, download
the matching official archive and update this file. A missing archive causes
an explicit build error rather than silently using the wrong SQLite version.
