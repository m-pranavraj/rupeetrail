import { beforeAll, describe, expect, it } from 'vitest'
import { LedgerRealtime } from './realtime'

class FakeSocket {
  sent: string[] = []
  closed: { code: number; reason: string } | null = null
  send(value: string): void {
    this.sent.push(value)
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason }
  }
}

class FakeStorage {
  private data = new Map<string, unknown>()
  private alarm: number | null = null

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value)
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key)
  }
  async list<T>(options: { prefix?: string; limit?: number } = {}): Promise<Map<string, T>> {
    const found = new Map<string, T>()
    for (const [key, value] of this.data) {
      if (options.prefix && !key.startsWith(options.prefix)) continue
      found.set(key, value as T)
      if (options.limit && found.size >= options.limit) break
    }
    return found
  }
  async getAlarm(): Promise<number | null> {
    return this.alarm
  }
  async setAlarm(at: number): Promise<void> {
    this.alarm = at
  }
}

class FakeState {
  storage = new FakeStorage()
  private sockets: { socket: FakeSocket; tags: string[] }[] = []

  acceptWebSocket(socket: FakeSocket, tags: string[] = []): void {
    this.sockets.push({ socket, tags })
  }
  getWebSockets(tag?: string): FakeSocket[] {
    return this.sockets
      .filter((entry) => !tag || entry.tags.includes(tag))
      .map((entry) => entry.socket)
  }
}

class FakeResponse {
  status: number
  ok: boolean
  private payload: string | null

  constructor(body: string | null, init: { status?: number; webSocket?: unknown } = {}) {
    this.status = init.status ?? 200
    this.ok = this.status >= 200 && this.status < 300
    this.payload = body
  }
  async json(): Promise<unknown> {
    return this.payload === null ? null : JSON.parse(this.payload)
  }
}

let lastPair: { client: FakeSocket; server: FakeSocket } | null = null

beforeAll(() => {
  const runtime = globalThis as unknown as Record<string, unknown>
  runtime.Response = FakeResponse
  runtime.WebSocketPair = class {
    0 = new FakeSocket()
    1 = new FakeSocket()
    constructor() {
      lastPair = { client: this[0], server: this[1] }
    }
  }
})

function post(path: string, body: unknown): Request {
  return new Request(`https://realtime${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function mint(hub: LedgerRealtime, room = 'group:g1'): Promise<string> {
  const response = (await hub.fetch(post('/mint', { room }))) as unknown as FakeResponse
  expect(response.status).toBe(200)
  const payload = (await response.json()) as { ticket: string }
  return payload.ticket
}

async function connect(hub: LedgerRealtime, ticket: string): Promise<FakeResponse> {
  return (await hub.fetch(
    new Request(`https://api.test/api/realtime/ws?ticket=${ticket}`, {
      headers: { Upgrade: 'websocket' },
    }),
  )) as unknown as FakeResponse
}

describe('ledger realtime hub', () => {
  it('mints a ticket, accepts one socket and broadcasts the revision', async () => {
    const state = new FakeState()
    const hub = new LedgerRealtime(state as never)

    const ticket = await mint(hub)
    expect(ticket).toMatch(/^[a-f0-9]{48}$/)

    const response = await connect(hub, ticket)
    expect(response.status).toBe(101)
    expect(lastPair?.server.sent.map((entry) => JSON.parse(entry))).toEqual([
      { type: 'ready', event: 'ready', expiresInMs: 300_000 },
    ])

    const published = (await hub.fetch(
      post('/publish', { room: 'group:g1', revision: 7 }),
    )) as unknown as FakeResponse
    expect(await published.json()).toEqual({ ok: true, delivered: 1 })

    const frames = lastPair!.server.sent.map((entry) => JSON.parse(entry))
    expect(frames[1]).toEqual({
      type: 'broadcast',
      event: 'ledger',
      data: { revision: 7 },
    })
  })

  it('refuses a reused, malformed or expired ticket', async () => {
    const state = new FakeState()
    const hub = new LedgerRealtime(state as never)

    expect((await connect(hub, 'not-a-ticket')).status).toBe(401)

    const ticket = await mint(hub)
    expect((await connect(hub, ticket)).status).toBe(101)
    expect((await connect(hub, ticket)).status).toBe(401)

    await state.storage.put(`ticket:${'a'.repeat(48)}`, {
      room: 'group:g1',
      expiresAt: Date.now() - 1,
    })
    expect((await connect(hub, 'a'.repeat(48))).status).toBe(401)
  })

  it('keeps rooms isolated and rejects a bad room name', async () => {
    const state = new FakeState()
    const hub = new LedgerRealtime(state as never)

    const ticket = await mint(hub, 'group:alpha')
    await connect(hub, ticket)
    const alpha = lastPair!.server

    const other = post('/publish', { room: 'group:beta', revision: 2 })
    expect(await ((await hub.fetch(other)) as unknown as FakeResponse).json()).toEqual({
      ok: true,
      delivered: 0,
    })
    expect(alpha.sent.map((entry) => JSON.parse(entry))).toHaveLength(1)

    const bad = (await hub.fetch(post('/mint', { room: 'bad room!' }))) as unknown as FakeResponse
    expect(bad.status).toBe(400)
  })

  it('requires the websocket upgrade header', async () => {
    const state = new FakeState()
    const hub = new LedgerRealtime(state as never)
    const ticket = await mint(hub)
    const plain = (await hub.fetch(
      new Request(`https://api.test/api/realtime/ws?ticket=${ticket}`),
    )) as unknown as FakeResponse
    expect(plain.status).toBe(426)
  })
})
