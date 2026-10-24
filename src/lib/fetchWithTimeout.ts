export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeout = 30000, signal: externalSignal, ...fetchOptions } = options
  const controller = new AbortController()
  let timedOut = false

  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeout)

  const handleExternalAbort = () => {
    controller.abort(externalSignal?.reason)
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      handleExternalAbort()
    } else {
      externalSignal.addEventListener('abort', handleExternalAbort, { once: true })
    }
  }

  try {
    return await fetch(input, {
      ...fetchOptions,
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) {
      throw new Error(`Request timed out after ${timeout}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    externalSignal?.removeEventListener('abort', handleExternalAbort)
  }
}
