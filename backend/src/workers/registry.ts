import { nanoid } from "nanoid";
import { Setting } from "../db/mongo.js";
import { config } from "../config.js";
import type { WorkerRef } from "../worker/exec.js";

const KEY = "workers";

export interface Worker {
  id: string;
  name: string;
  url: string;
  token: string;
  enabled: boolean;
}

interface WorkerStore {
  workers: Worker[];
  defaultId: string;
}

async function write(store: WorkerStore): Promise<void> {
  await Setting.updateOne({ key: KEY }, { $set: { value: store } }, { upsert: true });
}

/** Load the worker store, seeding the primary worker from .env on first use. */
async function load(): Promise<WorkerStore> {
  const doc = await Setting.findOne({ key: KEY }).lean();
  const v = doc?.value as Partial<WorkerStore> | undefined;
  if (v && Array.isArray(v.workers) && v.workers.length) {
    return { workers: v.workers, defaultId: v.defaultId || v.workers[0].id };
  }
  const id = nanoid(8);
  const primary: Worker = {
    id,
    name: "Primary Kali",
    url: config.worker.url,
    token: config.worker.token,
    enabled: true,
  };
  const store: WorkerStore = { workers: [primary], defaultId: id };
  await write(store);
  return store;
}

export async function getDefaultWorker(): Promise<WorkerRef> {
  const s = await load();
  const w =
    s.workers.find((x) => x.id === s.defaultId && x.enabled) ??
    s.workers.find((x) => x.enabled) ??
    s.workers[0];
  return w ? { url: w.url, token: w.token } : { url: config.worker.url, token: config.worker.token };
}

/** Resolve a worker by id, falling back to the default when missing/disabled. */
export async function getWorkerRef(id?: string | null): Promise<WorkerRef> {
  if (!id) return getDefaultWorker();
  const s = await load();
  const w = s.workers.find((x) => x.id === id && x.enabled);
  return w ? { url: w.url, token: w.token } : getDefaultWorker();
}

export interface WorkerPublic {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  isDefault: boolean;
  tokenSet: boolean;
}

export async function listWorkers(): Promise<{ workers: WorkerPublic[]; defaultId: string }> {
  const s = await load();
  return {
    defaultId: s.defaultId,
    workers: s.workers.map((w) => ({
      id: w.id,
      name: w.name,
      url: w.url,
      enabled: w.enabled,
      isDefault: w.id === s.defaultId,
      tokenSet: Boolean(w.token),
    })),
  };
}

export interface EnabledWorker {
  id: string;
  name: string;
  ref: WorkerRef;
}

/** All enabled workers, with their connection refs — for fan-out (e.g. feed updates). */
export async function getEnabledWorkers(): Promise<EnabledWorker[]> {
  const s = await load();
  return s.workers
    .filter((w) => w.enabled)
    .map((w) => ({ id: w.id, name: w.name, ref: { url: w.url, token: w.token } }));
}

export async function getWorkerById(id: string): Promise<WorkerRef | null> {
  const s = await load();
  const w = s.workers.find((x) => x.id === id);
  return w ? { url: w.url, token: w.token } : null;
}

export interface WorkerInput {
  name?: string;
  url?: string;
  token?: string;
  enabled?: boolean;
}

export async function createWorker(data: WorkerInput): Promise<string> {
  const s = await load();
  const id = nanoid(8);
  s.workers.push({
    id,
    name: data.name?.trim() || "Kali worker",
    url: (data.url ?? "").trim(),
    token: data.token ?? "",
    enabled: data.enabled ?? true,
  });
  if (!s.defaultId) s.defaultId = id;
  await write(s);
  return id;
}

export async function updateWorker(id: string, patch: WorkerInput): Promise<boolean> {
  const s = await load();
  const w = s.workers.find((x) => x.id === id);
  if (!w) return false;
  if (patch.name !== undefined) w.name = patch.name.trim() || w.name;
  if (patch.url !== undefined) w.url = patch.url.trim();
  if (patch.enabled !== undefined) w.enabled = patch.enabled;
  if (patch.token) w.token = patch.token; // blank = keep
  await write(s);
  return true;
}

export async function deleteWorker(id: string): Promise<boolean> {
  const s = await load();
  const idx = s.workers.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  s.workers.splice(idx, 1);
  if (s.defaultId === id) s.defaultId = s.workers[0]?.id ?? "";
  await write(s);
  return true;
}

export async function setDefaultWorker(id: string): Promise<boolean> {
  const s = await load();
  if (!s.workers.some((x) => x.id === id)) return false;
  s.defaultId = id;
  await write(s);
  return true;
}
