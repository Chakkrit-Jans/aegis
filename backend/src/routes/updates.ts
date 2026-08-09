import { Router } from "express";
import { getState, runSource, runAll, setSchedule } from "../updates/service.js";
import { UPDATE_SOURCES } from "../updates/registry.js";
import { getEnabledWorkers } from "../workers/registry.js";
import { isEnterprise } from "../edition/service.js";

export const updatesRouter = Router();

// Current feed status per worker + auto-update schedule.
updatesRouter.get("/", async (_req, res) => {
  const state = await getState();
  const workers = await getEnabledWorkers();
  res.json({
    sources: UPDATE_SOURCES.map((s) => ({ id: s.id, label: s.label, description: s.description })),
    workers: workers.map((w) => ({ id: w.id, name: w.name })),
    runs: state.runsByWorker,
    autoEnabled: state.autoEnabled,
    intervalHours: state.intervalHours,
  });
});

// Manual: update every feed on every enabled worker.
updatesRouter.post("/run-all", async (_req, res) => {
  res.json(await runAll());
});

// Manual: update one feed on every enabled worker.
updatesRouter.post("/:id/run", async (req, res) => {
  if (!UPDATE_SOURCES.some((s) => s.id === req.params.id))
    return res.status(404).json({ error: "unknown source" });
  res.json(await runSource(req.params.id));
});

// Configure auto-update (enable/disable + interval in hours). Enabling the
// schedule is an Enterprise feature; manual updates above are always available.
updatesRouter.post("/schedule", async (req, res) => {
  const { autoEnabled, intervalHours } = req.body ?? {};
  if (Boolean(autoEnabled) && !(await isEnterprise()))
    return res.status(402).json({
      error: "Scheduled auto-updates are an Enterprise feature. Manual 'Update all' is always available in Community.",
      feature: "feeds.schedule",
      upgrade: true,
    });
  res.json(await setSchedule(Boolean(autoEnabled), Number(intervalHours) || 24));
});
