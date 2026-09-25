const { withProjectBuildGradle } = require('@expo/config-plugins');

// Expo SDK 51 downloads SQLite during Gradle builds. Use the official archive
// shipped with this project so EAS does not need to reach sqlite.org.
const marker = '// Inventory: bundled SQLite source';

module.exports = function withBundledSQLite(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('Bundled SQLite requires a Groovy Android build.gradle.');
    }
    if (!config.modResults.contents.includes(marker)) {
      config.modResults.contents += `
${marker}
subprojects { subproject ->
    if (subproject.name == 'expo-sqlite') {
        subproject.afterEvaluate {
            def downloadTask = subproject.tasks.named('downloadSQLite').get()
            def archive = rootProject.file("../vendor/sqlite/" + downloadTask.dest.name)
            if (!archive.isFile()) {
                throw new GradleException("Missing bundled SQLite archive: " + archive)
            }
            def stageSQLite = subproject.tasks.register('stageBundledSQLite', Copy) {
                from(archive)
                into(downloadTask.dest.parentFile)
            }
            downloadTask.enabled = false
            subproject.tasks.named('prepareSQLite').configure {
                dependsOn(stageSQLite)
            }
        }
    }
}
`;
    }
    return config;
  });
};
