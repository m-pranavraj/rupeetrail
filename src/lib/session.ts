/** Device-local state: who you are on this phone, which groups you belong to,
 * and a cached copy of each ledger so the app can open instantly and read
 * offline. The member token is the credential the server checks; it never
 * leaves this device except as an auth header.
 */
import type { GroupSnapshot } from './api'

// --- Keys for localStorage ---
const IDENTITY_KEY = 'rupeetrail.identity.v3'
const MEMBERSHIPS_KEY = 'rupeetrail.memberships.v3'
const CACHE_PREFIX = 'rupeetrail.cache.v3.'
const PHONE_HASH_KEY = 'rupeetrail.phonehash.v1'

// --- Simple storage helpers ---
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or a full quota must not break the session.
  }
}

// --- Phone verification ---
// Users enter a mobile number; we hash it and use the hash as a stable user ID
// for ads frequency‑capping. The hash never leaves the device.

async function hashPhoneNumber(phone: string): Promise<string> {
  // Normalize: keep only digits, take last 10
  const digits = phone.replace(/\D/g, '').slice(-10)
  if (digits.length < 10) return ''
  // SHA-256 hash, return first 16 hex chars
  const encoder = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(digits))
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return hex.substring(0, 16)
}

/** Is the phone number on this device verified? */
export function isPhoneVerified(): boolean {
  try {
    const raw = localStorage.getItem(PHONE_HASH_KEY)
    return raw !== null && raw.length > 0
  } catch {
    return false
  }
}

/** Hash and store a mobile number. Only the hash is persisted, never the number. */
export async function storePhoneHash(phone: string): Promise<string> {
  const hash = await hashPhoneNumber(phone)
  if (!hash) return ''
  try {
    localStorage.setItem(PHONE_HASH_KEY, hash)
  } catch {
    // Private mode – ignore
  }
  return hash
}

/** Read the stored hashed phone number. */
export function readPhoneHash(): string | null {
  try {
    return localStorage.getItem(PHONE_HASH_KEY)
  } catch {
    return null
  }
}

// --- Identity ---

export interface Identity {
  name: string
  upiId: string
  /** the account's mobile number, once signed in */
  phone?: string
  /** Hashed phone number (16 hex chars) – optional, set after verification */
  phoneHash?: string
}

/** Read the identity from localStorage (v3 schema). */
export function loadIdentity(): Identity | null {
  const identity = read<Identity>(IDENTITY_KEY)
  if (!identity || typeof identity.name !== 'string' || !identity.name.trim()) return null
  return {
    name: identity.name.trim(),
    upiId: typeof identity.upiId === 'string' ? identity.upiId : '',
    ...(typeof identity.phone === 'string' && identity.phone ? { phone: identity.phone } : {}),
    // Preserve existing phoneHash if present
    ...(identity.phoneHash && { phoneHash: identity.phoneHash }),
  }
}

/** Save the identity to localStorage. */
export function saveIdentity(identity: Identity | null): void {
  write(IDENTITY_KEY, identity)
}

// --- Membership ---

export interface Membership {
  groupId: string
  memberId: string
  token: string
  groupName: string
  emoji: string
  name: string
  upiId: string
  joinedAt: number
}

/** Read the memberships from localStorage. */
export function loadMemberships(): Membership[] {
  const list = read<Membership[]>(MEMBERSHIPS_KEY)
  if (!Array.isArray(list)) return []
  return list.filter(
    (m) =>
      m &&
      typeof m.groupId === 'string' &&
      typeof m.memberId === 'string' &&
      typeof m.token === 'string',
  )
}

/** Save the memberships to localStorage. */
export function saveMemberships(list: Membership[]): void {
  write(MEMBERSHIPS_KEY, list)
}

export function upsertMembership(membership: Membership): Membership[] {
  const next = [...loadMemberships().filter((m) => m.groupId !== membership.groupId), membership]
  saveMemberships(next)
  return next
}

export function removeMembership(groupId: string): Membership[] {
  const next = loadMemberships().filter((m) => m.groupId !== groupId)
  saveMemberships(next)
  try {
    localStorage.removeItem(CACHE_PREFIX + groupId)
  } catch {
    // ignore
  }
  return next
}

// --- Cache ---

export function readCache(groupId: string): GroupSnapshot | null {
  return read<GroupSnapshot>(CACHE_PREFIX + groupId)
}

export function writeCache(snapshot: GroupSnapshot): void {
  write(CACHE_PREFIX + groupIdFor(snapshot), snapshot)
}

function groupIdFor(snapshot: GroupSnapshot): string {
  return snapshot.group.id
}

export function clearCache(groupId: string): void {
  write(CACHE_PREFIX + groupId, null)
}