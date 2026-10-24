import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildInviteEmail,
  escapeHtml,
  handleInvite,
  resolveAppOrigin,
  validateRequest,
  type InviteDeps,
} from '../supabase/functions/send-invitation-email/core.ts'

const FACILITY = '11111111-1111-4111-8111-111111111111'

function makeDeps(overrides: Partial<InviteDeps> = {}) {
  const sent: { to: string; subject: string; html: string; text: string }[] = []
  const finished: { status: string; error: string | null }[] = []
  const deps: InviteDeps = {
    resendKey: 'test-key',
    appUrl: 'https://app.example.com/some/path',
    getUser: async () => ({ id: 'user-1', email: 'boss@example.com' }),
    getFacilityRole: async () => 'admin',
    findPendingInvitation: async () => ({ id: 'inv-1' }),
    getFacilityName: async () => 'Plant <script>alert(1)</script>',
    getInviterName: async () => 'Eve "the" <b>Admin</b>',
    countSenderSends: async () => 0,
    countInvitationSends: async () => 0,
    logSend: async () => 'log-1',
    finishSend: async (_id, status, error) => { finished.push({ status, error }) },
    sendEmail: async (msg) => { sent.push(msg); return { ok: true } },
    ...overrides,
  }
  return { deps, sent, finished }
}

function request(body: unknown, method = 'POST') {
  return new Request('https://fn.local/send-invitation-email', {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  })
}

const validBody = {
  email: 'New.Person@Example.com',
  role: 'contributor',
  facilityId: FACILITY,
  facilityName: 'Spoofed Facility',
  inviterName: 'Spoofed Inviter',
}

test('escapeHtml escapes all HTML-significant characters', () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
})

test('resolveAppOrigin only trusts https configuration and returns null when unconfigured', () => {
  assert.equal(resolveAppOrigin('https://app.example.com/x?y=1'), 'https://app.example.com')
  assert.equal(resolveAppOrigin('http://app.example.com'), null)
  assert.equal(resolveAppOrigin('javascript:alert(1)'), null)
  assert.equal(resolveAppOrigin('https://user:pw@app.example.com'), null)
  assert.equal(resolveAppOrigin(undefined), null)
  assert.equal(resolveAppOrigin(null), null)
  assert.equal(resolveAppOrigin(''), null)
})

test('validateRequest rejects bad email, role and facility', () => {
  assert.equal(validateRequest({ ...validBody, email: 'not-an-email' }).ok, false)
  assert.equal(validateRequest({ ...validBody, email: `${'a'.repeat(250)}@x.com` }).ok, false)
  assert.equal(validateRequest({ ...validBody, email: 'a<b>@x.com' }).ok, false)
  assert.equal(validateRequest({ ...validBody, role: 'owner' }).ok, false)
  assert.equal(validateRequest({ ...validBody, facilityId: 'abc' }).ok, false)
  const ok = validateRequest(validBody)
  assert.ok(ok.ok && ok.value.email === 'new.person@example.com')
})

test('buildInviteEmail escapes names and includes the trusted sign-in link', () => {
  const msg = buildInviteEmail({
    facilityName: '<img src=x onerror=alert(1)>',
    inviterName: 'A & B',
    role: 'admin',
    email: 'x@example.com',
    appOrigin: 'https://app.example.com',
  })
  assert.ok(!msg.html.includes('<img src=x'))
  assert.ok(msg.html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert.ok(msg.html.includes('A &amp; B'))
  assert.ok(msg.html.includes('href="https://app.example.com/dashboard"'))
  assert.equal(msg.signInUrl, 'https://app.example.com/dashboard')
  assert.ok(msg.text.includes('https://app.example.com/dashboard'))
})

test('sends with server-resolved names and ignores caller Origin and names', async () => {
  const { deps, sent, finished } = makeDeps()
  const res = await handleInvite(request(validBody), deps)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
  assert.equal(sent.length, 1)
  const html = sent[0].html
  assert.ok(!html.includes('Spoofed'))
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('Plant &lt;script&gt;'))
  assert.ok(html.includes('Eve &quot;the&quot; &lt;b&gt;Admin&lt;/b&gt;'))
  assert.ok(html.includes('https://app.example.com/dashboard'))
  assert.ok(!html.includes('evil.example'))
  assert.equal(sent[0].to, 'new.person@example.com')
  assert.deepEqual(finished, [{ status: 'sent', error: null }])
})

