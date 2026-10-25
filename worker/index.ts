/**
 * RupeeSplit API — Cloudflare Worker on Sites.
 *
 * A group ledger is one JSON document in D1, guarded by a revision number so
 * two people adding expenses at the same moment cannot silently overwrite each
 * other. Every member holds a device token issued when they create or join a
 * group; that token is the only credential, which is why joining is just a
 * name, a UPI id and an invite code. Tokens are stored hashed.
 *
 * Money is always integer paise, and split maths is shared with the browser
 * (`src/lib/splits.ts`) so a share previewed on one phone is exactly what every
 * other phone sees.
 */
import { allocateSplit, SplitError } from '../src/lib/splits'
import { createRealtimeTicket, publishRealtime } from '../freebuff-realtime/server.js'
import type {
  AckStatus,
  Expense,
  ExpenseCategory,
  Group,
  GroupStatus,
  Member,
  PayerShare,
  Settlement,
  SettlementStatus,
  Split,
} from '../src/types'

/* ------------------------------------------------------------------ *
 * Minimal D1 typings (the project does not pull in workers-types)
 * ------------------------------------------------------------------ */

interface D1Meta {
  changes?: number
}
interface D1Result {
  meta: D1Meta
}
interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T = unknown>(): Promise<T | null>
  all<T = unknown>(): Promise<{ results: T[] }>
  run(): Promise<D1Result>
}
interface D1Database {
  prepare(query: string): D1Statement
}
interface DurableObjectNamespace {
  idFromName(name: string): unknown
  get(id: unknown): { fetch(request: Request): Promise<Response> }
}

export interface Env {
  DB: D1Database
  ASSETS?: { fetch(request: Request): Promise<Response> }
  REALTIME?: DurableObjectNamespace
  APP_ORIGIN?: string
  /* Published Android build, read by the in-app update check. */
  ANDROID_VERSION_CODE?: string
  ANDROID_VERSION_NAME?: string
  ANDROID_APK_URL?: string
  ANDROID_APK_SHA256?: string
  ANDROID_APK_SIZE?: string
  ANDROID_MIN_CODE?: string
  ANDROID_RELEASE_NOTES?: string
  /** One JSON blob covering every field above; wins when present. */
  ANDROID_RELEASE_JSON?: string
}

/* ------------------------------------------------------------------ *
 * Document shape
 * ------------------------------------------------------------------ */

interface StoredMember extends Member {
  tokenHash: string
  /** extra device tokens issued by a phone login; newest last */
  tokenHashes?: string[]
  /** links this membership to a phone-number account */
  userId?: string
}

interface UserRow {
  id: string
  phone: string
  name: string
  upi_id: string | null
  pin_hash: string
  pin_salt: string
  token_hash: string
  failed_attempts: number
  locked_until: number
  created_at: number
  last_seen_at: number
}

interface AuthMembership {
  groupId: string
  memberId: string
  token: string
  groupName: string
  emoji: string
  name: string
  upiId: string
  joinedAt: number
}

interface GroupDoc {
  id: string
  code: string
  name: string
  emoji: string
  status: GroupStatus
  createdAt: number
  closedAt?: number
  currency: 'INR'
  members: StoredMember[]
  expenses: Expense[]
  settlements: Settlement[]
}

interface Loaded {
  doc: GroupDoc
  revision: number
}

class HttpError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

/* ------------------------------------------------------------------ *
 * Small utilities
 * ------------------------------------------------------------------ */

const encoder = new TextEncoder()
const MAX_BODY = 16 * 1024
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CATEGORIES: ExpenseCategory[] = [
  'food',
  'travel',
  'stay',
  'groceries',
  'entertainment',
  'utilities',
  'shopping',
  'other',
]
const METHODS = ['upi', 'cash', 'bank', 'other'] as const

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token))
  return hex(new Uint8Array(digest))
}

function newToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)))
}

function newId(prefix: string): string {
  const raw = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  return `${prefix}_${raw}`
}

function inviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
}

function roomFor(groupId: string): string {
  return `group:${groupId}`
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > MAX_BODY) throw new HttpError('That request is too large.', 413)
  try {
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape')
    return value as Record<string, unknown>
  } catch {
    throw new HttpError('Malformed request.', 400)
  }
}

function text(value: unknown, min: number, max: number, label: string): string {
  if (typeof value !== 'string') throw new HttpError(`${label} is required.`)
  const trimmed = value.trim()
  if (trimmed.length < min) throw new HttpError(`${label} is required.`)
  if (trimmed.length > max) throw new HttpError(`${label} must be ${max} characters or fewer.`)
  return trimmed
}

function optionalText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new HttpError(`${label} must be a whole number.`)
  }
  if (value < min || value > max) throw new HttpError(`${label} is out of range.`)
  return value
}

function upiOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new HttpError('UPI id must be text.')
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (!/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9.-]{2,64}$/.test(trimmed)) {
    throw new HttpError('That UPI id does not look right. Example: name@okhdfcbank')
  }
  return trimmed
}

function emojiOf(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '🧾'
  return [...value.trim()].slice(0, 4).join('')
}

