/* Phone-account smoke test: registration, uniqueness, PIN check, group restore.
 *
 *   node scripts/auth-smoke.mjs                 (against local wrangler dev)
 *   API_ORIGIN=https://… node scripts/auth-smoke.mjs
 */

const API = process.env.API_ORIGIN ?? 'http://127.0.0.1:8787'

let failures = 0
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => null)
  return { status: response.status, payload }
}

const phone = `9${String(Date.now()).slice(-9)}`
const pin = '4321'

console.log(`\nRupeeSplit account smoke test → ${API}\n`)

const registered = await call('/api/auth/register', {
  method: 'POST',
  body: { name: 'Auth Tester', upiId: 'tester@okaxis', phone, pin },
})
check('register returns 201', registered.status === 201, String(registered.status))
check('register issues an account token', Boolean(registered.payload?.token))
check('register returns the phone back', registered.payload?.user?.phone === phone)

const duplicate = await call('/api/auth/register', {
  method: 'POST',
  body: { name: 'Copycat', upiId: '', phone, pin: '1111' },
})
check('a phone number can only register once', duplicate.status === 409, String(duplicate.status))

const wrongPin = await call('/api/auth/login', {
  method: 'POST',
  body: { phone, pin: '0000' },
})
check('wrong PIN is rejected', wrongPin.status === 401, String(wrongPin.status))

const shortPin = await call('/api/auth/register', {
  method: 'POST',
  body: { name: 'X', phone: `8${String(Date.now()).slice(-9)}`, pin: '12' },
})
check('a short PIN is rejected', shortPin.status === 400, String(shortPin.status))

// Create a group while signed in, so the membership is linked to the account.
const group = await call('/api/groups', {
  method: 'POST',
  headers: { 'x-rt-user': registered.payload.token },
  body: {
    name: 'Account Trip',
    emoji: '🏖️',
    memberName: 'Auth Tester',
    upiId: 'tester@okaxis',
  },
})
check('group created while signed in', group.status === 201, String(group.status))

// Members added by name, before they have the app.
const groupAuth = { 'x-rt-member': group.payload.me.id, 'x-rt-token': group.payload.token }
const groupId = group.payload.group.id

const added = await call(`/api/groups/${groupId}/members`, {
  method: 'POST',
  headers: groupAuth,
  body: { name: 'Ravi', upiId: 'ravi@okaxis' },
})
check('a person can be added by name', added.status === 201, String(added.status))
const ravi = (added.payload?.group?.members ?? []).find((member) => member.name === 'Ravi')
check('the added person is marked as not joined', ravi?.isPlaceholder === true)
check('the added person counts as a member', (added.payload?.group?.members ?? []).length === 2)
check('placeholders never receive a token', ravi?.tokenHash === undefined)

const duplicateName = await call(`/api/groups/${groupId}/members`, {
  method: 'POST',
  headers: groupAuth,
  body: { name: 'ravi' },
})
check('the same name cannot be added twice', duplicateName.status === 409, String(duplicateName.status))

// When Ravi actually joins with the invite code, he takes over the placeholder.
const claim = await call('/api/groups/join', {
  method: 'POST',
  body: { code: group.payload.code, memberName: 'Ravi', upiId: 'ravi@okaxis' },
})
check('joining with a matching name succeeds', claim.status === 201, String(claim.status))
check('the joining person claims the placeholder row', claim.payload?.me?.id === ravi?.id)
check(
  'claiming does not create a duplicate member',
  (claim.payload?.group?.members ?? []).length === 2,
  `got ${(claim.payload?.group?.members ?? []).length}`,
)
check('the claimed member is no longer a placeholder', claim.payload?.group?.members?.find((m) => m.id === ravi?.id)?.isPlaceholder === undefined)

const removeClaimed = await call(`/api/groups/${groupId}/members/${ravi?.id}`, {
  method: 'DELETE',
  headers: groupAuth,
})
check('a real member cannot be removed', removeClaimed.status === 403, String(removeClaimed.status))

