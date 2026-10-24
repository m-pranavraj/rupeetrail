// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import App from './App'
import { LedgerProvider } from './lib/store'
import type { GroupSnapshot } from './lib/api'
import type { Expense } from './types'

const GROUP_ID = 'g_test'
const ME = 'm_arjun'
const PRIYA = 'm_priya'
const TOKEN = 'device-token'
const CODE = '7KQ4M2'

function baseSnapshot(): GroupSnapshot {
  return {
    revision: 4,
    code: CODE,
    me: { id: ME, name: 'Arjun', upiId: 'arjun@okaxis', color: 0 },
    group: {
      id: GROUP_ID,
      name: 'Goa plan',
      emoji: '🏖️',
      status: 'active',
      createdAt: Date.now() - 86400000,
      currency: 'INR',
      members: [
        { id: ME, name: 'Arjun', upiId: 'arjun@okaxis', color: 0, joinedAt: Date.now() - 86400000 },
        { id: PRIYA, name: 'Priya', upiId: 'priya@ybl', color: 1, joinedAt: Date.now() - 86400000 },
      ],
    },
    expenses: [
      {
        id: 'e_dinner',
        groupId: GROUP_ID,
        description: 'Dinner',
        amountPaise: 100000,
        date: Date.now() - 3600000,
        category: 'food',
        payers: [{ memberId: ME, amountPaise: 100000 }],
        split: { mode: 'equal', participants: [ME, PRIYA] },
        notes: 'Two of us',
        createdBy: ME,
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now() - 3600000,
        acks: { [ME]: 'acknowledged', [PRIYA]: 'pending' },
        revision: 1,
      },
    ],
    settlements: [],
  }
}

function seedDevice() {
  localStorage.setItem(
    'rupeetrail.identity.v3',
    JSON.stringify({ name: 'Arjun', upiId: 'arjun@okaxis' }),
  )
  localStorage.setItem(
    'rupeetrail.memberships.v3',
    JSON.stringify([
      {
        groupId: GROUP_ID,
        memberId: ME,
        token: TOKEN,
        groupName: 'Goa plan',
        emoji: '🏖️',
        name: 'Arjun',
        upiId: 'arjun@okaxis',
        joinedAt: Date.now(),
      },
    ]),
  )
  localStorage.setItem(`rupeetrail.cache.v3.${GROUP_ID}`, JSON.stringify(baseSnapshot()))
}

let server = baseSnapshot()
let rejectExpense: string | null = null
let fetchMock: ReturnType<typeof vi.fn>

