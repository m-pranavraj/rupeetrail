import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AppState } from 'react-native'
import * as api from './api'
import type { AuthMembership, GroupSnapshot } from './api'
import type { Expense, Settlement } from './lib/types'
import {
  currentPoint,
  readGeo,
  removeGeoPoints,
  setGeoPoint,
  type GeoMap,
  type GeoPoint,
} from './lib/geo'
import { connectGroup, type LiveStatus } from './realtime'
import { readSession, writeSession, type StoredSession } from './storage'

interface ActiveGroup {
  membership: AuthMembership
  snapshot: GroupSnapshot
  live: LiveStatus
}

interface Store {
  ready: boolean
  session: StoredSession | null
  active: ActiveGroup | null
  busy: boolean
  error: string | null
  notice: string | null

  signUp(input: { name: string; phone: string; pin: string; upiId?: string }): Promise<boolean>
  signIn(input: { phone: string; pin: string }): Promise<boolean>
  signOut(): Promise<void>

  createGroup(input: { name: string; emoji: string }): Promise<string | null>
  joinGroup(code: string): Promise<string | null>

  openGroup(groupId: string): Promise<void>
  closeGroup(): void
  refresh(): Promise<void>

  addExpense(input: api.ExpenseInput): Promise<string | null>
  updateExpense(expenseId: string, input: api.ExpenseInput): Promise<boolean>
  removeExpense(expenseId: string): Promise<boolean>
  addPerson(name: string, upiId: string): Promise<boolean>
  removePerson(memberId: string): Promise<boolean>
  settle(input: { from: string; to: string; amountPaise: number; method?: Settlement['method'] }): Promise<boolean>
  confirmSettlement(id: string, action: 'paid' | 'received' | 'dispute'): Promise<boolean>
  acknowledge(expenseId: string, status: 'acknowledged' | 'questioned', reason?: string): Promise<boolean>
  resolveDispute(expenseId: string, resolution: string): Promise<boolean>
  patchGroup(patch: { name?: string; emoji?: string; status?: 'active' | 'reconciling' | 'closed' }): Promise<boolean>
  updateMe(patch: { name?: string; upiId?: string }): Promise<boolean>

  /** Device-side place tags keyed by expense id. */
  geo: GeoMap
  tagPlace(expenseId: string, label?: string): Promise<GeoPoint | null>
  clearPlace(expenseId: string): Promise<void>

  clearMessages(): void
}

const StoreContext = createContext<Store | null>(null)

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore must be used inside LedgerProvider')
  return store
}

const isAuthFailure = (cause: unknown) => cause instanceof api.ApiError && cause.status === 401

function membershipFor(snapshot: GroupSnapshot, token: string, joinedAt = Date.now()): AuthMembership {
  return {
    groupId: snapshot.group.id,
    memberId: snapshot.me.id,
    token,
    groupName: snapshot.group.name,
    emoji: snapshot.group.emoji,
    name: snapshot.me.name,
    upiId: snapshot.me.upiId ?? '',
    joinedAt,
  }
}

