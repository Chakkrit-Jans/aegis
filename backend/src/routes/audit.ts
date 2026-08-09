import { Router } from "express";
import { Audit } from "../db/mongo.js";

export const auditRouter = Router();

// Recent audit entries, newest first. Optional ?action= and ?target= filters.
// (Export & SIEM streaming are an Enterprise add-on — see ee/routes-audit-export.)
auditRouter.get("/", async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (typeof req.query.action === "string") filter.action = req.query.action;
  if (typeof req.query.target === "string") filter.target = req.query.target;
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const entries = await Audit.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  res.json(entries);
});
