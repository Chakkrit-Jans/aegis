import type { Server } from "socket.io";
import { Setting } from "../db/mongo.js";
import { workerExecStatus, type WorkerRef } from "../worker/exec.js";
import { getEnabledWorkers } from "../workers/registry.js";
import { UPDATE_SOURCES, type UpdateSource } from "./registry.js";
import { isEnterprise } from "../edition/service.js";
import { log } from "../lib/log.js";

const SETTINGS_KEY = "updates";
// setInterval delays must stay under the 2^31-1 ms (~24.8 day) limit.
const MAX_INTERVAL_HOURS = 336; // 14 days

export interface RunResult {
  id: string;
  ok: boolean;
  at: string;
  summary: string;
}

export interface UpdatesState {
  autoEnabled: boolean;
  intervalHours: number;
  // status per worker: runsByWorker[workerId][sourceId]
  runsByWorker: Record<string, Record<string, RunResult>>;
}

const defaultState: UpdatesState = { autoEnabled: false, intervalHours: 24, runsByWorker: {} };

let timer: NodeJS.Timeout | null = null;
let ioRef: Server | null = null;

async function loadState(): Promise<UpdatesState> {
  const doc = await Setting.findOne({ key: SETTINGS_KEY }).lean();
  const stored = (doc?.value as Partial<UpdatesState>) ?? {};
  return {
    autoEnabled: stored.autoEnabled ?? false,
    intervalHours: stored.intervalHours ?? 24,
    runsByWorker: stored.runsByWorker ?? {},
  };
}

async function saveState(state: UpdatesState): Promise<void> {
  await Setting.updateOne({ key: SETTINGS_KEY }, { $set: { value: state } }, { upsert: true });
  ioRef?.emit("updates", { autoEnabled: state.autoEnabled, intervalHours: state.intervalHours });
}

export async function getState(): Promise<UpdatesState> {
  return loadState();
}

// Genuine failure indicators in tool output (independent of exit code).
const FAIL_MARKERS =
  /command not found|worker offline|worker unreachable|is not installed on the worker|not permitted|unauthorized|could not resolve host|fatal:|no such file or directory/i;

/**
 * Judge an update result. Exit code alone is unreliable: nuclei exits 0 on
 * success (but prints "not installed"), while searchsploit exits non-zero (6)
 * even when it succeeds. So: fail only on unreachable worker, timeout (124),
 * missing binary (127), or a clear error marker in the output.
 */
function judgeUpdate(res: { reachable: boolean; code: number; output: string }): boolean {
  if (!res.reachable) return false;
  if (res.code === 124 || res.code === 127) return false; // timeout / binary missing
  return !FAIL_MARKERS.test(res.output);
}

async function runOne(src: UpdateSource, ref: WorkerRef): Promise<RunResult> {
  const res = await workerExecStatus(ref, src.bin, src.updateArgs, src.timeoutMs);
  return {
    id: src.id,
    ok: judgeUpdate(res),
    at: new Date().toISOString(),
    summary: (res.output || "(no output)").slice(0, 500),
  };
}

/** Persist a batch of results (workerId → sourceId → result) into the store. */
async function record(batch: Record<string, Record<string, RunResult>>): Promise<void> {
  const state = await loadState();
  for (const [workerId, sources] of Object.entries(batch)) {
    state.runsByWorker[workerId] = { ...(state.runsByWorker[workerId] ?? {}), ...sources };
  }
  await saveState(state);
}

/** Update one feed on ALL enabled workers, in parallel. */
export async function runSource(id: string): Promise<Record<string, RunResult>> {
  const src = UPDATE_SOURCES.find((s) => s.id === id);
  if (!src) return {};
  const workers = await getEnabledWorkers();
  const out: Record<string, Record<string, RunResult>> = {};
  await Promise.all(
    workers.map(async (w) => {
      log.info(`updating feed ${id} on worker ${w.name}`);
      out[w.id] = { [id]: await runOne(src, w.ref) };
    })
  );
  await record(out);
  const flat: Record<string, RunResult> = {};
  for (const w of workers) flat[w.id] = out[w.id][id];
  return flat;
}

/** Update ALL feeds on ALL enabled workers. Workers run in parallel; feeds per worker sequentially. */
export async function runAll(): Promise<Record<string, Record<string, RunResult>>> {
  const workers = await getEnabledWorkers();
  const out: Record<string, Record<string, RunResult>> = {};
  await Promise.all(
    workers.map(async (w) => {
      const perSource: Record<string, RunResult> = {};
      for (const src of UPDATE_SOURCES) {
        log.info(`updating feed ${src.id} on worker ${w.name}`);
        perSource[src.id] = await runOne(src, w.ref);
      }
      out[w.id] = perSource;
    })
  );
  await record(out);
  return out;
}

export async function setSchedule(autoEnabled: boolean, intervalHours: number): Promise<UpdatesState> {
  const state = await loadState();
  state.autoEnabled = autoEnabled;
  state.intervalHours = Math.max(1, Math.min(MAX_INTERVAL_HOURS, Math.trunc(intervalHours) || 24));
  await saveState(state);
  await restartTimer();
  return state;
}

async function restartTimer(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const state = await loadState();
  if (!state.autoEnabled) {
    log.info("auto-update disabled");
    return;
  }
  // Scheduled auto-updates are an Enterprise feature. A lapsed license stops them.
  if (!(await isEnterprise())) {
    log.info("auto-update requires Enterprise — not scheduling");
    return;
  }
  const ms = state.intervalHours * 3_600_000;
  timer = setInterval(() => {
    isEnterprise().then((ent) => {
      if (!ent) {
        log.info("skipping scheduled update — Enterprise license not active");
        return;
      }
      runAll()
        .then(() => log.info("auto vuln-feed update complete (all workers)"))
        .catch((e) => log.error("auto update failed", e));
    });
  }, ms);
  log.info(`auto-update scheduled every ${state.intervalHours}h (all workers)`);
}

/** Wire up the scheduler on boot (restores persisted schedule). */
export async function initUpdates(io: Server): Promise<void> {
  ioRef = io;
  await restartTimer();
}
