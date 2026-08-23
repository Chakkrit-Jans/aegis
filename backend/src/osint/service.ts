/**
 * OSINT origin-IP discovery. Finds candidate origin IPs behind a CDN/WAF
 * (e.g. Cloudflare) for a domain, using third-party OSINT APIs the operator
 * supplies keys for (Shodan / Censys / SecurityTrails). All keys are stored in
 * the Setting collection (key "osint") and entered through the UI — never in
 * code/env. The lookups are passive (they query the OSINT providers, not the
 * target) and the tool is scope + approval gated at the agent layer.
 */
import { Setting } from "../db/mongo.js";

const KEY = "osint";

export interface OsintConfig {
  shodanKey: string;
  censysId: string;
  censysSecret: string;
  securitytrailsKey: string;
}

const defaults: OsintConfig = { shodanKey: "", censysId: "", censysSecret: "", securitytrailsKey: "" };

export async function getOsintConfig(): Promise<OsintConfig> {
  const doc = await Setting.findOne({ key: KEY }).lean();
  return { ...defaults, ...((doc?.value as Partial<OsintConfig>) ?? {}) };
}

/** Save keys. An empty/undefined field KEEPS the existing value (so the UI can
 * show "set" without forcing re-entry of a secret). */
export async function setOsintConfig(p: Partial<OsintConfig>): Promise<OsintConfig> {
  const cur = await getOsintConfig();
  const pick = (nv: string | undefined, ov: string) => (nv && nv.trim() ? nv.trim() : ov);
  const next: OsintConfig = {
    shodanKey: pick(p.shodanKey, cur.shodanKey),
    censysId: pick(p.censysId, cur.censysId),
    censysSecret: pick(p.censysSecret, cur.censysSecret),
    securitytrailsKey: pick(p.securitytrailsKey, cur.securitytrailsKey),
  };
  await Setting.updateOne({ key: KEY }, { $set: { value: next } }, { upsert: true });
  return next;
}

/** Client-safe view: never return the keys, only whether each is set. */
export function toPublicOsint(c: OsintConfig) {
  return {
    shodanSet: Boolean(c.shodanKey),
    censysSet: Boolean(c.censysId && c.censysSecret),
    securitytrailsSet: Boolean(c.securitytrailsKey),
  };
}

// Cloudflare published IPv4 ranges — used to flag which candidates are the CDN
// edge vs a likely real origin.
const CF_CIDRS = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];
const ipToInt = (ip: string): number => ip.split(".").reduce((a, o) => ((a << 8) >>> 0) + (Number(o) & 255), 0) >>> 0;
function inCidr(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ipToInt(ip) & mask) >>> 0) === ((ipToInt(net) & mask) >>> 0);
}
const isCloudflare = (ip: string): boolean => CF_CIDRS.some((c) => inCidr(ip, c));

async function jget(url: string, headers?: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

/** Aggregate candidate origin IPs for a domain from whichever OSINT keys are set. */
export async function findOrigin(domain: string): Promise<string> {
  const cfg = await getOsintConfig();
  const cand = new Map<string, Set<string>>(); // ip -> which sources reported it
  const add = (ip: unknown, src: string) => {
    if (typeof ip !== "string" || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return;
    let s = cand.get(ip);
    if (!s) { s = new Set(); cand.set(ip, s); }
    s.add(src);
  };
  const used: string[] = [];
  const errors: string[] = [];
  const enc = encodeURIComponent(domain);

  if (cfg.securitytrailsKey) {
    used.push("SecurityTrails");
    try {
      const h = await jget(`https://api.securitytrails.com/v1/history/${enc}/dns/a`, { APIKEY: cfg.securitytrailsKey });
      for (const rec of (h.records as Array<{ values?: Array<{ ip?: string }> }>) ?? [])
        for (const v of rec.values ?? []) add(v.ip, "ST:dns-history");
    } catch (e) { errors.push(`SecurityTrails: ${(e as Error).message}`); }
  }
  if (cfg.shodanKey) {
    used.push("Shodan");
    try {
      const d = await jget(`https://api.shodan.io/dns/domain/${enc}?key=${cfg.shodanKey}`);
      for (const r of (d.data as Array<{ type?: string; value?: string }>) ?? [])
        if (r.type === "A") add(r.value, "Shodan:dns");
    } catch (e) { errors.push(`Shodan: ${(e as Error).message}`); }
  }
  if (cfg.censysId && cfg.censysSecret) {
    used.push("Censys");
    try {
      const auth = Buffer.from(`${cfg.censysId}:${cfg.censysSecret}`).toString("base64");
      const q = encodeURIComponent(`services.tls.certificates.leaf_data.names: ${domain}`);
      const s = await jget(`https://search.censys.io/api/v2/hosts/search?q=${q}&per_page=25`, { Authorization: `Basic ${auth}` });
      const hits = (s.result as { hits?: Array<{ ip?: string }> })?.hits ?? [];
      for (const hit of hits) add(hit.ip, "Censys:cert");
    } catch (e) { errors.push(`Censys: ${(e as Error).message}`); }
  }

  if (used.length === 0)
    return "No OSINT API keys configured. Add a Shodan / Censys / SecurityTrails key in Settings → OSINT (Origin-IP sources), then retry.";
  const errSuffix = errors.length ? `\nErrors: ${errors.join("; ")}` : "";
  if (cand.size === 0) return `Queried ${used.join(", ")} for ${domain} — no candidate IPs found.${errSuffix}`;

  const rows = [...cand.entries()].map(([ip, srcs]) => ({ ip, cf: isCloudflare(ip), srcs: [...srcs] }));
  rows.sort((a, b) => Number(a.cf) - Number(b.cf)); // likely-origin first
  const origins = rows.filter((r) => !r.cf);
  const lines = rows.map((r) => `${r.ip}  ${r.cf ? "[Cloudflare]" : "[likely ORIGIN]"}  (${r.srcs.join(", ")})`);
  const verdict = origins.length
    ? `→ ${origins.length} candidate origin IP(s) NOT in Cloudflare ranges — verify by requesting the site directly on these IPs (Host header) before reporting.`
    : "→ all candidates are Cloudflare edge — try SecurityTrails DNS history (pre-CDN records) or a cert-fingerprint search.";
  return `Origin-IP OSINT for ${domain} via ${used.join(", ")}:\n${lines.join("\n")}\n${verdict}${errSuffix}`;
}
