const requiredEnvNames = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
] as const

type RequiredEnvName = typeof requiredEnvNames[number]

function requireEnv(name: RequiredEnvName): string {
  const value = import.meta.env[name]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value.trim()
}

function optionalPublicAppUrl(): string | null {
  const value = import.meta.env.VITE_PUBLIC_APP_URL
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('unsupported protocol')
    }
    return url.origin
  } catch {
    throw new Error('VITE_PUBLIC_APP_URL must be a valid http(s) URL')
  }
}

export const env = Object.freeze({
  SUPABASE_URL: requireEnv('VITE_SUPABASE_URL'),
  SUPABASE_ANON_KEY: requireEnv('VITE_SUPABASE_ANON_KEY'),
  PUBLIC_APP_URL: optionalPublicAppUrl(),
})

export default env
