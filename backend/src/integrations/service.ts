import { Setting } from "../db/mongo.js";

const KEY = "integrations";

export interface ProxyConfig {
  enabled: boolean;
  url: string; // e.g. http://host.docker.internal:8080 (Burp) or :8081 (Caido)
  label: string; // "burp" | "caido" | "custom"
}

export interface TelegramConfig {
  enabled: boolean;
  botToken: string;
  chatId: string;
}

export interface Integrations {
  proxy: ProxyConfig;
  telegram: TelegramConfig;
}

const defaults: Integrations = {
  proxy: { enabled: false, url: "", label: "burp" },
  telegram: { enabled: false, botToken: "", chatId: "" },
};

export async function getIntegrations(): Promise<Integrations> {
  const doc = await Setting.findOne({ key: KEY }).lean();
  const stored = (doc?.value as Partial<Integrations>) ?? {};
  return {
    proxy: { ...defaults.proxy, ...(stored.proxy ?? {}) },
    telegram: { ...defaults.telegram, ...(stored.telegram ?? {}) },
  };
}

async function save(next: Integrations): Promise<void> {
  await Setting.updateOne({ key: KEY }, { $set: { value: next } }, { upsert: true });
}

/** Client-safe view: never leak the bot token, just whether one is set. */
export interface IntegrationsPublic {
  proxy: ProxyConfig;
  telegram: { enabled: boolean; chatId: string; botTokenSet: boolean };
}

export function toPublic(i: Integrations): IntegrationsPublic {
  return {
    proxy: i.proxy,
    telegram: {
      enabled: i.telegram.enabled,
      chatId: i.telegram.chatId,
      botTokenSet: Boolean(i.telegram.botToken),
    },
  };
}

export async function setProxy(p: Partial<ProxyConfig>): Promise<Integrations> {
  const cur = await getIntegrations();
  cur.proxy = { ...cur.proxy, ...p };
  await save(cur);
  return cur;
}

export async function setTelegram(t: Partial<TelegramConfig>): Promise<Integrations> {
  const cur = await getIntegrations();
  // An empty botToken in the update means "leave unchanged" so the UI never has
  // to resend the secret.
  const botToken = t.botToken ? t.botToken : cur.telegram.botToken;
  cur.telegram = { ...cur.telegram, ...t, botToken };
  await save(cur);
  return cur;
}

/** Active proxy URL for routing tool traffic, or "" when disabled. */
export async function proxyUrl(): Promise<string> {
  const { proxy } = await getIntegrations();
  return proxy.enabled && proxy.url ? proxy.url : "";
}
