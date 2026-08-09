/**
 * License verification. A license is `base64url(payloadJSON).base64url(signature)`,
 * signed with the vendor's Ed25519 PRIVATE key (which never ships). The product
 * ships only the PUBLIC key below and verifies offline, so licenses cannot be
 * forged. Mint licenses with `licensing/sign-license.mjs`.
 */
import { createPublicKey, verify as edVerify } from "node:crypto";
import type { Edition } from "./features.js";

// Vendor public key. Replace with your own (keep the matching private key offline).
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWFtHVbWHYHuROWsJPlCV98S/wdPHYIf27lG5bB7nXTU=
-----END PUBLIC KEY-----`;

export interface LicensePayload {
  org: string;
  edition: "enterprise";
  issued: number; // epoch ms
  expires: number | null; // epoch ms, or null = perpetual
}

export interface LicenseResult {
  valid: boolean;
  edition: Edition;
  org?: string;
  expires?: number | null;
  error?: string;
}

export function verifyLicense(license: string): LicenseResult {
  if (!license || !license.trim()) return { valid: false, edition: "community" };
  try {
    const [body, sig] = license.trim().split(".");
    if (!body || !sig) return { valid: false, edition: "community", error: "malformed license" };
    const payloadBytes = Buffer.from(body, "base64url");
    const ok = edVerify(null, payloadBytes, createPublicKey(PUBLIC_KEY_PEM), Buffer.from(sig, "base64url"));
    if (!ok) return { valid: false, edition: "community", error: "bad signature" };
    const p = JSON.parse(payloadBytes.toString("utf8")) as LicensePayload;
    if (p.edition !== "enterprise") return { valid: false, edition: "community", error: "unknown edition" };
    if (p.expires && Date.now() > p.expires)
      return { valid: false, edition: "community", org: p.org, expires: p.expires, error: "license expired" };
    return { valid: true, edition: "enterprise", org: p.org, expires: p.expires ?? null };
  } catch (e) {
    return { valid: false, edition: "community", error: (e as Error).message };
  }
}
