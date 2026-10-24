import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught application error:', error, errorInfo)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 p-4">
        <div className="w-full max-w-md bg-white border border-neutral-200 rounded-2xl shadow-sm p-6 text-center">
          <h1 className="text-xl font-bold text-neutral-900 mb-2">Something went wrong</h1>
          <p className="text-sm text-neutral-600 mb-5">
            {this.state.error?.message || 'An unexpected application error occurred.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2.5 bg-neutral-100 text-neutral-800 rounded-xl text-sm font-medium hover:bg-neutral-200"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => { window.location.href = '/dashboard' }}
              className="px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }
}
