import { Router } from "express";
import { Engagement, Session, Approval } from "../db/mongo.js";
import { renderReport } from "../ai/tools.js";
import { renderReportHtml } from "../report/html.js";
import { eeHooks } from "../lib/eehooks.js";
import { audit } from "../audit/service.js";
import type { AuthedRequest } from "../auth/middleware.js";

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const engagementsRouter = Router();

engagementsRouter.get("/", async (_req, res) => {
  const list = await Engagement.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});

engagementsRouter.post("/", async (req, res) => {
  const { name, client, worker } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name required" });
  const slug = slugify(name);
  if (await Engagement.findOne({ slug }))
    return res.status(409).json({ error: "engagement already exists" });
  const eng = await Engagement.create({ slug, name, client: client ?? "", worker: worker ?? "" });
  res.status(201).json(eng);
});

// Assign which Kali worker this engagement runs on ("" = default worker).
engagementsRouter.post("/:slug/worker", async (req, res) => {
  const { worker } = req.body ?? {};
  const eng = await Engagement.findOneAndUpdate(
    { slug: req.params.slug },
    { $set: { worker: typeof worker === "string" ? worker : "" } },
    { new: true }
  );
  if (!eng) return res.status(404).json({ error: "not found" });
  res.json(eng);
});

engagementsRouter.get("/:slug", async (req, res) => {
  const eng = await Engagement.findOne({ slug: req.params.slug }).lean();
  if (!eng) return res.status(404).json({ error: "not found" });
  res.json(eng);
});

// Delete an engagement and all of its sessions/approvals. Blocked while a
// session is still running or awaiting approval (stop it first) so the agent
// loop can't keep writing to a deleted engagement.
engagementsRouter.delete("/:slug", async (req: AuthedRequest, res) => {
  const eng = await Engagement.findOne({ slug: req.params.slug });
  if (!eng) return res.status(404).json({ error: "not found" });

  const active = await Session.findOne({
    engagement: eng._id,
    status: { $in: ["running", "waiting_approval"] },
  }).lean();
  if (active)
    return res.status(409).json({ error: "A session is still running — stop it first, then delete." });

  const sessions = await Session.find({ engagement: eng._id }).select("_id").lean();
  const sessionIds = sessions.map((s) => s._id);
  if (sessionIds.length) await Approval.deleteMany({ session: { $in: sessionIds } });
  await Session.deleteMany({ engagement: eng._id });
  await Engagement.deleteOne({ _id: eng._id });

  await audit({
    actor: req.user?.email ?? "operator",
    actorRole: req.user?.role,
    action: "engagement.delete",
    target: eng.slug,
    detail: `${eng.name} · ${sessionIds.length} session(s), ${eng.findings?.length ?? 0} finding(s)`,
    ip: req.ip,
  });
  res.json({ ok: true });
});

// Record authorization (required before any active tool).
engagementsRouter.post("/:slug/auth", async (req, res) => {
  const { by, ref } = req.body ?? {};
  if (!by) return res.status(400).json({ error: "`by` (who authorized) required" });
  const eng = await Engagement.findOneAndUpdate(
    { slug: req.params.slug },
    { $set: { authorization: { granted: true, by, ref: ref ?? "", at: new Date() } } },
    { new: true }
  );
  if (!eng) return res.status(404).json({ error: "not found" });
  res.json(eng);
});

// Manage scope include/exclude lists.
engagementsRouter.post("/:slug/scope", async (req, res) => {
  const { add, exclude, remove } = req.body ?? {};
  const eng = await Engagement.findOne({ slug: req.params.slug });
  if (!eng) return res.status(404).json({ error: "not found" });
  if (!eng.scope) eng.scope = { include: [], exclude: [] };
  if (add) eng.scope.include = [...new Set([...eng.scope.include, add])];
  if (exclude) eng.scope.exclude = [...new Set([...eng.scope.exclude, exclude])];
  if (remove) {
    eng.scope.include = eng.scope.include.filter((t: string) => t !== remove);
    eng.scope.exclude = eng.scope.exclude.filter((t: string) => t !== remove);
  }
  await eng.save();
  res.json(eng);
});

// Render the engagement's findings as a Markdown report.
engagementsRouter.get("/:slug/report", async (req, res) => {
  const eng = await Engagement.findOne({ slug: req.params.slug }).lean();
  if (!eng) return res.status(404).json({ error: "not found" });
  res.type("text/markdown").send(renderReport(eng));
});

// Print-ready HTML report (the frontend opens it and "Save as PDF").
engagementsRouter.get("/:slug/report.html", async (req, res) => {
  const eng = await Engagement.findOne({ slug: req.params.slug }).lean();
  if (!eng) return res.status(404).json({ error: "not found" });
  const date = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
  const branding = await eeHooks.effectiveBranding();
  res.type("text/html").send(renderReportHtml(eng, date, branding));
});

engagementsRouter.post("/:slug/findings", async (req, res) => {
  const { title, severity, asset, detail } = req.body ?? {};
  if (!title) return res.status(400).json({ error: "title required" });
  const eng = await Engagement.findOneAndUpdate(
    { slug: req.params.slug },
    { $push: { findings: { title, severity: severity ?? "info", asset: asset ?? "", detail: detail ?? "" } } },
    { new: true }
  );
  if (!eng) return res.status(404).json({ error: "not found" });
  res.json(eng);
});
