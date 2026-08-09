/**
 * Edition resolution: the current edition is Enterprise if a valid license is
 * stored (Setting key "license"), otherwise Community. Entitlements are derived
 * from the feature registry. Verification is cached briefly so it isn't re-run
 * on every request.
 */
import { Setting } from "../db/mongo.js";
import { verifyLicense, type LicenseResult } from "./license.js";
import { ENTERPRISE_FEATURES, COMMUNITY_LIMITS, type Edition } from "./features.js";

const KEY = "license";
let cache: { at: number; license: string; result: LicenseResult } | null = null;
const TTL_MS = 30_000;

async function readLicense(): Promise<string> {
  const doc = await Setting.findOne({ key: KEY }).lean();
  const value = (doc?.value ?? {}) as { license?: string };
  return value.license ?? "";
}

export async function getLicenseResult(): Promise<LicenseResult> {
  const license = await readLicense();
  if (cache && cache.license === license && Date.now() - cache.at < TTL_MS) return cache.result;
  const result = verifyLicense(license);
  cache = { at: Date.now(), license, result };
  return result;
}

export async function getEdition(): Promise<Edition> {
  return (await getLicenseResult()).edition;
}

export async function isEnterprise(): Promise<boolean> {
  return (await getEdition()) === "enterprise";
}

export async function setLicense(license: string): Promise<LicenseResult> {
  await Setting.updateOne({ key: KEY }, { $set: { value: { license } } }, { upsert: true });
  cache = null;
  return verifyLicense(license);
}

export async function clearLicense(): Promise<void> {
  await Setting.updateOne({ key: KEY }, { $set: { value: { license: "" } } }, { upsert: true });
  cache = null;
}

/** Everything the UI needs to render edition state and gate features. */
export async function getEntitlements() {
  const r = await getLicenseResult();
  const enterprise = r.edition === "enterprise";
  return {
    edition: r.edition,
    org: r.org ?? null,
    expires: r.expires ?? null,
    licenseError: r.error ?? null,
    features: ENTERPRISE_FEATURES.map((f) => ({ ...f, enabled: enterprise })),
    limits: enterprise
      ? { aiProviders: null as number | null, workers: null as number | null }
      : { aiProviders: COMMUNITY_LIMITS.aiProviders, workers: COMMUNITY_LIMITS.workers },
  };
}
