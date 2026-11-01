"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./kit";

/**
 * One broken card never blanks a page: a render error inside shows a small
 * fallback card with Retry, and the rest of the page carries on.
 */
export class Boundary extends Component<{ children: ReactNode; label?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Nearer section failed${this.props.label ? ` (${this.props.label})` : ""}:`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mt-4 rounded-card bg-surface p-4 text-center" role="alert">
        <p className="m-0 text-[15px] font-semibold">{this.props.label ? `${this.props.label} didn’t load` : "This part didn’t load"}</p>
        <p className="m-0 mt-1 text-[14px] text-ink-soft">The rest of the page is fine.</p>
        <Button variant="secondary" className="mx-auto mt-3" onClick={() => this.setState({ failed: false })}>
          Retry
        </Button>
      </div>
    );
  }
}
