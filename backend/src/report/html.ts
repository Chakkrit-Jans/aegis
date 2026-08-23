interface RFinding {
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
interface REngagement {
  name: string;
  client?: string | null;
  scope?: { include?: string[] | null; exclude?: string[] | null } | null;
  findings?: RFinding[] | null;
}

export interface ReportBranding {
  companyName: string;
  logoDataUrl: string;
  primaryColor: string;
  footer: string;
}

const ORDER = ["critical", "high", "medium", "low", "info"];
const COLOR: Record<string, string> = {
  critical: "#b30021",
  high: "#d9480f",
  medium: "#b8860b",
  low: "#2f6f4f",
  info: "#5a6b7a",
};
const CONF_ORDER = ["certain", "firm", "tentative"];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const sevOf = (f: RFinding) => (f.severity ?? "info").toLowerCase();
const confOf = (f: RFinding) => {
  const c = (f.confidence ?? "certain").toLowerCase();
  return CONF_ORDER.includes(c) ? c : "certain";
};
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A polished, print-ready HTML client report. The browser's "Save as PDF" turns it into a PDF.
 * `branding` (Enterprise only) white-labels the cover, accent colour and footer. */
export function renderReportHtml(eng: REngagement, dateStr: string, branding?: ReportBranding | null): string {
  const accent = branding?.primaryColor || "#0b7285";
  const findings = [...(eng.findings ?? [])].sort((a, b) => ORDER.indexOf(sevOf(a)) - ORDER.indexOf(sevOf(b)));
  const counts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[sevOf(f)] = (counts[sevOf(f)] ?? 0) + 1;
  const confCounts: Record<string, number> = { certain: 0, firm: 0, tentative: 0 };
  for (const f of findings) confCounts[confOf(f)] = (confCounts[confOf(f)] ?? 0) + 1;
  const uniqueAssets = new Set(findings.map((f) => (f.asset ?? "").trim()).filter(Boolean)).size;
  const uniqueCves = new Set(findings.map((f) => (f.cve ?? "").trim()).filter(Boolean)).size;
  const maxCvss = findings.reduce((m, f) => (typeof f.cvss === "number" && f.cvss > m ? f.cvss : m), 0);

  const overall =
    counts.critical > 0 ? "CRITICAL" : counts.high > 0 ? "HIGH" : counts.medium > 0 ? "MEDIUM" : counts.low > 0 ? "LOW" : "INFORMATIONAL";
  const overallColor =
    counts.critical > 0 ? COLOR.critical : counts.high > 0 ? COLOR.high : counts.medium > 0 ? COLOR.medium : counts.low > 0 ? COLOR.low : COLOR.info;

  const summaryRows = ORDER.map(
    (s) =>
      `<tr><td><span class="dot" style="background:${COLOR[s]}"></span>${cap(s)}</td><td style="text-align:right;font-weight:600">${counts[s]}</td></tr>`
  ).join("");

  // Scan statistics (Burp-style): high-level counts for the assessment.
  const statRows = [
    ["Total issues", String(findings.length)],
    ["Unique affected assets", String(uniqueAssets)],
    ["Highest severity", overall],
    ...(uniqueCves > 0 ? [["Known CVEs", `${uniqueCves}${maxCvss > 0 ? ` (max CVSS ${maxCvss})` : ""}`]] : []),
    ["Confidence — Certain", String(confCounts.certain)],
    ["Confidence — Firm", String(confCounts.firm)],
    ["Confidence — Tentative", String(confCounts.tentative)],
  ]
    .map(([k, v]) => `<tr><td>${k}</td><td style="text-align:right;font-weight:600">${esc(v)}</td></tr>`)
    .join("");

  // "Issues found" — group findings by type (title), Burp-style, most severe group first.
  const groups = new Map<string, RFinding[]>();
  for (const f of findings) {
    const key = (f.title ?? "(untitled finding)").trim();
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(f);
  }
  const groupSev = (list: RFinding[]) => Math.min(...list.map((f) => ORDER.indexOf(sevOf(f))));
  const sortedGroups = [...groups.entries()].sort((a, b) => groupSev(a[1]) - groupSev(b[1]));

  const issuesFound =
    findings.length === 0
      ? `<p class="muted">No issues were recorded for this engagement.</p>`
      : sortedGroups
          .map(([title, list]) => {
            const top = list.slice().sort((a, b) => ORDER.indexOf(sevOf(a)) - ORDER.indexOf(sevOf(b)))[0];
            const gsev = sevOf(top);
            const rows = list
              .slice()
              .sort((a, b) => ORDER.indexOf(sevOf(a)) - ORDER.indexOf(sevOf(b)))
              .map((f) => {
                const sev = sevOf(f);
                return `<tr>
        <td>${esc(f.asset || "—")}</td>
        <td><span class="pill" style="background:${COLOR[sev]}">${sev.toUpperCase()}</span></td>
        <td>${cap(confOf(f))}</td>
      </tr>`;
              })
              .join("\n");
            return `<div class="isstype">
      <span class="badge" style="background:${COLOR[gsev]}">${gsev.toUpperCase()}</span>
      <span class="isstitle">${esc(title)}</span>
      <span class="isscount">${list.length} instance${list.length === 1 ? "" : "s"}</span>
    </div>
    <table class="issdetail">
      <tr><th>Affected asset</th><th style="width:110px">Severity</th><th style="width:110px">Confidence</th></tr>
      ${rows}
    </table>`;
          })
          .join("\n");

  const findingBlocks =
    findings.length === 0
      ? `<p class="muted">No findings were recorded for this engagement.</p>`
      : findings
          .map((f, i) => {
            const sev = sevOf(f);
            const para = (s?: string | null) => esc(s ?? "").replace(/\n/g, "<br/>");
            const block = (label: string, s?: string | null, cls = "") =>
              s ? `<div class="rblock"><span class="rlabel${cls}">${label}</span><div class="rtext">${para(s)}</div></div>` : "";
            const structured = f.description || f.impact || f.remediation;
            const body = structured
              ? block("Description", f.description) +
                block("Impact / Risk", f.impact, " risk") +
                block("Remediation", f.remediation, " fix") +
                block("Evidence / Notes", f.detail)
              : `<div class="detail">${para(f.detail)}</div>`; // legacy single-blob finding
            return `<div class="finding">
      <div class="fhead">
        <span class="badge" style="background:${COLOR[sev]}">${sev.toUpperCase()}</span>
        <span class="ftitle">${i + 1}. ${esc(f.title ?? "(untitled finding)")}</span>
        ${f.cve ? `<span class="fcve">${esc(f.cve)}${typeof f.cvss === "number" ? ` · CVSS ${f.cvss}` : ""}</span>` : ""}
        <span class="fconf">Confidence: ${cap(confOf(f))}</span>
      </div>
      ${f.asset ? `<div class="asset"><b>Affected asset:</b> ${esc(f.asset)}</div>` : ""}
      ${body}
    </div>`;
          })
          .join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>Report — ${esc(eng.name)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "Sarabun", system-ui, sans-serif; color:#1a2430; margin:0; font-size:13px; line-height:1.6; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 24px; }
  h1 { font-size: 26px; margin: 0 0 4px; color:${accent}; }
  h2 { font-size: 17px; margin: 26px 0 10px; color:${accent}; border-bottom:2px solid #e2e8f0; padding-bottom:6px; }
  .sub { color:#5a6b7a; margin:2px 0; }
  .meta { display:flex; gap:24px; flex-wrap:wrap; margin-top:10px; }
  .meta div b { color:${accent}; }
  .risk { display:inline-block; padding:6px 14px; border-radius:6px; color:#fff; font-weight:700; letter-spacing:1px; }
  table { width:100%; border-collapse:collapse; margin:8px 0; }
  td, th { border:1px solid #e2e8f0; padding:7px 10px; }
  th { background:#f1f5f9; text-align:left; }
  .dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:8px; vertical-align:middle; }
  .cols { display:flex; gap:20px; flex-wrap:wrap; align-items:flex-start; }
  .cols > div { flex:1; min-width:260px; }
  .cols h3 { font-size:13px; margin:0 0 4px; color:#5a6b7a; text-transform:uppercase; letter-spacing:.5px; }
  .isstype { display:flex; align-items:center; gap:10px; margin:14px 0 0; padding:6px 0; border-top:1px solid #e2e8f0; page-break-after: avoid; }
  .isstitle { font-weight:700; color:${accent}; }
  .isscount { color:#8a99a8; font-size:11px; margin-left:auto; }
  table.issdetail { margin-top:4px; page-break-inside: avoid; }
  table.issdetail td, table.issdetail th { padding:5px 9px; font-size:12px; }
  .pill { color:#fff; font-size:10px; font-weight:700; padding:1px 7px; border-radius:10px; }
  .finding { border:1px solid #e2e8f0; border-radius:8px; padding:14px 16px; margin:12px 0; page-break-inside: avoid; }
  .fhead { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
  .badge { color:#fff; font-size:11px; font-weight:700; letter-spacing:.5px; padding:2px 8px; border-radius:4px; }
  .ftitle { font-size:15px; font-weight:700; color:${accent}; }
  .fcve { font-size:10px; font-weight:700; color:#7c2d12; background:#fff1e6; border:1px solid #fdba74; padding:1px 7px; border-radius:10px; white-space:nowrap; }
  .fconf { margin-left:auto; color:#8a99a8; font-size:11px; }
  .asset { color:#5a6b7a; margin:4px 0; }
  .detail { white-space:normal; margin-top:6px; }
  .rblock { margin-top:8px; }
  .rlabel { display:block; font-size:11px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:#5a6b7a; margin-bottom:2px; }
  .rlabel.risk { color:${overallColor}; }
  .rlabel.fix { color:#2f6f4f; }
  .rtext { white-space:normal; }
  .muted { color:#5a6b7a; }
  .foot { margin-top:30px; color:#8a99a8; font-size:11px; border-top:1px solid #e2e8f0; padding-top:10px; }
  .cover { border-left:4px solid ${overallColor}; padding-left:14px; }
  @media print { .noprint { display:none; } }
</style></head>
<body><div class="wrap">
  <div class="noprint" style="margin-bottom:14px;text-align:right">
    <button onclick="window.print()" style="padding:8px 16px;font-size:14px;cursor:pointer">🖨️ Print / Save as PDF</button>
  </div>
  <div class="cover">
    ${branding?.logoDataUrl ? `<img src="${branding.logoDataUrl}" alt="logo" style="max-height:60px;max-width:240px;margin-bottom:12px;display:block"/>` : ""}
    <h1>Penetration Test Report</h1>
    <div class="sub">${esc(eng.name)}</div>
    <div class="meta">
      <div><b>Client:</b> ${esc(eng.client || "n/a")}</div>
      <div><b>Date:</b> ${esc(dateStr)}</div>
      <div><b>Overall risk:</b> <span class="risk" style="background:${overallColor}">${overall}</span></div>
    </div>
    <div class="sub" style="margin-top:8px"><b>Scope:</b> ${esc((eng.scope?.include ?? []).join(", ") || "(none)")}</div>
    ${branding?.companyName ? `<div class="sub" style="margin-top:6px"><b>Prepared by:</b> ${esc(branding.companyName)}</div>` : ""}
  </div>

  <h2>Executive Summary</h2>
  <p>This report presents the results of an authorized security assessment of <b>${esc(eng.name)}</b>.
  A total of <b>${findings.length}</b> finding(s) were identified. The overall risk rating is
  <b style="color:${overallColor}">${overall}</b>.</p>
  <div class="cols">
    <div>
      <h3>Issues by severity</h3>
      <table><tr><th>Severity</th><th style="text-align:right">Count</th></tr>${summaryRows}</table>
    </div>
    <div>
      <h3>Scan statistics</h3>
      <table>${statRows}</table>
    </div>
  </div>
  <p class="muted">Each finding below includes evidence, impact, the risk it poses, and a concrete
  remediation recommendation. Remediate higher-severity issues first.</p>

  <h2>Issues found on ${esc((eng.scope?.include ?? []).join(", ") || eng.name)}</h2>
  ${issuesFound}

  <h2>Findings &amp; Remediation</h2>
  ${findingBlocks}

  <div class="foot">${branding?.footer ? esc(branding.footer) : "Aegis — authorized penetration testing only. This report is confidential and intended for the named client."}</div>
</div></body></html>`;
}
