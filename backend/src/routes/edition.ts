import { Router } from "express";
import { requireRole, type AuthedRequest } from "../auth/middleware.js";
import { audit } from "../audit/service.js";
import { getEntitlements, getLicenseResult, setLicense, clearLicense } from "../edition/service.js";

export const editionRouter = Router();

// Entitlements — any authenticated user (the console reads this to render state).
editionRouter.get("/", async (_req, res) => {
  res.json(await getEntitlements());
});

// License details (never returns the raw key) — admin only.
editionRouter.get("/license", requireRole("admin"), async (_req, res) => {
  const r = await getLicenseResult();
  res.json({ edition: r.edition, org: r.org ?? null, expires: r.expires ?? null, error: r.error ?? null });
});

// Apply a license key — admin only.
editionRouter.post("/license", requireRole("admin"), async (req: AuthedRequest, res) => {
  const { license } = req.body ?? {};
  if (typeof license !== "string") return res.status(400).json({ error: "license (string) required" });
  const r = await setLicense(license);
  await audit({
    actor: req.user!.email,
    actorRole: req.user!.role,
    action: "edition.license.apply",
    detail: r.valid ? `enterprise · ${r.org}` : `invalid: ${r.error}`,
    ip: req.ip,
  });
  if (!r.valid) return res.status(400).json({ error: r.error ?? "invalid license", edition: r.edition });
  res.json({ edition: r.edition, org: r.org ?? null, expires: r.expires ?? null });
});

// Remove the license (back to Community) — admin only.
editionRouter.delete("/license", requireRole("admin"), async (req: AuthedRequest, res) => {
  await clearLicense();
  await audit({ actor: req.user!.email, actorRole: req.user!.role, action: "edition.license.remove", ip: req.ip });
  res.json({ ok: true });
});
