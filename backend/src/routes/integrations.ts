import { Router } from "express";
import {
  getIntegrations,
  toPublic,
  setProxy,
  setTelegram,
} from "../integrations/service.js";
import { sendTest } from "../telegram/gateway.js";
import {
  getProfilesPublic,
  getProfileConfig,
  createProfile,
  updateProfile,
  deleteProfile,
  setDefaultProfile,
} from "../ai/settings.js";
import { makeProvider, listModels } from "../ai/providers.js";
import { requireRole, type AuthedRequest } from "../auth/middleware.js";
import { audit } from "../audit/service.js";
import { isEnterprise } from "../edition/service.js";
import { COMMUNITY_LIMITS } from "../edition/features.js";

// Integrations are admin-managed.
export const integrationsRouter = Router();

integrationsRouter.use(requireRole("admin"));

// --- AI provider profiles (multiple; one is the default/active) ---
const PROVIDERS = ["deepseek", "anthropic", "openai-compatible"] as const;
type ProviderName = (typeof PROVIDERS)[number];
const isProvider = (v: unknown): v is ProviderName =>
  typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);

integrationsRouter.get("/ai/profiles", async (_req, res) => {
  res.json(await getProfilesPublic());
});

integrationsRouter.post("/ai/profiles", async (req: AuthedRequest, res) => {
  const { name, provider, apiKey, baseUrl, model } = req.body ?? {};
  if (!isProvider(provider))
    return res.status(400).json({ error: "provider must be deepseek | anthropic | openai-compatible" });
  // Edition gate: Community allows a single AI provider profile.
  if (!(await isEnterprise())) {
    const { profiles } = await getProfilesPublic();
    if (profiles.length >= COMMUNITY_LIMITS.aiProviders)
      return res.status(402).json({
        error: `Community edition is limited to ${COMMUNITY_LIMITS.aiProviders} AI provider. Upgrade to Enterprise for multiple providers with routing and fallback.`,
        feature: "ai.multiProvider",
        upgrade: true,
      });
  }
  const id = await createProfile({ name, provider, apiKey, baseUrl, model });
  await audit({
    actor: req.user!.email, actorRole: req.user!.role,
    action: "integrations.ai.create", detail: `${name || provider} (${provider})`, ip: req.ip,
  });
  res.status(201).json({ id });
});

integrationsRouter.put("/ai/profiles/:id", async (req: AuthedRequest, res) => {
  const { name, provider, apiKey, baseUrl, model } = req.body ?? {};
  if (provider !== undefined && !isProvider(provider))
    return res.status(400).json({ error: "invalid provider" });
  const ok = await updateProfile(req.params.id, {
    ...(typeof name === "string" ? { name } : {}),
    ...(isProvider(provider) ? { provider } : {}),
    ...(typeof apiKey === "string" ? { apiKey } : {}),
    ...(typeof baseUrl === "string" ? { baseUrl } : {}),
    ...(typeof model === "string" ? { model } : {}),
  });
  if (!ok) return res.status(404).json({ error: "profile not found" });
  await audit({
    actor: req.user!.email, actorRole: req.user!.role,
    action: "integrations.ai.update", target: req.params.id, ip: req.ip,
  });
  res.json({ ok: true });
});

integrationsRouter.delete("/ai/profiles/:id", async (req: AuthedRequest, res) => {
  const ok = await deleteProfile(req.params.id);
  if (!ok) return res.status(404).json({ error: "profile not found" });
  await audit({
    actor: req.user!.email, actorRole: req.user!.role,
    action: "integrations.ai.delete", target: req.params.id, ip: req.ip,
  });
  res.json({ ok: true });
});

integrationsRouter.post("/ai/profiles/:id/default", async (req: AuthedRequest, res) => {
  const ok = await setDefaultProfile(req.params.id);
  if (!ok) return res.status(404).json({ error: "profile not found" });
  await audit({
    actor: req.user!.email, actorRole: req.user!.role,
    action: "integrations.ai.default", target: req.params.id, ip: req.ip,
  });
  res.json({ ok: true });
});

// Live check for a specific profile.
integrationsRouter.post("/ai/profiles/:id/test", async (req, res) => {
  try {
    const ai = await getProfileConfig(req.params.id);
    if (!ai) return res.status(404).json({ error: "profile not found" });
    if (!ai.apiKey && ai.provider !== "openai-compatible")
      return res.status(400).json({ error: "no API key configured" });
    const provider = makeProvider(ai);
    const result = await provider.chat([{ role: "user", content: "Reply with the word OK." }], []);
    res.json({ ok: true, provider: provider.name, model: provider.model, reply: result.text.slice(0, 80) });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

// Live model list for a specific profile.
integrationsRouter.get("/ai/profiles/:id/models", async (req, res) => {
  try {
    const ai = await getProfileConfig(req.params.id);
    if (!ai) return res.status(404).json({ error: "profile not found" });
    if (!ai.apiKey && ai.provider !== "openai-compatible")
      return res.status(400).json({ error: "no API key configured" });
    const models = await listModels(ai);
    res.json({ provider: ai.provider, models });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

integrationsRouter.get("/", async (_req, res) => {
  res.json(toPublic(await getIntegrations()));
});

// Burp/Caido (or any) upstream proxy for web tools.
integrationsRouter.post("/proxy", async (req: AuthedRequest, res) => {
  const { enabled, url, label } = req.body ?? {};
  const next = await setProxy({
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(typeof url === "string" ? { url } : {}),
    ...(typeof label === "string" ? { label } : {}),
  });
  await audit({
    actor: req.user!.email,
    actorRole: req.user!.role,
    action: "integrations.proxy",
    detail: `enabled=${next.proxy.enabled} url=${next.proxy.url}`,
    ip: req.ip,
  });
  res.json(toPublic(next));
});

integrationsRouter.post("/telegram", async (req: AuthedRequest, res) => {
  const { enabled, botToken, chatId } = req.body ?? {};
  const next = await setTelegram({
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(typeof botToken === "string" ? { botToken } : {}),
    ...(typeof chatId === "string" ? { chatId } : {}),
  });
  await audit({
    actor: req.user!.email,
    actorRole: req.user!.role,
    action: "integrations.telegram",
    detail: `enabled=${next.telegram.enabled}`,
    ip: req.ip,
  });
  res.json(toPublic(next));
});

integrationsRouter.post("/telegram/test", async (_req, res) => {
  const err = await sendTest();
  if (err) return res.status(400).json({ error: err });
  res.json({ ok: true });
});
