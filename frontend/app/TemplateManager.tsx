"use client";

import { useEffect, useRef, useState } from "react";
import { api, type CustomTemplate, type TemplateLevels } from "../lib/api";
import { CATEGORIES, buildObjective } from "./objectiveTemplates";
import { useT } from "./i18n";

const LEVELS: (keyof TemplateLevels)[] = ["basic", "medium", "advanced"];
const LVL_LABEL: Record<string, string> = { basic: "Basic", medium: "Medium", advanced: "Advanced" };

export function TemplateManager({ onChanged }: { onChanged?: () => void }) {
  const { t } = useT();
  const [templates, setTemplates] = useState<CustomTemplate[]>([]);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [levels, setLevels] = useState<TemplateLevels>({ basic: "", medium: "", advanced: "" });
  const [copyFrom, setCopyFrom] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function reload() {
    try { setTemplates(await api.listTemplates()); } catch (e) { setErr(String((e as Error).message)); }
  }
  useEffect(() => { reload(); }, []);

  const setLevel = (k: keyof TemplateLevels, v: string) => setLevels((p) => ({ ...p, [k]: v }));

  function resetForm() {
    setEditId(null); setName(""); setLevels({ basic: "", medium: "", advanced: "" }); setCopyFrom(""); setErr(""); setMsg("");
  }
  function edit(t: CustomTemplate) {
    setEditId(t.id); setName(t.name); setLevels({ ...t.levels }); setCopyFrom(""); setErr(""); setMsg("");
  }
  function doCopy() {
    if (!copyFrom) return;
    const kind = copyFrom.slice(0, 1);
    const key = copyFrom.slice(2);
    if (kind === "b") {
      const cat = CATEGORIES.find((c) => c.key === key);
      if (cat) {
        setLevels({
          basic: buildObjective(key, "basic", "<TARGET>"),
          medium: buildObjective(key, "medium", "<TARGET>"),
          advanced: buildObjective(key, "advanced", "<TARGET>"),
        });
        setMsg(t("tm.copied3Builtin")); setErr("");
      }
    } else {
      const c = templates.find((x) => x.id === key);
      if (c) { setLevels({ ...c.levels }); setMsg(t("tm.copied3")); setErr(""); }
    }
  }
  async function save() {
    if (!levels.basic.trim() && !levels.medium.trim() && !levels.advanced.trim()) {
      setErr(t("tm.needOne")); return;
    }
    try {
      if (editId) await api.updateTemplate(editId, { name, levels });
      else await api.createTemplate(name, levels);
      setMsg(editId ? t("tm.updated") : t("tm.created"));
      setErr(""); resetForm(); await reload(); onChanged?.();
    } catch (e) { setErr(String((e as Error).message)); }
  }
  async function remove(id: string) {
    if (!confirm(t("tm.confirmDelete"))) return;
    try { await api.deleteTemplate(id); if (editId === id) resetForm(); await reload(); onChanged?.(); }
    catch (e) { setErr(String((e as Error).message)); }
  }
  function exportJson() {
    const data = JSON.stringify(templates.map((t) => ({ name: t.name, levels: t.levels })), null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = "aegis-templates.json"; a.click();
    URL.revokeObjectURL(url);
  }
  async function importFile(file: File) {
    try {
      const parsed = JSON.parse(await file.text());
      const r = await api.importTemplates(Array.isArray(parsed) ? parsed : [], false);
      setMsg(t("tm.imported").replace("{n}", String(r.imported))); setErr(""); await reload(); onChanged?.();
    } catch (e) { setErr(t("tm.badFile") + String((e as Error).message)); }
  }

  return (
    <div className="panel">
      <h2 style={{ marginTop: 0 }}>{t("tm.title")}</h2>
      <div className="muted" style={{ fontSize: 11, margin: "6px 0 10px" }}>
        {t("tm.intro")}
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        <button onClick={exportJson}>{t("tm.exportAll")}</button>
        <button onClick={() => fileRef.current?.click()}>{t("tm.import")}</button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
      </div>

      {err && <div className="warn" style={{ color: "var(--red)" }}>{err}</div>}
      {msg && <div className="warn" style={{ color: "var(--green)" }}>{msg}</div>}

      {/* saved templates — name left, Edit/Delete compact on the right, same line */}
      <label>{t("tm.saved")} ({templates.length})</label>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
        {templates.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t("tm.savedNone")}</span>}
        {templates.map((tpl) => (
          <div key={tpl.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, borderTop: "1px solid var(--border)", padding: "7px 0" }}>
            <div style={{ minWidth: 0 }}>
              <strong>{tpl.name}</strong>{" "}
              {LEVELS.filter((l) => tpl.levels[l].trim()).map((l) => (
                <span key={l} className="pill" style={{ fontSize: 10, marginLeft: 2 }}>{LVL_LABEL[l]}</span>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flex: "none" }}>
              <button onClick={() => edit(tpl)}>{t("tm.edit")}</button>
              <button className="reject" onClick={() => remove(tpl.id)}>{t("tm.delete")}</button>
            </div>
          </div>
        ))}
      </div>

      {/* editor */}
      <div style={{ borderTop: "1px solid var(--cyan-dim)", paddingTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>{editId ? t("tm.editHead") : t("tm.newHead")}</h3>
        <label>{t("tm.name")}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("tm.namePlaceholder")} />

        <label>{t("tm.copyFrom")}</label>
        <div className="row" style={{ gap: 6 }}>
          <select style={{ flex: 5 }} value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">{t("tm.copyPick")}</option>
            <optgroup label="Built-in">
              {CATEGORIES.map((c) => <option key={c.key} value={`b:${c.key}`}>{c.label}</option>)}
            </optgroup>
            {templates.filter((tpl) => tpl.id !== editId).length > 0 && (
              <optgroup label="Custom">
                {templates.filter((tpl) => tpl.id !== editId).map((tpl) => <option key={tpl.id} value={`c:${tpl.id}`}>{tpl.name}</option>)}
              </optgroup>
            )}
          </select>
          <button style={{ flex: "none" }} onClick={doCopy}>{t("tm.copyBtn")}</button>
        </div>

        <div className="muted" style={{ fontSize: 11, margin: "10px 0 2px" }}>
          {t("tm.cmdHint")}
        </div>
        {LEVELS.map((l) => (
          <div key={l}>
            <label>{LVL_LABEL[l]}</label>
            <textarea rows={3} value={levels[l]} onChange={(e) => setLevel(l, e.target.value)}
              placeholder={t("tm.levelPlaceholder")} />
          </div>
        ))}

        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          <button className="primary" onClick={save}>{editId ? t("tm.update") : t("tm.create")}</button>
          {editId && <button onClick={resetForm}>{t("tm.newForm")}</button>}
        </div>
      </div>
    </div>
  );
}
