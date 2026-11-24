// Only http(s) links may be stored or rendered as hrefs. `new URL()` alone
// accepts schemes such as `javascript:`, which would run script in the app origin.

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

// Returns the URL only if it is http(s); otherwise undefined so the link is not clickable.
export function safeHref(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  return isSafeHttpUrl(value) ? value.trim() : undefined
}
