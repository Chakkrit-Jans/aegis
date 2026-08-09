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

const twoCol = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 } as const;

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
  const maxSev = Math.max(1, ...SEV.map((s) => d.findings.bySeverity[s.k] ?? 0));
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

      {/* Findings by severity */}
      <div className="panel" style={{ margin: 0 }}>
        <h2>Findings by severity</h2>
        {d.findings.total === 0 ? (
          <div className="muted">No findings recorded yet.</div>
        ) : (
          SEV.map((s) => {
            const n = d.findings.bySeverity[s.k] ?? 0;
            return (
              <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 10, margin: "6px 0" }}>
                <div style={{ width: 64, fontSize: 12 }}>{s.label}</div>
                <div style={{ flex: 1, background: "rgba(255,255,255,.04)", borderRadius: 4, height: 16 }}>
                  <div style={{ width: `${(n / maxSev) * 100}%`, background: s.c, height: "100%", borderRadius: 4, minWidth: n ? 3 : 0 }} />
                </div>
                <div style={{ width: 30, textAlign: "right", fontWeight: 700, fontSize: 13 }}>{n}</div>
              </div>
            );
          })
        )}
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
