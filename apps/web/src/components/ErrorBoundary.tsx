import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Keeps one broken screen from blanking the whole app: the sidebar stays,
 * the page explains what happened and offers a way back. Resets when the
 * route changes (the shell passes the path as `resetKey`).
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Screen failed to render', error, info.componentStack);
  }

  override componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="state state--error" role="alert">
        <h3>This screen hit a problem</h3>
        <p className="state__text">
          Something on this page could not be shown. The rest of the app still works. Reload to try
          again; if it keeps happening, the details are in the browser console.
        </p>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => window.location.reload()}
        >
          Reload the page
        </button>
      </div>
    );
  }
}
