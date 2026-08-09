import { Router } from "express";
import { Engagement, Session, Approval, Audit } from "../db/mongo.js";
import { getEnabledWorkers } from "../workers/registry.js";
import { workerHealth } from "../worker/exec.js";

export const dashboardRouter = Router();

const SEVS = ["critical", "high", "medium", "low", "info"];

/** Best-effort worker health with a short cap so a down worker can't stall the page. */
async function health(ref: { url: string; token: string }): Promise<{ ok: boolean; tools: number; error: string }> {
  const timeout = new Promise<{ ok: boolean; error: string }>((r) =>
    setTimeout(() => r({ ok: false, error: "timeout" }), 4000)
  );
  const h = await Promise.race([workerHealth(ref).catch(() => ({ ok: false, error: "unreachable" })), timeout]);
  return { ok: h.ok, tools: "tools" in h && h.tools ? h.tools.length : 0, error: "error" in h ? h.error ?? "" : "" };
}

// Cross-engagement overview for the Dashboard landing tab (read-only; any role).
dashboardRouter.get("/", async (_req, res) => {
  const [engagements, byStatusAgg, sessionsTotal, recentSessionsRaw, pending, audit, workers] = await Promise.all([
    Engagement.find().select("slug name findings").lean(),
    Session.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    Session.countDocuments(),
    Session.find().select("objective status engagement updatedAt").sort({ updatedAt: -1 }).limit(8).lean(),
    Approval.find({ status: "pending" }).sort({ createdAt: -1 }).limit(20).lean(),
    Audit.find().sort({ createdAt: -1 }).limit(8).lean(),
    getEnabledWorkers(),
  ]);

  const engById = new Map(engagements.map((e) => [String(e._id), e]));
  const engInfo = (id?: unknown) => {
    const e = id ? engById.get(String(id)) : null;
    return { slug: e?.slug ?? "", name: e?.name ?? "(deleted)" };
  };

  // Findings rolled up by severity across every engagement.
  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let findingsTotal = 0;
  for (const e of engagements)
    for (const f of e.findings ?? []) {
      const s = String(f.severity ?? "info").toLowerCase();
      bySeverity[SEVS.includes(s) ? s : "info"]++;
      findingsTotal++;
    }

  const byStatus: Record<string, number> = {};
  for (const g of byStatusAgg) byStatus[g._id] = g.n;

  // Map the pending approvals' sessions to their engagements (targeted lookup).
  const pendSessIds = [...new Set(pending.map((a) => String(a.session)))];
  const pendSessions = pendSessIds.length
    ? await Session.find({ _id: { $in: pendSessIds } }).select("engagement").lean()
    : [];
  const sessEng = new Map(pendSessions.map((s) => [String(s._id), String(s.engagement)]));

  const workerHealth_ = await Promise.all(
    workers.map(async (w) => ({ id: w.id, name: w.name, url: w.ref.url, ...(await health(w.ref)) }))
  );

  res.json({
    engagements: engagements.length,
    findings: { total: findingsTotal, bySeverity },
    sessions: { total: sessionsTotal, byStatus },
    pendingApprovals: pending.map((a) => ({
      id: String(a._id),
      tool: a.tool,
      rationale: a.rationale,
      sessionId: String(a.session),
      createdAt: a.createdAt,
      ...engInfo(sessEng.get(String(a.session))),
    })),
    recentSessions: recentSessionsRaw.map((s) => ({
      id: String(s._id),
      objective: s.objective,
      status: s.status,
      updatedAt: s.updatedAt,
      ...engInfo(s.engagement),
    })),
    workers: workerHealth_,
    recentAudit: audit.map((a) => ({ actor: a.actor, action: a.action, target: a.target, createdAt: a.createdAt })),
  });
});