function categoryOf(value: unknown): ExpenseCategory {
  if (typeof value === 'string' && (CATEGORIES as string[]).includes(value)) {
    return value as ExpenseCategory
  }
  return 'other'
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

let schemaReady: Promise<void> | null = null

/**
 * Create the table on first use. Hosted deployments cannot run arbitrary SQL
 * against D1, so the Worker owns its own schema; `worker/migrations` mirrors it
 * for local Wrangler and for a future explicit migration step.
 */
async function ensureSchema(env: Env): Promise<void> {
  if (!env.DB) throw new HttpError('The ledger database is not configured for this deployment.', 503)
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS groups (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          doc TEXT NOT NULL
        )`,
      ).run()
      await env.DB.prepare('CREATE INDEX IF NOT EXISTS groups_code_idx ON groups (code)').run()
      // Phone-number accounts. One row per real number: the UNIQUE constraint is
      // what makes the login unique, and the PIN hash is what protects it.
      await env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          phone TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          upi_id TEXT,
          pin_hash TEXT NOT NULL,
          pin_salt TEXT NOT NULL,
          token_hash TEXT NOT NULL,
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        )`,
      ).run()
      await env.DB.prepare(
        'CREATE INDEX IF NOT EXISTS users_phone_idx ON users (phone)',
      ).run()
    })().catch((error) => {
      schemaReady = null
      throw error
    })
  }
  return schemaReady
}

async function loadGroup(env: Env, id: string): Promise<Loaded | null> {
  const row = await env.DB.prepare('SELECT doc, revision FROM groups WHERE id = ?')
    .bind(id)
    .first<{ doc: string; revision: number }>()
  if (!row) return null
  return { doc: JSON.parse(row.doc) as GroupDoc, revision: row.revision }
}

async function loadGroupByCode(env: Env, code: string): Promise<Loaded | null> {
  const row = await env.DB.prepare('SELECT doc, revision FROM groups WHERE code = ?')
    .bind(code)
    .first<{ doc: string; revision: number }>()
  if (!row) return null
  return { doc: JSON.parse(row.doc) as GroupDoc, revision: row.revision }
}

async function authenticate(
  request: Request,
  env: Env,
  groupId: string,
): Promise<(Loaded & { me: StoredMember }) | null> {
  const memberId = request.headers.get('x-rt-member')
  const token = request.headers.get('x-rt-token')
  if (!memberId || !token) return null
  const loaded = await loadGroup(env, groupId)
  if (!loaded) return null
  const member = loaded.doc.members.find((m) => m.id === memberId)
  if (!member) return null
  const presented = await hashToken(token)
  const accepted = [member.tokenHash, ...(member.tokenHashes ?? [])]
  if (!accepted.includes(presented)) return null
  return { ...loaded, me: member }
}

/* ------------------------------------------------------------------ *
 * Phone-number accounts
 *
 * The mobile number is the unique account key; a 4-digit PIN is the secret.
 * Without the PIN anyone who knew a number could take the account over, so the
 * PIN is never optional and is stored as a PBKDF2 hash with a per-user salt.
 * ------------------------------------------------------------------ */

const PHONE_PATTERN = /^[6-9]\d{9}$/
const MAX_LOGIN_ATTEMPTS = 5
const LOCK_MS = 15 * 60 * 1000
const PIN_ITERATIONS = 30_000

function phoneOf(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError('Mobile number is required.')
  const digits = value.replace(/\D/g, '').slice(-10)
  if (!PHONE_PATTERN.test(digits)) {
    throw new HttpError('That mobile number does not look right. Use a 10-digit Indian number.')
  }
  return digits
}

function pinOf(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}$/.test(value.trim())) {
    throw new HttpError('Choose a 4-digit PIN.')
  }
  return value.trim()
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: PIN_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  return hex(new Uint8Array(bits))
}

function publicUser(user: UserRow) {
  return { id: user.id, name: user.name, upiId: user.upi_id ?? '', phone: user.phone }
}

async function authenticateUser(request: Request, env: Env): Promise<UserRow | null> {
  const token = request.headers.get('x-rt-user')
  if (!token) return null
  const hash = await hashToken(token)
  const row = await env.DB.prepare('SELECT * FROM users WHERE token_hash = ?')
    .bind(hash)
    .first<UserRow>()
  if (!row || !row.token_hash) return null
  return row
}

/**
 * Re-issue a device token for every group this account belongs to, so signing in
 * on a new phone restores the same ledgers. Older device tokens keep working.
 */
async function membershipsForUser(env: Env, user: UserRow): Promise<AuthMembership[]> {
  const rows = await env.DB.prepare('SELECT id, revision, doc FROM groups WHERE doc LIKE ?')
    .bind(`%"userId":"${user.id}"%`)
    .all<{ id: string; revision: number; doc: string }>()

  const out: AuthMembership[] = []

  for (const row of rows.results ?? []) {
    const token = newToken()
    const tokenHash = await hashToken(token)
    let saved = false

    for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
      const loaded = await loadGroup(env, row.id)
      if (!loaded) break
      const index = loaded.doc.members.findIndex((member) => member.userId === user.id)
      if (index === -1) break

      const member = loaded.doc.members[index]
      if (member.leftAt) break

      const hashes = [...(member.tokenHashes ?? []), tokenHash].slice(-4)
      loaded.doc.members[index] = {
        ...member,
        name: user.name,
        upiId: user.upi_id ?? member.upiId,
        tokenHashes: hashes,
      }

      try {
        await saveGroup(env, loaded.doc, loaded.revision)
        saved = true
        out.push({
          groupId: loaded.doc.id,
          memberId: member.id,
          token,
          groupName: loaded.doc.name,
          emoji: loaded.doc.emoji,
          name: user.name,
          upiId: user.upi_id ?? member.upiId ?? '',
          joinedAt: member.joinedAt,
        })
      } catch {
        // Someone else wrote first: reload and try again with the new revision.
      }
    }
  }

  return out
}

