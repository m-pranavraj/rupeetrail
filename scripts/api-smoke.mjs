/**
 * End-to-end smoke test against a locally running Worker.
 *
 *   npm run db:local
 *   npm run dev:realtime   (port 8788)
 *   npm run dev:api        (port 8787)
 *   node scripts/api-smoke.mjs
 *
 * It covers the flows the product actually promises: create a group, invite by
 * code, join from a second device, log a multi-payer expense, confirm it, settle
 * it from both sides, and receive the live broadcast over a real websocket.
 */
import crypto from 'node:crypto'
import net from 'node:net'
import tls from 'node:tls'

const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:8787'
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://127.0.0.1:8787'

let failures = 0
function check(condition, label, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
}

async function api(path, { method = 'GET', body, auth, expected } = {}) {
  const headers = { Origin: ORIGIN }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (auth) {
    headers['x-rt-member'] = auth.memberId
    headers['x-rt-token'] = auth.token
  }
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  const status = response.status
  if (expected && status !== expected) {
    console.log('  request failed:', method, path, status, JSON.stringify(payload))
  }
  return { status, payload }
}

/** Bare-bones read-only websocket client so no dependency is needed. */
function openSocket(url, origin) {
  const target = new URL(url)
  const key = crypto.randomBytes(16).toString('base64')
  const secure = target.protocol === 'wss:'
  const port = Number(target.port || (secure ? 443 : 80))
  const socket = secure
    ? tls.connect({ host: target.hostname, port, servername: target.hostname })
    : net.connect(port, target.hostname)
  const messages = []
  const waiters = []
  let buffer = Buffer.alloc(0)
  let upgraded = false

  const deliver = (message) => {
    messages.push(message)
    for (const waiter of [...waiters]) {
      if (waiter.match(message)) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(message)
      }
    }
  }

  const parse = () => {
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f
      const masked = (buffer[1] & 0x80) !== 0
      let length = buffer[1] & 0x7f
      let offset = 2
      if (length === 126) {
        if (buffer.length < 4) return
        length = buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (buffer.length < 10) return
        length = Number(buffer.readBigUInt64BE(2))
        offset = 10
      }
      const maskOffset = offset
      if (masked) offset += 4
      if (buffer.length < offset + length) return
      const payload = Buffer.from(buffer.slice(offset, offset + length))
      if (masked) {
        const mask = buffer.slice(maskOffset, maskOffset + 4)
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4]
      }
      buffer = buffer.slice(offset + length)
      if (opcode === 1) {
        try {
          deliver(JSON.parse(payload.toString('utf8')))
        } catch {
          // ignore non-JSON frames
        }
      }
      if (opcode === 8) {
        socket.end()
        return
      }
    }
  }

  const sendUpgrade = () => socket.write(
    [
      `GET ${target.pathname}${target.search} HTTP/1.1`,
      `Host: ${target.host}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Key: ${key}`,
      'Sec-WebSocket-Version: 13',
      `Origin: ${origin}`,
      '',
      '',
    ].join('\r\n'),
  )
  if (secure) socket.once('secureConnect', sendUpgrade)
  else socket.once('connect', sendUpgrade)

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    if (!upgraded) {
      const end = buffer.indexOf('\r\n\r\n')
      if (end === -1) return
      const head = buffer.slice(0, end).toString('latin1')
      buffer = buffer.slice(end + 4)
      upgraded = true
      if (!head.startsWith('HTTP/1.1 101')) {
        for (const waiter of [...waiters]) waiter.reject(new Error(head.split('\r\n')[0]))
        waiters.length = 0
        return
      }
      for (const waiter of [...waiters]) {
        if (waiter.match({ type: '__open' })) {
          waiters.splice(waiters.indexOf(waiter), 1)
          waiter.resolve({})
        }
      }
    }
    parse()
  })

  return {
    waitFor(predicate, timeoutMs = 8000) {
      const existing = messages.find(predicate)
      if (existing) return Promise.resolve(existing)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((w) => w.resolve === resolve)
          if (index >= 0) waiters.splice(index, 1)
          reject(new Error('Timed out waiting for a websocket message'))
        }, timeoutMs)
        waiters.push({
          match: predicate,
          resolve: (message) => {
            clearTimeout(timer)
            resolve(message)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
      })
    },
    close() {
      socket.destroy()
    },
  }
}

console.log(`\nRupeeTrail API smoke test → ${API}\n`)

/* 1. health */
const health = await api('/api/health')
check(health.status === 200 && health.payload?.ok === true, 'health endpoint is up')
check(health.payload?.realtime === true, 'realtime binding is attached')

