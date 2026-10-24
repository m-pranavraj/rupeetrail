/** Supabase data layer — a drop-in alternative to the Worker API.
 *
 * Every function takes the device's member token; the client sends it as
 * `x-rt-token` and Postgres policies (supabase/migrations/0001_init.sql) decide
 * what that membership may read or write.
 */
import { getSupabase } from './supabase'
import type {
  Expense,
  Group,
  GroupStatus,
  Member,
  PayerShare,
  Settlement,
  SettlementStatus,
  Split,
} from '../types'
import type { Authored, ExpenseInput, GroupSnapshot, InvitePreview } from './api'

type Row = Record<string, unknown>

const iso = (value: unknown): number =>
  typeof value === 'string' ? Date.parse(value) : Number(value ?? Date.now())

const isoOrUndefined = (value: unknown): number | undefined =>
  typeof value === 'string' || typeof value === 'number' ? iso(value) : undefined

function mapMember(row: Row): Member {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    upiId: row.upi_id ? String(row.upi_id) : undefined,
    color: Number(row.color ?? 0),
    joinedAt: iso(row.joined_at),
    leftAt: isoOrUndefined(row.left_at),
  }
}

function mapGroup(row: Row, members: Member[]): Group {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    emoji: String(row.emoji ?? '🏖️'),
    status: (row.status as GroupStatus) ?? 'active',
    createdAt: iso(row.created_at),
    closedAt: isoOrUndefined(row.closed_at),
    members,
    currency: 'INR',
  }
}

function mapExpense(row: Row): Expense {
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    description: String(row.description ?? ''),
    amountPaise: Number(row.amount_paise ?? 0),
    date: iso(row.date),
    category: (row.category as Expense['category']) ?? 'other',
    payers: (row.payers as PayerShare[]) ?? [],
    split: (row.split as Split) ?? { mode: 'equal', participants: [] },
    notes: row.notes ? String(row.notes) : undefined,
    createdBy: String(row.created_by ?? ''),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deletedAt: isoOrUndefined(row.deleted_at),
    acks: (row.acks as Expense['acks']) ?? {},
    revision: Number(row.revision ?? 1),
  }
}

function mapSettlement(row: Row): Settlement {
  return {
    id: String(row.id),
    groupId: String(row.group_id),
    from: String(row.from_member_id),
    to: String(row.to_member_id),
    amountPaise: Number(row.amount_paise ?? 0),
    method: (row.method as Settlement['method']) ?? 'upi',
    status: (row.status as SettlementStatus) ?? 'pending',
    note: row.note ? String(row.note) : undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    payerConfirmedAt: isoOrUndefined(row.payer_confirmed_at),
    receiverConfirmedAt: isoOrUndefined(row.receiver_confirmed_at),
  }
}

function fail(error: { message?: string } | null): never {
  throw new Error(error?.message ?? 'Supabase request failed.')
}

// ------------------------------------------------------------- RPC responses

interface JoinResultRow {
  group_id: string
  member_id: string
  token: string
  code: string
}

async function snapshotFromRpc(result: JoinResultRow): Promise<Authored> {
  const snapshot = await fetchGroupSnapshot(result.group_id, result.token, result.member_id)
  return { ...snapshot, token: result.token }
}

// ------------------------------------------------------------- Groups

export async function createGroup(input: {
  name: string
  emoji: string
  memberName: string
  upiId?: string
}): Promise<Authored> {
  const { data, error } = await getSupabase().rpc('create_group', {
    p_name: input.name,
    p_emoji: input.emoji,
    p_member_name: input.memberName,
    p_upi_id: input.upiId ?? null,
  })
  if (error) fail(error)
  return snapshotFromRpc(data as JoinResultRow)
}

export async function joinGroup(input: {
  code: string
  memberName: string
  upiId?: string
}): Promise<Authored> {
  const { data, error } = await getSupabase().rpc('join_group', {
    p_code: input.code.trim().toUpperCase(),
    p_member_name: input.memberName,
    p_upi_id: input.upiId ?? null,
  })
  if (error) fail(error)
  return snapshotFromRpc(data as JoinResultRow)
}

export async function invitePreview(code: string): Promise<InvitePreview> {
  const { data, error } = await getSupabase().rpc('invite_preview', {
    p_code: code.trim().toUpperCase(),
  })
  if (error) fail(error)
  const row = data as Row
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    emoji: String(row.emoji ?? '🏖️'),
    memberCount: Number(row.member_count ?? 0),
    status: (row.status as GroupStatus) ?? 'active',
    closed: row.status === 'closed',
  }
}

