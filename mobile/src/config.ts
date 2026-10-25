/**
 * Runtime configuration for the Android app.
 *
 * The API base is compiled in at build time (EXPO_PUBLIC_API_BASE) so the same
 * source can point at the current backend, a Render deployment, or staging.
 * There is no local fallback: the app refuses to work without a server.
 */
const FALLBACK_API_BASE = 'https://site-4cdae2a9f5c34eb7b0c6148416fe5552.freebuff.page'

export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE ?? FALLBACK_API_BASE).replace(/\/+$/, '')

/** Bumped by the release build; the server compares this number. */
export const APP_VERSION_CODE = Number(process.env.EXPO_PUBLIC_VERSION_CODE ?? 1)
export const APP_VERSION_NAME = process.env.EXPO_PUBLIC_VERSION_NAME ?? '2.0.0'
export const RELEASE_CHANNEL = process.env.EXPO_PUBLIC_CHANNEL ?? 'stable'

/** The installed app's version, shown in settings. */
export const APP_LABEL = `${APP_VERSION_NAME} (${APP_VERSION_CODE})`
