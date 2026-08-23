import net from "node:net";
import dns from "node:dns/promises";
import { Engagement, ShellCommand } from "../db/mongo.js";
import { workerExec, workerShell, type WorkerRef } from "../worker/exec.js";
import { proxyUrl } from "../integrations/service.js";
import { audit } from "../audit/service.js";
import { UPDATE_SOURCES } from "../updates/registry.js";
import * as updates from "../updates/service.js";
import { eeHooks } from "../lib/eehooks.js";
import { findOrigin } from "../osint/service.js";
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
  /** "enterprise" → only exposed/executed under a valid Enterprise license. */
  edition?: "enterprise";
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

export const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
export const clampInt = (v: unknown, d: number, min: number, max: number): number => {
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

const cveLookup: ToolDef = {
  category: "vuln",
  risk: "passive",
  schema: {
    name: "cve_lookup",
    description:
      "Map a product + version to known CVE ids (via searchsploit's Exploit-DB index). Passive discovery — touches no target. Use the returned CVE ids on save_finding (cve field) and fill the cvss score from the CVE. Coverage is limited to CVEs that have a public exploit — for a version with a well-known CVE that has no public exploit, also use your own knowledge.",
    parameters: {
      type: "object",
      properties: {
        product: { type: "string", description: "Product / software name, e.g. 'Medusa' or 'Apache httpd'" },
        version: { type: "string", description: "Version string if known, e.g. '2.12.2'" },
      },
      required: ["product"],
    },
  },
  async run(args, ctx) {
    const product = str(args.product);
    if (!product) return "error: product required";
    const version = str(args.version);
    const terms = `${product} ${version}`.trim().split(/\s+/).slice(0, 6);
    const raw = await workerExec(ctx.worker, "searchsploit", ["-j", ...terms]);
    let entries: Array<{ Title?: string; Codes?: string }> = [];
    try {
      entries = (JSON.parse(raw) as { RESULTS_EXPLOIT?: Array<{ Title?: string; Codes?: string }> }).RESULTS_EXPLOIT ?? [];
    } catch {
      return `searchsploit (raw): ${raw.slice(0, 1500)}`;
    }
    const cveRe = /CVE-\d{4}-\d{3,7}/g;
    const seen = new Map<string, string>(); // cve -> first exploit title
    for (const e of entries) for (const c of (e.Codes ?? "").match(cveRe) ?? []) if (!seen.has(c)) seen.set(c, e.Title ?? "");
    if (seen.size === 0)
      return `No CVE mapped from Exploit-DB for "${product} ${version}". Public exploits found: ${entries.length}. If you know a well-known CVE for this product/version, use it from your own knowledge.`;
    const lines = [...seen.entries()].slice(0, 40).map(([c, t]) => `${c} — ${t}`);
    return `Known CVEs for ${product} ${version} (from public exploits; set CVSS yourself):\n${lines.join("\n")}`;
  },
};

/* -------------------------------------------------------- secret scanning */
// High-signal detectors for secrets that leak in client-side code. group = the
// capture group holding the value (default: whole match).
const SECRET_DETECTORS: Array<{ name: string; re: RegExp; group?: number }> = [
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { name: "Stripe secret key", re: /\bsk_(?:live|test)_[0-9a-zA-Z]{16,}\b/g },
  { name: "Stripe publishable key", re: /\b[rp]k_(?:live|test)_[0-9a-zA-Z]{16,}\b/g },
  { name: "GitHub token", re: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g },
  { name: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { name: "Client env secret (NEXT_PUBLIC_*)", re: /NEXT_PUBLIC_[A-Z0-9_]*?(?:KEY|TOKEN|SECRET|PASS)[A-Z0-9_]*\s*[:=]\s*["'`]?([^"'`\s,;})]{8,})/g, group: 1 },
  { name: "Generic key/secret assignment", re: /(?:api[_-]?key|apikey|secret|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd)["'`]?\s*[:=]\s*["'`]([A-Za-z0-9_\-.]{16,})["'`]/gi, group: 1 },
];

const maskSecret = (s: string): string =>
  s.length <= 12 ? `${s.slice(0, 2)}…${s.slice(-2)}` : `${s.slice(0, 6)}…${s.slice(-4)} (len ${s.length})`;

function scanForSecrets(source: string, text: string, out: Map<string, { type: string; value: string; source: string }>): void {
  for (const d of SECRET_DETECTORS) {
    d.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = d.re.exec(text)) !== null && n < 100) {
      n++;
      const raw = (d.group ? m[d.group] : m[0]) ?? "";
      if (raw.length < 8) continue;
      const key = `${d.name}|${raw}`;
      if (!out.has(key)) out.set(key, { type: d.name, value: raw, source });
    }
  }
}

async function grabText(url: string, cap = 800_000): Promise<string> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    return (await res.text()).slice(0, cap);
  } catch {
    return "";
  }
}

const secretScan: ToolDef = {
  category: "recon",
  risk: "active",
  targetArg: "url",
  schema: {
    name: "secret_scan",
    description:
      "Fetch a web page and its same-origin JavaScript bundles and scan them for leaked secrets / API keys (Stripe, AWS, Google, GitHub, JWTs, NEXT_PUBLIC_* client env vars, generic key assignments). ACTIVE — touches the target. Detection only; values are MASKED and never verified against the vendor. Optionally also scans a few Wayback Machine snapshots for secrets that leaked in the past.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target page URL" },
        include_archive: { type: "boolean", description: "Also scan a few web.archive.org snapshots (default false)" },
      },
      required: ["url"],
    },
  },
  async run(args) {
    const url = str(args.url);
    if (!url) return "error: url required";
    const includeArchive = args.include_archive === true;
    const hits = new Map<string, { type: string; value: string; source: string }>();

    const html = await grabText(url);
    if (!html) return `error: could not fetch ${url}`;
    scanForSecrets("page", html, hits);

    // Same-origin linked scripts (Next.js/webpack bundles are where client keys leak).
    let origin = "";
    try { origin = new URL(url).origin; } catch { /* ignore */ }
    const scripts: string[] = [];
    const sre = /<script[^>]+src=["']([^"']+)["']/gi;
    let sm: RegExpExecArray | null;
    while ((sm = sre.exec(html)) !== null && scripts.length < 25) {
      try {
        const abs = new URL(sm[1], url).toString();
        if (origin && abs.startsWith(origin) && !scripts.includes(abs)) scripts.push(abs);
      } catch { /* ignore */ }
    }
    for (const s of scripts) scanForSecrets(`js:${s.split("/").pop() || s}`, await grabText(s), hits);

    // Optional: Wayback Machine snapshots (public archive of the target's past).
    let snaps = 0;
    if (includeArchive) {
      try {
        const cdx = await grabText(
          `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&limit=6&filter=statuscode:200&collapse=digest`,
          40_000
        );
        const rows = JSON.parse(cdx || "[]") as string[][];
        for (const r of rows.slice(1, 4)) {
          const [, ts, original] = r;
          if (!ts || !original) continue;
          snaps++;
          scanForSecrets(`archive:${ts}`, await grabText(`http://web.archive.org/web/${ts}id_/${original}`), hits);
        }
      } catch { /* ignore */ }
    }

    const scanned = 1 + scripts.length + snaps;
    if (hits.size === 0) return `No secrets detected in ${url}${includeArchive ? " (+archive)" : ""} across ${scanned} resource(s).`;
    const lines = [...hits.values()].slice(0, 60).map((h) => `[${h.type}] ${maskSecret(h.value)}  (${h.source})`);
    return `Potential leaked secrets in ${url} — ${hits.size} unique across ${scanned} resource(s). Values MASKED; verify manually, do NOT use:\n${lines.join("\n")}`;
  },
};

const originIpOsint: ToolDef = {
  category: "recon",
  risk: "active",
  targetArg: "domain",
  schema: {
    name: "origin_ip_osint",
    description:
      "Find candidate ORIGIN IPs behind a CDN/WAF (e.g. Cloudflare) for a domain via OSINT: Shodan DNS, Censys certificate search, and SecurityTrails DNS history. It queries those providers (not the target) and flags which candidate IPs are Cloudflare edge vs a likely real origin. Requires an API key configured in Settings → OSINT.",
    parameters: {
      type: "object",
      properties: { domain: { type: "string", description: "Domain to resolve the origin for, e.g. store.example.com" } },
      required: ["domain"],
    },
  },
  async run(args) {
    const domain = str(args.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain) return "error: domain required";
    return findOrigin(domain);
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
        cve: { type: "string", description: "Known CVE id if the issue maps to one, e.g. CVE-2025-69871 (optional)." },
        cvss: { type: "number", description: "CVSS base score 0.0–10.0 for that CVE (optional)." },
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
            cve: str(args.cve),
            cvss: (() => { const n = Number(args.cvss); return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : undefined; })(),
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
  cve?: string | null;
  cvss?: number | null;
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
    if (f.cve) lines.push(`**CVE:** ${f.cve}${typeof f.cvss === "number" ? ` (CVSS ${f.cvss})` : ""}`);
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

// Core tools shipped in every edition. Any Enterprise-only tools live in the
// private `ee/` overlay and are merged in at runtime via eeHooks.extraTools — so
// they are physically ABSENT from the Community build, not merely license-gated.
const CORE_TOOLS: Record<string, ToolDef> = {
  dns_lookup: dnsLookup,
  http_probe: httpProbe,
  tcp_scan: tcpScan,
  nmap_scan: nmapScan,
  dir_enum: dirEnum,
  web_vuln_scan: webVulnScan,
  exploit_search: exploitSearch,
  cve_lookup: cveLookup,
  secret_scan: secretScan,
  origin_ip_osint: originIpOsint,
  cred_test: credTest,
  run_command: runCommand,
  update_feeds: updateFeeds,
  feed_status: feedStatus,
  save_finding: saveFinding,
  generate_report: generateReport,
};

/** Core tools + any Enterprise overlay tools present in this build. */
export const allTools = (): Record<string, ToolDef> => ({ ...CORE_TOOLS, ...eeHooks.extraTools });

/** Look up a tool by name across core + Enterprise overlay. */
export const getTool = (name: string): ToolDef | undefined => CORE_TOOLS[name] ?? eeHooks.extraTools[name];

/** Is this tool gated behind an Enterprise license? */
export const isEnterpriseTool = (name: string): boolean => getTool(name)?.edition === "enterprise";

/**
 * Schemas exposed to the model. Enterprise-only tools are withheld unless
 * `opts.enterprise` is true, so a Community instance never even sees them.
 */
export const toolSchemas = (only?: string[], opts?: { enterprise?: boolean }): ToolSchema[] =>
  Object.values(allTools())
    .filter((t) => !only || only.includes(t.schema.name))
    .filter((t) => t.edition !== "enterprise" || opts?.enterprise)
    .map((t) => t.schema);