function respond(data: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

beforeEach(() => {
  server = baseSnapshot()
  rejectExpense = null
  localStorage.clear()
  window.location.hash = '#/'
  cleanup()

  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()

    if (url.endsWith('/api/auth/register') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'))
      return respond(
        {
          token: TOKEN,
          user: {
            id: 'u_test',
            name: body.name ?? 'Arjun',
            upiId: body.upiId ?? '',
            phone: body.phone ?? '9876543210',
          },
          memberships: [],
        },
        201,
      )
    }
    if (url.endsWith('/api/auth/login') && method === 'POST') {
      return respond({
        token: TOKEN,
        user: { id: 'u_test', name: 'Arjun', upiId: 'arjun@okaxis', phone: '9876543210' },
        memberships: [],
      })
    }
    if (url.endsWith('/api/auth/logout') && method === 'POST') {
      return respond({ ok: true })
    }
    if (url.includes('/api/realtime/ticket')) {
      return respond({ error: 'Live updates are not available on this deployment.' }, 503)
    }
    if (url.includes('/api/invite/')) {
      return respond({ id: GROUP_ID, code: CODE, name: 'Goa plan', emoji: '🏖️', memberCount: 2, status: 'active', closed: false })
    }
    if (url.endsWith('/api/groups') && method === 'POST') {
      return respond({ ...server, token: TOKEN }, 201)
    }
    if (url.includes('/api/groups/join') && method === 'POST') {
      return respond({ ...server, token: TOKEN }, 201)
    }
    if (url.endsWith(`/api/groups/${GROUP_ID}`) && method === 'GET') {
      return respond(server)
    }
    if (url.endsWith('/members') && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}'))
      const member = {
        id: 'm_ravi',
        name: body.name,
        upiId: body.upiId,
        color: 2,
        joinedAt: Date.now(),
        isPlaceholder: true,
      }
      server = {
        ...server,
        group: { ...server.group, members: [...server.group.members, member] },
        revision: server.revision + 1,
      }
      return respond(server, 201)
    }
    if (url.includes('/expenses') && method === 'POST') {
      if (rejectExpense) return respond({ error: rejectExpense }, 400)
      const body = JSON.parse(String(init?.body ?? '{}'))
      const expense: Expense = {
        id: 'e_new',
        groupId: GROUP_ID,
        description: body.description,
        amountPaise: body.amountPaise,
        date: body.date,
        category: body.category,
        payers: body.payers,
        split: body.split,
        notes: body.notes,
        createdBy: ME,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        acks: { [ME]: 'acknowledged', [PRIYA]: 'pending' },
        revision: 1,
      }
      server = { ...server, expenses: [...server.expenses, expense], revision: server.revision + 1 }
      return respond(server, 201)
    }
    return respond({ error: 'Not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderApp() {
  return render(
    <LedgerProvider>
      <App />
    </LedgerProvider>,
  )
}

describe('first run', () => {
  it('asks for a name and UPI id, then shows an empty group list', async () => {
    const user = userEvent.setup()
    renderApp()

    expect(screen.getByText(/Two things, then you’re in/i)).toBeTruthy()
    await user.type(screen.getByPlaceholderText('e.g. Arjun'), 'Arjun')
    await user.type(screen.getByPlaceholderText('name@okhdfcbank'), 'arjun@okaxis')
    await user.type(screen.getByPlaceholderText('9876543210'), '9876543210')
    await user.type(screen.getByPlaceholderText('••••'), '1234')
    await user.click(screen.getByRole('button', { name: /Continue/i }))

    expect(await screen.findByText('Your groups')).toBeTruthy()
    expect(screen.getByText('No groups yet')).toBeTruthy()
    expect(screen.getByText('Arjun')).toBeTruthy()
  })

  it('rejects a malformed UPI id before continuing', async () => {
    const user = userEvent.setup()
    renderApp()

    await user.type(screen.getByPlaceholderText('e.g. Arjun'), 'Arjun')
    await user.type(screen.getByPlaceholderText('name@okhdfcbank'), 'not-a-upi')
    await user.click(screen.getByRole('button', { name: /Continue/i }))

    expect(await screen.findByText(/UPI ids look like/i)).toBeTruthy()
    expect(screen.queryByText('Your groups')).toBeNull()
  })
})

describe('shared groups', () => {
  it('lists the groups this phone belongs to with my position', async () => {
    seedDevice()
    renderApp()

    expect(await screen.findByText('Goa plan')).toBeTruthy()
    expect(screen.getAllByText(/₹500/).length).toBeGreaterThan(0)
    expect(screen.getByText('gets back')).toBeTruthy()
  })

  it('opens a group, shows expenses and the live sync state', async () => {
    seedDevice()
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByText('Goa plan'))
    expect(await screen.findByText('Dinner')).toBeTruthy()
    expect(screen.getAllByText(/syncing|live|connecting/i).length).toBeGreaterThan(0)
    // Single snapshot fetch on open, then polling as a fallback.
    const ticketCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/realtime/ticket'))
    expect(ticketCalls.length).toBeGreaterThan(0)
  })

  it('shows an invite link carrying this group’s code', async () => {
    seedDevice()
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByText('Goa plan'))
    await user.click(await screen.findByRole('button', { name: /Invite people/i }))

    const dialog = await screen.findByRole('dialog')
    const link = within(dialog).getByLabelText('Invite link') as HTMLInputElement
    expect(link.value).toContain(`#/join/${CODE}`)
    expect(within(dialog).getAllByText(CODE).length).toBeGreaterThan(0)
    expect(within(dialog).getByText('priya@ybl')).toBeTruthy()
  })

  it('adds someone by name before they join', async () => {
    seedDevice()
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByText('Goa plan'))
    await user.click(await screen.findByRole('button', { name: /Invite people/i }))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByPlaceholderText('e.g. Priya'), 'Ravi')
    await user.click(within(dialog).getByRole('button', { name: /Add to group/i }))

    expect(await within(dialog).findByText('Ravi')).toBeTruthy()
    expect(within(dialog).getByText('not joined')).toBeTruthy()

    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/members') && (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(JSON.parse(String(post?.[1]?.body)).name).toBe('Ravi')
  })

  it('does not treat someone added by name as a pending confirmation', async () => {
    seedDevice()
    server = {
      ...server,
      group: {
        ...server.group,
        members: [
          ...server.group.members,
          { id: 'm_ravi', name: 'Ravi', upiId: 'ravi@okaxis', color: 2, joinedAt: Date.now(), isPlaceholder: true },
        ],
      },
      expenses: [{ ...server.expenses[0], acks: { [ME]: 'acknowledged', [PRIYA]: 'acknowledged' } }],
    }
    localStorage.setItem(`rupeetrail.cache.v3.${GROUP_ID}`, JSON.stringify(server))
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByText('Goa plan'))
    await user.click(await screen.findByRole('tab', { name: 'Balances' }))
    expect(await screen.findByText('Every expense confirmed by all members')).toBeTruthy()
    expect(screen.getByText('not joined')).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: 'Expenses' }))
    await user.click(await screen.findByText('Dinner'))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Not joined yet')).toBeTruthy()
    expect(within(dialog).getByText('2/2 confirmed')).toBeTruthy()
  })

  it('adds an expense through the shared API and shows it immediately', async () => {
    seedDevice()
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByText('Goa plan'))
    await user.click(await screen.findByRole('button', { name: 'Add expense' }))
    const dialog = await screen.findByRole('dialog')

    await user.type(within(dialog).getByLabelText('Amount in rupees'), '900')
    await user.type(within(dialog).getByPlaceholderText('e.g. Beach shack dinner'), 'Sunset cruise')
    await user.click(within(dialog).getByRole('button', { name: 'Add expense' }))

    expect(await screen.findByText('Sunset cruise')).toBeTruthy()
    const post = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/expenses') && (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(post).toBeTruthy()
    expect(JSON.parse(String(post?.[1]?.body)).amountPaise).toBe(90000)
  })

  it('keeps the form open and surfaces the server’s complaint', async () => {
    seedDevice()
    rejectExpense = 'Payer amounts must add up to the expense total.'
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByText('Goa plan'))
    await user.click(await screen.findByRole('button', { name: 'Add expense' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Amount in rupees'), '500')
    await user.type(within(dialog).getByPlaceholderText('e.g. Beach shack dinner'), 'Bad one')
    await user.click(within(dialog).getByRole('button', { name: 'Add expense' }))

    expect(await screen.findByText(/Payer amounts must add up/i)).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('offers a UPI payment link for the suggested transfer', async () => {
    seedDevice()
    const user = userEvent.setup()
    renderApp()

    await user.click(await screen.findByText('Goa plan'))
    await user.click(await screen.findByRole('tab', { name: 'Settle' }))

    const payLink = await screen.findByRole('link', { name: /Pay Arjun by UPI/i })
    expect(payLink.getAttribute('href')).toContain('upi://pay?')
    expect(payLink.getAttribute('href')).toContain('pa=arjun%40okaxis')
    expect(await screen.findByText('Suggested plan')).toBeTruthy()
  })
})

describe('invite links', () => {
  it('previews the group before joining', async () => {
    localStorage.setItem('rupeetrail.identity.v3', JSON.stringify({ name: 'Arjun', upiId: 'arjun@okaxis' }))
    window.location.hash = `#/join/${CODE}`
    renderApp()

    expect(await screen.findByText('You’re invited to')).toBeTruthy()
    expect(screen.getByText('Goa plan')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Join group/i })).toBeTruthy()
  })

  it('asks for a name before joining when this device is new', async () => {
    window.location.hash = `#/join/${CODE}`
    renderApp()

    expect(await screen.findByText(/Join “Goa plan”/i)).toBeTruthy()
    expect(screen.getByPlaceholderText('e.g. Arjun')).toBeTruthy()
  })

  it('joins straight from the invite link once details are entered', async () => {
    window.location.hash = `#/join/${CODE}`
    const user = userEvent.setup()
    renderApp()

    await user.type(await screen.findByPlaceholderText('e.g. Arjun'), 'Priya')
    await user.type(screen.getByPlaceholderText('name@okhdfcbank'), 'priya@ybl')
    await user.type(screen.getByPlaceholderText('9876543210'), '9876543211')
    await user.type(screen.getByPlaceholderText('••••'), '4321')
    await user.click(screen.getByRole('button', { name: /Join group/i }))

    expect(await screen.findByText('Dinner')).toBeTruthy()
    const joinCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/api/groups/join') && (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(joinCall).toBeTruthy()
    expect(JSON.parse(String((joinCall?.[1] as RequestInit | undefined)?.body)).memberName).toBe('Priya')
  })
})
