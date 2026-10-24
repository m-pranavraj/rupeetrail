#!/usr/bin/env node
/**
 * Turn a freshly built APK into the values the update manifest needs.
 *
 *   node scripts/android-release.mjs android/app/build/outputs/apk/release/app-release.apk \
 *     --notes "Faster settle screen; fixed a split rounding bug."
 *
 * It prints the ANDROID_* environment variables to paste into the API host, and
 * prepends the same notes to CHANGELOG.md so the repo and the app agree.
 */
import { createHash } from 'node:crypto'
import { readFile, readFile as readText, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const apkPath = args.find((arg) => !arg.startsWith('--'))
const notesIndex = args.indexOf('--notes')
const notes = notesIndex >= 0 ? (args[notesIndex + 1] ?? '') : ''
const minIndex = args.indexOf('--min-code')
const minCode = minIndex >= 0 ? Number(args[minIndex + 1]) : 1

if (!apkPath) {
  console.error('Usage: node scripts/android-release.mjs <path-to.apk> [--notes "..."] [--min-code N]')
  process.exit(1)
}

const absolute = apkPath.startsWith('/') ? apkPath : join(root, apkPath)
const apk = await readFile(absolute)
const sha256 = createHash('sha256').update(apk).digest('hex')
const appJson = JSON.parse(await readText(join(root, 'mobile', 'app.json'), 'utf8'))
const versionCode = appJson.expo.android.versionCode
const versionName = appJson.expo.version
const size = apk.byteLength

console.log(`\n${basename(absolute)}  ${(size / (1024 * 1024)).toFixed(1)} MB\n`)
console.log('Set these on the API host (Render → Environment, or Sites → Secrets):\n')
console.log(`ANDROID_VERSION_CODE=${versionCode}`)
console.log(`ANDROID_VERSION_NAME=${versionName}`)
console.log(`ANDROID_APK_URL=https://<your-host>/<path>/${basename(absolute)}`)
console.log(`ANDROID_APK_SHA256=${sha256}`)
console.log(`ANDROID_APK_SIZE=${size}`)
console.log(`ANDROID_MIN_CODE=${minCode}`)
console.log(`ANDROID_RELEASE_NOTES=${notes.replace(/\n/g, ' ')}`)

if (notes) {
  const changelogPath = join(root, 'CHANGELOG.md')
  let changelog = ''
  try {
    changelog = await readText(changelogPath, 'utf8')
  } catch {
    changelog = '# Changelog\n\n'
  }
  const header = '# Changelog\n\n'
  const body = changelog.startsWith(header) ? changelog.slice(header.length) : changelog
  const entry = `## ${versionName} (${versionCode}) — ${new Date().toISOString().slice(0, 10)}\n\n${notes.trim()}\n\n`
  await writeFile(changelogPath, header + entry + body.trimStart())
  console.log('\nCHANGELOG.md updated.')
}
