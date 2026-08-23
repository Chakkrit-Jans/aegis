import { Router } from "express";
import { getOsintConfig, setOsintConfig, toPublicOsint } from "../osint/service.js";
import type { AuthedRequest } from "../auth/middleware.js";
import { audit } from "../audit/service.js";

/** OSINT provider keys (Shodan / Censys / SecurityTrails) for origin-IP discovery.
 * GET returns only which keys are set; POST (admin) saves them. */
export const osintRouter = Router();

osintRouter.get("/", async (_req, res) => {
  res.json(toPublicOsint(await getOsintConfig()));
});

osintRouter.post("/", async (req: AuthedRequest, res) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "admin only" });
  const { shodanKey, censysId, censysSecret, securitytrailsKey } = req.body ?? {};
  const next = await setOsintConfig({ shodanKey, censysId, censysSecret, securitytrailsKey });
  await audit({ actor: req.user?.email ?? "admin", actorRole: req.user?.role, action: "osint.config", ip: req.ip });
  res.json(toPublicOsint(next));
});
