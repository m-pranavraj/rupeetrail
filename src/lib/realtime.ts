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
      if (stopped) return
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
          onLedger()
          const life = Math.max(5_000, Math.min(300_000, Number(message.expiresInMs) || 300_000))
          window.clearTimeout(renewalTimer)
          renewalTimer = window.setTimeout(
            () => {
              retire(connection)
              void open()
            },
            Math.max(1_000, life - 1_000),
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
        schedule(Math.min(20_000, 800 * 2 ** Math.min(attempt, 5)))
      }

      connection.onclose = drop
      connection.onerror = drop
    } catch (error) {
      if (stopped) return
      const status = (error as { status?: number }).status
      onStatus('offline')
      onPresence(0)
      // A missing realtime binding or a revoked membership will not fix itself
      // quickly; keep trying slowly so the app still recovers after a redeploy.
      attempt += 1
      schedule(status === 401 || status === 403 || status === 503 ? 30_000 : Math.min(20_000, 800 * 2 ** attempt))
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
