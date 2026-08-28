import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../ui/Button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render-time exceptions anywhere below it.
 *
 * Without this, a single bad render unmounts the whole tree and leaves a
 * blank white page with nothing but a console trace — which is exactly the
 * failure mode this app already hit once when main.tsx lost its mount call.
 * A blank page is indistinguishable from a network hang to a user, so the
 * boundary exists to make a crash say so.
 *
 * Must stay a class component: there is no hook equivalent of
 * componentDidCatch.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Console is the only sink available — no error-reporting service is
    // wired into this project yet. The component stack is the useful half.
    console.error('Unhandled render error:', error, errorInfo.componentStack)
  }

  private handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-page" role="alert">
          <h1>Something went wrong</h1>
          <p>
            The page failed to render. This is a bug on our side, not something you did.
          </p>
          {/* Dev-only: the message is useful while building and noise in prod. */}
          {import.meta.env.DEV && (
            <pre className="error-page__details">{this.state.error.message}</pre>
          )}
          <div className="error-page__actions">
            <Button type="button" onClick={this.handleReset}>
              Try again
            </Button>
            <a className="button button--ghost" href="/search">
              Back to search
            </a>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
