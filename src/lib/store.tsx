import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  AckStatus,
  Expense,
  Group,
  GroupStatus,
  Member,
  MemberId,
  Settlement,
  SettlementStatus,
} from '../types'
import {
  ApiError,
  ackExpense,
  addExpense as apiAddExpense,
  addMember as apiAddMember,
  addSettlement as apiAddSettlement,
  removeMember as apiRemoveMember,
  confirmSettlement as apiConfirmSettlement,
  createGroup as apiCreateGroup,
  deleteExpense as apiDeleteExpense,
  fetchGroup,
  joinGroup as apiJoinGroup,
  loginAccount,
  logoutAccount,
  patchGroup,
  registerAccount,
  type AuthSession,
  patchMe,
  resolveDispute as apiResolveDispute,
  updateExpense as apiUpdateExpense,
  type Credentials,
  type ExpenseInput,
  type GroupSnapshot,
} from './api'
import { computeBalances } from './balances'
import { connectGroup, type LiveStatus } from './realtime'
import {
  pendingExpenseId,
  queueExpense,
  queuedForGroup,
  readOutbox,
  removeQueued,
} from './outbox'
import {
  loadIdentity,
  loadMemberships,
  newIdentityId,
  readCache,
  removeMembership,
  saveIdentity,
  saveMemberships,
  writeCache,
  type Identity,
  type Membership,
} from './session'

export type NewExpenseInput = ExpenseInput

export interface GroupSummary {
  groupId: string
  code: string
  name: string
  emoji: string
  status: GroupStatus
  memberCount: number
  members: Member[]
  /** null when this device has no snapshot yet */
  netPaise: number | null
  hasOpenQuestion: boolean
  hasPendingPayment: boolean
}

interface StoreValue {
  identity: Identity | null
  memberships: Membership[]
  summaries: GroupSummary[]
  active: GroupSnapshot | null
  activeGroupId: string | null
  activeMembership: Membership | null
  loading: boolean
  busy: boolean
  error: string | null
  notice: string | null
  live: LiveStatus
  presence: number

  start: (name: string, upiId: string) => void
  updateIdentity: (name: string, upiId: string) => Promise<void>
  signUp: (input: {
    name: string
    upiId: string
    phone: string
    pin: string
  }) => Promise<void>
  signIn: (input: { phone: string; pin: string }) => Promise<void>
  signOut: () => Promise<void>
  createGroup: (name: string, emoji: string) => Promise<string>
  joinGroup: (code: string) => Promise<string>
  openGroup: (groupId: string) => Promise<void>
  closeGroup: () => void
  refresh: () => Promise<void>
  fetchGroupSummaries: () => Promise<void>
  leaveGroup: (groupId: string) => void
  dismiss: () => void
  notify: (message: string | null) => void

  addMember: (groupId: string, name: string, upiId: string) => Promise<boolean>
  removeMember: (groupId: string, memberId: string) => Promise<boolean>
  addExpense: (groupId: string, input: NewExpenseInput) => Promise<boolean>
  updateExpense: (groupId: string, expenseId: string, input: NewExpenseInput) => Promise<boolean>
  deleteExpense: (groupId: string, expenseId: string) => void
  setAck: (groupId: string, expenseId: string, memberId: MemberId, status: AckStatus) => void
  raiseDispute: (groupId: string, expenseId: string, memberId: MemberId, reason: string) => void
  resolveDispute: (groupId: string, expenseId: string, resolution: string) => void
  recordSettlement: (
    groupId: string,
    from: MemberId,
    to: MemberId,
    amountPaise: number,
    method: Settlement['method'],
    note?: string,
  ) => Promise<boolean>
  advanceSettlement: (settlementId: string, memberId: MemberId, target: SettlementStatus) => void
  renameGroup: (groupId: string, name: string, emoji: string) => Promise<boolean>
  setGroupStatus: (groupId: string, status: GroupStatus) => Promise<boolean>
}

const StoreContext = createContext<StoreValue | null>(null)

function credentialsOf(membership: Membership): Credentials {
  return { memberId: membership.memberId, token: membership.token }
}

