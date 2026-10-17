import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Catches unexpected render errors and shows a recoverable message instead of
 * a blank screen. Details are kept generic; the console keeps the stack.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
          <div className="rounded-card border border-line bg-surface p-6 shadow-card">
            <h1 className="text-lg font-semibold text-ink">Something went wrong</h1>
            <p className="mt-2 text-sm text-ink-soft">
              The screen hit an unexpected error. Your data is safe — recorded purchases are stored
              server-side.
            </p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="mt-4 h-10 rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-strong"
            >
              Try again
            </button>
          </div>
        </main>
      )
    }
    return this.props.children
  }
}
