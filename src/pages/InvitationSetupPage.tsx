import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { env } from '../lib/env'
import { useAuth } from '../context/AuthContext'
import { useFacility } from '../context/FacilityContext'
import { fetchWithTimeout } from '../lib/fetchWithTimeout'

interface Invitation { email: string; facility_name: string; expires_at: string }

export default function InvitationSetupPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { refreshProfile } = useAuth()
  const { refreshAll } = useFacility()
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || ''
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [checking, setChecking] = useState(true)
  const [existing, setExisting] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setChecking(true)
    setInvitation(null)
    setError('')
    setFirstName('')
    setLastName('')
    setPassword('')
    setConfirmPassword('')
    void Promise.resolve(supabase.rpc('lookup_facility_invitation', { p_token: token })).then(({ data, error: lookupError }) => {
      if (!active) return
      if (lookupError || !data || typeof data.email !== 'string' || typeof data.facility_name !== 'string' || typeof data.expires_at !== 'string') {
        setError('This invitation is invalid, expired or already used. Ask your administrator to resend it.')
      } else setInvitation(data)
      setChecking(false)
    }).catch(() => {
      if (!active) return
      setError('Could not check your invitation. Please try again later.')
      setChecking(false)
    })
    return () => { active = false }
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!invitation || busy) return
    setError('')
    if (!existing && (password.length < 12 || password.length > 128 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || password !== confirmPassword)) {
      setError('Use matching passwords of 12–128 characters with uppercase, lowercase and a number.')
      return
    }
    setBusy(true)
    try {
      let tokens: { access_token: string; refresh_token: string }
      let membership: { facility_id: string; organization_id: string }
      if (existing) {
        const isolated = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
        const { data, error: signInError } = await isolated.auth.signInWithPassword({ email: invitation.email, password })
        if (signInError || !data.session) throw new Error('Could not sign in. Check your password or reset it from the normal sign-in page.')
        const { data: accepted, error: acceptError } = await isolated.rpc('accept_facility_invitation', { p_token: token, p_first_name: firstName.trim(), p_last_name: lastName.trim() })
        if (acceptError || !accepted?.facility_id || !accepted?.organization_id) throw new Error('The invitation could not be accepted. It may have expired or been cancelled. Ask your administrator to resend it.')
        tokens = data.session
        membership = accepted
      } else {
        const response = await fetchWithTimeout(`${env.SUPABASE_URL}/functions/v1/invitation-account`, {
          timeout: 30000, method: 'POST', headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, firstName, lastName, password, confirmPassword }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Account setup could not finish. Try signing in if you already have an account.')
        if (!data.session?.access_token || !data.session?.refresh_token || typeof data.facility_id !== 'string' || typeof data.organization_id !== 'string') throw new Error('Account setup returned an incomplete result. Please sign in and try again.')
        tokens = data.session
        membership = data
      }
      localStorage.setItem('xgfi_current_org', membership.organization_id)
      localStorage.setItem('xgfi_current_facility', membership.facility_id)
      const { data: authenticated, error: sessionError } = await supabase.auth.setSession(tokens)
      if (sessionError || !authenticated.session) throw new Error('Your invitation was accepted, but sign-in did not finish. Please use the normal sign-in page.')
      await refreshProfile()
      await refreshAll()
      setPassword('')
      setConfirmPassword('')
      navigate('/dashboard', { replace: true })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Account setup could not finish. Please try again.')
    } finally { setBusy(false) }
  }

  const inputClass = 'w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm text-neutral-900 focus:outline-none focus:ring-2 focus:ring-primary-400'
  return (
    <div className="min-h-full bg-neutral-50 flex items-center justify-center p-4 py-8">
      <div className="w-full max-w-md bg-white border border-neutral-200 rounded-2xl shadow-sm p-6">
        <p className="text-sm font-semibold text-primary-700 mb-2">Xg-Fi</p>
        <h1 className="text-2xl font-semibold text-neutral-900">{existing ? 'Sign in to accept' : 'Set up your account'}</h1>
        {checking ? <p className="mt-4 text-neutral-700">Checking your invitation…</p> : invitation && <>
          <p className="mt-2 text-sm text-neutral-600 leading-relaxed">Join {invitation.facility_name}. Your invitation expires {new Date(invitation.expires_at).toLocaleDateString()}.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="text-sm text-neutral-800">First Name<input className={`${inputClass} mt-2`} autoComplete="given-name" value={firstName} onChange={e => setFirstName(e.target.value)} required maxLength={100} disabled={busy} /></label>
              <label className="text-sm text-neutral-800">Last Name<input className={`${inputClass} mt-2`} autoComplete="family-name" value={lastName} onChange={e => setLastName(e.target.value)} required maxLength={100} disabled={busy} /></label>
            </div>
            <label className="block text-sm text-neutral-800">Email Address<input type="email" className={`${inputClass} mt-2 bg-neutral-100`} value={invitation.email} readOnly autoComplete="username" /></label>
            <label className="block text-sm text-neutral-800">{existing ? 'Password' : 'Create Password'}<input type="password" className={`${inputClass} mt-2`} autoComplete={existing ? 'current-password' : 'new-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={existing ? 1 : 12} maxLength={128} disabled={busy} /></label>
            {!existing && <>
              <p className="text-xs text-neutral-600 leading-relaxed">Use 12–128 characters, including uppercase, lowercase and a number.</p>
              <label className="block text-sm text-neutral-800">Confirm Password<input type="password" className={`${inputClass} mt-2`} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required disabled={busy} /></label>
            </>}
            <button disabled={busy} className="w-full rounded-xl bg-primary-700 hover:bg-primary-800 text-white px-4 py-3 text-sm font-medium disabled:opacity-60">{busy ? 'Please wait…' : existing ? 'Sign In and Accept Invitation' : 'Create Account'}</button>
            <button type="button" disabled={busy} onClick={() => { setExisting(!existing); setError(''); setPassword(''); setConfirmPassword('') }} className="w-full text-sm font-medium text-primary-700 py-2">{existing ? 'Need a new account? Create Account' : 'Already have an account? Sign In'}</button>
          </form>
        </>}
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-800">{error}</p>}
        {!checking && <button type="button" disabled={busy} onClick={() => navigate('/')} className="mt-4 w-full py-2 text-sm font-medium text-primary-700 disabled:opacity-60">Return to Xg-Fi</button>}
      </div>
    </div>
  )
}
