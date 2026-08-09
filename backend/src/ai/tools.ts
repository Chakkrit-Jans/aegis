import net from "node:net";
import dns from "node:dns/promises";
import { Engagement, ShellCommand } from "../db/mongo.js";
import { workerExec, workerShell, type WorkerRef } from "../worker/exec.js";
import { proxyUrl } from "../integrations/service.js";
import { audit } from "../audit/service.js";
import { UPDATE_SOURCES } from "../updates/registry.js";
import * as updates from "../updates/service.js";
import type { ToolSchema } from "./providers.js";

/**
 * Tool registry the agent can call, organized into pentest phases.
 *
 * risk:
 *   "passive"   → local/read-only lookup → runs freely.
 *   "active"    → touches the target over the network → scope check + approval.
 *   "intrusive" → credential testing / exploitation → scope check + approval,
 *                 and hard caps to avoid DoS / lockout / mass targeting.
 */
export type ToolCategory = "recon" | "vuln" | "cred" | "exploit" | "report";
export type ToolRisk = "passive" | "active" | "intrusive";

export interface ToolContext {
  engagementId: string;
  engagementSlug: string;
  sessionId: string;
  worker: WorkerRef; // the Kali worker this engagement runs on
}

export interface ToolDef {
  schema: ToolSchema;
  category: ToolCategory;
  risk: ToolRisk;
  /** The argument (if any) that names the target, for the scope gate. */
  targetArg?: string;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const clampInt = (v: unknown, d: number, min: number, max: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.max(min, Math.min(max, Math.trunc(n)));
};

/* ------------------------------------------------------------------ recon */

const dnsLookup: ToolDef = {
  category: "recon",
  risk: "passive",
  schema: {
    name: "dns_lookup",
    description: "Resolve A/AAAA/MX/TXT DNS records for a hostname. Passive.",
    parameters: {
      type: "object",
      properties: { host: { type: "string" } },
      required: ["host"],
    },
  },
  async run(args) {
    const host = str(args.host);
    if (!host) return "error: host required";
    const out: string[] = [];
    for (const kind of ["A", "AAAA", "MX", "TXT"] as const) {
      try {
        out.push(`${kind}: ${JSON.stringify(await dns.resolve(host, kind))}`);
      } catch {
        out.push(`${kind}: (none)`);
      }
    }
    return out.join("\n");
  },
};

const httpProbe: ToolDef = {
  category: "recon",
  risk: "active",
  targetArg: "url",
  schema: {
    name: "http_probe",
    description: "Fetch a URL and report status + security headers. ACTIVE.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  async run(args) {
    const url = str(args.url);
    try {
      const res = await fetch(url, { method: "GET", redirect: "manual" });
      const interesting = [
        "server",
        "strict-transport-security",
        "content-security-policy",
        "x-frame-options",
        "x-content-type-options",
      ];
      const headers = interesting.map((h) => `${h}: ${res.headers.get(h) ?? "(missing)"}`).join("\n");
      return `status: ${res.status}\n${headers}`;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  },
};

const tcpScan: ToolDef = {
  category: "recon",
  risk: "active",
  targetArg: "host",
  schema: {
    name: "tcp_scan",
    description: "Built-in TCP connect scan of specific ports. ACTIVE.",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string" },
        ports: { type: "array", items: { type: "number" } },
      },
      required: ["host", "ports"],
    },
  },
  async run(args) {
    const host = str(args.host);
    const ports = (Array.isArray(args.ports) ? (args.ports as number[]) : []).slice(0, 100);
    const results = await Promise.all(
      ports.map((p) => probePort(host, p).then((open) => `${p}: ${open ? "open" : "closed"}`))
    );
    return results.join("\n") || "no ports specified";
  },
};

