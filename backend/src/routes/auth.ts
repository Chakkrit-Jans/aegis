import { Router } from "express";
import { login, changePassword } from "../auth/service.js";
import { requireAuth, type AuthedRequest } from "../auth/middleware.js";
import { audit } from "../audit/service.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: "email and password required" });
  const token = await login(email, password);
  if (!token) {
    await audit({ actor: String(email), action: "login.fail", ip: req.ip });
    return res.status(401).json({ error: "invalid credentials" });
  }
  await audit({ actor: String(email).toLowerCase(), action: "login.success", ip: req.ip });
  res.json({ token });
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ email: req.user!.email, role: req.user!.role });
});

authRouter.post("/change-password", requireAuth, async (req: AuthedRequest, res) => {
  const { current, next } = req.body ?? {};
  if (!current || !next) return res.status(400).json({ error: "current and next password required" });
  const err = await changePassword(req.user!.sub, current, next);
  if (err) return res.status(400).json({ error: err });
  res.json({ ok: true });
});