/** Render queued expenses as ordinary rows so nothing ever disappears offline. */
function pendingExpensesFor(groupId: string, membership: Membership): Expense[] {
  return queuedForGroup(groupId).map((queued) => ({
    id: pendingExpenseId(queued.id),
    groupId,
    description: queued.input.description,
    amountPaise: queued.input.amountPaise,
    date: queued.input.date,
    category: queued.input.category,
    payers: queued.input.payers,
    split: queued.input.split,
    notes: queued.input.notes,
    createdBy: membership.memberId,
    createdAt: queued.queuedAt,
    updatedAt: queued.queuedAt,
    acks: { [membership.memberId]: 'acknowledged' as AckStatus },
    revision: 0,
    pendingSync: true,
  }))
}

function withPending(snapshot: GroupSnapshot, membership: Membership): GroupSnapshot {
  const pending = pendingExpensesFor(snapshot.group.id, membership)
  if (pending.length === 0) return snapshot
  const known = new Set(snapshot.expenses.map((expense) => expense.id))
  const fresh = pending.filter((expense) => !known.has(expense.id))
  if (fresh.length === 0) return snapshot
  return { ...snapshot, expenses: [...snapshot.expenses, ...fresh] }
}

function summaryFrom(membership: Membership, snapshot: GroupSnapshot): GroupSummary {
  const { group, expenses, settlements } = snapshot
  const balances = computeBalances({ group, expenses, settlements })
  const mine = balances.find((b) => b.memberId === membership.memberId)
  const live = expenses.filter((e) => !e.deletedAt)
  return {
    groupId: group.id,
    code: snapshot.code,
    name: group.name,
    emoji: group.emoji,
    status: group.status,
    memberCount: group.members.filter((m) => !m.leftAt).length,
    members: group.members.filter((m) => !m.leftAt),
    netPaise: mine?.netPaise ?? 0,
    hasOpenQuestion: live.some((e) => e.dispute?.status === 'open'),
    hasPendingPayment: settlements.some((s) => s.status !== 'confirmed' && s.status !== 'disputed'),
  }
}

function summaryFromCache(membership: Membership): GroupSummary {
  const cached = readCache(membership.groupId)
  if (cached) return summaryFrom(membership, cached)
  return {
    groupId: membership.groupId,
    code: '',
    name: membership.groupName,
    emoji: membership.emoji || '🧾',
    status: 'active',
    memberCount: 1,
    members: [{ id: membership.memberId, name: membership.name, color: 0, joinedAt: membership.joinedAt }],
    netPaise: null,
    hasOpenQuestion: false,
    hasPendingPayment: false,
  }
}

function summariseAll(memberships: Membership[]): GroupSummary[] {
  return memberships.map(summaryFromCache)
}

