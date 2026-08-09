"use client";

import { useRef, useState, useEffect } from "react";
import { api } from "../lib/api";
import { useT } from "./i18n";

interface Line {
  cmd: string;
  output: string;
  code: number;
}

export function Terminal({ engagementSlug }: { engagementSlug: string | null }) {
  const { t } = useT();
  const [lines, setLines] = useState<Line[]>([]);
  const [command, setCommand] = useState("");
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  // Block body so the effect always returns undefined. An expression body would
  // return scrollIntoView()'s value, which React treats as a cleanup function —
  // fine when it's undefined, but some browser extensions/polyfills override
  // scrollIntoView to return a value, and React then calls it → "x is not a function".
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, running]);

  async function run() {
    if (!command.trim() || !engagementSlug) return;
    const cmd = command;
    setCommand("");
    setRunning(true);
    setErr("");
    try {
      const res = await api.shellRun(engagementSlug, cmd);
      setLines((l) => [...l, { cmd, output: res.output, code: res.code }]);
    } catch (e) {
      setErr(String((e as Error).message));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="panel">
      <h2>{t("term.title")}</h2>
      {!engagementSlug && <div className="warn">{t("term.selectFirst")}</div>}
      <div className="warn" style={{ marginBottom: 8 }}>
        {t("term.warn")}
      </div>
      <div
        className="transcript"
        style={{ height: "50vh", background: "#04070e", borderRadius: 6, padding: 10 }}
      >
        {lines.length === 0 && <div className="muted">{t("term.noCmds")}</div>}
        {lines.map((l, i) => (
          <div key={i} className="msg" style={{ borderColor: "var(--green)" }}>
            <div style={{ color: "var(--cyan)" }}>$ {l.cmd}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{l.output || t("term.noOutput")}</div>
            <div className="muted" style={{ fontSize: 10 }}>exit {l.code}</div>
          </div>
        ))}
        {running && <div className="muted">{t("term.running")}</div>}
        <div ref={endRef} />
      </div>
      {err && <div className="warn" style={{ color: "var(--red)" }}>{err}</div>}
      <div className="row" style={{ marginTop: 10 }}>
        <input
          style={{ flex: 5, fontFamily: "inherit" }}
          placeholder="whoami; id; nmap -sV ..."
          value={command}
          disabled={!engagementSlug || running}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <button className="primary" disabled={!engagementSlug || running} onClick={run}>
          {t("term.run")}
        </button>
      </div>
    </div>
  );
}
