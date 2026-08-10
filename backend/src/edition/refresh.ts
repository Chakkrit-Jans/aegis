/**
 * Optional ONLINE license refresh. When LICENSE_REFRESH_URL is set, the instance
 * periodically posts its current license to the vendor License Server and:
 *   - picks up a renewed token (auto-renew after payment), or
 *   - drops the license if the server reports it revoked/expired (instant kill).
 * If the URL is unset the product stays fully offline (no phone-home).
 * A network failure is non-fatal — the current license is kept (grace).
 */
import { Setting } from "../db/mongo.js";
import { setLicense, clearLicense } from "./service.js";
import { log } from "../lib/log.js";

const URL = process.env.LICENSE_REFRESH_URL || "";
const HOURS = Number(process.env.LICENSE_REFRESH_HOURS || 12);

async function currentLicense(): Promise<string> {
  const doc = (await Setting.findOne({ key: "license" }).lean()) as { value?: { license?: string } } | null;
  return doc?.value?.license || "";
}

async function runOnce(): Promise<void> {
  const token = await currentLicense();
  if (!token) return; // Community — nothing to refresh
  let data: { status?: string; token?: string };
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return log.warn(`license refresh: server responded ${res.status} — keeping current license`);
    data = (await res.json()) as { status?: string; token?: string };
  } catch {
    return log.warn("license refresh: server unreachable — keeping current license");
  }
  if (data.status === "active" && data.token) {
    if (data.token !== token) {
      await setLicense(data.token);
      log.info("license refresh: picked up a renewed license from the server");
    }
  } else if (data.status === "revoked" || data.status === "expired" || data.status === "none") {
    await clearLicense();
    log.info(`license refresh: server reports "${data.status}" — reverted to Community`);
  }
}

export function startLicenseRefresh(): void {
  if (!URL) return; // offline mode
  log.info(`Online license refresh enabled (every ${HOURS}h) → ${URL}`);
  runOnce().catch((e) => log.warn(`license refresh error: ${e}`));
  setInterval(() => runOnce().catch((e) => log.warn(`license refresh error: ${e}`)), HOURS * 3600 * 1000);
}
