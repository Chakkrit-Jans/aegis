import { Router } from "express";
import type { Server } from "socket.io";
import { Engagement, Session, Approval } from "../db/mongo.js";
import { runSession, decideApproval } from "../ai/orchestrator.js";
import { runChatTurn } from "../ai/chat.js";
import { requestStop, pushSteer } from "../sessions/control.js";
import { isEnterprise } from "../edition/service.js";
import { audit } from "../audit/service.js";
import type { AuthedRequest } from "../auth/middleware.js";
import { log } from "../lib/log.js";

export function sessionsRouter(io: Server): Router {
  const router = Router();

  // Create a session for an engagement and (optionally) start the agent loop.
  router.post("/", async (req, res) => {
    const { engagementSlug, objective, autostart, autoApprove } = req.body ?? {};
    const eng = await Engagement.findOne({ slug: engagementSlug });
    if (!eng) return res.status(404).json({ error: "engagement not found" });
    const session = await Session.create({
      engagement: eng._id,
      objective: objective ?? "",
      autoApprove: Boolean(autoApprove),
    });
    const id = String(session._id);
    if (autostart !== false) {
      runSession(id, io).catch((e) => log.error("runSession failed", e));
    }
    res.status(201).json(session);
  });

  // List past sessions for an engagement (lightweight — no full transcript).
  router.get("/", async (req, res) => {
    const slug = req.query.engagement;
    if (typeof slug !== "string") return res.status(400).json({ error: "engagement query required" });
    const eng = await Engagement.findOne({ slug }).lean();
    if (!eng) return res.status(404).json({ error: "engagement not found" });
    const list = await Session.find({ engagement: eng._id })
      .select("objective status createdAt transcript")
      .sort({ createdAt: -1 })
      .lean();
    res.json(
      list.map((s) => ({
        _id: String(s._id),
        objective: s.objective,
        status: s.status,
        createdAt: s.createdAt,
        entries: (s.transcript ?? []).length,
      }))
    );
  });

  router.get("/:id", async (req, res) => {
    const session = await Session.findById(req.params.id).lean();
    if (!session) return res.status(404).json({ error: "not found" });
    res.json(session);
  });

  // Stop a running session (cancel). Also unblocks one waiting on approval.
  router.post("/:id/stop", async (req: AuthedRequest, res) => {
    requestStop(req.params.id);
    const pending = await Approval.findOne({ session: req.params.id, status: "pending" });
    if (pending) await decideApproval(String(pending._id), false, req.user?.email ?? "operator-stop");
    await audit({ actor: req.user?.email ?? "operator", action: "session.stop", target: req.params.id, ip: req.ip });
    res.json({ ok: true });
  });

  // (Re)start the agent loop for an existing session.
  router.post("/:id/start", async (req, res) => {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ error: "not found" });
    runSession(String(session._id), io).catch((e) => log.error("runSession failed", e));
    res.json({ ok: true });
  });

  // Conversational chat to a session. The operator message is appended to the
  // transcript immediately, then:
  //   - autonomous run in progress (running) → queued as live guidance (steer);
  //   - a proposed action is awaiting confirmation (waiting_approval) → rejected,
  //     the operator must confirm/cancel that first;
  //   - otherwise (idle/done/stopped) → a chat turn: the agent replies with the
  //     command + target it proposes, waits for confirmation, runs it, and logs
  //     the result. Active/intrusive tools always pass the confirmation gate.
  router.post("/:id/chat", async (req: AuthedRequest, res) => {
    // Edition gate: the AI Chat control is an Enterprise feature.
    if (!(await isEnterprise()))
      return res.status(402).json({
        error: "AI Chat control requires an Enterprise license.",
        feature: "ai.chat",
        upgrade: true,
      });
    const text = String(req.body?.text ?? "").trim();
    if (!text) return res.status(400).json({ error: "text required" });
    if (text.length > 2000) return res.status(400).json({ error: "text too long (max 2000 chars)" });
    const session = await Session.findById(req.params.id).select("status").lean();
    if (!session) return res.status(404).json({ error: "not found" });
    if (session.status === "waiting_approval")
      return res.status(409).json({ error: "confirm or cancel the pending action first" });

    const entry = { role: "user", content: text, tool: "", meta: { steer: true }, at: new Date() };
    await Session.findByIdAndUpdate(req.params.id, { $push: { transcript: entry } });
    io.to(`session:${req.params.id}`).emit("transcript", entry);
    await audit({
      actor: req.user?.email ?? "operator",
      actorRole: req.user?.role,
      action: "session.chat",
      target: req.params.id,
      detail: text.slice(0, 200),
      ip: req.ip,
    });

    if (session.status === "running") {
      // An autonomous loop owns the session — feed the message as live guidance.
      pushSteer(req.params.id, text);
      return res.json({ ok: true, mode: "steered" });
    }
    // Operator-driven chat turn (propose → confirm → execute → log).
    runChatTurn(req.params.id, io, text).catch((e) => log.error("chat turn failed", e));
    res.json({ ok: true, mode: "chat" });
  });

  // Operator decision on a pending active-tool approval.
  router.post("/:id/approvals/:approvalId", async (req: AuthedRequest, res) => {
    const { decision } = req.body ?? {};
    if (decision !== "approve" && decision !== "reject")
      return res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
    const approval = await Approval.findById(req.params.approvalId);
    if (!approval) return res.status(404).json({ error: "approval not found" });
    if (approval.status !== "pending")
      return res.status(409).json({ error: `already ${approval.status}` });
    const outcome = await decideApproval(String(approval._id), decision === "approve", req.user?.email ?? "operator");
    if (outcome !== "ok") return res.status(409).json({ error: "approval no longer pending" });
    await audit({
      actor: req.user?.email ?? "operator",
      actorRole: req.user?.role,
      action: `approval.${decision}`,
      target: String(approval._id),
      detail: approval.tool,
      meta: { sessionId: req.params.id },
      ip: req.ip,
    });
    res.json({ ok: true });
  });

  return router;
}
