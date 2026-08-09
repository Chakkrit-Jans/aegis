"use client";

import { useEffect, useState, type ReactNode } from "react";
import { version as reactVersion } from "react";
import { api, type AboutInfo, type WorkerToolsInfo, type Me } from "../lib/api";
import { EditionPanel } from "./EditionPanel";

// Frontend stack versions (build-time; React resolved at runtime).
const FRONTEND: { name: string; version: string }[] = [
  { name: "Next.js", version: "14.2.35" },
  { name: "React", version: reactVersion },
  { name: "Socket.IO client", version: "4.x" },
];

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", borderTop: "1px solid var(--border)", fontSize: 13 }}>
      <span className="muted">{k}</span>
      <span style={{ textAlign: "right", fontFamily: "var(--mono, monospace)" }}>{v}</span>
    </div>
  );
}

export function About({ me, onClose, onEditionChange }: { me: Me; onClose: () => void; onEditionChange?: (e: string) => void }) {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [tools, setTools] = useState<WorkerToolsInfo | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.getAbout().then(setInfo).catch((e) => setErr(String((e as Error).message)));
    // Worker tool versions run several probes on Kali — load them separately.
    api.getWorkerTools().then(setTools).catch(() => setTools({ worker: null, tools: [], error: "unavailable" }));
  }, []);

  const uptime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(2,5,10,.7)", backdropFilter: "blur(3px)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "6vh 16px" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="panel"
        style={{ maxWidth: 560, width: "100%", maxHeight: "86vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h2 style={{ margin: 0 }}>About Aegis</h2>
          <button onClick={onClose}>✕ Close</button>
        </div>

        {err && <div className="warn" style={{ color: "var(--red)" }}>{err}</div>}
        {!info && !err && <div className="muted" style={{ marginTop: 10 }}>Loading…</div>}

        {info && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12 }}>
              <span className="brand" style={{ fontSize: 22 }}>AEGIS</span>
              <span className="pill ok">v{info.app.version}</span>
              <span className={`pill ${info.edition === "enterprise" ? "ok" : ""}`} style={{ textTransform: "uppercase" }}>
                {info.edition === "enterprise" ? "★ Enterprise" : "Community"}
              </span>
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>{info.app.description}</p>
            <div style={{ marginTop: 6 }}>
              <Row k="Git commit" v={<code>{info.app.git}</code>} />
              <Row k="Signed in as" v={`${me.email} · ${me.role}`} />
            </div>

            {/* Edition & license management (moved here from Settings) */}
            <div style={{ margin: "14px 0" }}>
              <EditionPanel onChanged={onEditionChange} />
            </div>

            <h3 style={{ margin: "16px 0 4px", color: "var(--cyan)", fontSize: 14 }}>Runtime &amp; services</h3>
            <Row k="Node.js" v={info.runtime.node} />
            <Row k="Platform" v={info.runtime.platform} />
            <Row k="Backend uptime" v={uptime(info.runtime.uptimeSec)} />
            <Row k="MongoDB" v={info.services.mongodb} />
            <Row k="Redis" v={info.services.redis} />

            <h3 style={{ margin: "16px 0 4px", color: "var(--cyan)", fontSize: 14 }}>Frontend</h3>
            {FRONTEND.map((c) => <Row key={c.name} k={c.name} v={c.version} />)}

            <h3 style={{ margin: "16px 0 4px", color: "var(--cyan)", fontSize: 14 }}>Backend components</h3>
            {info.components.map((c) => <Row key={c.name} k={c.name} v={c.version} />)}

            <h3 style={{ margin: "16px 0 4px", color: "var(--cyan)", fontSize: 14 }}>
              Kali worker tools {tools?.worker && <span className="muted" style={{ fontSize: 11 }}>· {tools.worker}</span>}
            </h3>
            {!tools && <div className="muted" style={{ fontSize: 12 }}>Probing worker…</div>}
            {tools?.error && <div className="muted" style={{ fontSize: 12 }}>{tools.error}</div>}
            {tools && !tools.error && tools.tools.map((c) => <Row key={c.name} k={c.name} v={c.version} />)}

            <div className="muted" style={{ fontSize: 11, marginTop: 16, textAlign: "center" }}>
              Aegis — authorized penetration testing only. ·{" "}
              <a href="/manual/index.html" target="_blank" rel="noopener">Docs</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
