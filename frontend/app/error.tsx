"use client";

// Next.js route-level error fallback. Replaces the default blank
// "Application error: a client-side exception has occurred" with a recoverable UI.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="wrap" style={{ maxWidth: 520, marginTop: "12vh" }}>
      <div className="panel" style={{ borderColor: "var(--red)" }}>
        <h2 style={{ color: "var(--red)", marginTop: 0 }}>เกิดข้อผิดพลาด</h2>
        <p className="muted">{error.message || "client-side exception"}</p>
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button onClick={() => reset()}>ลองใหม่</button>
          <button className="primary" onClick={() => window.location.reload()}>โหลดหน้าใหม่</button>
        </div>
      </div>
    </div>
  );
}
