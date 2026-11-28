export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

export function validateAccount(body: unknown): { token: string; firstName: string; lastName: string; password: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.token !== 'string' || !/^[a-f0-9]{64}$/.test(b.token)) return null;
  if (typeof b.firstName !== 'string' || typeof b.lastName !== 'string') return null;
  const firstName = b.firstName.trim();
  const lastName = b.lastName.trim();
  if (!firstName || !lastName || firstName.length > 100 || lastName.length > 100) return null;
  if (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 128 || !/[a-z]/.test(b.password) || !/[A-Z]/.test(b.password) || !/[0-9]/.test(b.password) || b.password !== b.confirmPassword) return null;
  return { token: b.token, firstName, lastName, password: b.password };
}

export interface AccountDeps {
  lookup(token: string): Promise<{ email: string } | null>;
  create(email: string, password: string, firstName: string, lastName: string): Promise<{ access_token: string; refresh_token: string } | null>;
  accept(accessToken: string, token: string, firstName: string, lastName: string): Promise<{ facility_id: string; organization_id: string } | null>;
}

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function handleAccount(req: Request, deps: AccountDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return response(null);
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  try {
    const body = await req.json().catch(() => null);
    const input = validateAccount(body);
    if (!input) return response({ error: 'Enter both names and matching passwords of 12–128 characters, including uppercase, lowercase and a number.' }, 400);
    const invitation = await deps.lookup(input.token);
    if (!invitation) return response({ error: 'This invitation is invalid, expired or already used. Ask an administrator for a new invitation.' }, 400);
    const session = await deps.create(invitation.email, input.password, input.firstName, input.lastName);
    if (!session) return response({ error: 'Account setup could not finish. If you already have an account, use Sign In instead. Otherwise, try again later.' }, 409);
    const membership = await deps.accept(session.access_token, input.token, input.firstName, input.lastName);
    if (!membership) return response({ error: 'Your account was created, but the invitation could not be accepted. Sign in and try the invitation again, or ask an administrator for a new one.' }, 409);
    return response({ session, ...membership });
  } catch {
    return response({ error: 'Account setup is unavailable right now. Please try again later.' }, 500);
  }
}
