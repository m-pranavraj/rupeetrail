/**
 * Live ledger fan-out.
 *
 * One Durable Object holds every open socket for the deployment; a group is
 * just a WebSocket tag. A write publishes only "the revision moved", so the
 * socket never carries ledger data, and a dropped event costs a refresh
 * rather than a wrong balance.
 *
 * Tickets are single-use, short-lived and minted behind the worker's normal
 * membership check, which is why the socket itself needs no credentials.
 */

interface Storage {
  get<T = unknown>(key: string): Promise<T | undefined>
  put<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<boolean>
  list<T = unknown>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>
  getAlarm(): Promise<number | null>
  setAlarm(at: number): Promise<void>
}

interface State {
  storage: Storage
  acceptWebSocket(socket: WebSocket, tags?: string[]): void
  getWebSockets(tag?: string): WebSocket[]
}

interface Ticket {
  room: string
  expiresAt: number
}

declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket }

const TICKET_PREFIX = 'ticket:'
const TICKET_MS = 45_000
const SESSION_MS = 300_000
const SWEEP_MS = 10 * 60_000
const MAX_ROOM_SOCKETS = 32
const ROOM = /^[A-Za-z0-9:_-]{1,96}$/

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function randomTicket(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let value = ''
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0')
  return value
}

function close(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason)
  } catch {
    // already closed
  }
}

export class LedgerRealtime {
  private state: State

  constructor(state: State) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'POST' && url.pathname === '/mint') return this.mint(request)
    if (request.method === 'POST' && url.pathname === '/publish') return this.publish(request)
    if (url.pathname === '/api/realtime/ws') return this.upgrade(request, url)
    return reply({ error: 'Not found.' }, 404)
  }

  private async mint(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { room?: unknown } | null
    const room = typeof body?.room === 'string' ? body.room : ''
    if (!ROOM.test(room)) return reply({ error: 'Unknown room.' }, 400)

    const ticket = randomTicket()
    await this.state.storage.put(TICKET_PREFIX + ticket, {
      room,
      expiresAt: Date.now() + TICKET_MS,
    } satisfies Ticket)

    // Unused tickets would otherwise sit in storage forever.
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(Date.now() + SWEEP_MS)
    }
    return reply({ ticket, expiresInMs: TICKET_MS })
  }

  private async upgrade(request: Request, url: URL): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return reply({ error: 'WebSocket required.' }, 426)
    }
    const ticket = url.searchParams.get('ticket') ?? ''
    if (!/^[a-f0-9]{48}$/.test(ticket)) return reply({ error: 'Invalid ticket.' }, 401)

    const key = TICKET_PREFIX + ticket
    const saved = await this.state.storage.get<Ticket>(key)
    await this.state.storage.delete(key)
    if (!saved || saved.expiresAt < Date.now()) {
      return reply({ error: 'This live session expired. Reopen the trip.' }, 401)
    }

    const open = this.state.getWebSockets(saved.room)
    for (let index = 0; index + MAX_ROOM_SOCKETS < open.length; index += 1) {
      close(open[index], 1013, 'Too many connections')
    }

    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.state.acceptWebSocket(server, [saved.room])
    this.send(server, { type: 'ready', event: 'ready', expiresInMs: SESSION_MS })

    return new Response(null, { status: 101, webSocket: client } as unknown as ResponseInit)
  }

  private async publish(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as
      | { room?: unknown; revision?: unknown }
      | null
    const room = typeof body?.room === 'string' ? body.room : ''
    if (!ROOM.test(room)) return reply({ error: 'Unknown room.' }, 400)

    const message = JSON.stringify({
      type: 'broadcast',
      event: 'ledger',
      data: { revision: typeof body?.revision === 'number' ? body.revision : null },
    })
    const sockets = this.state.getWebSockets(room)
    let delivered = 0
    for (const socket of sockets) {
      try {
        socket.send(message)
        delivered += 1
      } catch {
        close(socket, 1011, 'Delivery failed')
      }
    }
    return reply({ ok: true, delivered })
  }

  private send(socket: WebSocket, value: unknown): void {
    try {
      socket.send(JSON.stringify(value))
    } catch {
      close(socket, 1011, 'Send failed')
    }
  }

  /** The phone sends "ping" while it waits, which keeps the socket warm. */
  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') this.send(socket, { type: 'pong' })
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    close(socket, code, reason)
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    close(socket, 1011, 'Socket error')
  }

  async alarm(): Promise<void> {
    const now = Date.now()
    const tickets = await this.state.storage.list<Ticket>({ prefix: TICKET_PREFIX })
    for (const [key, value] of tickets) {
      if (value.expiresAt < now) await this.state.storage.delete(key)
    }
    const remaining = await this.state.storage.list<Ticket>({ prefix: TICKET_PREFIX, limit: 1 })
    if (remaining.size > 0) await this.state.storage.setAlarm(now + SWEEP_MS)
  }
}