const nmapScan: ToolDef = {
  category: "recon",
  risk: "active",
  targetArg: "host",
  schema: {
    name: "nmap_scan",
    description:
      "Service/version detection via nmap (top ports). ACTIVE. No aggressive timing, no DoS scripts.",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string" },
        top_ports: { type: "number", description: "How many top ports (max 1000)" },
      },
      required: ["host"],
    },
  },
  async run(args, ctx) {
    const host = str(args.host);
    const top = clampInt(args.top_ports, 100, 1, 1000);
    // -Pn: assume up, -sV: versions, -T3: polite timing (no -T5 / no DoS scripts).
    return workerExec(ctx.worker, "nmap", ["-Pn", "-sV", "-T3", "--top-ports", String(top), host]);
  },
};

const dirEnum: ToolDef = {
  category: "recon",
  risk: "active",
  targetArg: "url",
  schema: {
    name: "dir_enum",
    description: "Content/directory discovery with ffuf against a URL (FUZZ keyword). ACTIVE.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL containing the FUZZ keyword, e.g. https://t/FUZZ" },
        wordlist: { type: "string", description: "Path to wordlist on the worker" },
      },
      required: ["url"],
    },
  },
  async run(args, ctx) {
    const url = str(args.url);
    const wordlist = str(args.wordlist, "/usr/share/wordlists/dirb/common.txt");
    const ffufArgs = ["-u", url, "-w", wordlist, "-t", "20", "-mc", "200,204,301,302,401,403"];
    const proxy = await proxyUrl();
    if (proxy) ffufArgs.push("-x", proxy); // route through Burp/Caido
    return workerExec(ctx.worker, "ffuf", ffufArgs);
  },
};

/* -------------------------------------------------------------------- vuln */

const webVulnScan: ToolDef = {
  category: "vuln",
  risk: "active",
  targetArg: "url",
  schema: {
    name: "web_vuln_scan",
    description: "Scan a web target for known vulnerabilities with nuclei. ACTIVE.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        severity: { type: "string", description: "Comma list: info,low,medium,high,critical" },
      },
      required: ["url"],
    },
  },
  async run(args, ctx) {
    const url = str(args.url);
    const severity = str(args.severity, "medium,high,critical");
    const nucleiArgs = ["-u", url, "-severity", severity, "-rl", "50", "-silent"];
    const proxy = await proxyUrl();
    if (proxy) nucleiArgs.push("-proxy", proxy); // route through Burp/Caido
    return workerExec(ctx.worker, "nuclei", nucleiArgs, 180_000);
  },
};

const exploitSearch: ToolDef = {
  category: "vuln",
  risk: "passive",
  schema: {
    name: "exploit_search",
    description:
      "Look up known public exploits for a product/version (searchsploit). Discovery only — does not run anything.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "e.g. 'Apache 2.4.49'" } },
      required: ["query"],
    },
  },
  async run(args, ctx) {
    const query = str(args.query);
    if (!query) return "error: query required";
    return workerExec(ctx.worker, "searchsploit", query.split(/\s+/).slice(0, 6));
  },
};

/* -------------------------------------------------------------------- cred */

const credTest: ToolDef = {
  category: "cred",
  risk: "intrusive",
  targetArg: "host",
  schema: {
    name: "cred_test",
    description:
      "Test for weak credentials on a service with hydra. INTRUSIVE — capped concurrency to avoid lockouts/DoS. Requires approval.",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string" },
        service: { type: "string", description: "e.g. ssh, ftp, http-post-form" },
        userlist: { type: "string", description: "Path to username list on the worker" },
        passlist: { type: "string", description: "Path to password list on the worker" },
      },
      required: ["host", "service"],
    },
  },
  async run(args, ctx) {
    const host = str(args.host);
    const service = str(args.service);
    const userlist = str(args.userlist, "/usr/share/aegis/users.txt");
    const passlist = str(args.passlist, "/usr/share/aegis/passwords.txt");
    // -t 4: cap threads (avoid lockout/DoS); -f: stop on first hit; -w: wait between tries.
    return workerExec(
      ctx.worker,
      "hydra",
      ["-L", userlist, "-P", passlist, "-t", "4", "-f", "-w", "5", `${service}://${host}`],
      180_000
    );
  },
};

/* ------------------------------------------------------------------ report */

