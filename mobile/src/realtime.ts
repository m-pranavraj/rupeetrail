/**
 * Live ledger socket.
 *
 * The server mints a short-lived ticket after checking membership; the socket
 * only ever receives "someone changed the ledger, reload the snapshot". If the
 * socket cannot be established the app still works — it just polls on focus.
 */
import { API_BASE } from './config'
import { realtimeTicket, type Credentials } from './api'

export type LiveStatus = 'connecting' | 'live' | 'offline'

interface Options {
  groupId: string
  credentials: Credentials
  onLedger: () => void
  onStatus: (status: LiveStatus) => void
}

function absoluteSocket(raw: string): string {
  if (/^wss?:\/\//i.test(raw)) return raw
  const base = API_BASE.replace(/^http/i, 'ws')
  return `${base}${raw.startsWith('/') ? raw : `/${raw}`}`
}

export function connectGroup({ groupId, credentials, onLedger, onStatus }: Options): { close: () => void } {
  let stopped = false
  let attempt = 0
  let socket: WebSocket | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let renewal: ReturnType<typeof setTimeout> | undefined

  const schedule = (delay: number) => {
    if (stopped) return
    if (retry) clearTimeout(retry)
    retry = setTimeout(() => void open(), delay)
  }

  const retire = (connection: WebSocket | null) => {
    if (renewal) clearTimeout(renewal)
    renewal = undefined
    if (!connection) return
    connection.onmessage = null
    connection.onclose = null
    connection.onerror = null
    try {
      connection.close()
    } catch {
      // already closed
    }
    if (socket === connection) socket = null
  }

  async function open(): Promise<void> {
    if (stopped) return
    onStatus('connecting')
    try {
      const ticket = await realtimeTicket(credentials, `group:${groupId}`)
      if (stopped) return

      const connection = new WebSocket(absoluteSocket(ticket.websocketUrl))
      socket = connection

      connection.onmessage = (event) => {
        if (stopped || socket !== connection) return
        let message: { type?: string; event?: string; expiresInMs?: number }
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
          if (renewal) clearTimeout(renewal)
          renewal = setTimeout(() => {
            retire(connection)
            void open()
          }, Math.max(1_000, life - 1_000))
          return
        }
        if (message.type === 'broadcast' && message.event === 'ledger') onLedger()
      }

      const drop = () => {
        if (stopped || socket !== connection) return
        retire(connection)
        onStatus('offline')
        attempt += 1
        schedule(Math.min(20_000, 800 * 2 ** Math.min(attempt, 5)))
      }

      connection.onclose = drop
      connection.onerror = drop
    } catch (error) {
      if (stopped) return
      onStatus('offline')
      attempt += 1
      const status = (error as { status?: number }).status
      if (status === 401 || status === 403) schedule(30_000)
      // 503 means this deployment has no realtime binding; the fast sync loop
      // already covers updates, so probe again only occasionally.
      else if (status === 503) schedule(120_000)
      else schedule(Math.min(20_000, 800 * 2 ** attempt))
    }
  }

  void open()

  return {
    close() {
      stopped = true
      if (retry) clearTimeout(retry)
      retire(socket)
      onStatus('offline')
    },
  }
}
