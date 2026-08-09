import { Router } from "express";
import {
  listWorkers,
  createWorker,
  updateWorker,
  deleteWorker,
  setDefaultWorker,
  getWorkerById,
} from "../workers/registry.js";
import { workerHealth } from "../worker/exec.js";
import { requireRole, type AuthedRequest } from "../auth/middleware.js";
import { audit } from "../audit/service.js";
import { isEnterprise } from "../edition/service.js";
import { COMMUNITY_LIMITS } from "../edition/features.js";

// Kali worker registry — admin-managed.
export const workersRouter = Router();

workersRouter.use(requireRole("admin"));

workersRouter.get("/", async (_req, res) => {
  res.json(await listWorkers());
});

workersRouter.post("/", async (req: AuthedRequest, res) => {
  const { name, url, token, enabled } = req.body ?? {};
  if (!url || typeof url !== "string") return res.status(400).json({ error: "url required" });
  // Edition gate: Community allows a single Kali worker.
  if (!(await isEnterprise())) {
    const { workers } = await listWorkers();
    if (workers.length >= COMMUNITY_LIMITS.workers)
      return res.status(402).json({
        error: `Community edition is limited to ${COMMUNITY_LIMITS.workers} Kali worker. Upgrade to Enterprise to run multiple workers.`,
        feature: "workers.multi",
        upgrade: true,
      });
  }
  const id = await createWorker({ name, url, token, enabled });
  await audit({ actor: req.user!.email, actorRole: req.user!.role, action: "worker.create", detail: `${name || url}`, ip: req.ip });
  res.status(201).json({ id });
});

workersRouter.put("/:id", async (req: AuthedRequest, res) => {
  const { name, url, token, enabled } = req.body ?? {};
  const ok = await updateWorker(req.params.id, {
    ...(typeof name === "string" ? { name } : {}),
    ...(typeof url === "string" ? { url } : {}),
    ...(typeof token === "string" ? { token } : {}),
    ...(typeof enabled === "boolean" ? { enabled } : {}),
  });
  if (!ok) return res.status(404).json({ error: "worker not found" });
  await audit({ actor: req.user!.email, actorRole: req.user!.role, action: "worker.update", target: req.params.id, ip: req.ip });
  res.json({ ok: true });
});

workersRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const ok = await deleteWorker(req.params.id);
  if (!ok) return res.status(404).json({ error: "worker not found" });
  await audit({ actor: req.user!.email, actorRole: req.user!.role, action: "worker.delete", target: req.params.id, ip: req.ip });
  res.json({ ok: true });
});

workersRouter.post("/:id/default", async (req: AuthedRequest, res) => {
  const ok = await setDefaultWorker(req.params.id);
  if (!ok) return res.status(404).json({ error: "worker not found" });
  await audit({ actor: req.user!.email, actorRole: req.user!.role, action: "worker.default", target: req.params.id, ip: req.ip });
  res.json({ ok: true });
});

workersRouter.get("/:id/health", async (req, res) => {
  const w = await getWorkerById(req.params.id);
  if (!w) return res.status(404).json({ error: "worker not found" });
  res.json(await workerHealth(w));
});
