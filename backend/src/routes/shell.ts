import { Router } from "express";
import type { Server } from "socket.io";
import { Engagement, ShellCommand } from "../db/mongo.js";
import { workerShell } from "../worker/exec.js";
import { getWorkerRef } from "../workers/registry.js";
import { audit } from "../audit/service.js";
import type { AuthedRequest } from "../auth/middleware.js";

/**
 * Operator live shell. The operator is the authorized human, so their own
 * commands run directly — but only within an AUTHORIZED engagement, every
 * command is audit-logged, and the worker applies a destructive-command filter.
 */
export function shellRouter(io: Server): Router {
  const router = Router();

  router.post("/", async (req: AuthedRequest, res) => {
    const { engagementSlug, sessionId, command, cwd } = req.body ?? {};
    if (!command || typeof command !== "string")
      return res.status(400).json({ error: "command required" });
    const eng = await Engagement.findOne({ slug: engagementSlug });
    if (!eng) return res.status(404).json({ error: "engagement not found" });
    if (!eng.authorization?.granted)
      return res.status(403).json({ error: "engagement has no recorded authorization" });

    const doc = await ShellCommand.create({
      engagement: eng._id,
      session: sessionId || null,
      actor: req.user!.email,
      command,
      cwd: cwd || "",
      status: "running",
    });
    await audit({
      actor: req.user!.email,
      actorRole: req.user!.role,
      action: "shell.exec",
      target: engagementSlug,
      detail: command,
      ip: req.ip,
    });

    const worker = await getWorkerRef(eng.worker);
    const result = await workerShell(worker, command, cwd || "/root");
    doc.exitCode = result.code;
    doc.output = result.output;
    doc.status = result.code === -1 ? "error" : "done";
    await doc.save();

    if (sessionId) {
      io.to(`session:${sessionId}`).emit("transcript", {
        role: "tool",
        tool: "shell",
        content: `$ ${command}\n${result.output}`,
        at: new Date(),
      });
    }
    res.json({ code: result.code, output: result.output });
  });

  router.get("/history", async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (typeof req.query.engagement === "string") {
      const eng = await Engagement.findOne({ slug: req.query.engagement }).lean();
      if (eng) filter.engagement = eng._id;
    }
    const list = await ShellCommand.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    res.json(list);
  });

  return router;
}
