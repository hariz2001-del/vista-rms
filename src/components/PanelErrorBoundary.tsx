import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Keeps one panel's failure inside that panel.
 *
 * Without it, an error while drawing a chart unmounts the whole RMS and the
 * owner is left with a blank page and no way in — which happened once, on a
 * morning with no sales yet. The rest of the books stay usable; the panel says
 * what broke and offers to try again.
 */
export class PanelErrorBoundary extends Component<
  { name: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.name} failed to draw`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="border border-dashed border-line p-6 text-center text-sm">
        <p className="font-bold text-ink">The {this.props.name} could not be shown.</p>
        <p className="mt-1 text-muted">Everything else here is fine. {this.state.error.message}</p>
        <p className="mt-3 text-xs font-bold text-ink">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="border border-line px-3 py-2 hover:bg-canvas"
          >
            Try again
          </button>
        </p>
      </div>
    )
  }
}
