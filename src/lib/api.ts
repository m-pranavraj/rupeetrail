/**
 * Client for the group API. Every call is same-origin and carries the device's
 * member token in a header, so the browser never exposes it in a URL.
 */
import type { Expense, Group, GroupStatus, PayerShare, Settlement, Split } from '../types'

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

export interface InvitePreview {
  id: string
  code: string
  name: string
  emoji: string
  memberCount: number
  status: GroupStatus
  closed: boolean
}

export interface Ticket {
  ticket: string
  expiresAt: number
  websocketUrl: string
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export interface Credentials {
  memberId: string
  token: string
}

interface CallOptions {
  method?: string
  body?: unknown
  auth?: Credentials
}

const USER_TOKEN_KEY = 'rupeetrail.user.v1'

/** The signed-in account token, if this device has one. */
export function readUserToken(): string | null {
  try {
    return localStorage.getItem(USER_TOKEN_KEY)
  } catch {
    return null
  }
}

function writeUserToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(USER_TOKEN_KEY, token)
    else localStorage.removeItem(USER_TOKEN_KEY)
  } catch {
    // ignore storage failures
  }
}

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.auth) {
    headers['x-rt-member'] = options.auth.memberId
    headers['x-rt-token'] = options.auth.token
  }
  const userToken = readUserToken()
  if (userToken) headers['x-rt-user'] = userToken

  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch {
    throw new ApiError("Can't reach RupeeTrail right now. Check your connection and try again.", 0)
  }

  const payload = (await response.json().catch(() => null)) as { error?: string } | null
  if (!response.ok) {
    throw new ApiError(payload?.error ?? 'Something went wrong. Try again.', response.status)
  }
  return payload as T
}

/* -------------------------------------------------------------- accounts */

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

/** Create the account for a mobile number. The number must be unused. */
export async function registerAccount(input: {
  name: string
  upiId?: string
  phone: string
  pin: string
}): Promise<AuthSession> {
  const session = await call<AuthSession>('/api/auth/register', { method: 'POST', body: input })
  writeUserToken(session.token)
  return session
}

/** Sign back in with the mobile number and PIN. Returns every group it owns. */
export async function loginAccount(input: { phone: string; pin: string }): Promise<AuthSession> {
  const session = await call<AuthSession>('/api/auth/login', { method: 'POST', body: input })
  writeUserToken(session.token)
  return session
}

/** Revoke this device's account token. */
export async function logoutAccount(): Promise<void> {
  try {
    await call<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })
  } finally {
    writeUserToken(null)
  }
}

export function createGroup(input: {
  name: string
  emoji: string
  memberName: string
  upiId: string
}): Promise<Authored> {
  return call<Authored>('/api/groups', { method: 'POST', body: input })
}

export function joinGroup(input: {
  code: string
  memberName: string
  upiId: string
}): Promise<Authored> {
  return call<Authored>('/api/groups/join', { method: 'POST', body: input })
}

export function invitePreview(code: string): Promise<InvitePreview> {
  return call<InvitePreview>(`/api/invite/${encodeURIComponent(code)}`)
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

/** Add someone to the group by name, before they have the app. */
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

/** Remove a manually added member that has no money attached. */
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

export function patchMe(
  groupId: string,
  auth: Credentials,
  patch: { name?: string; upiId?: string },
): Promise<GroupSnapshot> {
  return call<GroupSnapshot>(`/api/groups/${encodeURIComponent(groupId)}/me`, {
    method: 'PATCH',
    auth,
    body: patch,
  })
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

export function updateExpense(
  groupId: string,
  auth: Credentials,
  expenseId: string,
  input: ExpenseInput,
): Promise<GroupSnapshot> {
  return call(`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`, {
    method: 'PATCH',
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

export function resolveDispute(
  groupId: string,
  auth: Credentials,
  expenseId: string,
  resolution: string,
): Promise<GroupSnapshot> {
  return call(`/api/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}/resolve`, {
    method: 'POST',
    auth,
    body: { resolution },
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
