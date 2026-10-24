import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Session, User } from '@supabase/supabase-js'
import type { Profile } from '../types'

interface AuthContextType {
  session: Session | null
  profile: Profile | null
  loading: boolean
  passwordRecovery: boolean
  clearPasswordRecovery: () => void
  signUp: (email: string, password: string, name: string) => Promise<{ error: string | null }>
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

async function getOrCreateProfile(user: User): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to fetch profile: ${error.message}`)
  }

  if (data) return data as Profile

  const { data: newProfile, error: upsertError } = await supabase
    .from('profiles')
    .upsert({
      id: user.id,
      name: user.user_metadata?.name || '',
      email: user.email || '',
    }, { onConflict: 'id' })
    .select()
    .maybeSingle()

  if (upsertError) {
    throw new Error(`Failed to create profile: ${upsertError.message}`)
  }

  return newProfile as Profile | null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [authInitialized, setAuthInitialized] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const activeUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    activeUserIdRef.current = session?.user?.id ?? null
  }, [session?.user?.id])

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession()
      .then(({ data: { session: initialSession }, error }) => {
        if (cancelled) return

        if (error) {
          console.error('Failed to initialize auth session:', error.message)
          setSession(null)
        } else {
          setSession(initialSession)
        }

        setAuthInitialized(true)
      })
      .catch(error => {
        if (cancelled) return
        console.error('Failed to initialize auth session:', error)
        setSession(null)
        setAuthInitialized(true)
      })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      if (event === 'SIGNED_OUT') setPasswordRecovery(false)
      if (event === 'INITIAL_SESSION') return

      const nextUserId = nextSession?.user?.id ?? null
      const userChanged = nextUserId !== activeUserIdRef.current

      setSession(nextSession)
      setAuthInitialized(true)

      if (nextUserId) {
        // Supabase may emit SIGNED_IN/TOKEN_REFRESHED again when a tab regains focus.
        // Only show the global loading screen when the authenticated user actually changes.
        if (userChanged) {
          activeUserIdRef.current = nextUserId
          setLoading(true)
        }
      } else {
        activeUserIdRef.current = null
        setProfile(null)
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!authInitialized) return

    let cancelled = false
    const user = session?.user

    if (!user) {
      setProfile(null)
      setLoading(false)
      return
    }

    const userId = user.id
    activeUserIdRef.current = userId
    setLoading(true)

    const safetyTimer = setTimeout(() => {
      if (!cancelled && activeUserIdRef.current === userId) {
        setLoading(false)
      }
    }, 10000)

    void getOrCreateProfile(user)
      .then(nextProfile => {
        if (!cancelled && activeUserIdRef.current === userId) {
          setProfile(nextProfile)
        }
      })
      .catch(error => {
        console.error('Failed to load profile:', error)
        if (!cancelled && activeUserIdRef.current === userId) {
          setProfile(null)
        }
      })
      .finally(() => {
        clearTimeout(safetyTimer)
        if (!cancelled && activeUserIdRef.current === userId) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      clearTimeout(safetyTimer)
    }
  }, [authInitialized, session?.user?.id])

  async function signUp(email: string, password: string, name: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: window.location.origin,
      },
    })

    if (error) return { error: error.message }

    if (data.session) {
      setLoading(true)
      setSession(data.session)
      setAuthInitialized(true)
      return { error: null }
    }

    if (data.user) {
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
      if (signInErr) {
        return { error: 'Account created! Please check your email to confirm, then sign in.' }
      }
    }

    return { error: null }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    activeUserIdRef.current = null
    setProfile(null)
  }

  async function refreshProfile() {
    const user = session?.user
    if (!user) return

    const userId = user.id
    try {
      const nextProfile = await getOrCreateProfile(user)
      if (activeUserIdRef.current === userId) {
        setProfile(nextProfile)
      }
    } catch (error) {
      console.error('Failed to refresh profile:', error)
    }
  }

  function clearPasswordRecovery() {
    setPasswordRecovery(false)
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, passwordRecovery, clearPasswordRecovery, signUp, signIn, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
