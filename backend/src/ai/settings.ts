import { nanoid } from "nanoid";
import { Setting } from "../db/mongo.js";
import { config, DEFAULT_MODELS, type ProviderName } from "../config.js";

const KEY = "ai";

/** A saved AI provider profile. Multiple can exist; one is the default (active). */
export interface AiProfile {
  id: string;
  name: string;
  provider: ProviderName;
  apiKey: string; // secret
  baseUrl: string; // openai-compatible base URL
  model: string; // "" = provider default
}

/** Flat config the orchestrator/providers consume (the active profile, resolved). */
export interface AiConfig {
  provider: ProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface AiStore {
  profiles: AiProfile[];
  defaultId: string;
}

function envKeyFor(p: ProviderName): string {
  return p === "deepseek" ? config.ai.deepseekKey : p === "anthropic" ? config.ai.anthropicKey : config.ai.apiKey;
}
function labelFor(p: string): string {
  return p === "deepseek" ? "DeepSeek" : p === "anthropic" ? "Anthropic" : "OpenAI-compatible";
}

async function writeStore(store: AiStore): Promise<void> {
  await Setting.updateOne({ key: KEY }, { $set: { value: store } }, { upsert: true });
}

/** Load the profile store, migrating the legacy single-config shape if present. */
async function loadStore(): Promise<AiStore> {
  const doc = await Setting.findOne({ key: KEY }).lean();
  const v = (doc?.value ?? null) as
    | (Partial<AiStore> & Partial<AiProfile>)
    | null;

  if (v && Array.isArray(v.profiles)) {
    return { profiles: v.profiles, defaultId: v.defaultId || v.profiles[0]?.id || "" };
  }
  // Migrate legacy { provider, apiKey, baseUrl, model } → one profile.
  if (v && (v.provider || v.apiKey || v.model)) {
    const id = nanoid(8);
    const prof: AiProfile = {
      id,
      name: labelFor(v.provider ?? config.ai.provider),
      provider: (v.provider ?? config.ai.provider) as ProviderName,
      apiKey: v.apiKey ?? "",
      baseUrl: v.baseUrl ?? "",
      model: v.model ?? "",
    };
    const store: AiStore = { profiles: [prof], defaultId: id };
    await writeStore(store);
    return store;
  }
  // Fresh install: seed one profile from the .env defaults and persist it.
  const id = nanoid(8);
  const prof: AiProfile = {
    id,
    name: labelFor(config.ai.provider),
    provider: config.ai.provider,
    apiKey: envKeyFor(config.ai.provider),
    baseUrl: config.ai.baseUrl,
    model: config.ai.model,
  };
  const store: AiStore = { profiles: [prof], defaultId: id };
  await writeStore(store);
  return store;
}

function profileToConfig(p: AiProfile): AiConfig {
  return {
    provider: p.provider,
    apiKey: p.apiKey || envKeyFor(p.provider),
    baseUrl: p.baseUrl || config.ai.baseUrl,
    model: p.model,
  };
}

export function activeModelFor(c: AiConfig): string {
  return c.model || DEFAULT_MODELS[c.provider];
}

/** The active (default) profile's config — used by the orchestrator and /health. */
export async function getActiveAiConfig(): Promise<AiConfig> {
  const store = await loadStore();
  const prof = store.profiles.find((p) => p.id === store.defaultId) ?? store.profiles[0];
  if (!prof)
    return {
      provider: config.ai.provider,
      apiKey: envKeyFor(config.ai.provider),
      baseUrl: config.ai.baseUrl,
      model: config.ai.model,
    };
  return profileToConfig(prof);
}

export async function getProfileConfig(id: string): Promise<AiConfig | null> {
  const store = await loadStore();
  const prof = store.profiles.find((p) => p.id === id);
  return prof ? profileToConfig(prof) : null;
}

export interface AiProfilePublic {
  id: string;
  name: string;
  provider: ProviderName;
  model: string;
  baseUrl: string;
  apiKeySet: boolean;
  isDefault: boolean;
}

export async function getProfilesPublic(): Promise<{ profiles: AiProfilePublic[]; defaultId: string }> {
  const store = await loadStore();
  return {
    defaultId: store.defaultId,
    profiles: store.profiles.map((p) => ({
      id: p.id,
      name: p.name,
      provider: p.provider,
      model: p.model,
      baseUrl: p.baseUrl,
      apiKeySet: Boolean(p.apiKey || envKeyFor(p.provider)),
      isDefault: p.id === store.defaultId,
    })),
  };
}

export interface ProfileInput {
  name?: string;
  provider: ProviderName;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export async function createProfile(data: ProfileInput): Promise<string> {
  const store = await loadStore();
  const id = nanoid(8);
  store.profiles.push({
    id,
    name: data.name?.trim() || labelFor(data.provider),
    provider: data.provider,
    apiKey: data.apiKey ?? "",
    baseUrl: data.baseUrl ?? "",
    model: data.model ?? "",
  });
  if (!store.defaultId || store.profiles.length === 1) store.defaultId = id;
  await writeStore(store);
  return id;
}

export async function updateProfile(id: string, patch: Partial<ProfileInput>): Promise<boolean> {
  const store = await loadStore();
  const prof = store.profiles.find((p) => p.id === id);
  if (!prof) return false;
  if (patch.name !== undefined) prof.name = patch.name.trim() || prof.name;
  if (patch.provider !== undefined) prof.provider = patch.provider;
  if (patch.baseUrl !== undefined) prof.baseUrl = patch.baseUrl;
  if (patch.model !== undefined) prof.model = patch.model;
  if (patch.apiKey) prof.apiKey = patch.apiKey; // blank = keep existing
  await writeStore(store);
  return true;
}

export async function deleteProfile(id: string): Promise<boolean> {
  const store = await loadStore();
  const idx = store.profiles.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  store.profiles.splice(idx, 1);
  if (store.defaultId === id) store.defaultId = store.profiles[0]?.id ?? "";
  await writeStore(store);
  return true;
}

export async function setDefaultProfile(id: string): Promise<boolean> {
  const store = await loadStore();
  if (!store.profiles.some((p) => p.id === id)) return false;
  store.defaultId = id;
  await writeStore(store);
  return true;
}
