import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleAccount, validateAccount, type AccountDeps } from '../supabase/functions/invitation-account/core.ts'

const body = { token: 'a'.repeat(64), firstName: ' Jane ', lastName: ' Doe ', password: 'StrongPassword123', confirmPassword: 'StrongPassword123', email: 'attacker@example.com' }
const request = (input: unknown = body) => new Request('https://test.local/account', { method: 'POST', body: JSON.stringify(input) })
function dependencies(overrides: Partial<AccountDeps> = {}): AccountDeps {
  return { lookup: async () => ({ email: 'invited@example.com' }), create: async () => ({ access_token: 'access', refresh_token: 'refresh' }), accept: async () => ({ facility_id: 'facility', organization_id: 'organization' }), ...overrides }
}

test('requires both names, strong matching passwords and a valid token', () => {
  for (const change of [{ firstName: ' ' }, { lastName: '' }, { token: 'bad' }, { password: 'short' }, { confirmPassword: 'Different12345' }, { password: 'lowercase123456', confirmPassword: 'lowercase123456' }]) assert.equal(validateAccount({ ...body, ...change }), null)
  assert.equal(validateAccount(body)?.firstName, 'Jane')
})
test('creates credentials only for the invited email and accepts before returning a session', async () => {
  const calls: string[] = []
  const response = await handleAccount(request(), dependencies({
    create: async (email, password, first, last) => { assert.equal(email, 'invited@example.com'); assert.equal(password, body.password); assert.equal(first, 'Jane'); assert.equal(last, 'Doe'); calls.push('create'); return { access_token: 'access', refresh_token: 'refresh' } },
    accept: async (access, token) => { assert.equal(access, 'access'); assert.equal(token, body.token); calls.push('accept'); return { facility_id: 'facility', organization_id: 'organization' } },
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(calls, ['create', 'accept'])
  assert.equal((await response.json()).session.access_token, 'access')
})
test('invalid expired or used invitations never create an account', async () => {
  const response = await handleAccount(request(), dependencies({ lookup: async () => null, create: async () => { assert.fail('must not create'); return null } }))
  assert.equal(response.status, 400)
})
test('existing-account or missing-session result never grants membership', async () => {
  const response = await handleAccount(request(), dependencies({ create: async () => null, accept: async () => { assert.fail('must not accept'); return null } }))
  assert.equal(response.status, 409)
  assert.equal((await response.json()).session, undefined)
})
test('cancellation or expiry during setup does not return authentication tokens', async () => {
  const response = await handleAccount(request(), dependencies({ accept: async () => null }))
  assert.equal(response.status, 409)
  assert.equal((await response.json()).session, undefined)
})
test('errors are generic and all responses carry CORS and no-store headers', async () => {
  for (const response of [await handleAccount(request(), dependencies({ lookup: async () => { throw new Error('secret database details') } })), await handleAccount(request({}), dependencies()), await handleAccount(new Request('https://test.local', { method: 'OPTIONS' }), dependencies())]) {
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*')
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    assert.ok(!(await response.text()).includes('secret database details'))
  }
})
