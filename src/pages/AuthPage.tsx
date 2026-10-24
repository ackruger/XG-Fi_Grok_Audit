import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { LogIn, UserPlus, Eye, EyeOff, ArrowLeft, Mail } from 'lucide-react'

export default function AuthPage({ returnTo }: { returnTo?: string }) {
  const navigate = useNavigate()
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot' | 'reset-sent'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (mode === 'signup') {
      if (!name.trim()) {
        setError('Name is required')
        setLoading(false)
        return
      }
      const { error: err } = await signUp(email, password, name)
      if (err) setError(err)
      else navigate(returnTo || '/dashboard', { replace: true })
    } else if (mode === 'signin') {
      const { error: err } = await signIn(email, password)
      if (err) setError(err)
      else navigate(returnTo || '/dashboard', { replace: true })
    } else if (mode === 'forgot') {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/`,
      })
      if (err) {
        setError(err.message)
      } else {
        setMode('reset-sent')
      }
    }
    setLoading(false)
  }

  if (mode === 'reset-sent') {
    return (
      <div className="min-h-full flex flex-col items-center justify-center bg-sunset-hero px-4">
        <div className="w-full max-w-sm relative z-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl mb-4 border border-white/30">
              <Mail className="text-white" size={28} />
            </div>
            <h1 className="text-2xl font-bold text-white">Check Your Email</h1>
            <p className="text-white/70 mt-2">
              We sent a password reset link to <span className="font-medium text-white">{email}</span>
            </p>
          </div>
          <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-white/50 p-6 text-center">
            <p className="text-sm text-neutral-600 mb-4">
              Click the link in the email to reset your password. If you don't see it, check your spam folder.
            </p>
            <button
              onClick={() => { setMode('signin'); setError('') }}
              className="text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-sunset-hero px-4">
      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl mb-4 border border-white/30">
            <span className="text-white font-bold text-xl">Xg</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Xg-Fi</h1>
          <p className="text-white/70 mt-1">Field Intelligence</p>
        </div>

        <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-white/50 p-6">
          {mode === 'forgot' ? (
            <div className="mb-6">
              <button
                type="button"
                onClick={() => { setMode('signin'); setError('') }}
                className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700 mb-3"
              >
                <ArrowLeft size={14} />
                Back
              </button>
              <h2 className="text-lg font-semibold text-neutral-900">Reset Password</h2>
              <p className="text-sm text-neutral-500 mt-1">Enter your email to receive a reset link</p>
            </div>
          ) : (
            <div className="flex mb-6 bg-neutral-100 rounded-xl p-1">
              <button
                type="button"
                onClick={() => { setMode('signin'); setError('') }}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  mode === 'signin' ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-500'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => { setMode('signup'); setError('') }}
                className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                  mode === 'signup' ? 'bg-white shadow-sm text-neutral-900' : 'text-neutral-500'
                }`}
              >
                Sign Up
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-neutral-700 mb-1">
                  Full Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 transition-all"
                  placeholder="John Smith"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-neutral-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 transition-all"
                placeholder="you@company.com"
              />
            </div>

            {mode !== 'forgot' && (
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-neutral-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full px-3 py-2.5 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-400/40 focus:border-primary-400 transition-all pr-10"
                    placeholder="Min 6 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            )}

            {mode === 'signin' && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => { setMode('forgot'); setError('') }}
                  className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                >
                  Forgot password?
                </button>
              </div>
            )}

            {error && (
              <div className="bg-error-50 border border-error-100 text-error-700 text-sm px-3 py-2 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-medium py-2.5 px-4 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-primary-200"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  {mode === 'signup' && <><UserPlus size={18} />Create Account</>}
                  {mode === 'signin' && <><LogIn size={18} />Sign In</>}
                  {mode === 'forgot' && <><Mail size={18} />Send Reset Link</>}
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