const saveFinding: ToolDef = {
  category: "report",
  risk: "passive",
  schema: {
    name: "save_finding",
    description: "Record a confirmed finding into the engagement report. Fill the structured fields — the report renders each as its own labelled section (Description / Impact / Remediation).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Issue type/name — reuse the SAME title for the same issue on different assets so the report groups them." },
        severity: { type: "string", description: "info|low|medium|high|critical" },
        confidence: { type: "string", description: "How sure you are it is exploitable: certain|firm|tentative (default certain)" },
        asset: { type: "string", description: "Affected asset/URL/path" },
        description: { type: "string", description: "Problem summary: what the vulnerability is and how it was observed (evidence)." },
        impact: { type: "string", description: "The risk / business impact if this is exploited." },
        remediation: { type: "string", description: "Concrete fix and prevention guidance (and, if relevant, what to do if already exploited)." },
        detail: { type: "string", description: "Optional extra evidence or notes (raw output, request/response snippets)." },
      },
      required: ["title", "severity", "description", "impact", "remediation"],
    },
  },
  async run(args, ctx) {
    await Engagement.updateOne(
      { _id: ctx.engagementId },
      {
        $push: {
          findings: {
            title: str(args.title),
            severity: str(args.severity, "info"),
            confidence: str(args.confidence, "certain"),
            asset: str(args.asset),
            description: str(args.description),
            impact: str(args.impact),
            remediation: str(args.remediation),
            detail: str(args.detail),
          },
        },
      }
    );
    return `finding saved: ${str(args.title)} [${str(args.severity, "info")}]`;
  },
};

/* ---------------------------------------------------------------- exploit */

const runCommand: ToolDef = {
  category: "exploit",
  risk: "intrusive",
  schema: {
    name: "run_command",
    description:
      "Run a single shell command on the Kali worker (for exploitation/verification steps). INTRUSIVE — requires operator approval. The operator must confirm the command stays within scope. No target auto-check.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "One shell command to execute on the worker" },
      },
      required: ["command"],
    },
  },
  async run(args, ctx) {
    const command = str(args.command);
    if (!command) return "error: command required";
    const doc = await ShellCommand.create({
      engagement: ctx.engagementId,
      session: ctx.sessionId,
      actor: "agent",
      command,
      status: "running",
    });
    const result = await workerShell(ctx.worker, command);
    doc.exitCode = result.code;
    doc.output = result.output;
    doc.status = result.code === -1 ? "error" : "done";
    await doc.save();
    await audit({
      actor: "agent",
      action: "shell.exec",
      target: ctx.engagementSlug,
      detail: command,
      meta: { sessionId: ctx.sessionId, exitCode: result.code },
    });
    return `exit ${result.code}\n${result.output}`;
  },
};

/* ------------------------------------------------------------- maintenance */

const updateFeeds: ToolDef = {
  category: "vuln",
  risk: "passive",
  schema: {
    name: "update_feeds",
    description:
      "Update local vulnerability feeds on the worker (nuclei templates, Exploit-DB, nmap NSE). Passive maintenance — downloads signatures, does NOT touch any target.",
    parameters: {
      type: "object",
      properties: {
        source: { type: "string", description: "A feed id, or 'all' (default)." },
      },
    },
  },
  async run(args) {
    const source = str(args.source, "all");
    const lines: string[] = [];
    if (source === "all") {
      const byWorker = await updates.runAll();
      for (const [wid, sources] of Object.entries(byWorker))
        for (const [sid, r] of Object.entries(sources))
          lines.push(`worker ${wid} · ${sid}: ${r.ok ? "updated" : "FAILED"}`);
    } else {
      const byWorker = await updates.runSource(source);
      for (const [wid, r] of Object.entries(byWorker))
        lines.push(`worker ${wid} · ${source}: ${r.ok ? "updated" : "FAILED"}`);
    }
    return lines.join("\n") || "no enabled workers";
  },
};

