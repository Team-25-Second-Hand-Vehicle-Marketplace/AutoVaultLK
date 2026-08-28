import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../ui/Button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {

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
