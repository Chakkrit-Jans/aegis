import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { getActiveAiConfig, activeModelFor } from "./ai/settings.js";
import { connectMongo, Session } from "./db/mongo.js";
import { engagementsRouter } from "./routes/engagements.js";
import { sessionsRouter } from "./routes/sessions.js";
import { resumeSession } from "./ai/orchestrator.js";
import { updatesRouter } from "./routes/updates.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { auditRouter } from "./routes/audit.js";
import { shellRouter } from "./routes/shell.js";
import { integrationsRouter } from "./routes/integrations.js";
import { workersRouter } from "./routes/workers.js";
import { templatesRouter } from "./routes/templates.js";
import { editionRouter } from "./routes/edition.js";
import { aboutRouter } from "./routes/about.js";
import { initUpdates } from "./updates/service.js";
import { startTelegramPolling } from "./telegram/gateway.js";
import { seedAdmin, verify } from "./auth/service.js";
import { requireAuth } from "./auth/middleware.js";
import { log } from "./lib/log.js";

async function main() {
  await connectMongo();
  await seedAdmin();

  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: config.corsOrigin } });

  // Socket connections must carry a valid token (socket.handshake.auth.token).
  io.use((socket, next) => {
    const token = (socket.handshake.auth?.token as string) ?? "";
    if (!verify(token)) return next(new Error("unauthorized"));
    next();
  });

  io.on("connection", (socket) => {
    socket.on("join", (sessionId: string) => {
      if (typeof sessionId === "string") socket.join(`session:${sessionId}`);
    });
  });

  // Resume any sessions that were mid-run when this process last stopped. Their
  // conversation and any pending approval are persisted, so both the agent loop
  // and the human-in-the-loop gate survive a backend restart.
  const inflight = await Session.find({ status: { $in: ["running", "waiting_approval"] } }).select("_id").lean();
  for (const s of inflight) resumeSession(String(s._id), io).catch((e) => log.error("resume failed", e));
  if (inflight.length) log.info(`resuming ${inflight.length} in-flight session(s)`);

  app.get("/health", async (_req, res) => {
    const ai = await getActiveAiConfig();
    res.json({ ok: true, provider: ai.provider, model: activeModelFor(ai), keySet: Boolean(ai.apiKey) });
  });
  app.use("/api/auth", authRouter);
  app.use("/api/engagements", requireAuth, engagementsRouter);
  app.use("/api/sessions", requireAuth, sessionsRouter(io));
  app.use("/api/updates", requireAuth, updatesRouter);
  app.use("/api/shell", requireAuth, shellRouter(io));
  app.use("/api/integrations", requireAuth, integrationsRouter);
  app.use("/api/workers", requireAuth, workersRouter);
  app.use("/api/templates", requireAuth, templatesRouter);
  app.use("/api/edition", requireAuth, editionRouter);
  app.use("/api/about", requireAuth, aboutRouter);
  app.use("/api/users", requireAuth, usersRouter);
  app.use("/api/audit", requireAuth, auditRouter);

  // Open-core: load the Enterprise overlay if it's present in this build.
  // The `ee/` folder is absent from the public Community repo (import fails →
  // Community mode); the private Enterprise build overlays it and unlocks the
  // extra routers + hooks. The path is built at runtime so tsc doesn't require
  // the module to exist when compiling Community.
  try {
    const eePath = "./ee/index.js";
    const ee = (await import(eePath)) as { registerEnterprise: (app: express.Express) => string[] };
    const feats = ee.registerEnterprise(app);
    log.info(`Enterprise modules loaded: ${feats.join(", ")}`);
  } catch {
    log.info("Community edition (no Enterprise modules present)");
  }

  await initUpdates(io);
  startTelegramPolling();

  httpServer.listen(config.port, () => {
    log.info(`Aegis backend on :${config.port} (default AI provider: ${config.ai.provider})`);
  });
}

main().catch((e) => {
  log.error("fatal", e);
  process.exit(1);
});