async function registerAccount(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)
  const name = text(body.name, 1, 40, 'Your name')
  const phone = phoneOf(body.phone)
  const pin = pinOf(body.pin)
  const upiId = upiOf(body.upiId)

  const existing = await env.DB.prepare('SELECT id FROM users WHERE phone = ?')
    .bind(phone)
    .first<{ id: string }>()
  if (existing) {
    throw new HttpError('That mobile number already has an account. Sign in instead.', 409)
  }

  const salt = newToken().slice(0, 32)
  const pinHash = await hashPin(pin, salt)
  const token = newToken()
  const now = Date.now()
  const id = newId('u')

  try {
    await env.DB.prepare(
      `INSERT INTO users
        (id, phone, name, upi_id, pin_hash, pin_salt, token_hash, failed_attempts, locked_until, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    )
      .bind(id, phone, name, upiId ?? null, pinHash, salt, await hashToken(token), now, now)
      .run()
  } catch (error) {
    if (/UNIQUE/i.test(String(error))) {
      throw new HttpError('That mobile number already has an account. Sign in instead.', 409)
    }
    throw error
  }

  const user: UserRow = {
    id,
    phone,
    name,
    upi_id: upiId ?? null,
    pin_hash: pinHash,
    pin_salt: salt,
    token_hash: await hashToken(token),
    failed_attempts: 0,
    locked_until: 0,
    created_at: now,
    last_seen_at: now,
  }

  return json({ token, user: publicUser(user), memberships: [] }, 201)
}

async function loginAccount(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)
  const phone = phoneOf(body.phone)
  const pin = pinOf(body.pin)

  const user = await env.DB.prepare('SELECT * FROM users WHERE phone = ?')
    .bind(phone)
    .first<UserRow>()
  if (!user) throw new HttpError('Mobile number or PIN is wrong.', 401)

  const now = Date.now()
  if (user.locked_until > now) {
    const minutes = Math.max(1, Math.ceil((user.locked_until - now) / 60000))
    throw new HttpError(
      `Too many tries. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      423,
    )
  }

  const candidate = await hashPin(pin, user.pin_salt)
  if (candidate !== user.pin_hash) {
    const attempts = user.failed_attempts + 1
    const locked = attempts >= MAX_LOGIN_ATTEMPTS
    await env.DB.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
      .bind(locked ? 0 : attempts, locked ? now + LOCK_MS : 0, user.id)
      .run()
    throw new HttpError(
      locked
        ? 'Too many wrong PINs. Try again in 15 minutes.'
        : 'Mobile number or PIN is wrong.',
      401,
    )
  }

  const token = newToken()
  await env.DB.prepare(
    'UPDATE users SET token_hash = ?, failed_attempts = 0, locked_until = 0, last_seen_at = ? WHERE id = ?',
  )
    .bind(await hashToken(token), now, user.id)
    .run()

  const memberships = await membershipsForUser(env, user)
  return json({ token, user: publicUser(user), memberships })
}

async function logoutAccount(request: Request, env: Env): Promise<Response> {
  const user = await authenticateUser(request, env)
  if (!user) throw new HttpError('Sign in first.', 401)
  await env.DB.prepare('UPDATE users SET token_hash = \'\' WHERE id = ?').bind(user.id).run()
  return json({ ok: true })
}

async function notify(env: Env, groupId: string, revision: number): Promise<void> {
  if (!env.REALTIME) return
  try {
    await publishRealtime(env, {
      room: roomFor(groupId),
      event: 'ledger',
      data: { revision },
    })
  } catch {
    // Realtime is best effort: clients also poll, so a publish failure must
    // never fail the write the member actually made.
  }
}

async function saveGroup(env: Env, doc: GroupDoc, revision: number): Promise<number> {
  const next = revision + 1
  const now = Date.now()
  const result = await env.DB.prepare(
    'UPDATE groups SET doc = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?',
  )
    .bind(JSON.stringify(doc), next, now, doc.id, revision)
    .run()
  if (!result.meta.changes) {
    throw new HttpError('Someone else updated this group first. Reopen it and try again.', 409)
  }
  await notify(env, doc.id, next)
  return next
}

function publicGroup(doc: GroupDoc): Group {
  return {
    id: doc.id,
    name: doc.name,
    emoji: doc.emoji,
    status: doc.status,
    createdAt: doc.createdAt,
    closedAt: doc.closedAt,
    currency: doc.currency,
    members: doc.members.map(({ tokenHash, tokenHashes, userId, ...member }) => member),
  }
}

function snapshot(doc: GroupDoc, revision: number, me: StoredMember, token?: string) {
  return {
    group: publicGroup(doc),
    expenses: doc.expenses,
    settlements: doc.settlements,
    revision,
    code: doc.code,
    me: { id: me.id, name: me.name, upiId: me.upiId, color: me.color },
    ...(token ? { token } : {}),
  }
}

function activeIds(doc: GroupDoc): Set<string> {
  return new Set(doc.members.filter((m) => !m.leftAt).map((m) => m.id))
}

function requireWritable(doc: GroupDoc): void {
  if (doc.status === 'closed') {
    throw new HttpError('This group is closed. Reopen it in settings to make changes.', 403)
  }
}