export function LedgerProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity())
  const [memberships, setMemberships] = useState<Membership[]>(() => loadMemberships())
  const [summaries, setSummaries] = useState<GroupSummary[]>(() => summariseAll(loadMemberships()))
  const [active, setActive] = useState<GroupSnapshot | null>(null)
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [live, setLive] = useState<LiveStatus>('offline')
  const [presence, setPresence] = useState(0)

  const activeIdRef = useRef<string | null>(null)
  const membershipsRef = useRef<Membership[]>(memberships)
  membershipsRef.current = memberships
  const identityRef = useRef<Identity | null>(identity)
  identityRef.current = identity
  const activeRef = useRef<GroupSnapshot | null>(active)
  activeRef.current = active
  const refreshInFlight = useRef<Promise<void> | null>(null)

  const applySnapshot = useCallback((membership: Membership, incoming: GroupSnapshot) => {
    const snapshot = withPending(incoming, membership)
    writeCache(snapshot)
    setSummaries((prev) => {
      const next = summaryFrom(membership, snapshot)
      const found = prev.some((s) => s.groupId === next.groupId)
      return found ? prev.map((s) => (s.groupId === next.groupId ? next : s)) : [...prev, next]
    })
    if (activeIdRef.current === snapshot.group.id) setActive(snapshot)
  }, [])

  const fail = useCallback((cause: unknown) => {
    const message =
      cause instanceof ApiError ? cause.message : 'Something went wrong. Try again in a moment.'
    setError(message)
    if (cause instanceof ApiError && cause.status === 401) {
      const currentId = activeIdRef.current
      if (currentId) {
        const next = removeMembership(currentId)
        setMemberships(next)
        setSummaries((prev) => prev.filter((s) => s.groupId !== currentId))
        activeIdRef.current = null
        setActiveGroupId(null)
        setActive(null)
      }
    }
  }, [])

  const loadGroup = useCallback(
    async (membership: Membership): Promise<GroupSnapshot | null> => {
      try {
        const snapshot = await fetchGroup(membership.groupId, credentialsOf(membership))
        applySnapshot(membership, snapshot)
        return snapshot
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) {
          const next = removeMembership(membership.groupId)
          setMemberships(next)
          setSummaries((prev) => prev.filter((s) => s.groupId !== membership.groupId))
          setError('That group no longer exists.')
          return null
        }
        fail(cause)
        return null
      }
    },
    [applySnapshot, fail],
  )

  /* Hydrate every group on this device once, so home-screen totals are real. */
  useEffect(() => {
    let cancelled = false
    const list = loadMemberships()
    if (list.length === 0) return
      ; (async () => {
        for (const membership of list) {
          if (cancelled) return
          try {
            const snapshot = await fetchGroup(membership.groupId, credentialsOf(membership))
            if (cancelled) return
            writeCache(snapshot)
            setSummaries((prev) => {
              const next = summaryFrom(membership, snapshot)
              return prev.some((s) => s.groupId === next.groupId)
                ? prev.map((s) => (s.groupId === next.groupId ? next : s))
                : [...prev, next]
            })
          } catch {
            // Keep the cached summary; the group screen reports the real error.
          }
        }
      })()
    return () => {
      cancelled = true
    }
    // Only on mount: memberships gained later are applied directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openGroup = useCallback(
    async (groupId: string) => {
      const membership = membershipsRef.current.find((m) => m.groupId === groupId)
      if (!membership) {
        setError('This device is not part of that group. Open the invite link again.')
        return
      }
      activeIdRef.current = groupId
      setActiveGroupId(groupId)
      const cached = readCache(groupId)
      setActive(cached && cached.group.id === groupId ? cached : null)
      setLoading(!cached)
      setError(null)
      await loadGroup(membership)
      setLoading(false)
    },
    [loadGroup],
  )

  const closeGroup = useCallback(() => {
    activeIdRef.current = null
    setActiveGroupId(null)
    setActive(null)
    setLive('offline')
    setPresence(0)
  }, [])

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return refreshInFlight.current
    const membership = membershipsRef.current.find((m) => m.groupId === activeIdRef.current)
    if (!membership) return
    const request = loadGroup(membership).then(() => undefined)
    refreshInFlight.current = request
    try {
      await request
    } finally {
      if (refreshInFlight.current === request) refreshInFlight.current = null
    }
  }, [loadGroup])

  /**
   * Refresh the active group's summaries by fetching the latest snapshot from the server.
   Useful after recording a settlement or adding/removing members/expenses.
   */
  const fetchGroupSummaries = useCallback(async () => {
    const membership = membershipsRef.current.find((m) => m.groupId === activeIdRef.current)
    if (membership) await loadGroup(membership)
  }, [loadGroup])

  /* Live sync for the open group, with polling as a dependable fallback. */
  useEffect(() => {
    if (!activeGroupId) return
    const membership = memberships.find((m) => m.groupId === activeGroupId)
    if (!membership) return
    const connection = connectGroup({
      groupId: activeGroupId,
      credentials: credentialsOf(membership),
      onLedger: () => {
        void refresh()
      },
      onStatus: setLive,
      onPresence: setPresence,
    })
    return () => connection.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupId, memberships.find((m) => m.groupId === activeGroupId)?.token, refresh])

  useEffect(() => {
    if (!activeGroupId || live === 'live') return
    // Only refresh on visibility/focus events when the WebSocket is not live.
    // This avoids hammering the server with periodic polls.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [activeGroupId, live, refresh])

  /* Push expenses saved while offline as soon as the connection returns. */
  const flushing = useRef(false)
  const flushOutbox = useCallback(async () => {
    if (flushing.current) return
    const queued = readOutbox()
    if (queued.length === 0) return

    flushing.current = true
    let sent = 0
    try {
      for (const item of queued) {
        const membership = membershipsRef.current.find((m) => m.groupId === item.groupId)
        if (!membership) {
          removeQueued(item.id)
          continue
        }
        try {
          await apiAddExpense(item.groupId, credentialsOf(membership), item.input)
          removeQueued(item.id)
          sent += 1
        } catch (cause) {
          // Still offline: keep the queue intact and try again next time.
          if (cause instanceof ApiError && cause.status === 0) break
          removeQueued(item.id)
          setError(
            cause instanceof ApiError ? cause.message : 'A queued expense could not be saved.',
          )
        }
      }
    } finally {
      flushing.current = false
    }

    if (sent > 0) {
      setNotice(`${sent} queued expense${sent === 1 ? '' : 's'} synced.`)
      const activeGroup = activeIdRef.current
      const membership = membershipsRef.current.find((m) => m.groupId === activeGroup)
      if (membership) await loadGroup(membership)
    }
  }, [loadGroup])

  useEffect(() => {
    void flushOutbox()
    const onOnline = () => void flushOutbox()
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
    }
  }, [flushOutbox])

  /* Keep summaries fresh even when no group is open. */
  useEffect(() => {
    const onFocus = () => {
      if (activeIdRef.current) return
      for (const membership of membershipsRef.current) {
        void fetchGroup(membership.groupId, credentialsOf(membership))
          .then((snapshot) => {
            writeCache(snapshot)
            setSummaries((prev) =>
              prev.map((s) =>
                s.groupId === snapshot.group.id ? summaryFrom(membership, snapshot) : s,
              ),
            )
          })
          .catch(() => { })
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const start = useCallback((name: string, upiId: string) => {
    const next: Identity = {
      id: identityRef.current?.id ?? newIdentityId(),
      name: name.trim(),
      upiId: upiId.trim(),
    }
    saveIdentity(next)
    // Update the ref immediately: an invite link joins in the same handler that
    // saves the identity, before React has re-rendered.
    identityRef.current = next
    setIdentity(next)
  }, [])

  const updateIdentity = useCallback(async (name: string, upiId: string) => {
    const next: Identity = {
      id: identityRef.current?.id ?? newIdentityId(),
      name: name.trim(),
      upiId: upiId.trim(),
    }
    saveIdentity(next)
    identityRef.current = next
    setIdentity(next)
    const list = membershipsRef.current.map((m) => ({ ...m, name: next.name, upiId: next.upiId }))
    setMemberships(list)
    saveMemberships(list)
    for (const membership of list) {
      try {
        const snapshot = await patchMe(membership.groupId, credentialsOf(membership), next)
        applySnapshot(membership, snapshot)
      } catch {
        // Offline edits still apply locally; the next successful call syncs.
      }
    }
  }, [applySnapshot])

  const applyAuth = useCallback((session: AuthSession) => {
    const nextIdentity: Identity = {
      id: identityRef.current?.id ?? newIdentityId(),
      name: session.user.name,
      upiId: session.user.upiId ?? '',
      phone: session.user.phone,
    }
    saveIdentity(nextIdentity)
    identityRef.current = nextIdentity
    setIdentity(nextIdentity)

    const nextMemberships: Membership[] = session.memberships.map((membership) => ({
      groupId: membership.groupId,
      memberId: membership.memberId,
      token: membership.token,
      groupName: membership.groupName,
      emoji: membership.emoji,
      name: membership.name,
      upiId: membership.upiId,
      joinedAt: membership.joinedAt,
    }))
    saveMemberships(nextMemberships)
    membershipsRef.current = nextMemberships
    setMemberships(nextMemberships)
    setSummaries(summariseAll(nextMemberships))
  }, [])

  const signUp = useCallback(
    async (input: { name: string; upiId: string; phone: string; pin: string }) => {
      setBusy(true)
      try {
        applyAuth(await registerAccount(input))
      } finally {
        setBusy(false)
      }
    },
    [applyAuth],
  )

  const signIn = useCallback(
    async (input: { phone: string; pin: string }) => {
      setBusy(true)
      try {
        applyAuth(await loginAccount(input))
      } finally {
        setBusy(false)
      }
    },
    [applyAuth],
  )

  const signOut = useCallback(async () => {
    try {
      await logoutAccount()
    } catch {
      // Signing out must work offline too; the local session is cleared below.
    }
    saveIdentity(null)
    identityRef.current = null
    setIdentity(null)
    saveMemberships([])
    membershipsRef.current = []
    setMemberships([])
    setSummaries([])
    activeIdRef.current = null
    setActiveGroupId(null)
    setActive(null)
  }, [])

  const rememberGroup = useCallback(
    (snapshot: GroupSnapshot, token: string): Membership => {
      const membership: Membership = {
        groupId: snapshot.group.id,
        memberId: snapshot.me.id,
        token,
        groupName: snapshot.group.name,
        emoji: snapshot.group.emoji,
        name: snapshot.me.name,
        upiId: snapshot.me.upiId ?? '',
        joinedAt: Date.now(),
      }
      const next = [
        ...membershipsRef.current.filter((m) => m.groupId !== membership.groupId),
        membership,
      ]
      saveMemberships(next)
      setMemberships(next)
      membershipsRef.current = next
      writeCache(snapshot)
      setSummaries((prev) => {
        const summary = summaryFrom(membership, snapshot)
        return prev.some((s) => s.groupId === summary.groupId)
          ? prev.map((s) => (s.groupId === summary.groupId ? summary : s))
          : [...prev, summary]
      })
      return membership
    },
    [],
  )

  const createGroup = useCallback(
    async (name: string, emoji: string): Promise<string> => {
      const me = identityRef.current
      if (!me) throw new ApiError('Add your name first.', 400)
      try {
        const created = await apiCreateGroup({
          name,
          emoji,
          memberName: me.name,
          upiId: me.upiId,
        })
        const membership = rememberGroup(created, created.token)
        return membership.groupId
      } catch (cause) {
        fail(cause)
        throw cause
      }
    },
    [fail, rememberGroup],
  )

  const joinGroup = useCallback(
    async (code: string): Promise<string> => {
      const me = identityRef.current
      if (!me) throw new ApiError('Add your name first.', 400)
      try {
        const joined = await apiJoinGroup({ code, memberName: me.name, upiId: me.upiId })
        const membership = rememberGroup(joined, joined.token)
        return membership.groupId
      } catch (cause) {
        fail(cause)
        throw cause
      }
    },
    [fail, rememberGroup],
  )

  const leaveGroup = useCallback(
    (groupId: string) => {
      const next = removeMembership(groupId)
      setMemberships(next)
      membershipsRef.current = next
      setSummaries((prev) => prev.filter((s) => s.groupId !== groupId))
      if (activeIdRef.current === groupId) {
        activeIdRef.current = null
        setActiveGroupId(null)
        setActive(null)
      }
    },
    [],
  )

  const withGroup = useCallback(
    async (
      groupId: string,
      run: (auth: Credentials) => Promise<GroupSnapshot>,
    ): Promise<boolean> => {
      const membership = membershipsRef.current.find((m) => m.groupId === groupId)
      if (!membership) {
        setError('This device is not part of that group.')
        return false
      }
      setBusy(true)
      try {
        const snapshot = await run(credentialsOf(membership))
        applySnapshot(membership, snapshot)
        return true
      } catch (cause) {
        fail(cause)
        return false
      } finally {
        setBusy(false)
      }
    },
    [applySnapshot, fail],
  )

  const addExpense = useCallback(
    async (groupId: string, input: NewExpenseInput): Promise<boolean> => {
      const membership = membershipsRef.current.find((m) => m.groupId === groupId)
      if (!membership) {
        setError('This device is not part of that group.')
        return false
      }
      setBusy(true)
      try {
        const snapshot = await apiAddExpense(groupId, credentialsOf(membership), input)
        applySnapshot(membership, snapshot)
        return true
      } catch (cause) {
        // status 0 means the request never reached the server: queue it locally.
        if (cause instanceof ApiError && cause.status === 0) {
          queueExpense(groupId, input)
          const current = activeRef.current
          if (current && current.group.id === groupId) applySnapshot(membership, current)
          setNotice('Saved on this device. It will sync when you are back online.')
          return true
        }
        fail(cause)
        return false
      } finally {
        setBusy(false)
      }
    },
    [applySnapshot, fail],
  )

  const addMember = useCallback(
    (groupId: string, name: string, upiId: string) =>
      withGroup(groupId, (auth) =>
        apiAddMember(groupId, auth, { name, upiId: upiId.trim() || undefined }),
      ),
    [withGroup],
  )

  const removeMember = useCallback(
    (groupId: string, memberId: string) =>
      withGroup(groupId, (auth) => apiRemoveMember(groupId, auth, memberId)),
    [withGroup],
  )

  const updateExpense = useCallback(
    (groupId: string, expenseId: string, input: NewExpenseInput) =>
      withGroup(groupId, (auth) => apiUpdateExpense(groupId, auth, expenseId, input)),
    [withGroup],
  )

  const deleteExpense = useCallback(
    (groupId: string, expenseId: string) => {
      void withGroup(groupId, (auth) => apiDeleteExpense(groupId, auth, expenseId))
    },
    [withGroup],
  )

  const setAck = useCallback(
    (groupId: string, expenseId: string, _memberId: MemberId, status: AckStatus) => {
      // There is no way back to "pending" from the API: a confirmation is a
      // one-way record, and an edit resets everyone's acknowledgements.
      if (status !== 'acknowledged') return
      void withGroup(groupId, (auth) => ackExpense(groupId, auth, expenseId, status))
    },
    [withGroup],
  )

  const raiseDispute = useCallback(
    (groupId: string, expenseId: string, _memberId: MemberId, reason: string) => {
      void withGroup(groupId, (auth) => ackExpense(groupId, auth, expenseId, 'questioned', reason))
    },
    [withGroup],
  )

  const resolveDispute = useCallback(
    (groupId: string, expenseId: string, resolution: string) => {
      void withGroup(groupId, (auth) => apiResolveDispute(groupId, auth, expenseId, resolution))
    },
    [withGroup],
  )

  const recordSettlement = useCallback(
    (
      groupId: string,
      from: MemberId,
      to: MemberId,
      amountPaise: number,
      method: Settlement['method'],
      note?: string,
    ) =>
      withGroup(groupId, async (auth) => {
        const created = await apiAddSettlement(groupId, auth, { from, to, amountPaise, method, note })
        const membership = membershipsRef.current.find((item) => item.groupId === groupId)
        const action =
          from.startsWith('manual:') && to === membership?.memberId
            ? 'received'
            : to.startsWith('manual:') && from === membership?.memberId
              ? 'paid'
              : null

        if (!action) return created

        // A manually named counterparty cannot confirm from another device.
        // Confirm the side represented by this device immediately so the
        // ledger and payment history agree without a second user action.
        return apiConfirmSettlement(groupId, auth, created.settlementId, action)
      }),
    [withGroup],
  )

  const advanceSettlement = useCallback(
    (settlementId: string, _memberId: MemberId, target: SettlementStatus) => {
      const groupId = activeIdRef.current
      if (!groupId) return
      const action =
        target === 'payer_confirmed'
          ? 'paid'
          : target === 'receiver_confirmed'
            ? 'received'
            : target === 'disputed'
              ? 'dispute'
              : null
      if (!action) return
      void withGroup(groupId, (auth) =>
        apiConfirmSettlement(groupId, auth, settlementId, action),
      )
    },
    [withGroup],
  )

  const renameGroup = useCallback(
    (groupId: string, name: string, emoji: string) =>
      withGroup(groupId, (auth) => patchGroup(groupId, auth, { name, emoji })),
    [withGroup],
  )

  const setGroupStatus = useCallback(
    (groupId: string, status: GroupStatus) =>
      withGroup(groupId, (auth) => patchGroup(groupId, auth, { status })),
    [withGroup],
  )

  const dismiss = useCallback(() => {
    setError(null)
    setNotice(null)
  }, [])

  const activeMembership = useMemo(
    () => memberships.find((m) => m.groupId === activeGroupId) ?? null,
    [memberships, activeGroupId],
  )

  const value: StoreValue = {
    identity,
    memberships,
    summaries,
    active,
    activeGroupId,
    activeMembership,
    loading,
    busy,
    error,
    notice,
    live,
    presence,
    start,
    updateIdentity,
    signUp,
    signIn,
    signOut,
    createGroup,
    joinGroup,
    openGroup,
    closeGroup,
    refresh,
    fetchGroupSummaries,
    leaveGroup,
    dismiss,
    notify: setNotice,
    addMember,
    removeMember,
    addExpense,
    updateExpense,
    deleteExpense,
    setAck,
    raiseDispute,
    resolveDispute,
    recordSettlement,
    advanceSettlement,
    renameGroup,
    setGroupStatus,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside LedgerProvider')
  return ctx
}
