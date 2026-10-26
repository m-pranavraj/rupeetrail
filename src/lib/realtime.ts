/**
 * Live group updates.
 *
 * The socket is authorized by a single-use ticket minted by our own API, which
 * checks the device's member token before the realtime hub ever sees it. A
 * socket lives at most five minutes, then gets a fresh ticket, so losing access
 * to a group takes effect quickly. Every `ledger` broadcast only says "the
 * revision changed" — the client always reloads the authoritative snapshot from
 * D1 rather than trusting event payloads.
 */
import { realtimeTicket, type Credentials } from './api'

export type LiveStatus = 'connecting' | 'live' | 'offline'

interface Options {
  groupId: string
  credentials: Credentials
  onLedger: () => void
  onStatus: (status: LiveStatus) => void
  onPresence: (count: number) => void
}

/** Local development tunnels the helper through the Vite dev origin. */
function normaliseSocketUrl(raw: string): string {
  try {
    const url = new URL(raw)
    const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
    if (!local) return raw
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}${url.pathname}${url.search}`
  } catch {
    return raw
  }
}

/** Exponential backoff: 600ms, 1.2s, 2.4s, 4.8s, 9.6s, 19.2s, 30s cap */
function backoffMs(attempt: number): number {
  return Math.min(30_000, 600 * 2 ** Math.min(attempt, 5))
}

export function connectGroup({
  groupId,
  credentials,
  onLedger,
  onStatus,
  onPresence,
}: Options): { close: () => void } {
  let stopped = false
  let attempt = 0
  let socket: WebSocket | null = null
  let retryTimer: number | undefined
  let renewalTimer: number | undefined
  let pending: AbortController | null = null

  const schedule = (delay: number) => {
    if (stopped) return
    window.clearTimeout(retryTimer)
    retryTimer = window.setTimeout(open, delay)
  }

  const retire = (connection: WebSocket | null) => {
    window.clearTimeout(renewalTimer)
    renewalTimer = undefined
    if (!connection) return
    connection.onopen = null
    connection.onmessage = null
    connection.onclose = null
    connection.onerror = null
    try {
      connection.close(1000, 'Renewing authorization')
    } catch {
      // already closed
    }
    if (socket === connection) socket = null
  }

  async function open(): Promise<void> {
    if (stopped || pending) return
    onStatus('connecting')
    const controller = new AbortController()
    pending = controller
    try {
      const ticket = await realtimeTicket(credentials, `group:${groupId}`)
      if (stopped || controller.signal.aborted) return
      const connection = new WebSocket(normaliseSocketUrl(ticket.websocketUrl))
      socket = connection

      connection.onmessage = (event) => {
        if (stopped || socket !== connection) return
        let message: {
          type?: string
          event?: string
          members?: { userId?: string }[]
          expiresInMs?: number
        }
        try {
          message = JSON.parse(String(event.data))
        } catch {
          return
        }

        if (message.type === 'ready') {
          attempt = 0
          onStatus('live')
          // Fetch the latest snapshot once connected.
          onLedger()
          // Schedule renewal slightly before the ticket expires.
          const life = Math.max(5_000, Math.min(300_000, Number(message.expiresInMs) || 300_000))
          window.clearTimeout(renewalTimer)
          renewalTimer = window.setTimeout(
            () => {
              retire(connection)
              void open()
            },
            Math.max(1_000, life - 10_000), // renew 10s before expiry
          )
          return
        }
        if (message.type === 'broadcast' && message.event === 'ledger') {
          onLedger()
          return
        }
        if (message.type === 'presence' && Array.isArray(message.members)) {
          const people = new Set(message.members.map((m) => m.userId ?? 'unknown'))
          onPresence(people.size)
        }
      }

      const drop = () => {
        if (stopped || socket !== connection) return
        retire(connection)
        onStatus('offline')
        onPresence(0)
        attempt += 1
        schedule(backoffMs(attempt))
      }

      connection.onclose = drop
      connection.onerror = drop
    } catch (error) {
      if (stopped) return
      const status = (error as { status?: number }).status
      onStatus('offline')
      onPresence(0)
      attempt += 1
      // 503 means realtime is unavailable on this deployment — wait longer.
      schedule(status === 503 ? 60_000 : backoffMs(attempt))
    } finally {
      if (pending === controller) pending = null
    }
  }

  void open()

  return {
    close() {
      stopped = true
      window.clearTimeout(retryTimer)
      window.clearTimeout(renewalTimer)
      pending?.abort()
      pending = null
      retire(socket)
      onStatus('offline')
    },
  }
}