function memberName(doc: GroupDoc, id: string): string {
  return doc.members.find((m) => m.id === id)?.name ?? 'Member'
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

function parsePayers(raw: unknown, amountPaise: number, ids: Set<string>): PayerShare[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError('Add who paid for this.')
  }
  const seen = new Set<string>()
  const payers: PayerShare[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') throw new HttpError('Payer details are malformed.')
    const row = entry as Record<string, unknown>
    const memberId = String(row.memberId ?? '')
    if (!ids.has(memberId)) throw new HttpError('A payer is not a member of this group.')
    if (seen.has(memberId)) throw new HttpError('The same person is listed twice as a payer.')
    seen.add(memberId)
    const paid = integer(row.amountPaise, 1, amountPaise, 'Payer amount')
    payers.push({ memberId, amountPaise: paid })
  }
  const total = payers.reduce((sum, p) => sum + p.amountPaise, 0)
  if (total !== amountPaise) {
    throw new HttpError('Payer amounts must add up to the expense total.')
  }
  return payers
}

function parseSplit(raw: unknown, ids: Set<string>): Split {
  if (!raw || typeof raw !== 'object') throw new HttpError('Choose how to split this expense.')
  const value = raw as Record<string, unknown>
  const mode = value.mode

  if (mode === 'equal') {
    if (!Array.isArray(value.participants) || value.participants.length === 0) {
      throw new HttpError('Pick at least one person to share this expense.')
    }
    const participants: string[] = []
    for (const id of value.participants) {
      if (typeof id !== 'string' || !ids.has(id)) {
        throw new HttpError('A participant is not a member of this group.')
      }
      if (!participants.includes(id)) participants.push(id)
    }
    return { mode, participants }
  }

  if (mode === 'exact' || mode === 'percent' || mode === 'shares') {
    if (!value.values || typeof value.values !== 'object' || Array.isArray(value.values)) {
      throw new HttpError('Enter a value for each person sharing this.')
    }
    const values: Record<string, number> = {}
    for (const [id, rawValue] of Object.entries(value.values as Record<string, unknown>)) {
      if (!ids.has(id)) throw new HttpError('A participant is not a member of this group.')
      if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue < 0) {
        throw new HttpError('Split values must be positive numbers.')
      }
      if (mode === 'exact' && !Number.isInteger(rawValue)) {
        throw new HttpError('Exact shares must be whole paise.')
      }
      values[id] = rawValue
    }
    if (Object.keys(values).length === 0) {
      throw new HttpError('Enter a value for each person sharing this.')
    }
    return { mode, values }
  }

  throw new HttpError('Unknown split mode.')
}

function validateSplit(amountPaise: number, split: Split): void {
  try {
    const allocations = allocateSplit(amountPaise, split)
    if (allocations.some((a) => a.amountPaise < 0)) {
      throw new HttpError('Shares cannot be negative.')
    }
  } catch (error) {
    if (error instanceof SplitError) throw new HttpError(error.message)
    throw error
  }
}

/* ------------------------------------------------------------------ *
 * Handlers
 * ------------------------------------------------------------------ */

async function createGroup(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)
  const name = text(body.name, 1, 60, 'Group name')
  const memberName = text(body.memberName, 1, 40, 'Your name')
  const upiId = upiOf(body.upiId)
  const emoji = emojiOf(body.emoji)
  const now = Date.now()
  const token = newToken()

  const user = await authenticateUser(request, env)
  const me: StoredMember = {
    id: newId('m'),
    name: memberName,
    upiId,
    color: 0,
    joinedAt: now,
    tokenHash: await hashToken(token),
    ...(user ? { userId: user.id } : {}),
  }

  const doc: GroupDoc = {
    id: newId('g'),
    code: '',
    name,
    emoji,
    status: 'active',
    createdAt: now,
    currency: 'INR',
    members: [me],
    expenses: [],
    settlements: [],
  }

  let saved = false
  for (let attempt = 0; attempt < 6 && !saved; attempt += 1) {
    doc.code = inviteCode()
    try {
      await env.DB.prepare(
        'INSERT INTO groups (id, code, revision, created_at, updated_at, doc) VALUES (?, ?, 1, ?, ?, ?)',
      )
        .bind(doc.id, doc.code, now, now, JSON.stringify(doc))
        .run()
      saved = true
    } catch (error) {
      if (!/UNIQUE/i.test(String(error))) throw error
      doc.id = newId('g')
    }
  }
  if (!saved) throw new HttpError('Could not create the group. Try again.', 503)

  return json(snapshot(doc, 1, me, token), 201)
}

