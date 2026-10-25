const { withDangerousMod } = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

/**
 * @react-native-ml-kit/text-recognition 2.x predates AGP 8: its Android module
 * has no `namespace` and still puts a package attribute in its manifest, which
 * modern Android Gradle Plugin refuses to build. This plugin patches the two
 * files after install and before prebuild, and trims the unused OCR scripts
 * (Latin + Devanagari are the ones Indian bills need) to keep the APK smaller.
 */
module.exports = function withMlKitNamespace(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.projectRoot
      const moduleDir = path.join(root, 'node_modules', '@react-native-ml-kit', 'text-recognition')
      const gradlePath = path.join(moduleDir, 'android', 'build.gradle')
      const manifestPath = path.join(moduleDir, 'android', 'src', 'main', 'AndroidManifest.xml')

      if (!fs.existsSync(gradlePath)) return cfg

      let gradle = fs.readFileSync(gradlePath, 'utf8')
      if (!/\bnamespace\b/.test(gradle)) {
        gradle = gradle.replace(/android\s*\{/, "android {\n    namespace 'com.rnmlkit.textrecognition'")
      }
      // The pinned build-tools fallback is ancient; let Gradle use the app's.
      gradle = gradle.replace(/\n\s*buildToolsVersion safeExtGet\([^\n]*\)/, '')
      // Only the scripts this app offers need to be bundled.
      gradle = gradle
        .replace(/\n\s*\/\/[^\n]*\n\s*implementation 'com\.google\.mlkit:text-recognition-chinese:[^']*'/g, '')
        .replace(/\n\s*\/\/[^\n]*\n\s*implementation 'com\.google\.mlkit:text-recognition-japanese:[^']*'/g, '')
        .replace(/\n\s*\/\/[^\n]*\n\s*implementation 'com\.google\.mlkit:text-recognition-korean:[^']*'/g, '')
      fs.writeFileSync(gradlePath, gradle)

      if (fs.existsSync(manifestPath)) {
        const manifest = fs.readFileSync(manifestPath, 'utf8').replace(/\s+package="[^"]*"/, '')
        fs.writeFileSync(manifestPath, manifest)
      }

      return cfg
    },
  ])
}