test('rejects unauthenticated callers without sending', async () => {
  const { deps, sent } = makeDeps({ getUser: async () => null })
  const res = await handleInvite(request(validBody), deps)
  assert.equal(res.status, 401)
  assert.equal(sent.length, 0)
})

test('rejects callers without manage rights and supervisors inviting admins', async () => {
  for (const role of [null, 'viewer', 'contributor', 'reviewer']) {
    const { deps, sent } = makeDeps({ getFacilityRole: async () => role })
    const res = await handleInvite(request(validBody), deps)
    assert.equal(res.status, 403)
    assert.equal(sent.length, 0)
  }
  const { deps, sent } = makeDeps({ getFacilityRole: async () => 'supervisor' })
  const res = await handleInvite(request({ ...validBody, role: 'admin' }), deps)
  assert.equal(res.status, 403)
  assert.equal(sent.length, 0)
})

test('requires a matching pending invitation from this caller', async () => {
  const { deps, sent } = makeDeps({ findPendingInvitation: async () => null })
  const res = await handleInvite(request(validBody), deps)
  assert.equal(res.status, 403)
  assert.equal(sent.length, 0)
})

test('enforces durable rate limits', async () => {
  const a = makeDeps({ countSenderSends: async () => 20 })
  assert.equal((await handleInvite(request(validBody), a.deps)).status, 429)
  const b = makeDeps({ countInvitationSends: async () => 3 })
  assert.equal((await handleInvite(request(validBody), b.deps)).status, 429)
  assert.equal(a.sent.length + b.sent.length, 0)
})

test('reports provider failures and records them', async () => {
  const { deps, finished } = makeDeps({ sendEmail: async () => ({ ok: false, detail: 'Email provider returned status 500' }) })
  const res = await handleInvite(request(validBody), deps)
  assert.equal(res.status, 502)
  const body = await res.json()
  assert.match(body.error, /could not be sent/)
  assert.deepEqual(finished, [{ status: 'failed', error: 'Email provider returned status 500' }])
})

test('times out a hanging provider call', async () => {
  const { deps, finished } = makeDeps({
    timeoutMs: 20,
    sendEmail: (_msg, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }),
  })
  const res = await handleInvite(request(validBody), deps)
  assert.equal(res.status, 502)
  assert.deepEqual(finished, [{ status: 'failed', error: 'Email provider timed out' }])
})

test('returns 503 when the email service is not configured', async () => {
  const { deps } = makeDeps({ resendKey: undefined })
  assert.equal((await handleInvite(request(validBody), deps)).status, 503)
})

test('returns 503 when APP_URL is not configured', async () => {
  const { deps, sent } = makeDeps({ appUrl: undefined })
  const res = await handleInvite(request(validBody), deps)
  assert.equal(res.status, 503)
  assert.equal(sent.length, 0)
})

test('returns 503 when APP_URL is an invalid string', async () => {
  const { deps, sent } = makeDeps({ appUrl: 'not-a-url' })
  const res = await handleInvite(request(validBody), deps)
  assert.equal(res.status, 503)
  assert.equal(sent.length, 0)
})

test('rejects malformed input', async () => {
  const { deps } = makeDeps()
  assert.equal((await handleInvite(request({ ...validBody, email: 'bad' }), deps)).status, 400)
  assert.equal((await handleInvite(request({ ...validBody, role: 'root' }), deps)).status, 400)
})
