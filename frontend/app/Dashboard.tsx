"use client";
import { useEffect, useState } from "react";
import { api, DashboardData } from "../lib/api";

const SEV = [
  { k: "critical", label: "Critical", c: "#ff4d6d" },
  { k: "high", label: "High", c: "#ff7849" },
  { k: "medium", label: "Medium", c: "#ffb547" },
  { k: "low", label: "Low", c: "#39ff88" },
  { k: "info", label: "Info", c: "#6b8299" },
];

// Finding confidence — certain (proven) → tentative (suspected).
const CONF = [
  { k: "certain", label: "Certain", c: "#39ff88" },
  { k: "firm", label: "Firm", c: "#ffb547" },
  { k: "tentative", label: "Tentative", c: "#6b8299" },
];

// Session statuses — colours mirror the .status-* classes in globals.css.
const SESS = [
  { k: "running", label: "Running", c: "#22e0ff" },
  { k: "waiting_approval", label: "Waiting approval", c: "#ffb547" },
  { k: "done", label: "Done", c: "#39ff88" },
  { k: "stopped", label: "Stopped", c: "#6b8299" },
  { k: "error", label: "Error", c: "#ff4d6d" },
  { k: "idle", label: "Idle", c: "#3a4b5b" },
];

const twoCol = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 } as const;

/** A dependency-free SVG donut: one stroked arc per non-zero slice. */
function Donut({ data, total, label, size = 150, stroke = 24 }: { data: { k: string; c: string; n: number }[]; total: number; label: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const TAU = Math.PI * 2;
  const pt = (a: number): [number, number] => [c + r * Math.cos(a), c + r * Math.sin(a)];
  const segs = data.filter((d) => d.n > 0);
  const single = segs.length === 1 ? segs[0] : null;
  let cum = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Findings by severity donut" style={{ flex: "none" }}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={stroke} />
      {single ? (
        <circle cx={c} cy={c} r={r} fill="none" stroke={single.c} strokeWidth={stroke} />
      ) : (
        segs.map((d) => {
          const frac = d.n / total;
          const a0 = -Math.PI / 2 + TAU * cum;
          const a1 = -Math.PI / 2 + TAU * (cum + frac);
          cum += frac;
          const [x0, y0] = pt(a0);
          const [x1, y1] = pt(a1);
          const large = a1 - a0 > Math.PI ? 1 : 0;
          return <path key={d.k} d={`M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`} fill="none" stroke={d.c} strokeWidth={stroke} strokeLinecap="butt" />;
        })
      )}
      <text x={c} y={c - 3} textAnchor="middle" fontSize="28" fontWeight="700" fill="#e6f6ff">{total}</text>
      <text x={c} y={c + 15} textAnchor="middle" fontSize="10" letterSpacing="1.5" fill="#6b8299">{label}</text>
    </svg>
  );
}

