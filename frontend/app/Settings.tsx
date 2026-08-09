"use client";

import { useEffect, useState } from "react";
import {
  api,
  type Integrations,
  type AiProfile,
  type WorkerRow,
  type UserRow,
  type AuditRow,
  type Me,
} from "../lib/api";
import { TemplateManager } from "./TemplateManager";
import { EE_SETTINGS_PANELS } from "./ee/panels";
import { useT } from "./i18n";

// Known models per provider — used as selectable suggestions. The field stays
// free-text, so any other model name can still be typed manually.
const MODELS: Record<string, string[]> = {
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  anthropic: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5", "claude-3-7-sonnet-latest"],
  "openai-compatible": ["gpt-4o-mini", "gpt-4o", "llama3.1", "qwen2.5", "mistral", "deepseek-r1"],
};

export function Settings({ me }: { me: Me }) {
  const { t } = useT();
  const isAdmin = me.role === "admin";
  // AI provider profiles
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null); // null = adding new
  const [fName, setFName] = useState("");
  const [fProvider, setFProvider] = useState("deepseek");
  const [fApiKey, setFApiKey] = useState("");
  const [fModel, setFModel] = useState("");
  const [fBaseUrl, setFBaseUrl] = useState("");
  const [fModels, setFModels] = useState<string[]>([]);
  // Kali workers
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [wShowForm, setWShowForm] = useState(false);
  const [wEditId, setWEditId] = useState<string | null>(null);
  const [wName, setWName] = useState("");
  const [wUrl, setWUrl] = useState("");
  const [wToken, setWToken] = useState("");
  const [wHealth, setWHealth] = useState<Record<string, string>>({});
  const [integ, setInteg] = useState<Integrations | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // proxy form
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyLabel, setProxyLabel] = useState("burp");
  // telegram form
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  // new user form
  const [nEmail, setNEmail] = useState("");
  const [nPass, setNPass] = useState("");
  const [nRole, setNRole] = useState("operator");

  const guard = <T,>(p: Promise<T>) =>
    p.catch((e) => { setErr(String((e as Error).message)); setMsg(""); return undefined; });
  // Success feedback that clears any stale error, so the two are never shown together.
  const flash = (m: string) => { setMsg(m); setErr(""); };

  async function loadAll() {
    setErr(""); setMsg("");
    if (!isAdmin) return;
    await reloadProfiles();
    await reloadWorkers();
    const i = await guard(api.getIntegrations());
    if (i) { setInteg(i); setProxyUrl(i.proxy.url); setProxyLabel(i.proxy.label); setChatId(i.telegram.chatId); }
    const u = await guard(api.listUsers());
    if (u) setUsers(u);
    const a = await guard(api.getAudit());
    if (a) setAuditRows(a);
  }

  async function reloadProfiles() {
    const p = await guard(api.listAiProfiles());
    if (p) setProfiles(p.profiles);
  }
  function openNew() {
    setEditId(null); setFName(""); setFProvider("deepseek"); setFApiKey(""); setFModel(""); setFBaseUrl("");
    setFModels([]); setShowForm(true); setErr(""); setMsg("");
  }
  async function openEdit(p: AiProfile) {
    setEditId(p.id); setFName(p.name); setFProvider(p.provider); setFApiKey(""); setFModel(p.model); setFBaseUrl(p.baseUrl);
    setFModels([]); setShowForm(true); setErr(""); setMsg("");
    if (p.apiKeySet || p.provider === "openai-compatible") {
      const m = await api.listAiProfileModels(p.id).catch(() => null);
      if (m) setFModels(m.models);
    }
  }
  async function saveProfile() {
    const body = { name: fName, provider: fProvider, apiKey: fApiKey, baseUrl: fBaseUrl, model: fModel };
    const r = editId ? await guard(api.updateAiProfile(editId, body)) : await guard(api.createAiProfile(body));
    if (r) { flash(editId ? "Provider updated." : "Provider added."); setShowForm(false); await reloadProfiles(); }
  }
  async function removeProfile(id: string) {
    if (!confirm("Delete this provider profile?")) return;
    const r = await guard(api.deleteAiProfile(id));
    if (r) { flash("Provider deleted."); await reloadProfiles(); }
  }
  async function makeDefault(id: string) {
    const r = await guard(api.setDefaultAiProfile(id));
    if (r) { flash("Default provider set."); await reloadProfiles(); }
  }
  async function testProfile(id: string) {
    const r = await guard(api.testAiProfile(id));
    if (r) flash(`AI OK — ${r.provider} / ${r.model} replied: "${r.reply}"`);
  }
  async function fetchFormModels() {
    if (!editId) { setErr("Save the profile first, then fetch its models."); setMsg(""); return; }
    const r = await guard(api.listAiProfileModels(editId));
    if (r) { setFModels(r.models); flash(`Loaded ${r.models.length} models from ${r.provider}.`); }
  }

  // --- Kali workers ---
  async function reloadWorkers() {
    const r = await guard(api.listWorkers());
    if (r) setWorkers(r.workers);
  }
  function openNewWorker() {
    setWEditId(null); setWName(""); setWUrl(""); setWToken(""); setWShowForm(true); setErr(""); setMsg("");
  }
  function openEditWorker(w: WorkerRow) {
    setWEditId(w.id); setWName(w.name); setWUrl(w.url); setWToken(""); setWShowForm(true); setErr(""); setMsg("");
  }
  async function saveWorker() {
    if (!wUrl.trim()) { setErr("Worker URL required (e.g. http://worker2:7000)."); setMsg(""); return; }
    const body = { name: wName, url: wUrl, token: wToken };
    const r = wEditId ? await guard(api.updateWorker(wEditId, body)) : await guard(api.createWorker(body));
    if (r) { flash(wEditId ? "Worker updated." : "Worker added."); setWShowForm(false); await reloadWorkers(); }
  }
  async function removeWorker(id: string) {
    if (!confirm("Delete this worker?")) return;
    const r = await guard(api.deleteWorker(id));
    if (r) { flash("Worker deleted."); await reloadWorkers(); }
  }
  async function makeWorkerDefault(id: string) {
    const r = await guard(api.setDefaultWorker(id));
    if (r) { flash("Default worker set."); await reloadWorkers(); }
  }
  async function checkWorker(id: string) {
    const r = await guard(api.workerHealth(id));
    if (r) setWHealth((h) => ({ ...h, [id]: r.ok ? `OK · ${(r.tools || []).length} tools` : `DOWN: ${r.error || "?"}` }));
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, []);

  if (!isAdmin) return <div className="panel muted">{t("set.adminOnly")}{me.role}.</div>;

  async function saveProxy(enabled: boolean) {
    const next = await guard(api.setProxy({ enabled, url: proxyUrl, label: proxyLabel }));
    if (next) { setInteg(next); flash("Proxy saved."); }
  }
  async function saveTelegram(enabled: boolean) {
    const next = await guard(api.setTelegram({ enabled, botToken, chatId }));
    if (next) { setInteg(next); setBotToken(""); flash("Telegram saved."); }
  }
  async function testTelegram() {
    const r = await guard(api.testTelegram());
    if (r) flash("Test message sent — check Telegram.");
  }
  async function addUser() {
    const r = await guard(api.createUser(nEmail, nPass, nRole));
    if (r) { setNEmail(""); setNPass(""); flash("User created."); const u = await api.listUsers(); setUsers(u); }
  }
  async function removeUser(id: string) {
    if (!confirm("Delete this user?")) return;
    const r = await guard(api.deleteUser(id));
    if (r) setUsers((x) => x.filter((u) => u.id !== id));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {err && <div className="panel" style={{ borderColor: "var(--red)" }}>⚠ {err}</div>}
      {msg && <div className="panel" style={{ borderColor: "var(--green)", color: "var(--green)" }}>{msg}</div>}

      {/* AI providers */}
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>{t("set.ai.title")}</h2>
          <button className="primary" onClick={openNew}>{t("set.ai.add")}</button>
        </div>
        <div className="muted" style={{ fontSize: 11, margin: "8px 0" }}>
          {t("set.ai.desc")}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {profiles.length === 0 && <div className="muted">{t("set.ai.none")}</div>}
          {profiles.map((p) => (
            <div
              key={p.id}
              style={{
                borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex",
                justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap",
              }}
            >
              <div>
                <strong>{p.name}</strong>{" "}
                {p.isDefault && <span className="pill ok">DEFAULT</span>}{" "}
                {!p.apiKeySet && <span className="pill no">no key</span>}
                <div className="muted" style={{ fontSize: 12 }}>{p.provider} · {p.model || "default model"}</div>
              </div>
              <div className="row" style={{ flex: "none", gap: 6 }}>
                {!p.isDefault && <button onClick={() => makeDefault(p.id)}>{t("set.setDefault")}</button>}
                <button onClick={() => testProfile(p.id)}>{t("set.ai.test")}</button>
                <button onClick={() => openEdit(p)}>{t("set.edit")}</button>
                <button className="reject" onClick={() => removeProfile(p.id)}>{t("set.delete")}</button>
              </div>
            </div>
          ))}
        </div>

        {showForm && (
          <div style={{ borderTop: "1px solid var(--cyan-dim)", marginTop: 12, paddingTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>{editId ? t("set.ai.editHead") : t("set.ai.addHead")}</h3>
            <label>{t("set.name")}</label>
            <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. DeepSeek prod" />
            <label>Provider</label>
            <select value={fProvider} onChange={(e) => { setFProvider(e.target.value); setFModel(""); setFModels([]); }}>
              <option value="deepseek">DeepSeek</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai-compatible">OpenAI-compatible / local</option>
            </select>
            <label>{t("set.ai.apiKey")} {editId && <span className="muted">{t("set.keepBlank")}</span>}</label>
            <input
              type="password"
              value={fApiKey}
              onChange={(e) => setFApiKey(e.target.value)}
              placeholder={editId ? "•••••• (leave blank to keep)" : "sk-..."}
            />
            <label>{t("set.ai.model")}</label>
            <div className="row" style={{ gap: 8 }}>
              <input
                style={{ flex: 5 }}
                list="ai-model-options"
                value={fModel}
                onChange={(e) => setFModel(e.target.value)}
                placeholder={`e.g. ${(fModels[0] ?? MODELS[fProvider]?.[0]) ?? "model name"}`}
              />
              <button style={{ flex: "none" }} onClick={fetchFormModels} title="ดึงรุ่นล่าสุดจาก provider (ต้อง Save profile ก่อน)">
                ↻ Fetch
              </button>
            </div>
            <datalist id="ai-model-options">
              {Array.from(new Set([...fModels, ...(MODELS[fProvider] ?? [])])).map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {fProvider === "openai-compatible" && (
              <>
                <label>Base URL</label>
                <input value={fBaseUrl} onChange={(e) => setFBaseUrl(e.target.value)} placeholder="http://host.docker.internal:11434/v1" />
              </>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button className="primary" onClick={saveProfile}>{editId ? t("set.update") : t("set.add")}</button>
              <button onClick={() => setShowForm(false)}>{t("set.cancel")}</button>
            </div>
          </div>
        )}
      </div>

      {/* Custom objective templates */}
      <TemplateManager />

      {/* Enterprise panels (empty in the Community build) */}
      {EE_SETTINGS_PANELS.map((Panel, i) => <Panel key={i} />)}

      {/* Kali workers */}
      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>{t("set.wk.title")}</h2>
          <button className="primary" onClick={openNewWorker}>{t("set.wk.add")}</button>
        </div>
        <div className="muted" style={{ fontSize: 11, margin: "8px 0" }}>
          {t("set.wk.desc")} <code>http://worker2:7000</code>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {workers.map((w) => (
            <div
              key={w.id}
              style={{
                borderTop: "1px solid var(--border)", paddingTop: 8, display: "flex",
                justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap",
              }}
            >
              <div>
                <strong>{w.name}</strong>{" "}
                {w.isDefault && <span className="pill ok">DEFAULT</span>}{" "}
                {!w.enabled && <span className="pill no">disabled</span>}
                <div className="muted" style={{ fontSize: 12 }}>
                  {w.url} {wHealth[w.id] && <span className={wHealth[w.id].startsWith("OK") ? "" : "pill no"}>· {wHealth[w.id]}</span>}
                </div>
              </div>
              <div className="row" style={{ flex: "none", gap: 6 }}>
                {!w.isDefault && <button onClick={() => makeWorkerDefault(w.id)}>{t("set.setDefault")}</button>}
                <button onClick={() => checkWorker(w.id)}>{t("set.wk.health")}</button>
                <button onClick={() => openEditWorker(w)}>{t("set.edit")}</button>
                <button className="reject" onClick={() => removeWorker(w.id)}>{t("set.delete")}</button>
              </div>
            </div>
          ))}
        </div>

        {wShowForm && (
          <div style={{ borderTop: "1px solid var(--cyan-dim)", marginTop: 12, paddingTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>{wEditId ? t("set.wk.editHead") : t("set.wk.addHead")}</h3>
            <label>{t("set.name")}</label>
            <input value={wName} onChange={(e) => setWName(e.target.value)} placeholder="e.g. Kali · client-A" />
            <label>URL (internal exec-agent)</label>
            <input value={wUrl} onChange={(e) => setWUrl(e.target.value)} placeholder="http://worker2:7000" />
            <label>Token {wEditId && <span className="muted">{t("set.keepBlank")}</span>}</label>
            <input
              type="password"
              value={wToken}
              onChange={(e) => setWToken(e.target.value)}
              placeholder={wEditId ? "•••••• (leave blank to keep)" : "WORKER_TOKEN"}
            />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="primary" onClick={saveWorker}>{wEditId ? t("set.update") : t("set.add")}</button>
              <button onClick={() => setWShowForm(false)}>{t("set.cancel")}</button>
            </div>
          </div>
        )}
      </div>

      {/* Proxy / Burp / Caido */}
      <div className="panel">
        <h2>{t("set.px.title")}</h2>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          {t("set.px.desc")} <code>http://host.docker.internal:8080</code>
        </div>
        <label>{t("set.px.type")}</label>
        <select value={proxyLabel} onChange={(e) => setProxyLabel(e.target.value)}>
          <option value="burp">Burp Suite</option>
          <option value="caido">Caido</option>
          <option value="custom">Custom</option>
        </select>
        <label>{t("set.px.url")}</label>
        <input value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} placeholder="http://host.docker.internal:8080" />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={() => saveProxy(true)}>{t("set.enableSave")}</button>
          <button onClick={() => saveProxy(false)}>{t("set.disable")}</button>
        </div>
        <div style={{ marginTop: 8 }}>
          {t("set.status")}{" "}
          <span className={`pill ${integ?.proxy.enabled ? "ok" : "no"}`}>
            {integ?.proxy.enabled ? `ON → ${integ.proxy.url}` : "OFF"}
          </span>
        </div>
      </div>

      {/* Telegram */}
      <div className="panel">
        <h2>{t("set.tg.title")}</h2>
        <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
          {t("set.tg.desc")}
        </div>
        <label>{t("set.tg.botToken")} {integ?.telegram.botTokenSet && <span className="pill ok">set</span>}</label>
        <input
          type="password"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder={integ?.telegram.botTokenSet ? "•••••• (leave blank to keep)" : "123456:ABC-..."}
        />
        <label>{t("set.tg.chatId")}</label>
        <input value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="e.g. 123456789" />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" onClick={() => saveTelegram(true)}>{t("set.enableSave")}</button>
          <button onClick={() => saveTelegram(false)}>{t("set.disable")}</button>
          <button onClick={testTelegram}>{t("set.tg.sendTest")}</button>
        </div>
        <div style={{ marginTop: 8 }}>
          {t("set.status")}{" "}
          <span className={`pill ${integ?.telegram.enabled ? "ok" : "no"}`}>
            {integ?.telegram.enabled ? "ON" : "OFF"}
          </span>
        </div>
      </div>

      {/* Users */}
      <div className="panel">
        <h2>{t("set.us.title")}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
          {users.map((u) => (
            <div key={u.id} style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 6 }}>
              <span>{u.email} <span className="pill">{u.role}</span></span>
              <button className="reject" onClick={() => removeUser(u.id)}>{t("set.delete")}</button>
            </div>
          ))}
        </div>
        <label>{t("set.us.add")}</label>
        <div className="row">
          <input placeholder="email" value={nEmail} onChange={(e) => setNEmail(e.target.value)} />
          <input placeholder="password (min 8)" type="password" value={nPass} onChange={(e) => setNPass(e.target.value)} />
          <select value={nRole} onChange={(e) => setNRole(e.target.value)} style={{ flex: "none", width: 120 }}>
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
          <button className="primary" style={{ flex: "none" }} onClick={addUser}>{t("set.add")}</button>
        </div>
      </div>

      {/* Audit */}
      <div className="panel">
        <h2>{t("set.au.title")}</h2>
        <div className="transcript" style={{ height: "40vh" }}>
          {auditRows.length === 0 && <div className="muted">{t("set.au.none")}</div>}
          {auditRows.map((a) => (
            <div key={a._id} className="msg" style={{ fontSize: 12 }}>
              <div className="who">{new Date(a.createdAt).toLocaleString()} · {a.actor}</div>
              <strong>{a.action}</strong> {a.target && <span className="muted">→ {a.target}</span>}
              {a.detail && <div className="muted" style={{ whiteSpace: "pre-wrap" }}>{a.detail}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
