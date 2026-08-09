"use client";

import React from "react";

/**
 * Catches render/runtime errors in a view so one crashing tab shows a
 * recoverable message instead of blanking the whole app. The header/nav live
 * outside this boundary, so switching tabs always works. Wrap with a `key` that
 * changes per view so navigating away resets the error state.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surfaced in the browser console for diagnosis.
    console.error("View crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="panel" style={{ borderColor: "var(--red)" }}>
          <h2 style={{ color: "var(--red)", marginTop: 0 }}>หน้านี้เกิดข้อผิดพลาดชั่วคราว</h2>
          <p className="muted">{this.state.error.message || "client-side exception"}</p>
          <p className="muted">
            สลับไปแท็บอื่นแล้วกลับมาใหม่ได้เลย หรือกดปุ่มด้านล่างเพื่อลองใหม่ / โหลดหน้าใหม่
          </p>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={() => this.setState({ error: null })}>ลองใหม่</button>
            <button className="primary" onClick={() => window.location.reload()}>
              โหลดหน้าใหม่
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