async function joinGroup(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)
  const code = text(body.code, 4, 12, 'Invite code').toUpperCase().replace(/[^A-Z0-9]/g, '')
  const memberName = text(body.memberName, 1, 40, 'Your name')
  const upiId = upiOf(body.upiId)

  const loaded = await loadGroupByCode(env, code)
  if (!loaded) throw new HttpError('That invite code does not match a group.', 404)
  if (loaded.doc.status === 'closed') {
    throw new HttpError('This group is closed and is not accepting new members.', 403)
  }

  const token = newToken()
  const now = Date.now()
  const user = await authenticateUser(request, env)
  const doc: GroupDoc = structuredClone(loaded.doc)

  // If someone added this person by name before they joined, they take over
  // that placeholder instead of appearing twice — history stays attached.
  const placeholder = doc.members.find(
    (member) =>
      member.isPlaceholder &&
      !member.leftAt &&
      member.name.trim().toLowerCase() === memberName.trim().toLowerCase(),
  )

  let me: StoredMember
  if (placeholder) {
    placeholder.name = memberName
    if (upiId) placeholder.upiId = upiId
    delete placeholder.isPlaceholder
    placeholder.tokenHash = await hashToken(token)
    if (user) placeholder.userId = user.id
    me = placeholder
  } else {
    me = {
      id: newId('m'),
      name: memberName,
      upiId,
      color: doc.members.length % 8,
      joinedAt: now,
      tokenHash: await hashToken(token),
      ...(user ? { userId: user.id } : {}),
    }
    doc.members.push(me)
  }

  const revision = await saveGroup(env, doc, loaded.revision)

  return json(snapshot(doc, revision, me, token), 201)
}

function memberInHistory(doc: GroupDoc, memberId: string): boolean {
  const usedInExpense = doc.expenses.some(
    (expense) =>
      expense.createdBy === memberId ||
      expense.payers.some((payer) => payer.memberId === memberId) ||
      (expense.split.participants ?? []).includes(memberId) ||
      Object.prototype.hasOwnProperty.call(expense.split.values ?? {}, memberId),
  )
  const usedInSettlement = doc.settlements.some(
    (settlement) => settlement.from === memberId || settlement.to === memberId,
  )
  return usedInExpense || usedInSettlement
}

/** Add someone who is in the group but has not installed anything yet. */
async function addMember(
  request: Request,
  env: Env,
  auth: Loaded & { me: StoredMember },
): Promise<Response> {
  requireWritable(auth.doc)
  const body = await readJson(request)
  const name = text(body.name, 1, 40, 'Their name')
  const upiId = upiOf(body.upiId)

  const doc: GroupDoc = structuredClone(auth.doc)
  if (activeIds(doc).size >= 50) {
    throw new HttpError('A group can hold up to 50 people.', 400)
  }
  if (
    doc.members.some(
      (member) => !member.leftAt && member.name.trim().toLowerCase() === name.trim().toLowerCase(),
    )
  ) {
    throw new HttpError(`${name} is already in this group.`, 409)
  }

  const now = Date.now()
  doc.members.push({
    id: newId('m'),
    name,
    upiId,
    color: doc.members.length % 8,
    joinedAt: now,
    isPlaceholder: true,
    tokenHash: '',
  })

  const revision = await saveGroup(env, doc, auth.revision)
  return json(snapshot(doc, revision, auth.me), 201)
}

/** Remove a manually added person, but never one with money attached to them. */
async function removeMember(
  env: Env,
  auth: Loaded & { me: StoredMember },
  memberId: string,
): Promise<Response> {
  requireWritable(auth.doc)
  const doc: GroupDoc = structuredClone(auth.doc)
  const member = doc.members.find((entry) => entry.id === memberId)
  if (!member) throw new HttpError('That person is not in this group.', 404)
  if (!member.isPlaceholder) {
    throw new HttpError('Only people you added by hand can be removed.', 403)
  }
  if (memberInHistory(doc, memberId)) {
    throw new HttpError(
      `${member.name} is already on an expense, so they stay in the history.`,
      409,
    )
  }

  doc.members = doc.members.filter((entry) => entry.id !== memberId)
  const revision = await saveGroup(env, doc, auth.revision)
  return json(snapshot(doc, revision, auth.me))
}

/**
 * The Android update manifest.
 *
 * Values come from Worker environment variables so publishing a build is a
 * config change, not a code change. With no URL configured the app simply never
 * sees an update, which is the correct behaviour before the first release.
 */
function releaseManifest(env: Env, url: URL): Response {
  const current = Number(url.searchParams.get('currentCode') ?? '0') || 0

  // A single JSON value keeps the whole manifest in one place (one secret or
  // one variable), while the individual names stay supported for local dev.
  if (env.ANDROID_RELEASE_JSON) {
    try {
      const parsed = JSON.parse(env.ANDROID_RELEASE_JSON) as {
        versionCode?: number
        versionName?: string
        apkUrl?: string
        sha256?: string
        sizeBytes?: number
        notes?: string
        minSupportedCode?: number
      }
      const versionCode = Number(parsed.versionCode ?? 0)
      const minSupportedCode = Number(parsed.minSupportedCode ?? 1)
      if (versionCode && parsed.apkUrl) {
        return json({
          latest: {
            versionCode,
            versionName: parsed.versionName ?? String(versionCode),
            apkUrl: parsed.apkUrl,
            sha256: parsed.sha256,
            sizeBytes: parsed.sizeBytes,
            notes: parsed.notes ?? '',
            mandatory: current < minSupportedCode,
            minSupportedCode,
          },
          updateRequired: versionCode > current || current < minSupportedCode,
          minSupportedCode,
        })
      }
    } catch {
      // A malformed manifest must not break the app: fall through to no update.
    }
  }

  const code = Number(env.ANDROID_VERSION_CODE ?? '0') || 0
  const min = Number(env.ANDROID_MIN_CODE ?? '0') || 0

  if (!code || !env.ANDROID_APK_URL) {
    return json({ latest: null, updateRequired: false, minSupportedCode: min })
  }

  const size = Number(env.ANDROID_APK_SIZE ?? '0') || 0
  return json({
    latest: {
      versionCode: code,
      versionName: env.ANDROID_VERSION_NAME ?? String(code),
      apkUrl: env.ANDROID_APK_URL,
      sha256: env.ANDROID_APK_SHA256 ?? undefined,
      sizeBytes: size || undefined,
      notes: env.ANDROID_RELEASE_NOTES ?? '',
      mandatory: current < min,
      minSupportedCode: min,
    },
    updateRequired: code > current || current < min,
    minSupportedCode: min,
  })
}

