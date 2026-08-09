import { Router } from "express";
import { listUsers, createUser, deleteUser } from "../auth/service.js";
import { requireRole, type AuthedRequest } from "../auth/middleware.js";
import { audit } from "../audit/service.js";

// All routes here are admin-only (mounted behind requireAuth + requireRole).
export const usersRouter = Router();

usersRouter.use(requireRole("admin"));

usersRouter.get("/", async (_req, res) => {
  res.json(await listUsers());
});

usersRouter.post("/", async (req: AuthedRequest, res) => {
  const { email, password, role } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const err = await createUser(email, password, role ?? "operator");
  if (err) return res.status(400).json({ error: err });
  await audit({
    actor: req.user!.email,
    actorRole: req.user!.role,
    action: "user.create",
    target: email,
    detail: `role=${role ?? "operator"}`,
    ip: req.ip,
  });
  res.status(201).json({ ok: true });
});

usersRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const err = await deleteUser(req.params.id);
  if (err) return res.status(400).json({ error: err });
  await audit({
    actor: req.user!.email,
    actorRole: req.user!.role,
    action: "user.delete",
    target: req.params.id,
    ip: req.ip,
  });
  res.json({ ok: true });
});
