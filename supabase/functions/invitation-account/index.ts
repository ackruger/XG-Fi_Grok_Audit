import { createClient } from 'npm:@supabase/supabase-js@2.49.1';
import { handleAccount, corsHeaders } from './core.ts';

Deno.serve(async (req: Request) => {
  try {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_ANON_KEY')!;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return await handleAccount(req, {
    async lookup(token) {
      const { data, error } = await client.rpc('lookup_facility_invitation', { p_token: token });
      if (error) throw new Error('Invitation lookup failed');
      return data && typeof data.email === 'string' ? { email: data.email } : null;
    },
    async create(email, password, firstName, lastName) {
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { name: `${firstName} ${lastName}`, first_name: firstName, last_name: lastName } } });
      if (error || !data.session) return null;
      return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
    },
    async accept(accessToken, token, firstName, lastName) {
      const authenticated = createClient(url, key, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
      const { data, error } = await authenticated.rpc('accept_facility_invitation', { p_token: token, p_first_name: firstName, p_last_name: lastName });
      if (error || !data || typeof data.facility_id !== 'string' || typeof data.organization_id !== 'string') return null;
      return data;
    },
  });
  } catch {
    return new Response(JSON.stringify({ error: 'Account setup is unavailable right now. Please try again later.' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
});