/** A titled panel with a donut + legend (count + %). Reused for findings and sessions. */
function DonutPanel({ title, items, total, center, empty }: { title: string; items: { k: string; label: string; c: string; n: number }[]; total: number; center: string; empty: string }) {
  return (
    <div className="panel" style={{ margin: 0 }}>
      <h2>{title}</h2>
      {total === 0 ? (
        <div className="muted">{empty}</div>
      ) : (
        <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <Donut data={items} total={total} label={center} />
          <div style={{ flex: 1, minWidth: 190 }}>
            {items.map((s) => {
              const pct = Math.round((s.n / total) * 100);
              return (
                <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 10, margin: "5px 0", opacity: s.n ? 1 : 0.4 }}>
                  <span style={{ display: "inline-block", width: 11, height: 11, borderRadius: 3, background: s.c, flex: "none" }} />
                  <span style={{ flex: 1, fontSize: 13 }}>{s.label}</span>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{s.n}</span>
                  <span className="muted" style={{ width: 42, textAlign: "right", fontSize: 12 }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Cross-engagement overview — the landing tab. Read-only; refreshes every 20s. */
export function Dashboard({ onOpen }: { onOpen: (slug: string) => void }) {
  const [d, setD] = useState<DashboardData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    api
      .getDashboard()
      .then((r) => { setD(r); setErr(""); })
      .catch((e) => setErr(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  if (loading && !d) return <div className="panel">Loading dashboard…</div>;
  if (err && !d) return <div className="panel" style={{ borderColor: "var(--red)" }}>⚠ {err}</div>;
  if (!d) return null;

  const running = d.sessions.byStatus.running ?? 0;
  const kpis = [
    { label: "Engagements", value: d.engagements, c: "var(--cyan)" },
    { label: "Running sessions", value: running, c: "var(--cyan)" },
    { label: "Pending approvals", value: d.pendingApprovals.length, c: d.pendingApprovals.length ? "var(--amber)" : "var(--muted)" },
    { label: "Total findings", value: d.findings.total, c: "var(--green)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {err && <div className="panel" style={{ borderColor: "var(--red)", margin: 0 }}>⚠ {err}</div>}

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
        {kpis.map((k) => (
          <div key={k.label} className="panel" style={{ margin: 0 }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: k.c, lineHeight: 1.1 }}>{k.value}</div>
            <div className="muted" style={{ fontSize: 12 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Findings by severity + confidence + Sessions by status — donuts */}
      <div style={twoCol}>
        <DonutPanel
          title="Findings by severity"
          items={SEV.map((s) => ({ ...s, n: d.findings.bySeverity[s.k] ?? 0 }))}
          total={d.findings.total}
          center="FINDINGS"
          empty="No findings recorded yet."
        />
        <DonutPanel
          title="Findings by confidence"
          items={CONF.map((s) => ({ ...s, n: d.findings.byConfidence[s.k] ?? 0 }))}
          total={d.findings.total}
          center="FINDINGS"
          empty="No findings recorded yet."
        />
        <DonutPanel
          title="Sessions by status"
          items={SESS.map((s) => ({ ...s, n: d.sessions.byStatus[s.k] ?? 0 }))}
          total={d.sessions.total}
          center="SESSIONS"
          empty="No sessions yet."
        />
      </div>

      {/* Pending approvals + recent sessions */}
      <div style={twoCol}>
        <div className="panel" style={{ margin: 0 }}>
          <h2>⚠ Pending approvals</h2>
          {d.pendingApprovals.length === 0 ? (
            <div className="muted">Nothing waiting for approval.</div>
          ) : (
            d.pendingApprovals.map((a) => (
              <div key={a.id} className="approval" style={{ cursor: "pointer" }} onClick={() => onOpen(a.slug)} title="Open in Console">
                <div style={{ fontSize: 13 }}><b style={{ color: "var(--amber)" }}>{a.tool}</b> · {a.name}</div>
                <div className="muted" style={{ fontSize: 11 }}>{a.rationale || "(no rationale)"}</div>
              </div>
            ))
          )}
        </div>
        <div className="panel" style={{ margin: 0 }}>
          <h2>Recent sessions</h2>
          {d.recentSessions.length === 0 ? (
            <div className="muted">No sessions yet.</div>
          ) : (
            d.recentSessions.map((s) => (
              <div key={s.id} style={{ borderTop: "1px solid var(--border)", padding: "7px 0", cursor: "pointer" }} onClick={() => onOpen(s.slug)} title="Open in Console">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <b style={{ fontSize: 13 }}>{s.name}</b>
                  <span className={`status-${s.status}`} style={{ fontSize: 11 }}>{s.status}</span>
                </div>
                <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.objective || "(no objective)"}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Worker health + recent activity */}
      <div style={twoCol}>
        <div className="panel" style={{ margin: 0 }}>
          <h2>Worker health</h2>
          {d.workers.length === 0 ? (
            <div className="muted">No enabled workers.</div>
          ) : (
            d.workers.map((w) => (
              <div key={w.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderTop: "1px solid var(--border)", padding: "7px 0" }}>
                <div style={{ minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{w.name}</b>{" "}
                  <span className="muted" style={{ fontSize: 11 }}>{w.url}</span>
                </div>
                <span className={`pill ${w.ok ? "ok" : "no"}`} style={{ flex: "none" }}>
                  {w.ok ? `OK · ${w.tools} tools` : `DOWN${w.error ? ": " + w.error : ""}`}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="panel" style={{ margin: 0 }}>
          <h2>Recent activity</h2>
          {d.recentAudit.length === 0 ? (
            <div className="muted">No activity yet.</div>
          ) : (
            d.recentAudit.map((a, i) => (
              <div key={i} style={{ borderTop: "1px solid var(--border)", padding: "6px 0", fontSize: 12 }}>
                <span className="muted">{new Date(a.createdAt).toLocaleString()} · {a.actor}</span>
                <br />
                <b>{a.action}</b>
                {a.target ? <span className="muted"> → {a.target}</span> : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div>
        <button onClick={load}>↻ Refresh</button>{" "}
        <span className="muted" style={{ fontSize: 11 }}>auto-refreshes every 20s</span>
      </div>
    </div>
  );
}
