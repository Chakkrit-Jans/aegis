/**
 * WPScan API token store. The token unlocks wpscan's vulnerability data —
 * vulnerable plugin/theme/version enumeration (`--enumerate vp,vt`) and the CVE
 * output wpscan otherwise suppresses with "No WPScan API Token given".
 *
 * Like the OSINT provider keys, it is stored in the Setting collection
 * (key "wpscan") and entered through the UI — never in code/env. It is injected
 * into wpscan commands at run time, AFTER operator approval, as an exported
 * WPSCAN_API_TOKEN env var so the secret never appears in the approval card,
 * the ShellCommand record, or the audit log.
 */
import { Setting } from "../db/mongo.js";

const KEY = "wpscan";

export interface WpscanConfig {
  apiToken: string;
}

const defaults: WpscanConfig = { apiToken: "" };

export async function getWpscanConfig(): Promise<WpscanConfig> {
  const doc = await Setting.findOne({ key: KEY }).lean();
  return { ...defaults, ...((doc?.value as Partial<WpscanConfig>) ?? {}) };
}

/** Save the token. A blank/undefined value KEEPS the existing one (so the UI can
 * show "set" without forcing re-entry of the secret). */
export async function setWpscanConfig(p: Partial<WpscanConfig>): Promise<WpscanConfig> {
  const cur = await getWpscanConfig();
  const apiToken = p.apiToken && p.apiToken.trim() ? p.apiToken.trim() : cur.apiToken;
  const next: WpscanConfig = { apiToken };
  await Setting.updateOne({ key: KEY }, { $set: { value: next } }, { upsert: true });
  return next;
}

/** Client-safe view: never return the token, only whether it is set. */
export function toPublicWpscan(c: WpscanConfig) {
  return { tokenSet: Boolean(c.apiToken) };
}

/**
 * If `command` invokes wpscan and a token is configured, prepend an exported
 * WPSCAN_API_TOKEN so wpscan (and only wpscan) picks it up. No-op when the
 * command isn't wpscan, no token is stored, or the command already supplies a
 * token (via --api-token or WPSCAN_API_TOKEN). Using an env export rather than
 * appending a flag keeps it safe for piped/chained commands and keeps the
 * secret out of the original command string the caller persists and audits.
 */
export async function injectWpscanToken(command: string): Promise<string> {
  if (!/\bwpscan\b/.test(command)) return command;
  if (/--api-token\b|WPSCAN_API_TOKEN/.test(command)) return command;
  const { apiToken } = await getWpscanConfig();
  if (!apiToken) return command;
  const quoted = `'${apiToken.replace(/'/g, "'\\''")}'`;
  return `export WPSCAN_API_TOKEN=${quoted}; ${command}`;
}
