import { Component, type ReactNode } from "react";
import { Link } from "react-router-dom";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { hasError: boolean; error?: Error };

/** Catches render errors in children and shows a fallback so the page is never blank. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="container app-page">
          <div className="page-header">
            <h1>Something went wrong</h1>
            <Link to="/server" className="btn-link">← Back to servers</Link>
          </div>
          <div className="card">
            <p className="error-msg">
              This page could not be loaded. Try refreshing or go back to servers.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