async function invitePreview(env: Env, code: string): Promise<Response> {
  const loaded = await loadGroupByCode(env, code.toUpperCase())
  if (!loaded) return json({ error: 'That invite link is not valid.' }, 404)
  return json({
    id: loaded.doc.id,
    code: loaded.doc.code,
    name: loaded.doc.name,
    emoji: loaded.doc.emoji,
    memberCount: loaded.doc.members.filter((m) => !m.leftAt).length,
    status: loaded.doc.status,
    closed: loaded.doc.status === 'closed',
  })
}

async function getSnapshot(env: Env, auth: Loaded & { me: StoredMember }): Promise<Response> {
  return json(snapshot(auth.doc, auth.revision, auth.me))
}

async function addExpense(
  request: Request,
  env: Env,
  auth: Loaded & { me: StoredMember },
): Promise<Response> {
  requireWritable(auth.doc)
  const body = await readJson(request)
  const ids = activeIds(auth.doc)
  const amountPaise = integer(body.amountPaise, 1, 100_000_000, 'Amount')
  const description = text(body.description, 1, 80, 'Description')
  const category = categoryOf(body.category)
  const date = integer(body.date, 0, Date.now() + 86_400_000, 'Date')
  const payers = parsePayers(body.payers, amountPaise, ids)
  const split = parseSplit(body.split, ids)
  validateSplit(amountPaise, split)

  const now = Date.now()
  const expense: Expense = {
    id: newId('e'),
    groupId: auth.doc.id,
    description,
    amountPaise,
    date,
    category,
    payers,
    split,
    notes: optionalText(body.notes, 200),
    createdBy: auth.me.id,
    createdAt: now,
    updatedAt: now,
    acks: Object.fromEntries(
      [...ids].map((id) => [id, id === auth.me.id ? ('acknowledged' as AckStatus) : ('pending' as AckStatus)]),
    ),
    revision: 1,
  }

  const doc: GroupDoc = structuredClone(auth.doc)
  doc.expenses.push(expense)
  const revision = await saveGroup(env, doc, auth.revision)
  return json({ ...snapshot(doc, revision, auth.me), expenseId: expense.id }, 201)
}

async function updateExpense(
  request: Request,
  env: Env,
  auth: Loaded & { me: StoredMember },
  expenseId: string,
): Promise<Response> {
  requireWritable(auth.doc)
  const existing = auth.doc.expenses.find((e) => e.id === expenseId)
  if (!existing || existing.deletedAt) throw new HttpError('That expense no longer exists.', 404)

  const body = await readJson(request)
  const ids = activeIds(auth.doc)
  const amountPaise = integer(body.amountPaise, 1, 100_000_000, 'Amount')
  const description = text(body.description, 1, 80, 'Description')
  const category = categoryOf(body.category)
  const date = integer(body.date, 0, Date.now() + 86_400_000, 'Date')
  const payers = parsePayers(body.payers, amountPaise, ids)
  const split = parseSplit(body.split, ids)
  validateSplit(amountPaise, split)

  const doc: GroupDoc = structuredClone(auth.doc)
  const target = doc.expenses.find((e) => e.id === expenseId)!
  target.description = description
  target.amountPaise = amountPaise
  target.date = date
  target.category = category
  target.payers = payers
  target.split = split
  target.notes = optionalText(body.notes, 200)
  target.updatedAt = Date.now()
  target.revision += 1
  // An edit invalidates earlier confirmation: everyone except the editor must
  // look at the new numbers before the ledger counts as agreed.
  target.acks = Object.fromEntries(
    [...ids].map((id) => [id, id === auth.me.id ? ('acknowledged' as AckStatus) : ('pending' as AckStatus)]),
  )
  if (target.dispute?.status === 'open') {
    target.dispute = { ...target.dispute, status: 'resolved', resolution: 'Expense was revised.', resolvedAt: Date.now() }
  }

  const revision = await saveGroup(env, doc, auth.revision)
  return json(snapshot(doc, revision, auth.me))
}

async function deleteExpense(
  env: Env,
  auth: Loaded & { me: StoredMember },
  expenseId: string,
): Promise<Response> {
  requireWritable(auth.doc)
  const existing = auth.doc.expenses.find((e) => e.id === expenseId)
  if (!existing) throw new HttpError('That expense no longer exists.', 404)
  const doc: GroupDoc = structuredClone(auth.doc)
  const target = doc.expenses.find((e) => e.id === expenseId)!
  target.deletedAt = Date.now()
  target.updatedAt = Date.now()
  const revision = await saveGroup(env, doc, auth.revision)
  return json(snapshot(doc, revision, auth.me))
}

