"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  api,
  API,
  loadToken,
  setToken,
  AuthError,
  type Engagement,
  type Session,
  type SessionSummary,
  type TranscriptEntry,
  type UpdatesInfo,
  type WorkerRow,
  type Me,
} from "../lib/api";
import { Terminal } from "./Terminal";
import { Settings } from "./Settings";
import { Dashboard } from "./Dashboard";
import { ErrorBoundary } from "./ErrorBoundary";
import { builtinList, buildObjective, type Level } from "./objectiveTemplates";
import type { CustomTemplate, OrgTemplate } from "../lib/api";
import { useT } from "./i18n";
import { About } from "./About";

type View = "dashboard" | "console" | "terminal" | "desktop" | "settings";

const VNC_URL =
  process.env.NEXT_PUBLIC_VNC_URL ?? "http://localhost:6080/vnc.html?autoconnect=1&resize=scale";

function sevPill(sev: string): string {
  const s = (sev || "").toLowerCase();
  if (s === "critical" || s === "high") return "no";
  if (s === "medium") return "warn";
  return ""; // low / info → neutral
}

interface ApprovalReq {
  approvalId: string;
  tool: string;
  args: Record<string, unknown>;
  rationale: string;
}

export default function Console() {
  const { t } = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [booting, setBooting] = useState(true);
  const [view, setView] = useState<View>("dashboard");
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [active, setActive] = useState<Engagement | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [reportText, setReportText] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [approvals, setApprovals] = useState<ApprovalReq[]>([]);
  const [status, setStatus] = useState<string>("idle");
  const [objective, setObjective] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [autoApprove, setAutoApprove] = useState(false);
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [orgTemplates, setOrgTemplates] = useState<OrgTemplate[]>([]);
  const [err, setErr] = useState("");
  const [feeds, setFeeds] = useState<UpdatesInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [edition, setEdition] = useState<"community" | "enterprise" | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const refresh = () =>
    guard(api.listEngagements()).then((l) => {
      if (!l) return;
      setEngagements(l);
      // Keep the current selection (with fresh data) if it still exists, else
      // auto-select the first engagement so its detail panel shows immediately.
      setActive((cur) => (cur && l.find((e) => e.slug === cur.slug)) || l[0] || null);
    });
  const loadFeeds = () => guard(api.getUpdates()).then((f) => f && setFeeds(f));

  // On mount: capture an SSO redirect (?sso_token / ?sso_error), else validate any stored token.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get("sso_token");
    const ssoError = params.get("sso_error");
    if (ssoToken || ssoError) window.history.replaceState({}, "", window.location.pathname);
    if (ssoError) { setErr("SSO sign-in failed: " + ssoError); setBooting(false); return; }
    if (ssoToken) {
      setToken(ssoToken);
      api.me().then(setMe).catch(() => setToken(null)).finally(() => setBooting(false));
      return;
    }
    const stored = loadToken();
    if (!stored) { setBooting(false); return; }
    api.me().then(setMe).catch(() => setToken(null)).finally(() => setBooting(false));
  }, []);

  // Load data once authenticated.
  useEffect(() => {
    if (me) {
      refresh();
      loadFeeds();
      if (me.role === "admin") api.listWorkers().then((r) => setWorkers(r.workers)).catch(() => {});
      loadCustomTemplates();
      api.getEntitlements().then((e) => setEdition(e.edition)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  async function changeWorker(workerId: string) {
    if (!active) return;
    await guard(api.setEngagementWorker(active.slug, workerId));
    await reloadActive(active.slug);
  }

  // Refresh the custom-template dropdown when returning to the console (they're
  // created/edited in Settings, so pick up changes on the way back).
  useEffect(() => {
    if (me && view === "console") loadCustomTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, me]);

  // Load past sessions whenever the selected engagement changes.
  useEffect(() => {
    setReportText(null);
    if (!active) { setSessions([]); return; }
    api.listSessions(active.slug).then(setSessions).catch(() => setSessions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.slug]);

  // Open a saved session (read-only history view).
  async function viewSession(id: string) {
    socketRef.current?.disconnect();
    setReportText(null);
    setApprovals([]);
    const s = await guard(api.getSession(id));
    if (s) { setSession(s); setTranscript(s.transcript ?? []); setStatus(s.status); }
  }
  async function viewReport() {
    if (!active) return;
    const md = await guard(api.getReport(active.slug));
    if (md !== undefined) setReportText(md);
  }
  function loadCustomTemplates() {
    api.listTemplates().then(setCustomTemplates).catch(() => {});
    api.listOrgTemplates().then((r) => setOrgTemplates(r.enabled ? r.templates : [])).catch(() => {});
  }
  function applyMerged() {
    const v = selectedTemplate;
    if (!v) return;
    const target = active?.scope.include[0] ?? "";
    if (v.startsWith("b:")) {
      const [cat, lvl] = v.slice(2).split(":");
      setObjective(buildObjective(cat, lvl as Level, target));
    } else if (v.startsWith("c:")) {
      const rest = v.slice(2);
      const i = rest.lastIndexOf(":");
      const t = customTemplates.find((x) => x.id === rest.slice(0, i));
      const lvl = rest.slice(i + 1) as "basic" | "medium" | "advanced";
      if (t) setObjective((t.levels[lvl] ?? "").replaceAll("<TARGET>", target || "<TARGET>"));
    } else if (v.startsWith("o:")) {
      const rest = v.slice(2);
      const i = rest.lastIndexOf(":");
      const t = orgTemplates.find((x) => x.id === rest.slice(0, i));
      const lvl = rest.slice(i + 1) as "basic" | "medium" | "advanced";
      if (t) setObjective((t.levels[lvl] ?? "").replaceAll("<TARGET>", target || "<TARGET>"));
    }
  }
  async function stopSession() {
    if (!session) return;
    await guard(api.stopSession(session._id));
  }
  async function exportPdf() {
    if (!active) return;
    const html = await guard(api.getReportHtml(active.slug));
    if (html === undefined) return;
    const w = window.open("", "_blank");
    if (!w) { setErr(t("prompt.popupBlocked")); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // Show the report preview only — the user clicks "Print / Save as PDF"
    // (button in the report) when they're ready. No auto-print.
    w.focus();
  }

  async function doLogin(email: string, password: string) {
    setErr("");
    try {
      const { token } = await api.login(email, password);
      setToken(token);
      setMe(await api.me());
    } catch (e) {
      setErr(t("login.failed") + String((e as Error).message));
    }
  }
  function logout() {
    setToken(null);
    setMe(null);
    socketRef.current?.disconnect();
    setSession(null);
  }
  async function changePw() {
    const current = prompt(t("prompt.pwCur"));
    if (!current) return;
    const next = prompt(t("prompt.pwNew"));
    if (!next) return;
    const ok = await guard(api.changePassword(current, next));
    if (ok) alert(t("prompt.pwChanged"));
  }

  async function updateAll() {
    setUpdating(true);
    await api.runAllUpdates().catch((e) => setErr(String(e.message ?? e)));
    await loadFeeds();
    setUpdating(false);
  }
  async function updateOne(id: string) {
    setUpdating(true);
    await api.runUpdate(id).catch((e) => setErr(String(e.message ?? e)));
    await loadFeeds();
    setUpdating(false);
  }
  async function toggleAuto(enabled: boolean) {
    const info = await api
      .setSchedule(enabled, feeds?.intervalHours ?? 24)
      .catch((e) => { setErr(String(e.message ?? e)); return null; });
    if (info) setFeeds(info);
  }
  async function changeInterval(hours: number) {
    const info = await api
      .setSchedule(feeds?.autoEnabled ?? false, hours)
      .catch((e) => { setErr(String(e.message ?? e)); return null; });
    if (info) setFeeds(info);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [transcript, approvals]);

  function guard<T>(p: Promise<T>): Promise<T | undefined> {
    return p.catch((e) => {
      if (e instanceof AuthError) { setMe(null); return undefined; }
      setErr(String(e.message ?? e));
      return undefined;
    });
  }

  async function newEngagement() {
    const name = prompt(t("prompt.engName"));
    if (!name) return;
    const client = prompt(t("prompt.client")) ?? "";
    const eng = await guard(api.createEngagement(name, client));
    if (eng) { await refresh(); setActive(eng); }
  }

  async function reloadActive(slug: string) {
    const list = await guard(api.listEngagements());
    if (list) { setEngagements(list); setActive(list.find((e) => e.slug === slug) ?? null); }
  }

  async function delEngagement() {
    if (!active) return;
    if (!confirm(t("eng.confirmDelete").replace("{name}", active.name))) return;
    const ok = await guard(api.deleteEngagement(active.slug));
    if (ok) { setSession(null); setTranscript([]); setReportText(null); await refresh(); }
  }

  async function recordAuth() {
    if (!active) return;
    const by = prompt(t("prompt.authBy"));
    if (!by) return;
    const ref = prompt(t("prompt.authRef")) ?? "";
    await guard(api.auth(active.slug, by, ref));
    await reloadActive(active.slug);
  }

  async function addScope(kind: "add" | "exclude") {
    if (!active) return;
    const val = prompt(kind === "add" ? t("prompt.scopeAdd") : t("prompt.scopeEx"));
    if (!val) return;
    await guard(api.scope(active.slug, { [kind]: val }));
    await reloadActive(active.slug);
  }

  async function spawnSession() {
    if (!active) return;
    setErr(""); setTranscript([]); setApprovals([]); setReportText(null);
    const s = await guard(api.createSession(active.slug, objective, autoApprove));
    if (!s) return;
    setSession(s); setStatus("running");
    api.listSessions(active.slug).then(setSessions).catch(() => {});

    socketRef.current?.disconnect();
    const socket = io(API, { transports: ["websocket", "polling"], auth: { token: loadToken() } });
    socketRef.current = socket;
    socket.on("connect", () => socket.emit("join", s._id));
    socket.on("transcript", (e: TranscriptEntry) => setTranscript((t) => [...t, e]));
    socket.on("status", (e: { status: string }) => setStatus(e.status));
    socket.on("approval", (a: ApprovalReq) => setApprovals((x) => [...x, a]));
  }

  async function decide(a: ApprovalReq, decision: "approve" | "reject") {
    if (!session) return;
    await guard(api.decide(session._id, a.approvalId, decision));
    setApprovals((x) => x.filter((y) => y.approvalId !== a.approvalId));
  }

  const authed = active?.authorization?.granted;

  if (booting) return <div className="wrap muted">Loading…</div>;
  if (!me) return <LoginView onSubmit={doLogin} err={err} />;

  return (
    <div className="wrap">
      <header className="top">
        <div className="brand">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            AEGIS
            {edition && (
              <span
                className={`pill ${edition === "enterprise" ? "ok" : ""}`}
                title={edition === "enterprise" ? "Enterprise edition" : "Community edition"}
                style={{ fontSize: 10, letterSpacing: 1, whiteSpace: "nowrap" }}
              >
                {edition === "enterprise" ? "★ EE" : "CE"}
              </span>
            )}
          </span>
          {t("tagline").split("·").map((p, i) => (
            <small key={i}>{p.trim()}</small>
          ))}
        </div>
        <div className="row" style={{ flex: "none", gap: 12, alignItems: "center" }}>
          <nav className="row" style={{ flex: "none", gap: 6 }}>
            {(["dashboard", "console", "terminal", "desktop", "settings"] as View[]).map((v) => (
              <button key={v} className={view === v ? "primary" : ""} onClick={() => setView(v)}>
                {t(`nav.${v}`)}
              </button>
            ))}
          </nav>
          <button style={{ whiteSpace: "nowrap" }} onClick={() => setShowAbout(true)} title="About Aegis — versions, license & account">ⓘ About</button>
          <button style={{ whiteSpace: "nowrap" }} onClick={() => window.open("/manual/index.html", "_blank", "noopener")} title="Open the documentation">📖 Docs</button>
          <button style={{ whiteSpace: "nowrap" }} onClick={changePw} title="Change password">{t("hdr.changePw")}</button>
          <button style={{ whiteSpace: "nowrap" }} onClick={logout}>{t("hdr.logout")}</button>
        </div>
      </header>

      {showAbout && <About me={me} onClose={() => setShowAbout(false)} onEditionChange={(e) => setEdition(e as "community" | "enterprise")} />}

      <ErrorBoundary key={view}>
      {view === "dashboard" && (
        <Dashboard
          onOpen={(slug) => {
            const e = engagements.find((x) => x.slug === slug);
            if (e) setActive(e);
            setView("console");
          }}
        />
      )}
      {view === "terminal" && <Terminal engagementSlug={active?.slug ?? null} />}
      {view === "settings" && <Settings me={me} />}
      {view === "desktop" && (
        <div className="panel">
          <h2>{t("desk.title")}</h2>
          <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
            {t("desk.hint")}
          </div>
          <iframe
            title="Kali desktop"
            src={VNC_URL}
            style={{
              width: "100%",
              height: "78vh",
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "#000",
            }}
          />
        </div>
      )}
      {view === "console" && (
      <>
      {err && <div className="panel" style={{ borderColor: "var(--red)", marginBottom: 16 }}>⚠ {err}</div>}

      <div className="grid">
        {/* LEFT: engagement control */}
        <div>
          <div className="panel">
            <h2>{t("eng.title")}</h2>
            <div className="row" style={{ marginBottom: 10 }}>
              <button className="primary" onClick={newEngagement}>{t("eng.new")}</button>
              <button onClick={refresh}>{t("eng.refresh")}</button>
            </div>
            <select
              size={6}
              value={active?.slug ?? ""}
              onChange={(e) => setActive(engagements.find((x) => x.slug === e.target.value) ?? null)}
            >
              {engagements.map((e) => (
                <option key={e.slug} value={e.slug}>
                  {e.name} {e.authorization?.granted ? "✓" : "·"}
                </option>
              ))}
            </select>
          </div>

          {active && (
            <div className="panel" style={{ marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <h2 style={{ margin: 0 }}>{active.name}</h2>
                <button className="reject" style={{ flex: "none", fontSize: 11 }} onClick={delEngagement}>{t("eng.delete")}</button>
              </div>
              <div className="muted">{active.client || t("eng.noClient")}</div>
              <div style={{ margin: "10px 0" }}>
                {t("eng.auth")}{" "}
                <span className={`pill ${authed ? "ok" : "no"}`}>{authed ? t("eng.granted") : t("eng.none")}</span>
              </div>
              <button onClick={recordAuth}>{t("eng.recordAuth")}</button>

              {workers.length > 0 && (
                <>
                  <label>{t("eng.worker")}</label>
                  <select value={active.worker || ""} onChange={(e) => changeWorker(e.target.value)}>
                    <option value="">{t("eng.defaultWorker")}</option>
                    {workers.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}{w.isDefault ? " (default)" : ""}{!w.enabled ? " · disabled" : ""}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <label>{t("eng.scopeIn")}</label>
              <div className="chips">
                {active.scope.include.length === 0 && <span className="muted">{t("eng.noneList")}</span>}
                {active.scope.include.map((x) => <span key={x} className="chip">{x}</span>)}
              </div>
              <label>{t("eng.scopeEx")}</label>
              <div className="chips">
                {active.scope.exclude.length === 0 && <span className="muted">{t("eng.noneList")}</span>}
                {active.scope.exclude.map((x) => <span key={x} className="chip">{x}</span>)}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button onClick={() => addScope("add")}>{t("eng.addIn")}</button>
                <button onClick={() => addScope("exclude")}>{t("eng.addEx")}</button>
              </div>

              <label>{t("tpl.label")} <span className="muted">{t("tpl.hint")}</span></label>
              <div className="row" style={{ gap: 6 }}>
                <select style={{ flex: 5 }} value={selectedTemplate} onChange={(e) => setSelectedTemplate(e.target.value)}>
                  <option value="">{t("tpl.pick")}</option>
                  <optgroup label="── Built-in ──">
                    {builtinList().map((b) => (
                      <option key={b.key} value={`b:${b.key}`}>{b.label}</option>
                    ))}
                  </optgroup>
                  {customTemplates.length > 0 && (
                    <optgroup label="── Custom ──">
                      {customTemplates.flatMap((ct) =>
                        (["basic", "medium", "advanced"] as const)
                          .filter((l) => ct.levels[l]?.trim())
                          .map((l) => (
                            <option key={`${ct.id}:${l}`} value={`c:${ct.id}:${l}`}>{ct.name} · {l}</option>
                          ))
                      )}
                    </optgroup>
                  )}
                  {orgTemplates.length > 0 && (
                    <optgroup label="── Org Library ──">
                      {orgTemplates.flatMap((ot) =>
                        (["basic", "medium", "advanced"] as const)
                          .filter((l) => ot.levels[l]?.trim())
                          .map((l) => (
                            <option key={`o${ot.id}:${l}`} value={`o:${ot.id}:${l}`}>{ot.name} · {l}</option>
                          ))
                      )}
                    </optgroup>
                  )}
                </select>
                <button style={{ flex: "none" }} disabled={!selectedTemplate} onClick={applyMerged}>{t("tpl.use")}</button>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                {t("tpl.manageHint")}<b>{t("tpl.settingsLink")}</b>
              </div>

              <label style={{ marginTop: 10 }}>{t("obj.label")}</label>
              <textarea
                rows={5}
                placeholder={t("obj.placeholder")}
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  checked={autoApprove}
                  onChange={(e) => setAutoApprove(e.target.checked)}
                />
                <span>{t("auto.label")} <span className="muted">{t("auto.hint")}</span></span>
              </label>
              {autoApprove && (
                <div className="warn" style={{ fontSize: 11 }}>
                  {t("auto.warn")}
                </div>
              )}
              {status === "running" || status === "waiting_approval" ? (
                <button
                  className="reject"
                  style={{ marginTop: 8, width: "100%" }}
                  onClick={stopSession}
                >
                  {t("spawn.stop")}
                </button>
              ) : (
                <button
                  className="primary"
                  style={{ marginTop: 8, width: "100%" }}
                  disabled={!authed}
                  onClick={spawnSession}
                >
                  {t("spawn.run")}
                </button>
              )}
              {!authed && <div className="warn">{t("spawn.needAuth")}</div>}

              {/* Findings + report */}
              <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <label>{t("find.title")} ({active.findings?.length ?? 0})</label>
                {(active.findings ?? []).length === 0 && <div className="muted" style={{ fontSize: 12 }}>{t("find.none")}</div>}
                {(active.findings ?? []).slice(0, 6).map((f, i) => (
                  <div key={i} style={{ fontSize: 12, marginBottom: 2 }}>
                    <span className={`pill ${sevPill(f.severity)}`}>{f.severity}</span> {f.title}
                  </div>
                ))}
                <div className="row" style={{ marginTop: 8, gap: 6 }}>
                  <button onClick={viewReport}>{t("find.viewReport")}</button>
                  <button onClick={exportPdf}>{t("find.exportPdf")}</button>
                </div>
              </div>

              {/* Session history */}
              <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <label>{t("hist.title")} ({sessions.length})</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
                  {sessions.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t("hist.none")}</span>}
                  {sessions.map((s) => (
                    <button
                      key={s._id}
                      onClick={() => viewSession(s._id)}
                      style={{ textAlign: "left", fontSize: 11, padding: "6px 8px", lineHeight: 1.5 }}
                    >
                      <span className={`status-${s.status}`}>{s.status}</span> · {s.entries} {t("hist.entries")}
                      <br />
                      <span className="muted">{new Date(s.createdAt).toLocaleString()} — {(s.objective || "(no objective)").slice(0, 34)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Vulnerability feeds / updates */}
          <div className="panel" style={{ marginTop: 16 }}>
            <h2>{t("feeds.title")}</h2>
            <div className="row" style={{ marginBottom: 10 }}>
              <button className="primary" disabled={updating} onClick={updateAll}>
                {updating ? t("feeds.updating") : t("feeds.updateAll")}
              </button>
              <button disabled={updating} onClick={loadFeeds}>{t("feeds.refresh")}</button>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0" }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                disabled={edition === "community"}
                checked={feeds?.autoEnabled ?? false}
                onChange={(e) => toggleAuto(e.target.checked)}
              />
              <span>{t("feeds.auto")}</span>
              {edition === "community" && (
                <span className="pill no" style={{ fontSize: 10 }} title="Scheduled auto-updates require Enterprise">🔒 Enterprise</span>
              )}
            </label>
            {feeds?.autoEnabled && (
              <div className="row" style={{ alignItems: "center", gap: 6 }}>
                <span className="muted">{t("feeds.every")}</span>
                <input
                  type="number"
                  min={1}
                  max={336}
                  value={feeds.intervalHours}
                  onChange={(e) => changeInterval(Number(e.target.value) || 24)}
                />
                <span className="muted">{t("feeds.hours")}</span>
              </div>
            )}

            {feeds && feeds.workers.length > 1 && (
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                {t("feeds.allWorkers")} {feeds.workers.length} {t("feeds.workersSuffix")}
              </div>
            )}
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              {feeds?.sources.map((s) => (
                <div key={s.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>{s.label}</strong>
                    <button disabled={updating} onClick={() => updateOne(s.id)}>⟳</button>
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>{s.description}</div>
                  <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                    {feeds.workers.map((w) => {
                      const run = feeds.runs[w.id]?.[s.id];
                      return (
                        <div key={w.id} style={{ fontSize: 11, display: "flex", gap: 6, alignItems: "center" }}>
                          {feeds.workers.length > 1 && <span className="muted" style={{ minWidth: 90 }}>{w.name}</span>}
                          {run ? (
                            <>
                              <span className={`pill ${run.ok ? "ok" : "no"}`}>{run.ok ? "OK" : "FAIL"}</span>
                              <span className="muted">{new Date(run.at).toLocaleString()}</span>
                            </>
                          ) : (
                            <span className="muted">{t("feeds.never")}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT: live session / history / report */}
        <div className="panel" style={{ display: "flex", flexDirection: "column" }}>
          <h2>
            {reportText !== null ? t("sess.report") : t("sess.title")}{" "}
            {reportText === null && session && (
              <span className={`status-${status}`}>· {status.replace("_", " ")}</span>
            )}
            {reportText !== null && active && <span className="muted">· {active.name}</span>}
          </h2>

          {reportText !== null ? (
            <>
              <div className="row" style={{ justifyContent: "flex-end", marginBottom: 6, gap: 6 }}>
                <button className="primary" onClick={exportPdf}>{t("find.exportPdf")}</button>
                <button onClick={() => setReportText(null)}>{t("sess.back")}</button>
              </div>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  margin: 0,
                  height: "auto",
                  overflow: "visible",
                  fontSize: 13,
                  lineHeight: 1.6,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 14,
                  background: "var(--panel2, #060a14)",
                }}
              >
                {reportText || "(empty report)"}
              </pre>
            </>
          ) : (
            <>
              {approvals.map((a) => (
                <div className="approval" key={a.approvalId}>
                  <div>{t("sess.approvalReq")} <code>{a.tool}</code></div>
                  <div className="muted" style={{ margin: "4px 0" }}>{a.rationale}</div>
                  <div><code>{JSON.stringify(a.args)}</code></div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="approve" onClick={() => decide(a, "approve")}>{t("sess.approve")}</button>
                    <button className="reject" onClick={() => decide(a, "reject")}>{t("sess.reject")}</button>
                  </div>
                </div>
              ))}

              <div className="transcript" ref={scrollRef} style={{ flex: 1, minHeight: 320, height: "auto" }}>
                {!session && <div className="muted">{t("sess.empty")}</div>}
                {transcript.map((e, i) => (
                  <div key={i} className={`msg ${e.role}`}>
                    <div className="who">{e.tool ? `${e.role} · ${e.tool}` : e.role}</div>
                    {e.content}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      </>
      )}
      </ErrorBoundary>
    </div>
  );
}

function LoginView({ onSubmit, err }: { onSubmit: (e: string, p: string) => void; err: string }) {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sso, setSso] = useState<{ enabled: boolean; label: string }>({ enabled: false, label: "" });
  useEffect(() => {
    api.getSsoStatus().then(setSso).catch(() => {});
  }, []);
  return (
    <div className="wrap" style={{ maxWidth: 380, marginTop: "12vh" }}>
      <div className="brand" style={{ textAlign: "center", marginBottom: 20 }}>
        AEGIS<small>{t("login.subtitle")}</small>
      </div>
      <form
        className="panel"
        onSubmit={(ev) => { ev.preventDefault(); onSubmit(email.trim(), password); }}
      >
        <h2>{t("login.signin")}</h2>
        {sso.enabled && (
          <>
            <button
              type="button"
              className="primary"
              style={{ width: "100%", marginBottom: 6 }}
              onClick={() => { window.location.href = api.ssoLoginUrl(); }}
            >
              🔑 {sso.label || "Sign in with SSO"}
            </button>
            <div className="muted" style={{ textAlign: "center", fontSize: 11, margin: "8px 0" }}>— or —</div>
          </>
        )}
        <label>{t("login.email")}</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" />
        <label>{t("login.password")}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {err && <div className="warn" style={{ color: "var(--red)" }}>{err}</div>}
        <button className="primary" type="submit" style={{ width: "100%", marginTop: 14 }}>
          {t("login.signin")}
        </button>
      </form>
    </div>
  );
}
