import { env } from './env'

export function getPublicAppBaseUrl(): string {
  if (env.PUBLIC_APP_URL) return env.PUBLIC_APP_URL
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

export function getAssetDeepLink(qrCodeId: string): string {
  return `${getPublicAppBaseUrl()}/q/${encodeURIComponent(qrCodeId)}`
}

export function hasConfiguredPublicAppUrl(): boolean {
  return Boolean(env.PUBLIC_APP_URL)
}