export async function fetchGroupSnapshot(
  groupId: string,
  token: string,
  memberId?: string,
): Promise<GroupSnapshot> {
  const db = getSupabase(token)

  const [groupRes, memberRes, expenseRes, settlementRes] = await Promise.all([
    db.from('groups').select('*').eq('id', groupId).single(),
    db
      .from('group_members')
      .select('id, group_id, name, upi_id, color, joined_at, left_at')
      .eq('group_id', groupId),
    db.from('expenses').select('*').eq('group_id', groupId).is('deleted_at', null),
    db.from('settlements').select('*').eq('group_id', groupId),
  ])

  if (groupRes.error) fail(groupRes.error)
  if (memberRes.error) fail(memberRes.error)
  if (expenseRes.error) fail(expenseRes.error)
  if (settlementRes.error) fail(settlementRes.error)

  const members = (memberRes.data ?? []).map((row) => mapMember(row as Row))
  const me = members.find((m) => m.id === memberId) ?? members[members.length - 1]

  return {
    group: mapGroup(groupRes.data as Row, members),
    expenses: (expenseRes.data ?? []).map((row) => mapExpense(row as Row)),
    settlements: (settlementRes.data ?? []).map((row) => mapSettlement(row as Row)),
    revision: Number((groupRes.data as Row).revision ?? 1),
    code: String((groupRes.data as Row).code ?? ''),
    me: {
      id: me?.id ?? '',
      name: me?.name ?? '',
      upiId: me?.upiId,
      color: me?.color ?? 0,
    },
  }
}

export async function updateGroupMeta(
  groupId: string,
  token: string,
  patch: { name?: string; emoji?: string; status?: GroupStatus },
): Promise<void> {
  const db = getSupabase(token)
  const row: Row = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.emoji !== undefined) row.emoji = patch.emoji
  if (patch.status !== undefined) row.status = patch.status

  const { error } = await db.from('groups').update(row).eq('id', groupId)
  if (error) fail(error)
  const { error: touchError } = await db.rpc('touch_group', { p_group_id: groupId })
  if (touchError) fail(touchError)
}

export async function updateMemberProfile(
  memberId: string,
  token: string,
  patch: { name?: string; upiId?: string },
): Promise<void> {
  const db = getSupabase(token)
  const row: Row = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.upiId !== undefined) row.upi_id = patch.upiId
  const { error } = await db.from('group_members').update(row).eq('id', memberId)
  if (error) fail(error)
}

// ------------------------------------------------------------- Expenses

export async function addExpense(
  groupId: string,
  token: string,
  input: ExpenseInput,
): Promise<string> {
  const db = getSupabase(token)
  const { data, error } = await db
    .from('expenses')
    .insert({
      group_id: groupId,
      description: input.description,
      amount_paise: input.amountPaise,
      date: new Date(input.date).toISOString(),
      category: input.category,
      payers: input.payers,
      split: input.split,
      notes: input.notes ?? null,
      acks: {},
    })
    .select('id')
    .single()
  if (error) fail(error)
  return String((data as Row).id)
}

export async function updateExpense(
  expenseId: string,
  token: string,
  input: ExpenseInput,
): Promise<void> {
  const db = getSupabase(token)
  const { error } = await db
    .from('expenses')
    .update({
      description: input.description,
      amount_paise: input.amountPaise,
      date: new Date(input.date).toISOString(),
      category: input.category,
      payers: input.payers,
      split: input.split,
      notes: input.notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', expenseId)
  if (error) fail(error)
}

export async function deleteExpense(expenseId: string, token: string): Promise<void> {
  const db = getSupabase(token)
  const { error } = await db
    .from('expenses')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', expenseId)
  if (error) fail(error)
}

export async function acknowledgeExpense(
  expenseId: string,
  token: string,
  memberId: string,
  status: 'pending' | 'acknowledged' | 'questioned',
): Promise<void> {
  const db = getSupabase(token)
  const { data, error } = await db.from('expenses').select('acks').eq('id', expenseId).single()
  if (error) fail(error)
  const acks = { ...((data as Row).acks as Record<string, string> | null ?? {}) }
  acks[memberId] = status
  const { error: writeError } = await db.from('expenses').update({ acks }).eq('id', expenseId)
  if (writeError) fail(writeError)
}

// ------------------------------------------------------------- Settlements

export async function addSettlement(
  groupId: string,
  token: string,
  input: {
    from: string
    to: string
    amountPaise: number
    method: Settlement['method']
    note?: string
  },
): Promise<string> {
  const db = getSupabase(token)
  const { data, error } = await db
    .from('settlements')
    .insert({
      group_id: groupId,
      from_member_id: input.from,
      to_member_id: input.to,
      amount_paise: input.amountPaise,
      method: input.method,
      note: input.note ?? null,
      status: 'pending',
    })
    .select('id')
    .single()
  if (error) fail(error)
  return String((data as Row).id)
}

export async function confirmSettlement(
  settlementId: string,
  token: string,
  action: 'paid' | 'received' | 'dispute',
): Promise<void> {
  const db = getSupabase(token)
  const { error } = await db.rpc('confirm_settlement', {
    p_settlement_id: settlementId,
    p_action: action,
  })
  if (error) fail(error)
}

// ------------------------------------------------------------- Realtime

/**
 * Subscribe to ledger changes for one group. Supabase broadcasts row changes
 * once the tables are added to the realtime publication (see the migration).
 */
export function subscribeToGroup(
  groupId: string,
  token: string,
  onLedgerChange: () => void,
): () => void {
  const db = getSupabase(token)
  const channel = db
    .channel(`group:${groupId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` },
      onLedgerChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'settlements', filter: `group_id=eq.${groupId}` },
      onLedgerChange,
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` },
      onLedgerChange,
    )
    .subscribe()

  return () => {
    void db.removeChannel(channel)
  }
}