async function ackExpense(
  request: Request,
  env: Env,
  auth: Loaded & { me: StoredMember },
  expenseId: string,
): Promise<Response> {
  requireWritable(auth.doc)
  const body = await readJson(request)
  const status = body.status
  if (status !== 'acknowledged' && status !== 'questioned') {
    throw new HttpError('Choose confirmed or questioned.')
  }
  const doc: GroupDoc = structuredClone(auth.doc)
  const expense = doc.expenses.find((e) => e.id === expenseId)
  if (!expense) throw new HttpError('That expense no longer exists.', 404)

  expense.acks[auth.me.id] = status
  if (status === 'questioned') {
    expense.dispute = {
      raisedBy: auth.me.id,
      reason: text(body.reason, 1, 240, 'Your question'),
      raisedAt: Date.now(),
      status: 'open',
    }
  }
  const revision = await saveGroup(env, doc, auth.revision)
  return json(snapshot(doc, revision, auth.me))
}

async function resolveDispute(
  request: Request,
  env: Env,
  auth: Loaded & { me: StoredMember },
  expenseId: string,
): Promise<Response> {
  requireWritable(auth.doc)
  const body = await readJson(request)
  const resolution = text(body.resolution, 1, 240, 'Resolution')
  const doc: GroupDoc = structuredClone(auth.doc)
  const expense = doc.expenses.find((e) => e.id === expenseId)
  if (!expense || !expense.dispute) throw new HttpError('There is no open question on that expense.', 404)
  if (expense.dispute.status !== 'open') throw new HttpError('That question is already resolved.', 409)
  expense.dispute.status = 'resolved'
  expense.dispute.resolution = resolution
  expense.dispute.resolvedAt = Date.now()
  const revision = await saveGroup(env, doc, auth.revision)
  return json(snapshot(doc, revision, auth.me))
}

async function addSettlement(
  request: Request,
  env: Env,
  auth: Loaded & { me: StoredMember },
): Promise<Response> {
  requireWritable(auth.doc)
  const body = await readJson(request)
  const ids = activeIds(auth.doc)
  const from = String(body.from ?? '')
  const to = String(body.to ?? '')
  if (!ids.has(from) || !ids.has(to)) throw new HttpError('Pick two members of this group.')
  if (from === to) throw new HttpError('Payer and receiver must be different people.')
  const amountPaise = integer(body.amountPaise, 1, 100_000_000, 'Amount')
  const method = METHODS.includes(body.method as (typeof METHODS)[number])
    ? (body.method as Settlement['method'])
    : 'upi'

  const now = Date.now()
  const settlement: Settlement = {
    id: newId('s'),
    groupId: auth.doc.id,
    from,
    to,
    amountPaise,
    method,
    status: 'pending',
    note: optionalText(body.note, 120),
    createdAt: now,
    updatedAt: now,
  }

  const doc: GroupDoc = structuredClone(auth.doc)
  doc.settlements.push(settlement)
  const revision = await saveGroup(env, doc, auth.revision)
  return json(
    {
      ...snapshot(doc, revision, auth.me),
      settlementId: settlement.id,
      message: `Recorded ${memberName(doc, from)} paying ${memberName(doc, to)}. Both sides need to confirm before balances move.`,
    },
    201,
  )
}

async function confirmSettlement(
  request: Request,
  env: Env,
  auth: Loaded & { me: StoredMember },
  settlementId: string,
): Promise<Response> {
  requireWritable(auth.doc)
  const body = await readJson(request)
  const action = body.action
  if (action !== 'paid' && action !== 'received' && action !== 'dispute') {
    throw new HttpError('Unknown confirmation action.')
  }
  const doc: GroupDoc = structuredClone(auth.doc)
  const settlement = doc.settlements.find((s) => s.id === settlementId)
  if (!settlement) throw new HttpError('That payment no longer exists.', 404)

  const now = Date.now()
  let status: SettlementStatus = settlement.status

  if (action === 'paid') {
    if (settlement.from !== auth.me.id) throw new HttpError('Only the payer can confirm this.', 403)
    settlement.payerConfirmedAt = now
    status = settlement.receiverConfirmedAt ? 'confirmed' : 'payer_confirmed'
  } else if (action === 'received') {
    if (settlement.to !== auth.me.id) throw new HttpError('Only the receiver can confirm this.', 403)
    settlement.receiverConfirmedAt = now
    status = settlement.payerConfirmedAt ? 'confirmed' : 'receiver_confirmed'
  } else {
    if (settlement.from !== auth.me.id && settlement.to !== auth.me.id) {
      throw new HttpError('Only the two people in this payment can flag it.', 403)
    }
    if (settlement.status === 'confirmed') {
      throw new HttpError('A confirmed payment cannot be disputed.', 409)
    }
    status = 'disputed'
  }

  settlement.status = status
  settlement.updatedAt = now
  const revision = await saveGroup(env, doc, auth.revision)
  return json(snapshot(doc, revision, auth.me))
}

async function patchGroup(
  request: Request,
  env: Env,
  auth: Loaded & { me: StoredMember },
): Promise<Response> {
  const body = await readJson(request)
  const doc: GroupDoc = structuredClone(auth.doc)
  if (body.name !== undefined) doc.name = text(body.name, 1, 60, 'Group name')
  if (body.emoji !== undefined) doc.emoji = emojiOf(body.emoji)
  if (body.status !== undefined) {
    const status = body.status
    if (status !== 'active' && status !== 'reconciling' && status !== 'closed') {
      throw new HttpError('Unknown group status.')
    }
    doc.status = status
    doc.closedAt = status === 'closed' ? Date.now() : undefined
  }
  const revision = await saveGroup(env, doc, auth.revision)
  return json(snapshot(doc, revision, auth.me))
}