/* 2. create a group as the first member */
const created = await api('/api/groups', {
  method: 'POST',
  expected: 201,
  body: { name: 'Smoke Trip', emoji: '🧪', memberName: 'Arjun', upiId: 'arjun@okaxis' },
})
check(created.status === 201, 'create group returns 201', created.status)
const group = created.payload
check(Boolean(group?.group?.id), 'group id returned')
check(group?.code?.length === 6, 'six-character invite code', group?.code)
check(group?.expenses?.length === 0 && group?.settlements?.length === 0, 'new group starts empty (no mock data)')
check(group?.group?.members?.length === 1, 'creator is the first member')
check(!JSON.stringify(group).includes('tokenHash'), 'member token hashes are never sent to clients')

const arjun = { memberId: group.me.id, token: group.token }

/* 3. invite preview works without any credential */
const preview = await api(`/api/invite/${group.code}`)
check(preview.status === 200 && preview.payload?.name === 'Smoke Trip', 'invite preview by code')
check(preview.payload?.memberCount === 1, 'invite preview shows member count')

/* 4. a second phone joins with the code */
const joined = await api('/api/groups/join', {
  method: 'POST',
  expected: 201,
  body: { code: group.code.toLowerCase(), memberName: 'Priya', upiId: 'priya@ybl' },
})
check(joined.status === 201, 'join by code (lowercase accepted)', joined.status)
const priya = { memberId: joined.payload.me.id, token: joined.payload.token }
check(joined.payload.group.members.length === 2, 'group now has two members')

/* 5. auth is enforced */
const noAuth = await api(`/api/groups/${group.group.id}`)
check(noAuth.status === 401, 'snapshot without a token is rejected', noAuth.status)
const badToken = await api(`/api/groups/${group.group.id}`, { auth: { ...arjun, token: 'nope' } })
check(badToken.status === 401, 'wrong token is rejected', badToken.status)

/* 6. realtime: subscribe before writing */
let socket
let realtimeOk = false
try {
  const ticket = await api('/api/realtime/ticket', {
    method: 'POST',
    auth: arjun,
    body: { room: `group:${group.group.id}` },
  })
  check(ticket.status === 200 && Boolean(ticket.payload?.websocketUrl), 'realtime ticket issued')
  socket = openSocket(ticket.payload.websocketUrl, ORIGIN)
  const ready = await socket.waitFor((m) => m.type === 'ready')
  check(ready.userId === arjun.memberId, 'socket authenticated as the member')
  realtimeOk = true
} catch (error) {
  check(false, 'realtime ticket + websocket', error.message)
}

/* 7. multi-payer expense with an exact split */
const expense = await api(`/api/groups/${group.group.id}/expenses`, {
  method: 'POST',
  expected: 201,
  auth: priya,
  body: {
    description: 'Beach shack dinner',
    amountPaise: 100000,
    date: Date.now(),
    category: 'food',
    payers: [
      { memberId: arjun.memberId, amountPaise: 60000 },
      { memberId: priya.memberId, amountPaise: 40000 },
    ],
    split: { mode: 'equal', participants: [arjun.memberId, priya.memberId] },
    notes: 'Two payers, one bill',
  },
})
check(expense.status === 201, 'expense recorded', expense.status)
check(expense.payload?.expenses?.length === 1, 'ledger has one expense')
check(expense.payload?.revision === 3, 'revision advanced with each write', expense.payload?.revision)

if (realtimeOk) {
  try {
    const event = await socket.waitFor((m) => m.type === 'broadcast' && m.event === 'ledger')
    check(event.data.revision >= 3, 'subscriber got the live ledger revision', JSON.stringify(event.data))
  } catch (error) {
    check(false, 'live broadcast follows a write', error.message)
  }
}

/* 8. malformed splits are refused server-side */
const badSplit = await api(`/api/groups/${group.group.id}/expenses`, {
  method: 'POST',
  expected: 400,
  auth: arjun,
  body: {
    description: 'Broken split',
    amountPaise: 1000,
    date: Date.now(),
    category: 'other',
    payers: [{ memberId: arjun.memberId, amountPaise: 1000 }],
    split: { mode: 'exact', values: { [arjun.memberId]: 400, [priya.memberId]: 400 } },
  },
})
check(badSplit.status === 400, 'exact split that misses the total is rejected', badSplit.status)