const feedStatus: ToolDef = {
  category: "vuln",
  risk: "passive",
  schema: {
    name: "feed_status",
    description: "Report current vulnerability-feed status: auto-update schedule and when each feed was last updated.",
    parameters: { type: "object", properties: {} },
  },
  async run() {
    const state = await updates.getState();
    const lines = [`auto-update: ${state.autoEnabled ? `every ${state.intervalHours}h` : "off"}`];
    for (const [wid, sources] of Object.entries(state.runsByWorker)) {
      for (const s of UPDATE_SOURCES) {
        const r = sources[s.id];
        lines.push(`worker ${wid} · ${s.id}: ${r ? `last ${r.at} (${r.ok ? "ok" : "failed"})` : "never"}`);
      }
    }
    if (Object.keys(state.runsByWorker).length === 0) lines.push("(no feeds updated yet)");
    return lines.join("\n");
  },
};

const generateReport: ToolDef = {
  category: "report",
  risk: "passive",
  schema: {
    name: "generate_report",
    description: "Compile all recorded findings for this engagement into a Markdown report.",
    parameters: { type: "object", properties: {} },
  },
  async run(_args, ctx) {
    const eng = await Engagement.findById(ctx.engagementId).lean();
    if (!eng) return "error: engagement not found";
    return renderReport(eng);
  },
};

/* --------------------------------------------------------------- helpers */

interface ReportFinding {
  title?: string | null;
  severity?: string | null;
  confidence?: string | null;
  asset?: string | null;
  description?: string | null;
  impact?: string | null;
  remediation?: string | null;
  detail?: string | null;
}
interface ReportEngagement {
  name: string;
  client?: string | null;
  scope?: { include?: string[] | null } | null;
  findings?: ReportFinding[] | null;
}

export function renderReport(eng: ReportEngagement): string {
  const order = ["critical", "high", "medium", "low", "info"];
  const sev = (f: ReportFinding) => f.severity ?? "info";
  const findings = [...(eng.findings ?? [])].sort((a, b) => order.indexOf(sev(a)) - order.indexOf(sev(b)));
  const lines = [
    `# Penetration Test Report — ${eng.name}`,
    `**Client:** ${eng.client || "n/a"}`,
    `**Scope:** ${(eng.scope?.include ?? []).join(", ") || "(none)"}`,
    "",
    "## Summary",
    `Total findings: ${findings.length}`,
    "",
    "## Findings",
  ];
  if (findings.length === 0) lines.push("_No findings recorded._");
  for (const f of findings) {
    lines.push(`### [${sev(f).toUpperCase()}] ${f.title ?? "(untitled)"}`);
    if (f.asset) lines.push(`**Asset:** ${f.asset}`);
    lines.push(`**Confidence:** ${(f.confidence ?? "certain").replace(/^\w/, (c) => c.toUpperCase())}`);
    lines.push("");
    if (f.description || f.impact || f.remediation) {
      if (f.description) lines.push(`**Description:** ${f.description}`, "");
      if (f.impact) lines.push(`**Impact / Risk:** ${f.impact}`, "");
      if (f.remediation) lines.push(`**Remediation:** ${f.remediation}`, "");
      if (f.detail) lines.push(`**Evidence / Notes:** ${f.detail}`, "");
    } else {
      lines.push(f.detail ?? "", ""); // legacy findings: single detail blob
    }
  }
  return lines.join("\n");
}

function probePort(host: string, port: number, timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (open: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

export const TOOLS: Record<string, ToolDef> = {
  dns_lookup: dnsLookup,
  http_probe: httpProbe,
  tcp_scan: tcpScan,
  nmap_scan: nmapScan,
  dir_enum: dirEnum,
  web_vuln_scan: webVulnScan,
  exploit_search: exploitSearch,
  cred_test: credTest,
  run_command: runCommand,
  update_feeds: updateFeeds,
  feed_status: feedStatus,
  save_finding: saveFinding,
  generate_report: generateReport,
};

export const toolSchemas = (only?: string[]): ToolSchema[] =>
  Object.values(TOOLS)
    .filter((t) => !only || only.includes(t.schema.name))
    .map((t) => t.schema);