const spare = await call(`/api/groups/${groupId}/members`, {
  method: 'POST',
  headers: groupAuth,
  body: { name: 'Meera' },
})
const meera = (spare.payload?.group?.members ?? []).find((member) => member.name === 'Meera')
const removed = await call(`/api/groups/${groupId}/members/${meera?.id}`, {
  method: 'DELETE',
  headers: groupAuth,
})
check('an unused added person can be removed', removed.status === 200, String(removed.status))
check(
  'removing them leaves the real members alone',
  (removed.payload?.group?.members ?? []).length === 2,
  `got ${(removed.payload?.group?.members ?? []).length}`,
)

// Someone already on an expense stays in the ledger even if they never join.
const used = await call(`/api/groups/${groupId}/members`, {
  method: 'POST',
  headers: groupAuth,
  body: { name: 'Kavya', upiId: 'kavya@okaxis' },
})
const kavya = (used.payload?.group?.members ?? []).find((member) => member.name === 'Kavya')
const withKavya = await call(`/api/groups/${groupId}/expenses`, {
  method: 'POST',
  headers: groupAuth,
  body: {
    amountPaise: 60000,
    description: 'Cab to the beach',
    category: 'transport',
    date: Date.now(),
    payers: [{ memberId: group.payload.me.id, amountPaise: 60000 }],
    split: { mode: 'equal', participants: [group.payload.me.id, kavya?.id] },
  },
})
check('an added person can share an expense', withKavya.status === 201, String(withKavya.status))
const removeUsed = await call(`/api/groups/${groupId}/members/${kavya?.id}`, {
  method: 'DELETE',
  headers: groupAuth,
})
check(
  'an added person with money on the books cannot be removed',
  removeUsed.status === 409,
  String(removeUsed.status),
)
check(
  'their share still counts after the refusal',
  (await call(`/api/groups/${groupId}`, { headers: groupAuth })).payload?.group?.members?.some(
    (member) => member.id === kavya?.id,
  ) === true,
)

const login = await call('/api/auth/login', { method: 'POST', body: { phone, pin } })
check('login succeeds with the right PIN', login.status === 200, String(login.status))
check('login rotates the account token', login.payload?.token && login.payload.token !== registered.payload.token)

const memberships = login.payload?.memberships ?? []
check('login restores the group list', memberships.length === 1, `got ${memberships.length}`)
const restored = memberships[0]
check('restored membership is for the right group', restored?.groupId === group.payload?.group?.id)
check('restored membership carries a usable token', typeof restored?.token === 'string' && restored.token.length > 20)

if (restored) {
  const snapshot = await call(`/api/groups/${restored.groupId}`, {
    headers: { 'x-rt-member': restored.memberId, 'x-rt-token': restored.token },
  })
  check('restored token can read the ledger', snapshot.status === 200, String(snapshot.status))
  check(
    'restored snapshot identifies the phone member',
    snapshot.payload?.me?.name === 'Auth Tester',
    snapshot.payload?.me?.name,
  )
  check(
    'restored ledger comes back with what was recorded',
    (snapshot.payload?.expenses ?? []).length === 1 &&
      snapshot.payload?.expenses?.[0]?.description === 'Cab to the beach',
    String((snapshot.payload?.expenses ?? []).length),
  )
}

const oldTokenAfterLogout = await call('/api/auth/logout', {
  method: 'POST',
  headers: { 'x-rt-user': login.payload.token },
})
check('logout succeeds', oldTokenAfterLogout.status === 200, String(oldTokenAfterLogout.status))

const afterLogout = await call('/api/groups', {
  method: 'POST',
  headers: { 'x-rt-user': login.payload.token },
  body: { name: 'Nope', emoji: '🚫', memberName: 'Ghost', upiId: '' },
})
check(
  'a revoked account token no longer links new groups',
  afterLogout.status === 201 && afterLogout.payload?.group?.members?.[0]?.userId === undefined,
)

console.log(
  failures === 0 ? '\nAll account checks passed.\n' : `\n${failures} check(s) failed.\n`,
)
process.exit(failures === 0 ? 0 : 1)