const wrongPayer = await api(`/api/groups/${group.group.id}/expenses`, {
  method: 'POST',
  expected: 400,
  auth: arjun,
  body: {
    description: 'Wrong payer total',
    amountPaise: 1000,
    date: Date.now(),
    category: 'other',
    payers: [{ memberId: arjun.memberId, amountPaise: 900 }],
    split: { mode: 'equal', participants: [arjun.memberId] },
  },
})
check(wrongPayer.status === 400, 'payer amounts must match the total', wrongPayer.status)

/* 9. acknowledgement and dispute */
const expenseId = expense.payload.expenses[0].id
const ack = await api(`/api/groups/${group.group.id}/expenses/${expenseId}/ack`, {
  method: 'POST',
  auth: arjun,
  body: { status: 'acknowledged' },
})
check(ack.status === 200, 'member can confirm an expense', ack.status)
check(ack.payload.expenses[0].acks[arjun.memberId] === 'acknowledged', 'ack stored against the member')

const dispute = await api(`/api/groups/${group.group.id}/expenses/${expenseId}/ack`, {
  method: 'POST',
  auth: priya,
  body: { status: 'questioned', reason: 'I only had a starter' },
})
check(dispute.status === 200, 'member can question an expense', dispute.status)
check(dispute.payload.expenses[0].dispute?.status === 'open', 'dispute is open')

const resolved = await api(`/api/groups/${group.group.id}/expenses/${expenseId}/resolve`, {
  method: 'POST',
  auth: arjun,
  body: { resolution: 'Split fixed to a starter share' },
})
check(resolved.status === 200, 'dispute can be resolved', resolved.status)
check(resolved.payload.expenses[0].dispute?.status === 'resolved', 'dispute marked resolved')

/* 10. settlement needs both sides */
const settlement = await api(`/api/groups/${group.group.id}/settlements`, {
  method: 'POST',
  expected: 201,
  auth: priya,
  body: { from: priya.memberId, to: arjun.memberId, amountPaise: 10000, method: 'upi', note: 'upi ref 1234' },
})
check(settlement.status === 201, 'payment recorded', settlement.status)
const settlementId = settlement.payload.settlementId

const wrongSide = await api(`/api/groups/${group.group.id}/settlements/${settlementId}/confirm`, {
  method: 'POST',
  expected: 403,
  auth: arjun,
  body: { action: 'paid' },
})
check(wrongSide.status === 403, 'receiver cannot confirm on the payer’s behalf', wrongSide.status)

const paid = await api(`/api/groups/${group.group.id}/settlements/${settlementId}/confirm`, {
  method: 'POST',
  auth: priya,
  body: { action: 'paid' },
})
check(paid.payload.settlements[0].status === 'payer_confirmed', 'payer confirmation is staged')

const received = await api(`/api/groups/${group.group.id}/settlements/${settlementId}/confirm`, {
  method: 'POST',
  auth: arjun,
  body: { action: 'received' },
})
check(received.payload.settlements[0].status === 'confirmed', 'both sides confirm the payment')

/* 11. group settings */
const renamed = await api(`/api/groups/${group.group.id}`, {
  method: 'PATCH',
  auth: arjun,
  body: { name: 'Smoke Trip 2', emoji: '🏝️' },
})
check(renamed.payload.group.name === 'Smoke Trip 2', 'group can be renamed')
const closed = await api(`/api/groups/${group.group.id}`, {
  method: 'PATCH',
  auth: arjun,
  body: { status: 'closed' },
})
check(closed.payload.group.status === 'closed', 'group can be closed')
const blocked = await api(`/api/groups/${group.group.id}/expenses`, {
  method: 'POST',
  expected: 403,
  auth: arjun,
  body: {
    description: 'After close',
    amountPaise: 100,
    date: Date.now(),
    category: 'other',
    payers: [{ memberId: arjun.memberId, amountPaise: 100 }],
    split: { mode: 'equal', participants: [arjun.memberId] },
  },
})
check(blocked.status === 403, 'closed group refuses new expenses', blocked.status)

/* 12. invite tokens cannot be used on another group */
const other = await api('/api/groups', {
  method: 'POST',
  body: { name: 'Other group', emoji: '🧾', memberName: 'Neha', upiId: '' },
})
const crossRead = await api(`/api/groups/${other.payload.group.id}`, { auth: arjun })
check(crossRead.status === 401, 'a token from one group cannot read another', crossRead.status)

/* 13. realtime refuses non-members */
const denied = await api('/api/realtime/ticket', {
  method: 'POST',
  expected: 401,
  auth: { memberId: 'm_notreal', token: 'x' },
  body: { room: `group:${group.group.id}` },
})
check(denied.status === 401, 'realtime ticket requires group membership', denied.status)

socket?.close()

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`)
process.exit(failures === 0 ? 0 : 1)
