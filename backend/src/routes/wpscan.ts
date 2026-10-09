import { Router } from "express";
import { getWpscanConfig, setWpscanConfig, toPublicWpscan } from "../wpscan/service.js";
import type { AuthedRequest } from "../auth/middleware.js";
import { audit } from "../audit/service.js";

/** WPScan API token — unlocks wpscan vulnerability data (vulnerable plugin/theme
 * enumeration + CVE output). GET returns only whether the token is set;
 * POST (admin) saves it. */
export const wpscanRouter = Router();

wpscanRouter.get("/", async (_req, res) => {
  res.json(toPublicWpscan(await getWpscanConfig()));
});

wpscanRouter.post("/", async (req: AuthedRequest, res) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "admin only" });
  const { apiToken } = req.body ?? {};
  const next = await setWpscanConfig({ apiToken });
  await audit({ actor: req.user?.email ?? "admin", actorRole: req.user?.role, action: "wpscan.config", ip: req.ip });
  res.json(toPublicWpscan(next));
});
