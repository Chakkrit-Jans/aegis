"use client";

import { useEffect, useState } from "react";
import { api, type Entitlements } from "../lib/api";

export function EditionPanel({ onChanged }: { onChanged?: (edition: string) => void }) {
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [license, setLicense] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const e = await api.getEntitlements();
      setEnt(e);
      onChanged?.(e.edition);
    } catch (e) {
      setErr(String((e as Error).message));
    }
  }
  useEffect(() => {
    reload(); /* eslint-disable-next-line */
  }, []);

  async function apply() {
    if (!license.trim()) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      const r = await api.applyLicense(license.trim());
      setMsg(`Enterprise activated for ${r.org ?? "your org"}.`);
      setLicense("");
      await reload();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm("Remove the license and return to Community edition?")) return;
    setBusy(true); setErr(""); setMsg("");
    try {
      await api.removeLicense();
      setMsg("Reverted to Community edition.");
      await reload();
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }

  const enterprise = ent?.edition === "enterprise";
  // Optional vendor checkout link. Set NEXT_PUBLIC_CHECKOUT_URL in the commercial
  // build to drive subscriptions; unset (public/self-hosted) hides the button.
  const checkoutUrl = process.env.NEXT_PUBLIC_CHECKOUT_URL || "";

  return (
    <div className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Edition &amp; License</h2>
        {ent && (
          <span className={`pill ${enterprise ? "ok" : ""}`} style={{ textTransform: "uppercase", letterSpacing: 1 }}>
            {enterprise ? "★ Enterprise" : "Community"}
          </span>
        )}
      </div>
      <div className="muted" style={{ fontSize: 11, margin: "8px 0" }}>
        Aegis is open-core: every safety feature (scope gate, approval gate, audit) is free forever.
        A license unlocks Enterprise capabilities. Licenses are signed and verified offline.{" "}
        <a href="/pricing.html" target="_blank" rel="noopener">Compare editions &amp; pricing →</a>
      </div>

      {ent && (
        <>
          {enterprise && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Licensed to <b style={{ color: "var(--text)" }}>{ent.org ?? "—"}</b>
              {" · "}
              {ent.expires ? `expires ${new Date(ent.expires).toLocaleDateString()}` : "perpetual"}
            </div>
          )}
          {ent.licenseError && (
            <div className="warn" style={{ color: "var(--red)", fontSize: 12 }}>
              License problem: {ent.licenseError}
            </div>
          )}

          {/* Feature matrix */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "10px 0" }}>
            {ent.features.map((f) => (
              <div key={f.key} className="rowline" style={{ paddingTop: 6 }}>
                <div style={{ minWidth: 0 }}>
                  <span>{f.enabled ? "✅" : "🔒"} {f.label}</span>
                  <div className="muted" style={{ fontSize: 11 }}>{f.description}</div>
                </div>
                <span className={`pill ${f.enabled ? "ok" : "no"}`} style={{ flex: "none" }}>
                  {f.enabled ? "included" : "Enterprise"}
                </span>
              </div>
            ))}
          </div>
          {!enterprise && (
            <div className="muted" style={{ fontSize: 11 }}>
              Community limits — AI providers: {ent.limits.aiProviders} · Kali workers: {ent.limits.workers}
            </div>
          )}
        </>
      )}

      {err && <div className="warn" style={{ color: "var(--red)" }}>{err}</div>}
      {msg && <div className="warn" style={{ color: "var(--green)" }}>{msg}</div>}

      {/* License entry */}
      <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
        {enterprise ? (
          <button className="reject" disabled={busy} onClick={remove}>Remove license</button>
        ) : (
          <>
            {checkoutUrl && (
              <div style={{ marginBottom: 10 }}>
                <button className="primary" onClick={() => window.open(checkoutUrl, "_blank", "noopener")}>
                  ★ Upgrade to Enterprise — subscribe
                </button>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Subscribe (฿500/mo), then paste the license key you receive by email below.
                </div>
              </div>
            )}
            <label>Enterprise license key</label>
            <textarea
              rows={3}
              placeholder="Paste your Aegis Enterprise license key…"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" disabled={busy || !license.trim()} onClick={apply}>Activate Enterprise</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