async function patchMe(
  request: Request,
  env: Env,
  auth: Loaded & { me: StoredMember },
): Promise<Response> {
  const body = await readJson(request)
  const doc: GroupDoc = structuredClone(auth.doc)
  const me = doc.members.find((m) => m.id === auth.me.id)!
  if (body.name !== undefined) me.name = text(body.name, 1, 40, 'Your name')
  if (body.upiId !== undefined) me.upiId = upiOf(body.upiId)
  const revision = await saveGroup(env, doc, auth.revision)
  return json(snapshot(doc, revision, me))
}

async function realtimeTicket(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request)
  const room = typeof body.room === 'string' ? body.room : ''
  const match = /^group:([A-Za-z0-9_-]+)$/.exec(room)
  if (!match) throw new HttpError('Unknown room.', 400)

  if (!env.REALTIME) {
    return json({ error: 'Live updates are not available on this deployment.' }, 503)
  }

  const auth = await authenticate(request, env, match[1])
  if (!auth) return json({ error: 'Not a member of this group.' }, 401)

  const configured = env.APP_ORIGIN
  const origin = request.headers.get('Origin') ?? ''
  if (!/^https?:\/\/[^/\s]+$/.test(origin)) throw new HttpError('Missing origin.', 403)
  if (configured && origin !== configured && origin !== new URL(request.url).origin) {
    throw new HttpError('Origin not allowed.', 403)
  }

  try {
    const ticket = await createRealtimeTicket(env, {
      room,
      userId: auth.me.id,
      origin,
      publish: false,
      presence: true,
    })
    return json(ticket)
  } catch {
    return json({ error: 'Live updates are temporarily unavailable.' }, 503)
  }
}

/* ------------------------------------------------------------------ *
 * Router
 * ------------------------------------------------------------------ */

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split('/').filter(Boolean) // api, ...
  const method = request.method.toUpperCase()

  if (parts[1] === 'health') {
    return json({ ok: true, realtime: Boolean(env.REALTIME) })
  }

  if (parts[1] === 'app' && parts[2] === 'releases' && method === 'GET') {
    return releaseManifest(env, url)
  }

  if (parts[1] === 'auth' && parts.length === 3 && method === 'POST') {
    if (parts[2] === 'register') return registerAccount(request, env)
    if (parts[2] === 'login') return loginAccount(request, env)
    if (parts[2] === 'logout') return logoutAccount(request, env)
    return json({ error: 'Unknown auth route.' }, 404)
  }

  if (parts[1] === 'groups' && parts.length === 2 && method === 'POST') {
    return createGroup(request, env)
  }

  if (parts[1] === 'groups' && parts[2] === 'join' && method === 'POST') {
    return joinGroup(request, env)
  }

  if (parts[1] === 'invite' && parts[2] && method === 'GET') {
    return invitePreview(env, decodeURIComponent(parts[2]))
  }

  if (parts[1] === 'realtime' && parts[2] === 'ticket' && method === 'POST') {
    return realtimeTicket(request, env)
  }

  if (parts[1] !== 'groups' || !parts[2]) return json({ error: 'Not found.' }, 404)

  const groupId = decodeURIComponent(parts[2])
  const auth = await authenticate(request, env, groupId)
  if (!auth) return json({ error: 'You are not a member of this group.' }, 401)

  if (parts.length === 3) {
    if (method === 'GET') return getSnapshot(env, auth)
    if (method === 'PATCH') return patchGroup(request, env, auth)
  }

  if (parts.length === 4 && parts[3] === 'me' && method === 'PATCH') {
    return patchMe(request, env, auth)
  }

  if (parts[3] === 'members') {
    if (parts.length === 4 && method === 'POST') return addMember(request, env, auth)
    if (parts.length === 5 && method === 'DELETE') {
      return removeMember(env, auth, decodeURIComponent(parts[4]))
    }
  }

  if (parts[3] === 'expenses') {
    if (parts.length === 4 && method === 'POST') return addExpense(request, env, auth)
    const expenseId = parts[4] ? decodeURIComponent(parts[4]) : ''
    if (expenseId && parts.length === 5) {
      if (method === 'PATCH') return updateExpense(request, env, auth, expenseId)
      if (method === 'DELETE') return deleteExpense(env, auth, expenseId)
    }
    if (expenseId && parts[5] === 'ack' && method === 'POST') {
      return ackExpense(request, env, auth, expenseId)
    }
    if (expenseId && parts[5] === 'resolve' && method === 'POST') {
      return resolveDispute(request, env, auth, expenseId)
    }
  }

  if (parts[3] === 'settlements') {
    if (parts.length === 4 && method === 'POST') return addSettlement(request, env, auth)
    const settlementId = parts[4] ? decodeURIComponent(parts[4]) : ''
    if (settlementId && parts[5] === 'confirm' && method === 'POST') {
      return confirmSettlement(request, env, auth, settlementId)
    }
  }

  return json({ error: 'Not found.' }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) {
      if (env.ASSETS) return env.ASSETS.fetch(request)
      return new Response('Not found', { status: 404 })
    }
    try {
      await ensureSchema(env)
      return await route(request, env, url)
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status)
      console.error('rupeesplit api error', error)
      return json({ error: 'Something went wrong on the server. Try again.' }, 500)
    }
  },
}
