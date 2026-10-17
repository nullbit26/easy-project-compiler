import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Localized heading shown instead of the crashed subtree. */
  title: string;
  /** Localized hint describing what to do next. */
  hint: string;
  /** Localized label for the recover button. */
  retryLabel: string;
  /** Optional custom fallback; replaces the default card when provided. */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Keeps a rendering error local to one part of the UI. Without it a single broken
 * panel unmounts the entire React tree and the user sees a blank page.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Keep the technical detail in the console, never in the UI.
    console.error('[UI] Render error caught by boundary:', error);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="bg-slate-900 border border-rose-800/60 rounded-2xl p-6 text-center space-y-3 max-w-lg mx-auto my-8">
        <div className="w-12 h-12 rounded-2xl bg-rose-950 border border-rose-800 text-rose-400 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-white">{this.props.title}</h3>
        <p className="text-xs text-slate-400">{this.props.hint}</p>
        <p className="text-[10px] text-rose-300/80 font-mono break-all max-h-20 overflow-y-auto">
          {error.message}
        </p>
        <button
          onClick={this.reset}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition-colors cursor-pointer inline-flex items-center gap-2"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {this.props.retryLabel}
        </button>
      </div>
    );
  }
}
