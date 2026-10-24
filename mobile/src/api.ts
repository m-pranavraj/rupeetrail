/**
 * HTTP client for the RupeeTrail API.
 *
 * Every call is absolute (the app has no same-origin server), and account /
 * membership tokens travel in headers so they never appear in a URL.
 */
import { API_BASE } from './config'
import type { Expense, Group, GroupStatus, PayerShare, Settlement, Split } from './lib/types'

export interface GroupSnapshot {
  group: Group
  expenses: Expense[]
  settlements: Settlement[]
  revision: number
  code: string
  me: { id: string; name: string; upiId?: string; color: number }
}

export interface Authored extends GroupSnapshot {
  token: string
}

export interface AuthMembership {
  groupId: string
  memberId: string
  token: string
  groupName: string
  emoji: string
  name: string
  upiId: string
  joinedAt: number
}

export interface AuthUser {
  id: string
  name: string
  upiId: string
  phone: string
}

export interface AuthSession {
  token: string
  user: AuthUser
  memberships: AuthMembership[]
}

export interface Credentials {
  memberId: string
  token: string
}

export interface Ticket {
  ticket: string
  expiresAt: number
  websocketUrl: string
}

export interface ReleaseInfo {
  versionCode: number
  versionName: string
  apkUrl: string
  sha256?: string
  sizeBytes?: number
  notes?: string
  mandatory: boolean
  minSupportedCode: number
}

export interface ReleaseResponse {
  latest: ReleaseInfo | null
  updateRequired: boolean
  minSupportedCode: number
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

interface CallOptions {
  method?: string
  body?: unknown
  auth?: Credentials
  userToken?: string | null
  timeoutMs?: number
}

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.auth) {
    headers['x-rt-member'] = options.auth.memberId
    headers['x-rt-token'] = options.auth.token
  }
  if (options.userToken) headers['x-rt-user'] = options.userToken

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    })
  } catch {
    throw new ApiError(
      controller.signal.aborted
        ? 'The server took too long to answer. Check your connection and try again.'
        : "Can't reach RupeeTrail right now. Check your connection and try again.",
      0,
    )
  } finally {
    clearTimeout(timer)
  }

  const payload = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) {
    throw new ApiError(payload?.error ?? 'Something went wrong. Try again.', response.status)
  }
  return payload as T
}

/* -------------------------------------------------------------- accounts */

export function registerAccount(input: {
  name: string
  upiId?: string
  phone: string
  pin: string
}): Promise<AuthSession> {
  return call<AuthSession>('/api/auth/register', { method: 'POST', body: input })
}

export function loginAccount(input: { phone: string; pin: string }): Promise<AuthSession> {
  return call<AuthSession>('/api/auth/login', { method: 'POST', body: input })
}

export function logoutAccount(token: string): Promise<{ ok: boolean }> {
  return call<{ ok: boolean }>('/api/auth/logout', { method: 'POST', userToken: token })
}

/* ---------------------------------------------------------------- groups */

export function createGroup(
  token: string,
  input: { name: string; emoji: string; memberName: string; upiId: string },
): Promise<Authored> {
  return call<Authored>('/api/groups', { method: 'POST', userToken: token, body: input })
}

export function joinGroup(
  token: string,
  input: { code: string; memberName: string; upiId: string },
): Promise<Authored> {
  return call<Authored>('/api/groups/join', { method: 'POST', userToken: token, body: input })
}

export function fetchGroup(groupId: string, auth: Credentials): Promise<GroupSnapshot> {
  return call<GroupSnapshot>(`/api/groups/${encodeURIComponent(groupId)}`, { auth })
}

export function patchGroup(
  groupId: string,
  auth: Credentials,
  patch: { name?: string; emoji?: string; status?: GroupStatus },
): Promise<GroupSnapshot> {
  return call<GroupSnapshot>(`/api/groups/${encodeURIComponent(groupId)}`, {
    method: 'PATCH',
    auth,
    body: patch,
  })
}

export function addMember(
  groupId: string,
  auth: Credentials,
  input: { name: string; upiId?: string },
): Promise<GroupSnapshot> {
  return call<GroupSnapshot>(`/api/groups/${encodeURIComponent(groupId)}/members`, {
    method: 'POST',
    auth,
    body: input,
  })
}

export function removeMember(
  groupId: string,
  auth: Credentials,
  memberId: string,
): Promise<GroupSnapshot> {
  return call<GroupSnapshot>(
    `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
    { method: 'DELETE', auth },
  )
}

export interface ExpenseInput {
  description: string
  amountPaise: number
  date: number
  category: Expense['category']
  payers: PayerShare[]
  split: Split
  notes?: string
}

export function addExpense(
  groupId: string,
  auth: Credentials,
  input: ExpenseInput,
): Promise<GroupSnapshot & { expenseId: string }> {
  return call(`/api/groups/${encodeURIComponent(groupId)}/expenses`, {
    method: 'POST',
    auth,
    body: input,
  })
}

export function deleteExpense(
  groupId: string,
  auth: Credentials,
  expenseId: string,
): Promise<GroupSnapshot> {
  return call(`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`, {
    method: 'DELETE',
    auth,
  })
}

export function ackExpense(
  groupId: string,
  auth: Credentials,
  expenseId: string,
  status: 'acknowledged' | 'questioned',
  reason?: string,
): Promise<GroupSnapshot> {
  return call(`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/ack`, {
    method: 'POST',
    auth,
    body: { status, reason },
  })
}

export function addSettlement(
  groupId: string,
  auth: Credentials,
  input: { from: string; to: string; amountPaise: number; method: Settlement['method']; note?: string },
): Promise<GroupSnapshot> {
  return call(`/api/groups/${encodeURIComponent(groupId)}/settlements`, {
    method: 'POST',
    auth,
    body: input,
  })
}

export function confirmSettlement(
  groupId: string,
  auth: Credentials,
  settlementId: string,
  action: 'paid' | 'received' | 'dispute',
): Promise<GroupSnapshot> {
  return call(
    `/api/groups/${encodeURIComponent(groupId)}/settlements/${encodeURIComponent(settlementId)}/confirm`,
    { method: 'POST', auth, body: { action } },
  )
}

export function realtimeTicket(auth: Credentials, room: string): Promise<Ticket> {
  return call<Ticket>('/api/realtime/ticket', { method: 'POST', auth, body: { room } })
}

/* --------------------------------------------------------------- releases */

export function fetchRelease(platform: string, channel: string, currentCode: number): Promise<ReleaseResponse> {
  return call<ReleaseResponse>(
    `/api/app/releases?platform=${encodeURIComponent(platform)}&channel=${encodeURIComponent(channel)}&currentCode=${currentCode}`,
    { timeoutMs: 8_000 },
  )
}