export function LedgerProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const [session, setSession] = useState<StoredSession | null>(null)
  const [active, setActive] = useState<ActiveGroup | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [geo, setGeo] = useState<GeoMap>({})

  const sessionRef = useRef<StoredSession | null>(null)
  const activeRef = useRef<ActiveGroup | null>(null)
  const socketRef = useRef<{ close: () => void } | null>(null)
  const refreshing = useRef(false)
  const inForeground = useRef(true)

  const applySession = useCallback((next: StoredSession | null) => {
    sessionRef.current = next
    setSession(next)
    void writeSession(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [stored, places] = await Promise.all([readSession(), readGeo()])
      if (!cancelled) {
        sessionRef.current = stored
        setSession(stored)
        setGeo(places)
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(
    () => () => {
      socketRef.current?.close()
      socketRef.current = null
    },
    [],
  )

  const fail = useCallback((cause: unknown) => {
    const message = cause instanceof api.ApiError ? cause.message : 'Something went wrong. Try again.'
    setError(message)
    return false
  }, [])

  const requireSession = useCallback((): StoredSession => {
    const current = sessionRef.current
    if (!current) throw new api.ApiError('Sign in again to continue.', 401)
    return current
  }, [])

  const healing = useRef<Promise<boolean> | null>(null)

  /**
   * Swap in fresh group tokens when the stored one has been retired.
   *
   * The account token still proves who this is, so a device that lost its group
   * token heals itself instead of showing "not a member" for its own trips.
   * Concurrent callers share one refresh.
   */
  const healMemberships = useCallback(async (): Promise<boolean> => {
    const current = sessionRef.current
    if (!current) return false
    if (!healing.current) {
      healing.current = (async () => {
        try {
          const fresh = await api.refreshSession(current.token)
          applySession({ ...current, user: fresh.user, memberships: fresh.memberships })
          const open = activeRef.current
          const replacement = open
            ? fresh.memberships.find((entry) => entry.groupId === open.membership.groupId)
            : undefined
          if (open && replacement) {
            activeRef.current = { ...open, membership: replacement }
            setActive((prev) => (prev ? { ...prev, membership: replacement } : prev))
          }
          return true
        } catch {
          return false
        } finally {
          healing.current = null
        }
      })()
    }
    return healing.current
  }, [applySession])


  /* ------------------------------------------------------------- accounts */

  const signUp = useCallback<Store['signUp']>(
    async (input) => {
      setBusy(true)
      setError(null)
      try {
        const auth = await api.registerAccount(input)
        applySession({ token: auth.token, user: auth.user, memberships: auth.memberships })
        setNotice(`Welcome, ${auth.user.name.split(' ')[0]}.`)
        return true
      } catch (cause) {
        return fail(cause)
      } finally {
        setBusy(false)
      }
    },
    [applySession, fail],
  )

  const signIn = useCallback<Store['signIn']>(
    async (input) => {
      setBusy(true)
      setError(null)
      try {
        const auth = await api.loginAccount(input)
        applySession({ token: auth.token, user: auth.user, memberships: auth.memberships })
        setNotice('Signed in. Your groups are back.')
        return true
      } catch (cause) {
        return fail(cause)
      } finally {
        setBusy(false)
      }
    },
    [applySession, fail],
  )

  const signOut = useCallback<Store['signOut']>(async () => {
    const current = sessionRef.current
    socketRef.current?.close()
    socketRef.current = null
    setActive(null)
    applySession(null)
    setNotice(null)
    if (current) {
      try {
        await api.logoutAccount(current.token)
      } catch {
        // The local session is already gone; a failed revoke is not fatal.
      }
    }
  }, [applySession])

  /* --------------------------------------------------------------- groups */

  const remember = useCallback(
    (snapshot: GroupSnapshot, token: string) => {
      const current = requireSession()
      const membership = membershipFor(snapshot, token)
      const memberships = [
        membership,
        ...current.memberships.filter((entry) => entry.groupId !== membership.groupId),
      ]
      applySession({ ...current, memberships })
    },
    [applySession, requireSession],
  )

  const createGroup = useCallback<Store['createGroup']>(
    async ({ name, emoji }) => {
      setBusy(true)
      setError(null)
      try {
        const current = requireSession()
        const snapshot = await api.createGroup(current.token, {
          name,
          emoji,
          memberName: current.user.name,
          upiId: current.user.upiId,
        })
        remember(snapshot, snapshot.token)
        setNotice('Group created. Share the invite code.')
        return snapshot.group.id
      } catch (cause) {
        fail(cause)
        return null
      } finally {
        setBusy(false)
      }
    },
    [fail, remember, requireSession],
  )

  const joinGroup = useCallback<Store['joinGroup']>(
    async (code) => {
      setBusy(true)
      setError(null)
      try {
        const current = requireSession()
        const snapshot = await api.joinGroup(current.token, {
          code: code.trim().toUpperCase(),
          memberName: current.user.name,
          upiId: current.user.upiId,
        })
        remember(snapshot, snapshot.token)
        setNotice('You are in.')
        return snapshot.group.id
      } catch (cause) {
        fail(cause)
        return null
      } finally {
        setBusy(false)
      }
    },
    [fail, remember, requireSession],
  )

  /* ----------------------------------------------------------- active group */

  const openGroup = useCallback<Store['openGroup']>(async (groupId) => {
    const current = sessionRef.current
    const stored = current?.memberships.find((entry) => entry.groupId === groupId)
    if (!stored) {
      setError('This phone does not have access to that group.')
      return
    }
    let membership: AuthMembership = stored
    setBusy(true)
    setError(null)
    try {
      let snapshot: GroupSnapshot
      try {
        snapshot = await api.fetchGroup(groupId, membership)
      } catch (cause) {
        if (!isAuthFailure(cause) || !(await healMemberships())) throw cause
        const healed = sessionRef.current?.memberships.find((entry) => entry.groupId === groupId)
        if (!healed) throw cause
        membership = healed
        snapshot = await api.fetchGroup(groupId, healed)
      }
      setActive({ membership, snapshot, live: 'connecting' })

      socketRef.current?.close()
      socketRef.current = connectGroup({
        groupId,
        credentials: membership,
        onLedger: () => {
          void api
            .fetchGroup(groupId, membership)
            .then((fresh) =>
              setActive((prev) =>
                prev && prev.snapshot.revision === fresh.revision
                  ? prev
                  : prev
                    ? { ...prev, snapshot: fresh }
                    : prev,
              ),
            )
            .catch(() => undefined)
        },
        onStatus: (live) => setActive((prev) => (prev ? { ...prev, live } : prev)),
      })
    } catch (cause) {
      fail(cause)
      setActive(null)
    } finally {
      setBusy(false)
    }
  }, [fail, healMemberships])

  const closeGroup = useCallback(() => {
    socketRef.current?.close()
    socketRef.current = null
    setActive(null)
  }, [])

  const refresh = useCallback<Store['refresh']>(async () => {
    const current = activeRef.current
    if (!current || refreshing.current) return
    refreshing.current = true
    try {
      let snapshot: GroupSnapshot
      try {
        snapshot = await api.fetchGroup(current.membership.groupId, current.membership)
      } catch (cause) {
        if (!isAuthFailure(cause) || !(await healMemberships())) throw cause
        const healed = activeRef.current?.membership
        if (!healed) throw cause
        snapshot = await api.fetchGroup(healed.groupId, healed)
      }
      // A no-op sync must not re-render the whole ledger: on a big group that
      // reads as a stutter every few seconds.
      setActive((prev) =>
        prev && prev.snapshot.revision === snapshot.revision ? prev : prev ? { ...prev, snapshot } : prev,
      )
    } catch (cause) {
      fail(cause)
    } finally {
      refreshing.current = false
    }
  }, [fail, healMemberships])

  /** Run a mutation that answers with a fresh snapshot. */
  const mutate = useCallback(
    async (work: (target: ActiveGroup) => Promise<GroupSnapshot>): Promise<boolean> => {
      const current = activeRef.current
      if (!current) return false
      setBusy(true)
      setError(null)
      try {
        let snapshot: GroupSnapshot
        try {
          snapshot = await work(current)
        } catch (cause) {
          if (!isAuthFailure(cause) || !(await healMemberships()) || !activeRef.current) throw cause
          snapshot = await work(activeRef.current)
        }
        setActive((prev) => (prev ? { ...prev, snapshot } : prev))
        return true
      } catch (cause) {
        return fail(cause)
      } finally {
        setBusy(false)
      }
    },
    [fail, healMemberships],
  )

  const addExpense = useCallback<Store['addExpense']>(
    async (input) => {
      const current = activeRef.current
      if (!current) return null
      setBusy(true)
      setError(null)
      try {
        let snapshot: Awaited<ReturnType<typeof api.addExpense>>
        try {
          snapshot = await api.addExpense(current.membership.groupId, current.membership, input)
        } catch (cause) {
          if (!isAuthFailure(cause) || !(await healMemberships()) || !activeRef.current) throw cause
          const healed = activeRef.current.membership
          snapshot = await api.addExpense(healed.groupId, healed, input)
        }
        setActive((prev) => (prev ? { ...prev, snapshot } : prev))
        return snapshot.expenseId
      } catch (cause) {
        fail(cause)
        return null
      } finally {
        setBusy(false)
      }
    },
    [fail, healMemberships],
  )

  const updateExpense = useCallback<Store['updateExpense']>(
    (expenseId, input) =>
      mutate(({ membership }) => api.updateExpense(membership.groupId, membership, expenseId, input)),
    [mutate],
  )

  const removeExpense = useCallback<Store['removeExpense']>(
    async (expenseId) => {
      const ok = await mutate(({ membership }) =>
        api.deleteExpense(membership.groupId, membership, expenseId),
      )
      if (ok) {
        const next = await removeGeoPoints([expenseId])
        setGeo({ ...next })
      }
      return ok
    },
    [mutate],
  )

  const tagPlace = useCallback<Store['tagPlace']>(async (expenseId, label) => {
    const point = await currentPoint(label)
    if (!point) return null
    const next = await setGeoPoint(expenseId, point)
    setGeo({ ...next })
    return point
  }, [])

  const clearPlace = useCallback<Store['clearPlace']>(async (expenseId) => {
    const next = await removeGeoPoints([expenseId])
    setGeo({ ...next })
  }, [])

  const addPerson = useCallback<Store['addPerson']>(
    (name, upiId) =>
      mutate(({ membership }) =>
        api.addMember(membership.groupId, membership, { name, upiId: upiId.trim() || undefined }),
      ),
    [mutate],
  )

  const removePerson = useCallback<Store['removePerson']>(
    (memberId) =>
      mutate(({ membership }) => api.removeMember(membership.groupId, membership, memberId)),
    [mutate],
  )

  const settle = useCallback<Store['settle']>(
    ({ from, to, amountPaise, method = 'upi' }) =>
      mutate(async ({ membership }) => {
        const snapshot = await api.addSettlement(membership.groupId, membership, {
          from,
          to,
          amountPaise,
          method,
        })
        const meId = membership.memberId
        const action =
          from.startsWith('manual:') && to === meId
            ? 'received'
            : to.startsWith('manual:') && from === meId
              ? 'paid'
              : null

        if (!action) return snapshot

        // A manually named counterparty has no phone to confirm from, so the
        // side this device represents confirms immediately. The balance moves
        // the moment the payment is recorded, so a failed confirmation must
        // never make a recorded payment look like a failed one.
        const createdId = snapshot.settlementId
        if (!createdId) return snapshot
        try {
          return await api.confirmSettlement(membership.groupId, membership, createdId, action)
        } catch {
          return snapshot
        }
      }),
    [mutate],
  )

  const confirmSettlement = useCallback<Store['confirmSettlement']>(
    (id, action) =>
      mutate(({ membership }) =>
        api.confirmSettlement(membership.groupId, membership, id, action),
      ),
    [mutate],
  )

  const acknowledge = useCallback<Store['acknowledge']>(
    (expenseId, status, reason) =>
      mutate(({ membership }) =>
        api.ackExpense(membership.groupId, membership, expenseId, status, reason),
      ),
    [mutate],
  )

  const resolveDispute = useCallback<Store['resolveDispute']>(
    (expenseId, resolution) =>
      mutate(({ membership }) =>
        api.resolveDispute(membership.groupId, membership, expenseId, resolution),
      ),
    [mutate],
  )

  const patchGroup = useCallback<Store['patchGroup']>(
    async (patch) => {
      const ok = await mutate(({ membership }) => api.patchGroup(membership.groupId, membership, patch))
      if (ok) {
        const current = sessionRef.current
        const activeGroup = activeRef.current
        if (current && activeGroup) {
          const memberships = current.memberships.map((entry) =>
            entry.groupId === activeGroup.membership.groupId
              ? {
                  ...entry,
                  groupName: patch.name ?? entry.groupName,
                  emoji: patch.emoji ?? entry.emoji,
                }
              : entry,
          )
          applySession({ ...current, memberships })
          setActive((prev) =>
            prev
              ? {
                  ...prev,
                  membership: {
                    ...prev.membership,
                    groupName: patch.name ?? prev.membership.groupName,
                    emoji: patch.emoji ?? prev.membership.emoji,
                  },
                }
              : prev,
          )
        }
      }
      return ok
    },
    [applySession, mutate],
  )

  const updateMe = useCallback<Store['updateMe']>(
    (patch) => mutate(({ membership }) => api.patchMe(membership.groupId, membership, patch)),
    [mutate],
  )

  const clearMessages = useCallback(() => {
    setError(null)
    setNotice(null)
  }, [])

  // Pull the ledger when the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      inForeground.current = state === 'active'
      if (state === 'active') void refresh()
    })
    return () => sub.remove()
  }, [refresh])

  // When the socket cannot attach (some networks block WebSockets, or the
  // deployment has no realtime binding) fall back to a fast foreground sync so
  // another phone's entry lands almost immediately. Nothing runs while the app
  // is in the background, and overlapping fetches are skipped.
  const openGroupId = active?.membership.groupId
  const openLive = active?.live
  useEffect(() => {
    if (!openGroupId || openLive === 'live') return
    const timer = setInterval(() => {
      if (inForeground.current) void refresh()
    }, 2_000)
    return () => clearInterval(timer)
  }, [openGroupId, openLive, refresh])

  const value = useMemo<Store>(
    () => ({
      ready,
      session,
      active,
      busy,
      error,
      notice,
      signUp,
      signIn,
      signOut,
      createGroup,
      joinGroup,
      openGroup,
      closeGroup,
      refresh,
      addExpense,
      updateExpense,
      removeExpense,
      addPerson,
      removePerson,
      settle,
      confirmSettlement,
      acknowledge,
      resolveDispute,
      patchGroup,
      updateMe,
      geo,
      tagPlace,
      clearPlace,
      clearMessages,
    }),
    [
      ready,
      session,
      active,
      busy,
      error,
      notice,
      signUp,
      signIn,
      signOut,
      createGroup,
      joinGroup,
      openGroup,
      closeGroup,
      refresh,
      addExpense,
      updateExpense,
      removeExpense,
      addPerson,
      removePerson,
      settle,
      confirmSettlement,
      acknowledge,
      resolveDispute,
      patchGroup,
      updateMe,
      geo,
      tagPlace,
      clearPlace,
      clearMessages,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export type { Expense, Settlement }
